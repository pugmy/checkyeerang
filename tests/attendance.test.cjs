const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "Code.gs"), "utf8");

function harness(data) {
  const rows = {
    User: (data.User || []).map(r => ({ ...r })),
    choolsuck: (data.choolsuck || []).map(r => ({ ...r })),
  };
  const context = vm.createContext({ Date, console });
  vm.runInContext(source, context, { filename: "Code.gs" });
  context.read_ = table => rows[table].map(r => ({ ...r }));
  context.delete_ = (table, field, value) => {
    rows[table] = rows[table].filter(r => r[field] !== value);
  };
  context.locked_ = fn => fn();
  context.requireAdmin_ = token => {
    if (token !== "test-admin-token") throw new Error("관리자 로그인이 필요합니다.");
  };
  context.parseDate_ = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const start = new Date(value + "T00:00:00+09:00");
    return Number.isNaN(start.getTime()) ? null : { start, end: new Date(start.getTime() + 86400000), day: 1 };
  };
  context.Utilities = {
    formatDate: (_d, _tz, pattern) => pattern === "u" ? "1" : pattern === "H" ? "13" : "00",
  };
  context.formatKST_ = d => d.toISOString();
  return { context, rows };
}

const member = { id: 1, name: "테스트학생", grade: 2, day: 1, shift: 1 };

test("reject deletion if a member has attendance history", () => {
  const { context, rows } = harness({
    User: [member], choolsuck: [{ id: 8, userId: 1, kind: "duty", date: "2026-11-02" }],
  });
  assert.equal(context.api_deleteMember(1, 'test-admin-token').ok, false);
  assert.equal(rows.User.length, 1);
  assert.equal(rows.choolsuck.length, 1);
});

test("allow deletion only if there is no attendance history", () => {
  const { context, rows } = harness({ User: [member] });
  assert.equal(context.api_deleteMember(1, 'test-admin-token').ok, true);
  assert.equal(rows.User.length, 0);
});

test("reject invalid member ids", () => {
  const { context } = harness({ User: [member] });
  assert.equal(context.api_deleteMember("invalid", "test-admin-token").ok, false);
  assert.equal(context.api_deleteMember(42, 'test-admin-token').ok, false);
});

test("CSV uses attendance date and excludes absences", () => {
  const { context } = harness({
    User: [member],
    choolsuck: [
      { id: 1, userId: 1, date: "2026-11-02", createdAt: "2026-11-03T04:00:00.000Z", shift: 1, kind: "duty", detail: "다음날 저장" },
      { id: 2, userId: 1, date: "2026-11-02", createdAt: "2026-11-02T04:00:00.000Z", shift: 1, kind: "absent", detail: "결석 제외" },
      { id: 3, userId: 1, date: "2026-11-03", createdAt: "2026-11-02T04:00:00.000Z", shift: 0, kind: "makeup", detail: "범위 밖" },
    ],
  });
  const result = context.api_csv("2026-11-02", "2026-11-02", "test-admin-token");
  assert.equal(result.ok, true);
  assert.match(result.csv, /다음날 저장/);
  assert.doesNotMatch(result.csv, /결석 제외|범위 밖/);
});

test("CSV rejects inverted date range", () => {
  const { context } = harness({ User: [member] });
  assert.equal(context.api_csv("2026-11-03", "2026-11-02", "test-admin-token").ok, false);
});

test("deny all administrative reads and writes without authorization", () => {
  const { context, rows } = harness({ User: [member] });
  assert.throws(() => context.api_members(), /관리자/);
  assert.throws(() => context.api_admin("2026-11-02"), /관리자/);
  assert.throws(() => context.api_csv("2026-11-02", "2026-11-02"), /관리자/);
  assert.throws(() => context.api_addMember({ name: "새 부원", grade: 1, day: 1, shift: 1 }), /관리자/);
  assert.throws(() => context.api_updateMember(1, { name: "수정", grade: 1, day: 1, shift: 1 }), /관리자/);
  assert.throws(() => context.api_graduate(1), /관리자/);
  assert.throws(() => context.api_restore(1), /관리자/);
  assert.throws(() => context.api_deleteMember(1), /관리자/);
  assert.equal(rows.User.length, 1);
});
