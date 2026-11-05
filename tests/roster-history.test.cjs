const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "RosterHistory.gs"), "utf8");

function harness(initialUsers) {
  const users = initialUsers.map(u => ({ ...u }));
  const events = [];
  const props = {};
  const historySheet = {
    getLastRow: () => events.length + 1,
    getRange: (_row, _col, _n, _width) => ({
      setNumberFormats: () => {},
      setValues: values => values.forEach(v => events.push({
        id: v[0], userId: v[1], effectiveAt: v[2], patch: v[3], createdAt: v[4],
      })),
    }),
  };
  const context = vm.createContext({
    Date, JSON, Object,
    LUNCH: 1, LUNCH_AFTER: 3, DINNER: 2,
    DEADLINE_MINUTE: { 1: 780, 3: 800, 2: 1100 },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => props[key] || null,
      setProperty: (key, value) => { props[key] = value; },
    }) },
    sheet_: table => {
      assert.equal(table, "RosterHistory");
      return historySheet;
    },
    read_: table => table === "User" ? users.map(u => ({ ...u })) : events.map(e => ({ ...e })),
    parseDate_: value => {
      const start = new Date(value + "T00:00:00+09:00");
      return { start, end: new Date(start.getTime() + 86400000), day: 1 };
    },
    byName_: (a, b) => a.name.localeCompare(b.name),
  });
  vm.runInContext(source, context, { filename: "RosterHistory.gs" });
  return { context, props, events, users };
}

const student = { id: 7, name: "테스트학생", grade: 2, day: 1, shift: 1, type: 1 };

test("migration writes one immutable baseline for each existing member", () => {
  const h = harness([student]);
  h.context.rosterBaseline_();
  h.context.rosterBaseline_();
  assert.equal(h.events.length, 1);
  assert.deepEqual(JSON.parse(h.events[0].patch), {
    name: student.name, grade: 2, day: 1, shift: 1, type: 1,
  });
  assert.ok(h.props.ROSTER_BASELINE_AT);
});

test("only changed fields are stored in later events", () => {
  const h = harness([student]);
  h.context.rosterBaseline_();
  const after = { ...student, day: 3 };
  const changeAt = new Date(Date.parse(h.props.ROSTER_BASELINE_AT) + 3600000).toISOString();
  h.context.rosterLog_(7, student, after, changeAt);
  assert.deepEqual(JSON.parse(h.events[1].patch), { day: 3 });
  h.context.rosterLog_(7, after, after, changeAt);
  assert.equal(h.events.length, 2);
});

test("point-in-time reconstruction preserves previous assignment", () => {
  const h = harness([student]);
  h.context.rosterBaseline_();
  const base = Date.parse(h.props.ROSTER_BASELINE_AT);
  const changeAt = new Date(base + 3600000).toISOString();
  h.context.rosterLog_(7, student, { ...student, shift: 2 }, changeAt);
  const index = h.context.rosterIndex_();
  const before = h.context.rosterStateAt_(index, 7, new Date(base + 1000).toISOString());
  const after = h.context.rosterStateAt_(index, 7, new Date(base + 7200000).toISOString());
  assert.equal(before.shift, 1);
  assert.equal(after.shift, 2);
  assert.equal(h.context.rosterStateAt_(index, 7, new Date(base - 1000).toISOString()), null);
});

test("newly registered members do not appear before registration", () => {
  const h = harness([]);
  h.context.rosterBaseline_();
  const base = Date.parse(h.props.ROSTER_BASELINE_AT);
  h.context.rosterLog_(7, null, student, new Date(base + 3600000).toISOString());
  const index = h.context.rosterIndex_();
  assert.equal(h.context.rosterStateAt_(index, 7, new Date(base + 1000).toISOString()), null);
  assert.equal(h.context.rosterStateAt_(index, 7, new Date(base + 7200000).toISOString()).name, "테스트학생");
});

test("unverified pre-migration dates cannot be mistaken for verified history", () => {
  const h = harness([student]);
  h.context.rosterBaseline_();
  const before = new Date(Date.parse(h.props.ROSTER_BASELINE_AT) - 86400000).toISOString();
  assert.equal(h.context.rosterCovered_(before), false);
  assert.equal(h.context.rosterHistoryFor_([student], h.context.rosterIndex_(), before)[0].name, "테스트학생");
});

test("record snapshots do not overwrite old schedule with current user values", () => {
  const h = harness([student]);
  h.context.rosterBaseline_();
  const base = Date.parse(h.props.ROSTER_BASELINE_AT);
  const changeAt = new Date(base + 7200000).toISOString();
  h.context.rosterLog_(7, student, { ...student, day: 5 }, changeAt);
  const historical = h.context.rosterStateAt_(h.context.rosterIndex_(), 7, new Date(base + 3600000).toISOString());
  assert.equal(historical.day, 1);
  assert.equal(student.day, 1);
  assert.equal(h.events.length, 2);
});

