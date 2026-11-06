const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "Code.gs"), "utf8");
const YEAR = 2027;
const CUTOFF = "2027-02-28T15:00:00.000Z"; // March 1 at 00:00 KST
const previous = [
  { id: 1, name: "2학년", grade: 2, day: 1, shift: 1, type: 1, createdAt: "2026-10-01T00:00:00.000Z" },
  { id: 2, name: "3학년", grade: 3, day: 2, shift: 2, type: 1, createdAt: "2026-10-01T00:00:00.000Z" },
  { id: 3, name: "신입생", grade: 1, day: 3, shift: 3, type: 1, createdAt: "2027-03-05T00:00:00.000Z" },
  { id: 4, name: "기졸업생", grade: 3, day: 4, shift: 2, type: 0, createdAt: "2025-10-01T00:00:00.000Z" },
];

function harness() {
  let users = previous.map(u => ({ ...u }));
  const props = {};
  const records = [];
  const context = vm.createContext({ Date, Number, Object, Array, console });
  vm.runInContext(source, context);
  context.today_ = () => "2027-03-10";
  context.parseDate_ = value => ({ start: new Date(value + "T00:00:00+09:00") });
  context.read_ = table => {
    assert.equal(table, "User");
    return users.map(u => ({ ...u }));
  };
  context.locked_ = fn => fn();
  context.requireAdmin_ = token => {
    if (token !== "valid-admin") throw new Error("관리자 로그인이 필요합니다.");
  };
  context.rosterRequireBaseline_ = () => {};
  context.rosterAssertConsistent_ = () => {};
  context.rosterPatch_ = (before, after) => before.grade === after.grade && before.type === after.type
    ? {} : { grade: after.grade, type: after.type };
  context.rosterPromoteOrRollback_ = (before, after, changes) => {
    records.push({ before, changes });
    users = after.map(u => ({ ...u }));
  };
  context.PropertiesService = { getScriptProperties: () => ({
    getProperty: key => props[key] || null,
    setProperty: (key, value) => { props[key] = value; },
    deleteProperty: key => { delete props[key]; },
  }) };
  return { context, users: () => users, records, props };
}

test("preview excludes new entrants and previously graduated members", () => {
  const h = harness();
  const preview = h.context.api_promotionPreview("valid-admin");
  assert.equal(preview.year, YEAR);
  assert.equal(preview.promotions, 1);
  assert.equal(preview.graduates, 1);
  assert.deepEqual(Array.from(preview.members, item => item.id), [1, 2]);
  assert.equal(h.records.length, 0);
});

test("only explicit admin confirmation can change grades", () => {
  const h = harness();
  assert.equal(h.context.api_promotionPreview("valid-admin").ok, true);
  assert.equal(h.users()[0].grade, 2);
  const result = h.context.api_applyPromotion(YEAR, ["1:2", "2:3"], "valid-admin");
  assert.equal(result.ok, true);
  assert.equal(h.users()[0].grade, 3);
  assert.equal(h.users()[1].type, 0);
  assert.equal(h.users()[2].grade, 1);
  assert.equal(h.users()[3].type, 0);
  assert.equal(h.props.PROMOTED_YEAR, String(YEAR));
});

test("cannot apply one yearly promotion twice", () => {
  const h = harness();
  assert.equal(h.context.api_applyPromotion(YEAR, ["1:2", "2:3"], "valid-admin").ok, true);
  assert.equal(h.context.api_applyPromotion(YEAR, ["1:2", "2:3"], "valid-admin").ok, false);
  assert.equal(h.records.length, 1);
});

test("reject stale member previews", () => {
  const h = harness();
  assert.equal(h.context.api_applyPromotion(YEAR, ["1:2"], "valid-admin").ok, false);
  assert.equal(h.context.api_applyPromotion(YEAR, ["1:1", "2:3"], "valid-admin").ok, false);
  assert.equal(h.records.length, 0);
});

