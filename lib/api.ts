// 화면이 부르는 서버 함수 모음. 이름과 인자는 옛 구글 스크립트의 api_*와 같고, 관리자 함수는 마지막 인자가 토큰이다.
// /api/rpc가 이름으로 찾아 호출한다. AppError 메시지만 화면에 그대로 전달된다.
import { prisma, locked, type Db } from "./prisma.ts";
import { adminLogin, adminLogout, requireAdmin } from "./admin.ts";
import { recordAbsencesToday } from "./absence.ts";
import { isExempt, schoolRuleExemption, schoolRulesCurrent, schoolRuleValidate, type SchoolRule } from "./rules.ts";
import { syncNeisSchedule } from "./neis.ts";
import { manualExemption, schoolExemption, schoolExemptionOrManual } from "./school.ts";
import {
  assertConsistent, audit, byName, dayView, ensureBaseline, forRecord, loadRoster, logChange, rosterPatch,
  slotMembers, stateAt, writeEvents, type Member, type Roster,
} from "./roster.ts";
import { getSetting, setSetting } from "./settings.ts";
import {
  atDeadline, currentShift, endOfDay, formatKST, kstHour, parseDate,
  SHIFT_ORDER, SHIFTS, today,
} from "./time.ts";

const result = (ok: boolean, message: string) => ({ ok, message });
const allUsers = (db: Db = prisma) => db.user.findMany({ orderBy: { id: "asc" } });
const BUSY_KINDS = ["duty", "absent", "excused"]; // 이 종류가 있으면 그 당번은 이미 처리된 것
const toRule = (r: any): SchoolRule => r;

// ---------- 학생 화면 ----------

export async function api_home() {
  await recordAbsencesToday();
  const date = today();
  const current = currentShift();
  const all = await allUsers();
  const attendance = new Set((await prisma.choolsuck.findMany({ where: { date, kind: "duty" } })).map((r) => r.userId));
  const weekday = parseDate(date)!.day;
  const roster = await loadRoster(prisma);
  const slots = SHIFTS.map((shift) => ({
    shift,
    duty: slotMembers(all, roster, date, shift, weekday).map((u) => ({ id: u.id, name: u.name, attended: attendance.has(u.id) })),
  }));
  const duty = current ? slots.find((s) => s.shift === current.shift)!.duty : [];
  let exemption: any = { all: false, reasons: [], unknown: false };
  try {
    exemption = await schoolExemption(date);
  } catch {
    exemption.unknown = true;
  }
  const makeup = all
    .filter((u) => u.type === 1)
    .sort(byName)
    .map((u) => ({ id: u.id, name: u.name, grade: u.grade, onDuty: !!current && u.day === current.day && u.shift === current.shift }));
  return { today: date, current, duty, slots, exemption, makeup };
}

export async function api_attend(userId: unknown, detail: unknown) {
  const id = Number(userId);
  const text = String(detail || "").trim().slice(0, 1000);
  // 클라이언트 값은 믿지 않고, 서버에서 현재 당번 시간대와 해당 부원인지 다시 검증
  const current = currentShift();
  if (!current) return result(false, "지금은 당번 시간이 아닙니다.");
  const date = today();
  if ((await schoolExemptionOrManual(date)).all) return result(false, "오늘은 출석 의무가 없는 기간입니다.");

  return locked(async (tx) => {
    if ((await manualExemption(date, tx)).all) return result(false, "오늘은 출석 의무가 없는 기간입니다.");
    const member = Number.isSafeInteger(id)
      ? await tx.user.findFirst({ where: { type: 1, id, day: current.day, shift: current.shift } })
      : null;
    if (!member) return result(false, "지금 당번이 아닙니다.");
    const already = await tx.choolsuck.findFirst({ where: { userId: id, date, shift: current.shift, kind: { in: BUSY_KINDS } } });
    if (already) return result(false, "오늘은 이미 출석했습니다.");
    await tx.choolsuck.create({ data: { userId: id, date, day: current.day, shift: current.shift, kind: "duty", detail: text } });
    await tx.user.update({ where: { id }, data: { workCount: { increment: 1 } } });
    return result(true, "출석이 기록되었습니다.");
  });
}

