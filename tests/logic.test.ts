// 순수 규칙(시간·면제·시간표 이력)만 확인한다. DB와 NEIS는 쓰지 않는다. 실행: npm test
import assert from "node:assert/strict";
import { test } from "node:test";
import { isExempt, schoolRuleExemption, type SchoolRule } from "../lib/rules.ts";
import { auditData, stateAt, type Member, type RosterEvent } from "../lib/roster.ts";
import { addDays, atDeadline, currentShift, DINNER, LUNCH, LUNCH_AFTER, parseDate } from "../lib/time.ts";

test("parseDate: 없는 날짜와 주말", () => {
  assert.equal(parseDate("2026-02-31"), null);
  assert.equal(parseDate("2026-11-2"), null);
  assert.equal(parseDate("2026-11-02")!.day, 1); // 월요일
  assert.equal(parseDate("2026-11-07")!.day, 0); // 토요일
  assert.equal(addDays("2026-12-01", -14), "2026-11-17");
});

test("currentShift: 한국 시간 기준 당번 시간대", () => {
  const at = (s: string) => currentShift(new Date(s));
  assert.deepEqual(at("2026-11-02T12:40:00+09:00"), { day: 1, shift: LUNCH });
  assert.deepEqual(at("2026-11-02T13:10:00+09:00"), { day: 1, shift: LUNCH_AFTER });
  assert.deepEqual(at("2026-11-02T18:05:00+09:00"), { day: 1, shift: DINNER });
  assert.equal(at("2026-11-02T14:00:00+09:00"), null);
  assert.equal(at("2026-11-07T12:40:00+09:00"), null); // 토요일
});

test("schoolRuleExemption: 학년별 행사는 해당 학년만 면제", () => {
  const trip: SchoolRule = { id: 1, startDate: "2026-10-07", endDate: "2026-10-16", category: "event", title: "해외체험학습", grades: "1", supersedesId: 0, cancelled: false };
  const ex = schoolRuleExemption("2026-10-08", [trip]);
  assert.equal(ex.all, false);
  assert.equal(isExempt(ex, 1), true);
  assert.equal(isExempt(ex, 2), false);
  assert.equal(isExempt(schoolRuleExemption("2026-10-17", [trip]), 1), false);
});

test("schoolRuleExemption: 시험 14일 전부터, 해제·수정은 최신 행만", () => {
  const rule = (o: Partial<SchoolRule> & { id: number }): SchoolRule =>
    ({ startDate: "2026-12-01", endDate: "2026-12-05", category: "exam", title: "기말", supersedesId: 0, cancelled: false, ...o });
  const rows = [rule({ id: 1 })];
  assert.equal(schoolRuleExemption("2026-11-17", rows).all, true);
  assert.equal(schoolRuleExemption("2026-11-16", rows).all, false);
  assert.equal(schoolRuleExemption("2026-12-05", rows).all, true); // 종료일 포함
  assert.equal(schoolRuleExemption("2026-12-06", rows).all, false);
  // 해제 행이 추가되면 면제가 사라진다
  assert.equal(schoolRuleExemption("2026-12-02", [...rows, rule({ id: 2, supersedesId: 1, cancelled: true })]).all, false);
  // 수정 행이 추가되면 옛 행은 무시된다
  const moved = [...rows, rule({ id: 2, supersedesId: 1, startDate: "2026-12-10", endDate: "2026-12-12" })];
  assert.equal(schoolRuleExemption("2026-11-20", moved).all, false);
  assert.equal(schoolRuleExemption("2026-12-11", moved).all, true);
});

test("시간표 이력: 마감 시점 상태 복원과 점검", () => {
  const base = "2026-11-01T00:00:00.000Z";
  const ev = (id: number, effectiveAt: string, patch: object): RosterEvent => ({ id, userId: 1, effectiveAt, patch });
  const events = [
    ev(1, base, { name: "가나", grade: 1, day: 1, shift: LUNCH, type: 1 }),
    ev(2, "2026-11-10T00:00:00.000Z", { day: 2 }), // 11-10(화요일 새벽 UTC)에 요일 변경
  ];
  const index = { 1: events };
  assert.equal(stateAt(index, 1, "2026-11-05T00:00:00.000Z")!.day, 1);
  assert.equal(stateAt(index, 1, "2026-11-11T00:00:00.000Z")!.day, 2);
  assert.equal(stateAt(index, 1, "2026-10-01T00:00:00.000Z"), null);
  // 마감 직전 시각은 그날 13:00 KST 바로 전이다
  assert.equal(atDeadline("2026-11-02", LUNCH), "2026-11-02T03:59:59.999Z");

  const now = "2026-11-20T00:00:00.000Z";
  const user: Member = { id: 1, name: "가나", grade: 1, day: 2, shift: LUNCH, type: 1 };
  assert.equal(auditData([user], events, base, now).ok, true);
  const bad = auditData([{ ...user, grade: 2 }], events, base, now);
  assert.deepEqual(bad.errors.map((e) => e.code), ["CURRENT_MISMATCH"]);
});
