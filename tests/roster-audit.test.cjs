const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const history = fs.readFileSync(path.join(__dirname, "..", "RosterHistory.gs"), "utf8");
const audit = fs.readFileSync(path.join(__dirname, "..", "RosterAudit.gs"), "utf8");
const baseline = "2026-11-01T00:00:00.000Z";
const at = "2026-11-05T10:00:00.000Z";
const member = { id: 1, name: "학생", grade: 2, day: 1, shift: 1, type: 1 };
const event = {
  id: 1, userId: 1, effectiveAt: baseline,
  patch: JSON.stringify({ name: "학생", grade: 2, day: 1, shift: 1, type: 1 }),
};

function inspect(users = [member], events = [event]) {
  const context = vm.createContext({ Date, JSON, Object });
  vm.runInContext(history + "\n" + audit, context);
  const result = context.rosterAuditData_(users, events, baseline, at);
  return { result, context };
}

test("valid baseline matches materialized member state", () => {
  assert.equal(inspect().result.ok, true);
});

test("detect schedule changes not captured in history", () => {
  const result = inspect([{ ...member, day: 4 }]).result;
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.code === "CURRENT_MISMATCH"));
});

test("detect missing and orphaned member histories", () => {
  const missing = inspect([member], []).result;
  assert.ok(missing.errors.some(e => e.code === "MISSING_HISTORY"));
  const orphan = inspect([member], [{ ...event, userId: 99 }]).result;
  assert.ok(orphan.errors.some(e => e.code === "ORPHAN_EVENT"));
});

test("reject malformed JSON and unknown event fields", () => {
  const invalid = inspect([member], [{ ...event, patch: "{broken" }]).result;
  assert.ok(invalid.errors.some(e => e.code === "INVALID_PATCH"));
  const extra = inspect([member], [{ ...event, patch: JSON.stringify({ hacked: true }) }]).result;
  assert.ok(extra.errors.some(e => e.code === "INVALID_PATCH"));
});

test("detect event timestamps later than the audit time", () => {
  const future = inspect([member], [{ ...event, effectiveAt: "2030-01-01T00:00:00.000Z" }]).result;
  assert.ok(future.errors.some(e => e.code === "FUTURE_EVENT"));
});

test("audit is pure: input users and events are unchanged", () => {
  const users = [{ ...member }], events = [{ ...event }];
  const originalUsers = JSON.stringify(users), originalEvents = JSON.stringify(events);
  inspect(users, events);
  assert.equal(JSON.stringify(users), originalUsers);
  assert.equal(JSON.stringify(events), originalEvents);
});

test("detect duplicate event IDs without changing source records", () => {
  const duplicate = { ...event, userId: 1, effectiveAt: "2026-11-04T00:00:00.000Z" };
  const result = inspect([member], [event, duplicate]).result;
  assert.ok(result.errors.some(e => e.code === "DUPLICATE_EVENT_ID"));
});

test("reject invalid field values in roster patches", () => {
  const invalidShift = inspect([member], [
    { ...event, patch: JSON.stringify({ ...JSON.parse(event.patch), shift: 99 }) },
  ]).result;
  assert.ok(invalidShift.errors.some(e => e.code === "INVALID_PATCH"));
  const invalidType = inspect([member], [
    { ...event, patch: JSON.stringify({ ...JSON.parse(event.patch), type: "deleted" }) },
  ]).result;
  assert.ok(invalidType.errors.some(e => e.code === "INVALID_PATCH"));
});