// 보충 출석: 당번이 아닌 부원이 오늘 보충한 기록 (kind=makeup, shift=0)
export async function api_makeup(userId: unknown, detail: unknown) {
  const id = Number(userId);
  const text = String(detail || "").trim().slice(0, 1000);
  const date = today();
  const day = parseDate(date)!.day;
  if (!day) return result(false, "주말에는 보충할 수 없습니다.");
  const closed = (ex: { reasons: { category: string }[] }) => ex.reasons.some((r) => r.category === "closed");
  if (closed(await schoolExemptionOrManual(date))) return result(false, "휴업일에는 보충 출석을 기록할 수 없습니다.");

  return locked(async (tx) => {
    if (closed(await manualExemption(date, tx))) return result(false, "휴업일에는 보충 출석을 기록할 수 없습니다.");
    const member = Number.isSafeInteger(id) ? await tx.user.findFirst({ where: { type: 1, id } }) : null;
    if (!member) return result(false, "부원을 선택하세요.");
    const current = currentShift();
    if (current && member.day === current.day && member.shift === current.shift) return result(false, "지금 당번은 보충할 수 없습니다.");
    if (await tx.choolsuck.findFirst({ where: { userId: id, date, shift: 0, kind: "makeup" } })) return result(false, "오늘 보충은 이미 기록되었습니다.");
    await tx.choolsuck.create({ data: { userId: id, date, day, shift: 0, kind: "makeup", detail: text } });
    await tx.user.update({ where: { id }, data: { addCount: { increment: 1 } } });
    return result(true, "보충이 기록되었습니다.");
  });
}

// ---------- 관리자: 로그인 / 출석 관리 ----------

export const api_adminLogin = adminLogin;
export const api_adminLogout = adminLogout;

export async function api_admin(date: unknown, token: unknown) {
  await requireAdmin(token);
  const t = today();
  const d = parseDate(date) ? (date as string) : t;
  const range = parseDate(d)!;
  if (d === t) await recordAbsencesToday();
  if (!range.day) return { today: t, date: d, day: 0, users: [], rosterByShift: {}, rosterVerified: true, records: [], exempt: null };

  const records = await prisma.choolsuck.findMany({ where: { date: d }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  let exempt = null;
  try {
    exempt = await schoolExemption(d);
  } catch {} // 학사일정을 못 읽어도 출석 화면은 보여 준다(면제 표시만 빠진다)
  const view = dayView(d, await allUsers(), await loadRoster(prisma), records);
  return { today: t, date: d, day: range.day, users: view.users, rosterByShift: view.shifts, rosterVerified: view.verified, records, exempt };
}

// ---------- 관리자: 부원 관리 ----------

export async function api_members(token: unknown) {
  await requireAdmin(token);
  return (await allUsers()).sort((a, b) => a.day - b.day || SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift] || byName(a, b));
}

function validateMember(d: any) {
  if (!d || !String(d.name || "").trim()) return "이름을 입력하세요.";
  const grade = Number(d.grade), day = Number(d.day), shift = Number(d.shift);
  if (!(grade >= 1 && grade <= 3 && grade % 1 === 0)) return "학년은 1~3 중에서 선택하세요.";
  if (!(day >= 1 && day <= 5 && day % 1 === 0)) return "요일은 월~금 중에서 선택하세요.";
  if (!SHIFT_ORDER[shift]) return "점심 전/점심 후/저녁을 선택하세요.";
  return null;
}

// 부원을 바꾸는 모든 작업의 공통 틀: 락 + 이력 기준 확인 + 이력과 현재 명단이 일치하는지 점검
async function rosterWrite<T>(fn: (tx: Db) => Promise<T>) {
  return locked(async (tx) => {
    await ensureBaseline(tx);
    await assertConsistent(tx);
    return fn(tx);
  });
}

const sameNameExists = (tx: Db, name: string, type: number, exceptId = 0) =>
  tx.user.findFirst({ where: { name, type, id: { not: exceptId } } });

export async function api_addMember(d: any, token: unknown) {
  await requireAdmin(token);
  const error = validateMember(d);
  if (error) return result(false, error);
  return rosterWrite(async (tx) => {
    const name = String(d.name).trim();
    if (await sameNameExists(tx, name, 1)) return result(false, "이미 같은 이름의 부원이 있습니다.");
    const row = await tx.user.create({ data: { name, grade: Number(d.grade), day: Number(d.day), shift: Number(d.shift), type: 1 } });
    await logChange(tx, null, row);
    return result(true, "추가되었습니다.");
  });
}

export async function api_updateMember(id: unknown, d: any, token: unknown) {
  await requireAdmin(token);
  const error = validateMember(d);
  if (error) return result(false, error);
  return rosterWrite(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: Number(id) || 0 } });
    if (!before) return result(false, "존재하지 않는 부원입니다.");
    const name = String(d.name).trim();
    if (await sameNameExists(tx, name, before.type, before.id)) return result(false, "이미 같은 이름의 부원이 있습니다.");
    const after = await tx.user.update({ where: { id: before.id }, data: { name, grade: Number(d.grade), day: Number(d.day), shift: Number(d.shift) } });
    await logChange(tx, before, after);
    return result(true, "수정되었습니다.");
  });
}