test("different shifts on one day retain their own historical assignments", () => {
  const h = harness([student]);
  h.props.ROSTER_BASELINE_AT = "2026-11-01T00:00:00.000Z";
  h.events.push({
    id: 1, userId: 7, effectiveAt: "2026-11-01T00:00:00.000Z",
    patch: JSON.stringify({ name: "테스트학생", grade: 2, day: 1, shift: 1, type: 1 }),
    createdAt: "2026-11-01T00:00:00.000Z",
  });
  h.events.push({
    id: 2, userId: 7, effectiveAt: "2026-11-09T04:05:00.000Z", // 13:05 KST
    patch: JSON.stringify({ shift: 3 }),
    createdAt: "2026-11-09T04:05:00.000Z",
  });
  const view = h.context.rosterDayView_("2026-11-09", [student], []);
  assert.equal(view.verified, true);
  assert.equal(view.shifts[1].length, 1); // 13:00 before changing to shift 3
  assert.equal(view.shifts[3].length, 1); // 13:20 after the change
  assert.equal(view.shifts[2].length, 0);
});

test("CSV lookup uses the old schedule for an earlier duty", () => {
  const h = harness([student]);
  h.props.ROSTER_BASELINE_AT = "2026-11-01T00:00:00.000Z";
  h.events.push({
    id: 1, userId: 7, effectiveAt: "2026-11-01T00:00:00.000Z",
    patch: JSON.stringify({ name: "테스트학생", grade: 2, day: 1, shift: 1, type: 1 }),
  });
  h.events.push({
    id: 2, userId: 7, effectiveAt: "2026-11-09T04:05:00.000Z",
    patch: JSON.stringify({ shift: 3 }),
  });
  const result = h.context.rosterForRecord_(h.context.rosterIndex_(),
    { userId: 7, date: "2026-11-09", shift: 1 }, { ...student, shift: 3 });
  assert.equal(result.verified, true);
  assert.equal(result.user.shift, 1);
});

test("history failure restores an existing member's previous state", () => {
  const h = harness([student]);
  const prior = { ...student, _row: 2 };
  const changed = { ...prior, shift: 3 };
  let restored = null;
  h.context.rosterLog_ = () => { throw new Error("sheet write failed"); };
  h.context.write_ = (table, row) => {
    assert.equal(table, "User");
    restored = { ...row };
  };
  assert.throws(() => h.context.rosterSaveEventOrRollback_(prior, changed), /되돌렸습니다/);
  assert.equal(restored.shift, 1);
  assert.equal(restored._row, 2);
});

test("failed creation removes the newly inserted member if history append fails", () => {
  const h = harness([student]);
  const created = { ...student, id: 8 };
  let removed = null;
  h.context.rosterLog_ = () => { throw new Error("sheet write failed"); };
  h.context.delete_ = (table, key, value) => { removed = { table, key, value }; };
  assert.throws(() => h.context.rosterSaveEventOrRollback_(null, created), /되돌렸습니다/);
  assert.deepEqual(removed, { table: "User", key: "id", value: 8 });
});

test("failed compensation is reported, not falsely claimed successful", () => {
  const h = harness([student]);
  h.context.rosterLog_ = () => { throw new Error("sheet write failed"); };
  h.context.write_ = () => { throw new Error("rollback also failed"); };
  assert.throws(() => h.context.rosterSaveEventOrRollback_(student, { ...student, day: 2 }), /모두 실패/);
});

test("yearly promotion failure restores the previous cohort", () => {
  const h = harness([student]);
  let written = [];
  h.context.writeAll_ = (table, users) => {
    assert.equal(table, "User");
    written.push(users.map(u => u.grade));
  };
  h.context.rosterWriteEvents_ = () => { throw new Error("history failed"); };
  assert.throws(() => h.context.rosterPromoteOrRollback_(
    [student], [{ ...student, grade: 3 }], [{ userId: 7, patch: { grade: 3 } }], new Date().toISOString()
  ), /되돌렸습니다/);
  assert.deepEqual(written, [[3], [2]]);
});

test("partial bulk update failure also triggers promotion compensation", () => {
  const h = harness([student]);
  let calls = 0, restored = null;
  h.context.writeAll_ = (_table, members) => {
    calls++;
    if (calls === 1) throw new Error("partial sheet write");
    restored = members.map(member => member.grade);
  };
  h.context.rosterWriteEvents_ = () => { throw new Error("should not reach event write"); };
  assert.throws(() => h.context.rosterPromoteOrRollback_(
    [student], [{ ...student, grade: 3 }], [{ userId: 7, patch: { grade: 3 } }], new Date().toISOString()
  ), /되돌렸습니다/);
  assert.deepEqual(restored, [2]);
  assert.equal(calls, 2);
});
