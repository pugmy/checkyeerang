const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'SchoolDays.gs'), 'utf8');

function fixture() {
  const rows = { SchoolDays: [], User: [{ id: 7, grade: 2, runCount: 1 }],
    choolsuck: [{ id: 31, userId: 7, date: '2026-11-12', shift: 1, kind: 'absent', detail: '' }],
    AttendanceCorrections: [] };
  let nextId = 1;
  const env = {
    Date,
    read_: table => rows[table].map(r => ({ ...r })),
    parseDate_: value => {
      if (!/^\d{4}-\d\d-\d\d$/.test(String(value))) return null;
      const d = new Date(value + 'T00:00:00+09:00');
      return Number.isNaN(d.getTime()) ||
        new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10) !== value ? null :
        { start: d };
    },
    today_: d => new Date(new Date(d).getTime() + 9 * 3600000).toISOString().slice(0, 10),
    result_: (ok, message) => ({ ok, message }),
    requireAdmin_: token => { if (token !== 'admin') throw Error('관리자 로그인'); },
    locked_: callback => callback(),
    insert_: (table, values) => {
      const record = { ...values, id: nextId++ };
      rows[table].push(record);
      return { ...record };
    },
    update_: (table, id, changes, increments) => {
      const row = rows[table].find(r => r.id === id);
      if (!row) return 'NOTFOUND';
      Object.assign(row, changes || {});
      Object.entries(increments || {}).forEach(([key, value]) => { row[key] += value; });
      return { ...row };
    },
    exemption_: () => ({ all: false, grades: { 1: false, 2: false, 3: false }, reasons: [] }),
    isExempt_: (rule, grade) => !!rule.all || !!rule.grades?.[grade],
    rosterIndex_: () => ({}),
    rosterAtDeadline_: date => new Date(date + 'T13:00:00+09:00').toISOString(),
    rosterStateAt_: () => null,
  };
  const ctx = vm.createContext(env);
  vm.runInContext(source, ctx);
  return { ctx, rows };
}

test('exam exemption begins 14 calendar days before first exam and ends with last exam day', () => {
  const { ctx } = fixture();
  const rules = [{ id: 1, category: 'exam', title: '기말고사',
    startDate: '2026-12-15', endDate: '2026-12-18', supersedesId: 0, cancelled: 0 }];
  assert.equal(ctx.schoolRuleExemption_('2026-11-30', rules).all, false);
  assert.equal(ctx.schoolRuleExemption_('2026-12-01', rules).all, true);
  assert.equal(ctx.schoolRuleExemption_('2026-12-18', rules).all, true);
  assert.equal(ctx.schoolRuleExemption_('2026-12-19', rules).all, false);
});

test('closures cover inclusive dates without copying a daily schedule', () => {
  const { ctx } = fixture();
  const rules = [{ id: 1, category: 'closed', title: '방학',
    startDate: '2027-01-01', endDate: '2027-02-14', supersedesId: 0, cancelled: 0 }];
  assert.equal(ctx.schoolRuleExemption_('2027-01-01', rules).all, true);
  assert.equal(ctx.schoolRuleExemption_('2027-02-14', rules).all, true);
  assert.equal(ctx.schoolRuleExemption_('2027-02-15', rules).all, false);
});

test('updating a rule appends a revision and does not erase the earlier record', () => {
  const { ctx, rows } = fixture();
  const original = { category: 'closed', title: '재량휴업',
    startDate: '2026-11-12', endDate: '2026-11-12' };
  assert.equal(ctx.api_schoolRuleSave(original, 0, 'admin').ok, true);
  const changed = { ...original, endDate: '2026-11-13' };
  assert.equal(ctx.api_schoolRuleSave(changed, 1, 'admin').ok, true);
  assert.equal(rows.SchoolDays.length, 2);
  assert.equal(rows.SchoolDays[1].supersedesId, 1);
  assert.equal(ctx.schoolRulesCurrent_(rows.SchoolDays).length, 1);
  assert.equal(ctx.schoolRuleExemption_('2026-11-13', rows.SchoolDays).all, true);
  assert.equal(ctx.api_schoolRuleCancel(2, 'admin').ok, true);
  assert.equal(rows.SchoolDays.length, 3);
  assert.equal(ctx.schoolRuleExemption_('2026-11-13', rows.SchoolDays).all, false);
});

test('invalid dates, unauthenticated edits and long ranges are rejected', () => {
  const { ctx, rows } = fixture();
  assert.throws(() => ctx.api_schoolRules('not-admin'), /관리자/);
  assert.throws(() => ctx.api_schoolRuleSave({}, 0), /관리자/);
  assert.equal(ctx.api_schoolRuleSave({ category: 'exam', title: '시험',
    startDate: '2026-12-18', endDate: '2026-12-15' }, 0, 'admin').ok, false);
  assert.equal(ctx.api_schoolRuleSave({ category: 'closed', title: '방학',
    startDate: '2026-01-01', endDate: '2026-12-31' }, 0, 'admin').ok, false);
  assert.equal(rows.SchoolDays.length, 0);
});

test('historical absent record can be corrected once with separate audit entry', () => {
  const { ctx, rows } = fixture();
  assert.equal(ctx.api_schoolRuleSave({ category: 'closed', title: '재량휴업',
    startDate: '2026-11-12', endDate: '2026-11-12' }, 0, 'admin').ok, true);
  assert.equal(ctx.api_excuseAbsence(31, 'admin').ok, true);
  assert.equal(rows.choolsuck[0].kind, 'excused');
  assert.equal(rows.choolsuck[0].date, '2026-11-12');
  assert.equal(rows.User[0].runCount, 0);
  assert.equal(rows.AttendanceCorrections.length, 1);
  assert.equal(rows.AttendanceCorrections[0].absenceId, 31);
  assert.equal(ctx.api_excuseAbsence(31, 'admin').ok, false);
  assert.equal(rows.User[0].runCount, 0);
});

test('corrections require admin and a valid exemption', () => {
  const { ctx, rows } = fixture();
  assert.throws(() => ctx.api_excuseAbsence(31), /관리자/);
  assert.equal(ctx.api_excuseAbsence(31, 'admin').ok, false);
  assert.equal(rows.choolsuck[0].kind, 'absent');
});