async function setType(id: unknown, type: number, token: unknown, ok: string, dupMessage?: string) {
  await requireAdmin(token);
  return rosterWrite(async (tx) => {
    const before = await tx.user.findUnique({ where: { id: Number(id) || 0 } });
    if (!before) return result(false, "존재하지 않는 부원입니다.");
    if (dupMessage && (await sameNameExists(tx, before.name, type, before.id))) return result(false, dupMessage);
    const after = await tx.user.update({ where: { id: before.id }, data: { type } });
    await logChange(tx, before, after);
    return result(true, ok);
  });
}

// 조기졸업처럼 사람이 직접 졸업 처리한다. 기록은 남는다.
export const api_graduate = (id: unknown, token: unknown) => setType(id, 0, token, "졸업 처리되었습니다.");
export const api_restore = (id: unknown, token: unknown) =>
  setType(id, 1, token, "재학생으로 복귀했습니다.", "같은 이름의 재학생이 있어 복귀할 수 없습니다.");

// 출석 이력이 있는 부원은 삭제하지 않는다. 행을 실제로 지우지 않아야 과거 배정과 감사 이력을 복원할 수 있다.
export async function api_deleteMember(id: unknown, token: unknown) {
  await requireAdmin(token);
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return result(false, "올바른 부원을 선택하세요.");
  return rosterWrite(async (tx) => {
    const member = await tx.user.findFirst({ where: { id: n, type: { not: -1 } } });
    if (!member) return result(false, "존재하지 않는 부원입니다.");
    if (await tx.choolsuck.findFirst({ where: { userId: n } })) {
      return result(false, "출석 기록이 있는 부원은 삭제할 수 없습니다. 졸업 처리로 기록을 보존하세요.");
    }
    const after = await tx.user.update({ where: { id: n }, data: { type: -1 } });
    await logChange(tx, member, after);
    return result(true, "부원 목록에서 제외되었습니다.");
  });
}

export async function api_rosterAudit(token: unknown) {
  await requireAdmin(token);
  return audit(prisma);
}

// ---------- 관리자: 학년도 진급 ----------
// 진급은 관리자 확인 후에만 실행한다. 3학년은 졸업(type 0), 1·2학년은 학년 +1. 3/1 이후 등록된 신입생은 제외한다.

type PlanItem = { id: number; name: string; fromGrade: number; toGrade: number | null; action: "promote" | "graduate" };

function promotionPlan(users: { id: number; name: string; grade: number; type: number; createdAt: Date }[], year: number): PlanItem[] {
  const cutoff = parseDate(`${year}-03-01`)!.start;
  return users
    .filter((u) => u.type === 1 && u.createdAt < cutoff)
    .map((u) => ({ id: u.id, name: u.name, fromGrade: u.grade, toGrade: u.grade >= 3 ? null : u.grade + 1, action: u.grade >= 3 ? "graduate" : "promote" }));
}

// 새 학년도(3월 1일) 시작 전에는 실행 불가; 이후에는 학기 중 늦게라도 직접 처리 가능
function promotionYear() {
  const t = today();
  const year = Number(t.slice(0, 4));
  return t >= `${year}-03-01` ? year : null;
}

