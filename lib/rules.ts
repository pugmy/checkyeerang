import { addDays, parseDate } from "./time.ts";

// ---------- NEIS 학사일정 가져오기 기준 ----------
// 면제되는 날: 휴업일/공휴일(전원), 정기시험 2주 전부터 시험 마지막 날까지(전원),
// 아래 행사 중 학년 표시가 Y인 학년(해당 학년만). 그 밖의 행사는 면제하지 않는다.
export const EXAM_WORD = "정기시험";
export const EXAM_LEAD_DAYS = 14;
export const EXEMPT_EVENT_WORDS = ["해외체험학습", "졸업식", "종업식", "진로탐색활동", "이공계 대학탐방"]; //2026년 NEIS API 호출 시 출력값을 기준으로 합니다. 추후 이름이 변경되었을 수 있으니 참고하세요.
export const GRADE_FLAG: Record<number, string> = { 1: "ONE_GRADE_EVENT_YN", 2: "TW_GRADE_EVENT_YN", 3: "THREE_GRADE_EVENT_YN" };

export type Reason = { category: string; title: string; message: string; lead?: boolean; grades?: string };
export type Exemption = { all: boolean; grades: Record<number, boolean>; reasons: Reason[]; unknown?: boolean };
export type NeisRow = Record<string, string>;

export function isExempt(ex: Pick<Exemption, "all" | "grades">, grade: number) {
  return ex.all || !!ex.grades[grade];
}

// ---------- 면제 일정 (휴업/시험/학년별 행사) ----------
// event는 grades("1", "1,2" 등)에 적힌 학년만 면제하는 행사다. closed·exam은 전원 면제다.
export const SCHOOL_RULE_CATEGORIES = ["closed", "exam", "event"];
export type SchoolRule = { id: number; startDate: string; endDate: string; category: string; title: string; supersedesId: number; cancelled: boolean; grades?: string };

// 수정·해제는 새 행을 추가하는 방식이라, 다른 행에 대체되지 않았고 해제되지 않은 행만 현재 일정이다.
export function schoolRulesCurrent<T extends SchoolRule>(rows: T[]): T[] {
  const superseded = new Set(rows.filter((r) => r.supersedesId > 0).map((r) => r.supersedesId));
  return rows.filter((r) => !superseded.has(r.id) && !r.cancelled);
}

export function schoolRuleValidate(d: any): string | null {
  if (!d || !SCHOOL_RULE_CATEGORIES.includes(d.category)) return "일정 종류를 선택해 주세요.";
  const s = parseDate(d.startDate), e = parseDate(d.endDate);
  if (!s || !e || d.startDate > d.endDate) return "시작일과 종료일을 확인해 주세요.";
  if (Math.round((e.start.getTime() - s.start.getTime()) / 86400000) > 120) return "한 일정은 121일까지 등록할 수 있습니다.";
  if (typeof d.title !== "string" || !d.title.trim() || d.title.trim().length > 80) return "일정 이름은 1~80자로 입력해 주세요.";
  if (d.category === "event" && !/^[123](,[123])*$/.test(String(d.grades))) return "대상 학년을 선택해 주세요.";
  return null;
}

export function schoolRuleExemption(date: string, rows: SchoolRule[]) {
  const reasons: Reason[] = [];
  const grades: Record<number, boolean> = { 1: false, 2: false, 3: false };
  for (const r of schoolRulesCurrent(rows)) {
    if (r.category === "event") {
      if (r.startDate <= date && date <= r.endDate) {
        for (const g of String(r.grades).split(",")) grades[Number(g)] = true;
        reasons.push({ category: "event", title: r.title, message: r.title + " · 해당 학년 면제", grades: r.grades });
      }
      continue;
    }
    const begin = r.category === "exam" ? addDays(r.startDate, -EXAM_LEAD_DAYS) : r.startDate;
    if (begin <= date && date <= r.endDate) {
      reasons.push({
        category: r.category,
        title: r.title,
        message: r.category === "exam" ? "시험 기간입니다" : r.title + " · 등교하지 않는 날",
        lead: r.category === "exam" && date < r.startDate, // 시험 전 14일(시험일 아님)
      });
    }
  }
  return { all: reasons.some((r) => r.category !== "event"), grades, reasons };
}
