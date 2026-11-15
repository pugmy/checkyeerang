// 한국 시간 기준 날짜·당번 규칙.
// shift 값: 1 점심 전, 3 점심 후, 2 저녁 (옛 데이터의 1/2를 그대로 쓰려고 점심 후를 3으로 둔다)
export const LUNCH = 1;
export const DINNER = 2;
export const LUNCH_AFTER = 3;
export const SHIFTS = [LUNCH, LUNCH_AFTER, DINNER];
// 당번 출석 마감 시각(분): 점심 전 13:00, 점심 후 13:20, 저녁 18:20
export const DEADLINE_MINUTE: Record<number, number> = { 1: 13 * 60, 3: 13 * 60 + 20, 2: 18 * 60 + 20 };
export const SHIFT_ORDER: Record<number, number> = { 1: 1, 3: 2, 2: 3 }; // 정렬용: 점심 전, 점심 후, 저녁

const KST = 9 * 3600 * 1000;
const DAY = 86400000;

// 한국 날짜 YYYY-MM-DD
export function today(now: Date = new Date()) {
  return new Date(now.getTime() + KST).toISOString().slice(0, 10);
}

// 한국 시간 기준 {day: 1~5(월~금), shift}. 당번 시간이 아니면 null.
export function currentShift(now: Date = new Date()) {
  const k = new Date(now.getTime() + KST);
  const day = k.getUTCDay() || 7; // 1 월 ~ 7 일
  if (day > 5) return null;
  const min = k.getUTCHours() * 60 + k.getUTCMinutes();
  if (min >= 12 * 60 + 30 && min < 13 * 60) return { day, shift: LUNCH };
  if (min >= 13 * 60 && min < 13 * 60 + 20) return { day, shift: LUNCH_AFTER };
  if (min >= 18 * 60 && min < 18 * 60 + 20) return { day, shift: DINNER };
  return null;
}

// "YYYY-MM-DD"(한국 날짜) -> {start, end, day(1~5, 주말 0)}. 형식이 틀리면 null.
export function parseDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const start = new Date(value + "T00:00:00+09:00");
  if (isNaN(start.getTime()) || today(start) !== value) return null; // 2026-02-31처럼 넘쳐서 다른 날이 되는 값 거부
  const u = new Date(start.getTime() + KST).getUTCDay() || 7;
  return { start, end: new Date(start.getTime() + DAY), day: u <= 5 ? u : 0 };
}

// date에서 days일 뒤(앞) 날짜
export function addDays(date: string, days: number) {
  return today(new Date(parseDate(date)!.start.getTime() + days * DAY));
}

// 해당 날짜·시간대 마감 직전 시각(ISO)
export function atDeadline(date: string, shift: number) {
  const range = parseDate(date);
  if (!range) return null;
  return new Date(range.start.getTime() + DEADLINE_MINUTE[shift] * 60000 - 1).toISOString();
}

export function endOfDay(date: string) {
  return new Date(parseDate(date)!.end.getTime() - 1).toISOString();
}

// 한국 시간 "2026. 9. 11 오후 12:35:40"
export function formatKST(d: Date) {
  const k = new Date(d.getTime() + KST);
  const h = k.getUTCHours();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${k.getUTCFullYear()}. ${k.getUTCMonth() + 1}. ${k.getUTCDate()} ${h < 12 ? "오전" : "오후"} ${h % 12 || 12}:${p(k.getUTCMinutes())}:${p(k.getUTCSeconds())}`;
}

export function kstHour(d: Date) {
  return new Date(d.getTime() + KST).getUTCHours();
}