export async function api_promotionPreview(token: unknown) {
  await requireAdmin(token);
  const year = promotionYear();
  if (!year) return { ok: false, message: "3월 1일부터 새 학년도 진급을 처리할 수 있습니다." };
  const done = Number(await getSetting(prisma, "PROMOTED_YEAR")) >= year;
  const plan = done ? [] : promotionPlan(await allUsers(), year);
  return {
    ok: true, year, done, reviewRequired: false, members: plan,
    promotions: plan.filter((u) => u.action === "promote").length,
    graduates: plan.filter((u) => u.action === "graduate").length,
  };
}

const ACTIONS = ["promote", "graduate", "exclude", "keep"];

export async function api_applyPromotion(year: unknown, expectedIds: unknown, decisions: unknown, token: unknown) {
  await requireAdmin(token);
  const y = Number(year);
  if (!Number.isSafeInteger(y) || promotionYear() !== y) return result(false, "진급 대상 학년도를 다시 확인하세요.");
  if (!Array.isArray(expectedIds) || expectedIds.length > 500 || expectedIds.some((id) => typeof id !== "string" || !/^[1-9]\d*:[123]$/.test(id))) {
    return result(false, "진급 대상 명단이 올바르지 않습니다.");
  }
  // 변경 대상은 미리보기 명단 안으로 제한한다. 같은 학생을 두 번 지정할 수 없다.
  const items = decisions == null ? [] : decisions;
  if (
    !Array.isArray(items) || items.length > 500 ||
    items.some((i) => !i || !Number.isSafeInteger(i.id) || i.id <= 0 || !ACTIONS.includes(i.action)) ||
    new Set(items.map((i) => i.id)).size !== items.length
  ) {
    return result(false, "학생별 처리 항목을 다시 확인하세요.");
  }
  return rosterWrite(async (tx) => {
    if (Number(await getSetting(tx, "PROMOTED_YEAR")) >= y) return result(false, "이번 학년도 진급은 이미 처리되었습니다.");
    const users = await allUsers(tx);
    const plan = promotionPlan(users, y);
    const actual = plan.map((x) => `${x.id}:${x.fromGrade}`).sort();
    const expected = [...(expectedIds as string[])].sort();
    if (actual.length !== expected.length || actual.some((id, i) => id !== expected[i])) {
      return result(false, "진급 대상 명단이 변경되었습니다. 미리보기를 다시 확인하세요.");
    }
    if (!plan.length) return result(false, "진급할 재학생이 없습니다.");
    const overrides = new Map<number, string>(items.map((i: any) => [i.id, i.action]));
    if ([...overrides.keys()].some((id) => !plan.some((m) => m.id === id))) {
      return result(false, "진급 대상이 아닌 학생이 포함되어 있습니다. 명단을 다시 불러오세요.");
    }
    if (plan.some((m) => (overrides.get(m.id) ?? m.action) === "promote" && m.fromGrade >= 3)) {
      return result(false, "3학년은 4학년으로 진급할 수 없습니다. 처리 항목을 다시 선택하세요.");
    }
    const stamp = new Date().toISOString();
    const events: { userId: number; patch: ReturnType<typeof rosterPatch> }[] = [];
    for (const m of plan) {
      const before = users.find((u) => u.id === m.id)!;
      const action = overrides.get(m.id) ?? m.action;
      if (action === "keep") continue;
      const data = action === "promote" ? { grade: before.grade + 1 } : { type: action === "graduate" ? 0 : -1 };
      const after = await tx.user.update({ where: { id: m.id }, data });
      events.push({ userId: m.id, patch: rosterPatch(before, after) });
    }
    await writeEvents(tx, events, stamp);
    await setSetting(tx, "PROMOTED_YEAR", String(y));
    return result(true, `${y}학년도 명단 정리가 완료되었습니다.`);
  });
}

// ---------- CSV ----------

const DAY_NAME = ["일", "월", "화", "수", "목", "금", "토"];
const KIND_LABEL: Record<string, string> = { makeup: "보충", absent: "결석" }; // 정규 출석은 빈칸
const SHIFT_LABEL: Record<number, string> = { 0: "", 1: "점심 전", 2: "저녁", 3: "점심 후" };

