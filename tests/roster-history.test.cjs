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
