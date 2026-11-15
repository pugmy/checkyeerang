import { locked, prisma } from "./prisma.ts";
import { addDays, today } from "./time.ts";
import { EXAM_WORD, EXEMPT_EVENT_WORDS, GRADE_FLAG, type NeisRow } from "./rules.ts";
import { getSetting, setSetting } from "./settings.ts";

// 환경변수: NEIS_KEY(필수). ATPT_CODE, SCHUL_CODE는 없으면 학교 이름으로 한 번 찾아 DB에 저장한다.
const SCHOOL_NAME = "창원과학고등학교";

async function neis(path: string, params: Record<string, string | number>) {
  const key = (process.env.NEIS_KEY ?? "").replace(/^["'\s]+|["'\s]+$/g, "");
  if (!key) throw new Error("환경변수 NEIS_KEY가 없습니다.");
  const hide = (t: string) => t.split(key).join("***"); // 오류 문구에 키가 새지 않게 한다
  const query = Object.entries(params).map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`).join("&");
  let res: Response;
  try {
    res = await fetch(`https://open.neis.go.kr/hub/${path}?KEY=${key}&Type=json&${query}`, { cache: "no-store" });
  } catch (e) {
    throw new Error("NEIS 호출 실패: " + hide(String((e as Error).message)));
  }
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`NEIS 응답이 JSON이 아닙니다(HTTP ${res.status}): ` + hide(text.slice(0, 200)));
  }
}

// NEIS 응답은 {서비스명: [{head: [...]}, {row: [...]}]} 이거나, 결과가 없으면 {RESULT: {CODE, MESSAGE}}
function neisRows(data: any, service: string): { code: string; rows: NeisRow[] } {
  if (data.RESULT) return { code: data.RESULT.CODE, rows: [] };
  const block = data[service];
  return { code: block[0].head[1].RESULT.CODE, rows: block[1] ? block[1].row : [] };
}

async function schoolParams() {
  let atpt = process.env.ATPT_CODE || (await getSetting(prisma, "ATPT_CODE"));
  let schul = process.env.SCHUL_CODE || (await getSetting(prisma, "SCHUL_CODE"));
  if (!atpt || !schul) {
    const r = neisRows(await neis("schoolInfo", { SCHUL_NM: SCHOOL_NAME }), "schoolInfo");
    if (r.rows.length !== 1) throw new Error(`학교가 ${r.rows.length}개 검색되었습니다. ATPT_CODE, SCHUL_CODE를 환경변수로 넣으세요.`);
    atpt = r.rows[0].ATPT_OFCDC_SC_CODE;
    schul = r.rows[0].SD_SCHUL_CODE;
    await setSetting(prisma, "ATPT_CODE", atpt);
    await setSetting(prisma, "SCHUL_CODE", schul);
  }
  return { ATPT_OFCDC_SC_CODE: atpt, SD_SCHUL_CODE: schul };
}

// ---------- NEIS 학사일정 → 일정 목록(SchoolDay) ----------
// 이번 학년도(3월~다음 해 2월)의 휴업일·공휴일·정기시험을 SchoolDay 행으로 가져온다. 새로 만든 건수를 돌려준다.
// 가져온 뒤에는 사람이 일정 관리에서 수정·해제할 수 있고, 같은 일정(neisKey)은 다시 만들지 않는다.
const SYNC_MS = 24 * 3600 * 1000, RETRY_MS = 10 * 60 * 1000;
let lastTry = 0;

// 두 날짜 사이가 토·일이거나 covered(다른 휴업일·공휴일)뿐이면 한 기간으로 이어 준다.
// NEIS는 방학 중의 주말이나 신정 같은 공휴일에 방학 행을 빼고 주는 경우가 있다.
function bridged(a: string, b: string, covered: Set<string>) {
  for (let x = addDays(a, 1); x < b; x = addDays(x, 1)) {
    const w = new Date(x + "T12:00:00Z").getUTCDay();
    if (w !== 0 && w !== 6 && !covered.has(x)) return false;
  }
  return true;
}

export async function syncNeisSchedule(force = false): Promise<number> {
  if (!force) {
    if (Date.now() - lastTry < RETRY_MS) return 0; // 실패해도 NEIS를 계속 두드리지 않는다
    if (Date.now() - Number((await getSetting(prisma, "NEIS_SYNCED")) ?? 0) < SYNC_MS) return 0;
  }
  lastTry = Date.now();
  const now = today();
  const year = Number(now.slice(0, 4)) - (now.slice(5, 7) < "03" ? 1 : 0);
  const to = addDays(`${year + 1}-03-01`, -1);
  const r = neisRows(
    await neis("SchoolSchedule", {
      ...(await schoolParams()),
      AA_FROM_YMD: `${year}0301`,
      AA_TO_YMD: to.replace(/-/g, ""),
      pSize: 1000,
    }),
    "SchoolSchedule",
  );
  if (r.code !== "INFO-000" && r.code !== "INFO-200") throw new Error("NEIS 응답 오류: " + r.code);

  // 같은 이름의 연속된 날짜를 한 기간으로 묶는다 (예: 겨울방학, 시험 3일).
  const days = new Map<string, Set<string>>();
  const closedDates = new Set<string>(); // 이름과 관계없이 휴업일·공휴일인 모든 날짜
  for (const row of r.rows) {
    const title = String(row.EVENT_NM).trim();
    const category = row.SBTR_DD_SC_NM === "휴업일" || row.SBTR_DD_SC_NM === "공휴일" ? "closed"
      : title.includes(EXAM_WORD) ? "exam"
      : EXEMPT_EVENT_WORDS.some((w) => title.includes(w)) ? "event" : null;
    const date = `${row.AA_YMD.slice(0, 4)}-${row.AA_YMD.slice(4, 6)}-${row.AA_YMD.slice(6)}`;
    if (category === "closed") closedDates.add(date);
    if (!category || !title || title === "토요휴업일") continue; // 주말은 이미 면제라 가져오지 않는다
    // 학년별 행사는 NEIS의 학년 표시가 Y인 학년만 면제한다. 해당 학년이 없으면 건너뛴다.
    const grades = category === "event" ? [1, 2, 3].filter((g) => row[GRADE_FLAG[g]] === "Y").join(",") : "";
    if (category === "event" && !grades) continue;
    const key = JSON.stringify([category, title, grades]);
    days.set(key, (days.get(key) ?? new Set()).add(date));
  }
  const items: { category: string; title: string; grades: string; startDate: string; endDate: string; neisKey: string }[] = [];
  for (const [key, set] of days) {
    const [category, title, grades] = JSON.parse(key) as string[];
    const sorted = [...set].sort();
    let start = sorted[0], prev = start;
    for (const d of [...sorted.slice(1), ""]) {
      if (d && bridged(prev, d, category === "exam" ? new Set() : closedDates)) { prev = d; continue; }
      items.push({ category, title, grades, startDate: start, endDate: prev,
        neisKey: `${category}|${start}|${prev}|${title}` + (grades ? "|" + grades : "") });
      start = prev = d;
    }
  }

  return locked(async (tx) => {
    const known = new Set((await tx.schoolDay.findMany({ select: { neisKey: true } })).map((x) => x.neisKey));
    const fresh = items.filter((i) => !known.has(i.neisKey));
    if (fresh.length) await tx.schoolDay.createMany({ data: fresh });
    await setSetting(tx, "NEIS_SYNCED", String(Date.now()));
    return fresh.length;
  });
}