// 엑셀에서 수식으로 실행되지 않게 하고, CSV 규칙에 맞게 따옴표로 감싼다
function cell(value: unknown) {
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

export async function api_csv(from: unknown, to: unknown, token: unknown) {
  await requireAdmin(token);
  const f = parseDate(from), t = parseDate(to);
  if (!f || !t) return { ok: false, message: "시작일과 종료일을 올바르게 입력하세요." };
  if (t.start < f.start) return { ok: false, message: "종료일이 시작일보다 빠릅니다." };

  const users = new Map((await allUsers()).map((u) => [u.id, u]));
  const roster = await loadRoster(prisma);
  // 출석일 기준으로 조회한다. 저장 시각(createdAt)은 일시 표시용이다.
  const records = await prisma.choolsuck.findMany({
    where: { date: { gte: from as string, lte: to as string }, kind: { in: ["duty", "makeup"] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const lines = [["요일", "일시", "시간", "이름", "학년", "구분", "담당 요일", "담당 시간", "특이사항", "시간표 이력"].map(cell).join(",")];
  for (const r of records) {
    const current = users.get(r.userId);
    if (!current) continue;
    const snap = forRecord(roster, r, current);
    const u = snap.user;
    const h = kstHour(r.createdAt);
    const recorded = h >= 12 && h < 14 ? "점심" : h >= 17 && h < 19 ? "저녁" : ""; // 기록된 시각 기준
    lines.push(
      [
        DAY_NAME[r.day] || "", // 등록 시각이 아닌 실제 출석 날짜의 요일
        formatKST(r.createdAt),
        recorded,
        u.name,
        u.grade,
        KIND_LABEL[r.kind] || "",
        DAY_NAME[u.day],
        SHIFT_LABEL[r.kind === "makeup" ? u.shift : r.shift] || "", // 보충 기록의 shift는 0이라 부원의 당번 시간을 쓴다
        r.detail,
        snap.verified ? "확인됨" : "이력 시작 전·미확인",
      ].map(cell).join(","),
    );
  }
  return { ok: true, name: `attendance_${from}_${to}.csv`, csv: lines.join("\r\n") + "\r\n" };
}

// ---------- 관리자: 등교·시험 면제 일정 ----------

export async function api_schoolRules(token: unknown) {
  await requireAdmin(token);
  return schoolRulesCurrent((await prisma.schoolDay.findMany()).map(toRule)).sort(
    (a, b) => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.id - b.id),
  );
}

// NEIS 학사일정(휴업일·공휴일·정기시험)을 일정 목록으로 가져온다. 이미 가져왔거나 수정·해제한 일정은 다시 만들지 않는다.
export async function api_schoolRulesSync(token: unknown) {
  await requireAdmin(token);
  try {
    const added = await syncNeisSchedule(true);
    return result(true, added ? `NEIS에서 일정 ${added}건을 가져왔습니다.` : "새로 가져올 일정이 없습니다.");
  } catch (e) {
    return result(false, "NEIS에서 일정을 가져오지 못했습니다: " + (e as Error).message);
  }
}

export async function api_schoolRuleSave(data: any, replaceId: unknown, token: unknown) {
  await requireAdmin(token);
  const err = schoolRuleValidate(data);
  if (err) return result(false, err);
  const replace = Number(replaceId || 0);
  if (!Number.isSafeInteger(replace) || replace < 0) return result(false, "수정할 일정을 다시 선택해 주세요.");
  return locked(async (tx) => {
    const current = schoolRulesCurrent((await tx.schoolDay.findMany()).map(toRule));
    if (replace && !current.some((r) => r.id === replace)) return result(false, "이미 변경된 일정입니다. 목록을 다시 불러와 주세요.");
    const row = await tx.schoolDay.create({
      data: {
        startDate: data.startDate, endDate: data.endDate, category: data.category, title: data.title.trim(), supersedesId: replace,
        grades: data.category === "event" ? data.grades : "",
      },
    });
    return { ok: true, id: row.id };
  });
}

export async function api_schoolRuleCancel(id: unknown, token: unknown) {
  await requireAdmin(token);
  const n = Number(id);
  if (!Number.isSafeInteger(n) || n <= 0) return result(false, "일정 번호를 확인해 주세요.");
  return locked(async (tx) => {
    const target = schoolRulesCurrent((await tx.schoolDay.findMany()).map(toRule)).find((r) => r.id === n);
    if (!target) return result(false, "이미 변경된 일정입니다.");
    await tx.schoolDay.create({
      data: { startDate: target.startDate, endDate: target.endDate, category: target.category, title: target.title, grades: target.grades ?? "", supersedesId: n, cancelled: true },
    });
    return result(true, "면제 일정을 해제했습니다. 과거 결석 기록은 자동 삭제되지 않습니다.");
  });
}

// 면제 일정이 뒤늦게 생긴 날의 결석을 면제로 정정한다. 원래 기록은 남기고 정정 내역을 별도 행으로 보존한다.
export async function api_excuseAbsence(absenceId: unknown, token: unknown) {
  await requireAdmin(token);
  const n = Number(absenceId);
  if (!Number.isSafeInteger(n) || n <= 0) return result(false, "정정할 출석 기록을 확인해 주세요.");
  return locked(async (tx) => {
    const record = await tx.choolsuck.findUnique({ where: { id: n } });
    if (!record || record.kind !== "absent") return result(false, "정정할 결석 기록이 없습니다.");
    const member = await tx.user.findUnique({ where: { id: record.userId } });
    if (!member) return result(false, "부원 정보를 찾을 수 없습니다.");
    let ex;
    try {
      ex = await schoolExemption(record.date);
    } catch {
      return result(false, "학사일정을 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    }
    const at = record.shift ? atDeadline(record.date, record.shift)! : endOfDay(record.date);
    const historical = stateAt((await loadRoster(tx)).index, member.id, at) || member;
    if (!isExempt(ex, historical.grade)) return result(false, "해당 날짜에는 면제 규칙이 없습니다. 먼저 달력에서 등교·시험 일정을 확인해 주세요.");
    if (member.runCount < 1) return result(false, "결석 횟수가 기록과 일치하지 않습니다. 데이터를 확인해 주세요.");
    const reason = ex.reasons.map((r) => r.title).join(", ") || "학사일정 면제";
    await tx.attendanceCorrection.create({ data: { absenceId: record.id, userId: record.userId, date: record.date, shift: record.shift, reason } });
    await tx.choolsuck.update({
      where: { id: record.id },
      data: { kind: "excused", detail: ("면제 정정: " + reason + (record.detail ? " / 기존 메모: " + record.detail : "")).slice(0, 1000) },
    });
    await tx.user.update({ where: { id: member.id }, data: { runCount: { decrement: 1 } } });
    return result(true, "결석을 면제로 정정했습니다. 변경 내역은 별도 기록에 보존됩니다.");
  });
}

// ---------- 관리자: 월간 달력 ----------

const CALENDAR_CATEGORIES = ["activity", "makeup_plan", "notice"];

function monthRange(month: unknown) {
  if (typeof month !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  const year = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  if (year < 2020 || year > 2100) return null;
  const first = new Date(Date.UTC(year, m - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7; // 월요일 시작
  return { begin: new Date(Date.UTC(year, m - 1, 1 - offset)).getTime(), days: 42 };
}

const dateAt = (begin: number, i: number) => new Date(begin + i * 86400000).toISOString().slice(0, 10);

// 한 달은 이력을 시간순으로 한 번만 훑어 만든다.
export function buildMonth(
  month: string, users: { id: number; name: string }[], roster: Roster,
  records: { id: number; kind: string; userId: number; detail: string; shift: number; date: string }[],
  notes: { id: number; category: string; title: string; detail: string; userId: number; date: string }[],
  schoolRules: SchoolRule[],
) {
  const range = monthRange(month)!;
  const history = Object.values(roster.index).flat().sort((a, b) => (a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1 : a.id - b.id));
  const state: Record<number, Member> = {};
  let index = 0;
  const advance = (until: string) => {
    while (index < history.length && history[index].effectiveAt <= until) {
      const e = history[index++];
      state[e.userId] = Object.assign(state[e.userId] || ({ id: e.userId } as Member), e.patch);
    }
  };
  const names = new Map(users.map((u) => [u.id, u.name]));
  const group = <T extends { date: string }>(rows: T[]) => {
    const g: Record<string, T[]> = {};
    for (const r of rows) (g[r.date] ||= []).push(r);
    return g;
  };
  const recordsByDate = group(records.filter((r) => ["duty", "makeup", "absent"].includes(r.kind)));
  const notesByDate = group(notes);

  const days = [];
  for (let i = 0; i < range.days; i++) {
    const date = dateAt(range.begin, i);
    const dow = ((new Date(date + "T12:00:00Z").getUTCDay() + 6) % 7) + 1;
    const slots = SHIFTS.map((shift) => {
      advance(atDeadline(date, shift)!);
      const members = Object.values(state)
        .filter((u) => u.type === 1 && u.day === dow && u.shift === shift)
        .map((u) => ({ id: u.id, name: u.name, grade: u.grade }))
        .sort(byName);
      return { shift, members };
    });
    const dayRecords = (recordsByDate[date] || []).map((r) => ({
      id: r.id, kind: r.kind, userId: r.userId, name: names.get(r.userId) ?? "부원 " + r.userId, detail: r.detail || "", shift: r.shift,
    }));
    const dayNotes = (notesByDate[date] || []).map((n) => ({
      id: n.id, category: n.category, title: n.title, detail: n.detail, userId: n.userId, name: names.get(n.userId) ?? "",
    }));
    const school = schoolRuleExemption(date, schoolRules);
    days.push({
      date, inMonth: date.slice(0, 7) === month,
      verified: !!roster.baseline && atDeadline(date, 2)! >= roster.baseline,
      slots, records: dayRecords, notes: dayNotes, school,
      needsReview: school.all && dayRecords.some((r) => r.kind === "absent"),
    });
  }
  return { ok: true, month, days };
}

export async function api_calendarMonth(month: unknown, token: unknown) {
  await requireAdmin(token);
  const range = monthRange(month);
  if (!range) return { ok: false, message: "조회할 월을 확인해 주세요." };
  const gte = dateAt(range.begin, 0), lte = dateAt(range.begin, 41);
  const where = { date: { gte, lte } };
  return buildMonth(
    month as string, await allUsers(), await loadRoster(prisma),
    await prisma.choolsuck.findMany({ where }), await prisma.calendarNote.findMany({ where }),
    (await prisma.schoolDay.findMany()).map(toRule),
  );
}

export async function api_calendarAdd(data: any, token: unknown) {
  await requireAdmin(token);
  const problem = (() => {
    if (!data || !parseDate(data.date)) return "날짜를 확인해 주세요.";
    if (!CALENDAR_CATEGORIES.includes(data.category)) return "일정 종류를 확인해 주세요.";
    if (typeof data.title !== "string" || !data.title.trim() || data.title.trim().length > 80) return "일정 이름은 1~80자로 입력해 주세요.";
    if (typeof data.detail !== "string" || data.detail.length > 300) return "메모는 300자까지 입력할 수 있습니다.";
    if (data.category === "makeup_plan" && (!Number.isSafeInteger(data.userId) || data.userId <= 0)) return "보충 예정인 부원을 선택해 주세요.";
    return null;
  })();
  if (problem) return result(false, problem);
  const userId = data.category === "makeup_plan" ? data.userId : 0;
  if (userId && !(await prisma.user.findFirst({ where: { id: userId, type: 1 } }))) return result(false, "등록된 부원을 선택해 주세요.");
  const note = await prisma.calendarNote.create({
    data: { date: data.date, category: data.category, title: data.title.trim(), detail: data.detail.trim(), userId },
  });
  return { ok: true, id: note.id };
}

export async function api_calendarDelete(id: unknown, token: unknown) {
  await requireAdmin(token);
  if (!Number.isSafeInteger(id) || (id as number) <= 0) return result(false, "일정 번호를 확인해 주세요.");
  const { count } = await prisma.calendarNote.deleteMany({ where: { id: id as number } });
  return count ? result(true, "일정을 삭제했습니다.") : result(false, "해당 일정을 찾을 수 없습니다.");
}

export const handlers: Record<string, (...args: any[]) => Promise<unknown>> = {
  api_home, api_attend, api_makeup, api_adminLogin, api_adminLogout, api_admin, api_members, api_addMember,
  api_updateMember, api_graduate, api_restore, api_deleteMember, api_rosterAudit, api_promotionPreview,
  api_applyPromotion, api_csv, api_schoolRules, api_schoolRulesSync, api_schoolRuleSave, api_schoolRuleCancel, api_excuseAbsence,
  api_calendarMonth, api_calendarAdd, api_calendarDelete,
};