test("unauthenticated clients cannot preview or apply promotion", () => {
  const h = harness();
  assert.throws(() => h.context.api_promotionPreview(), /관리자/);
  assert.throws(() => h.context.api_applyPromotion(YEAR, ["1:2", "2:3"]), /관리자/);
});

test("unknown outcome of prior promotion blocks automatic retry", () => {
  const h = harness();
  h.props.PROMOTION_PENDING_YEAR = String(YEAR);
  const preview = h.context.api_promotionPreview("valid-admin");
  assert.equal(preview.reviewRequired, true);
  assert.equal(preview.members.length, 0);
  assert.equal(h.context.api_applyPromotion(YEAR, ["1:2", "2:3"], "valid-admin").ok, false);
  assert.equal(h.records.length, 0);
});

test("successful promotion clears the pending marker", () => {
  const h = harness();
  assert.equal(h.context.api_applyPromotion(YEAR, ["1:2", "2:3"], "valid-admin").ok, true);
  assert.equal(h.props.PROMOTION_PENDING_YEAR, undefined);
  assert.equal(h.props.PROMOTED_YEAR, String(YEAR));
});

test("history write failure leaves review marker to prevent accidental repeat", () => {
  const h = harness();
  h.context.rosterPromoteOrRollback_ = () => { throw new Error("sheet write failure"); };
  assert.throws(() => h.context.api_applyPromotion(YEAR, ["1:2", "2:3"], "valid-admin"), /sheet write failure/);
  assert.equal(h.props.PROMOTION_PENDING_YEAR, String(YEAR));
  assert.equal(h.context.api_applyPromotion(YEAR, ["1:2", "2:3"], "valid-admin").ok, false);
});

test("individual decisions include early graduation, exclusion and no change", () => {
  const h = harness();
  const decisions = [
    { id: 1, action: "graduate" },
    { id: 2, action: "keep" },
  ];
  const result = h.context.api_applyPromotion(YEAR, ["1:2", "2:3"], decisions, "valid-admin");
  assert.equal(result.ok, true);
  assert.equal(h.users()[0].type, 0);
  assert.equal(h.users()[0].grade, 2);
  assert.equal(h.users()[1].type, 1);
  assert.equal(h.users()[1].grade, 3);
  assert.equal(h.users()[2].grade, 1);
  assert.equal(h.records.length, 1);
});

test("can exclude one existing student without deleting attendance history", () => {
  const h = harness();
  const result = h.context.api_applyPromotion(YEAR, ["1:2", "2:3"], [
    { id: 1, action: "exclude" }, { id: 2, action: "graduate" }
  ], "valid-admin");
  assert.equal(result.ok, true);
  assert.equal(h.users()[0].type, -1);
  assert.equal(h.users()[1].type, 0);
  assert.equal(h.records[0].changes.some(x => x.userId === 1 && x.patch.type === -1), true);
});

test("reject unauthorized decisions, duplicate IDs and invalid fourth-year promotion", () => {
  const cases = [
    [{ id: 999, action: "graduate" }],
    [{ id: 1, action: "graduate" }, { id: 1, action: "exclude" }],
    [{ id: 2, action: "promote" }],
    [{ id: 1, action: "delete" }],
  ];
  cases.forEach(decisions => {
    const h = harness();
    const response = h.context.api_applyPromotion(YEAR, ["1:2", "2:3"], decisions, "valid-admin");
    assert.equal(response.ok, false);
    assert.equal(h.records.length, 0);
    assert.equal(h.props.PROMOTION_PENDING_YEAR, undefined);
  });
});

test("individual review never bypasses administrator authentication", () => {
  const h = harness();
  assert.throws(() => h.context.api_applyPromotion(YEAR, ["1:2", "2:3"],
    [{ id: 1, action: "graduate" }], "wrong-token"), /관리자/);
  assert.equal(h.records.length, 0);
});
