const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const calendar = fs.readFileSync(path.join(__dirname, '..', 'Calendar.gs'), 'utf8');
const school = fs.readFileSync(path.join(__dirname, '..', 'SchoolDays.gs'), 'utf8');

function project(month, events, notes = [], records = [], schoolRules = []) {
  let parsed = 0;
  const parser = { parse(text) { parsed++; return JSON.parse(text); }, stringify: JSON.stringify };
  const ctx = vm.createContext({
    Date, JSON: parser, LUNCH: 1, LUNCH_AFTER: 3, DINNER: 2,
    rosterAtDeadline_: (date, shift) => new Date(
      Date.parse(date + 'T00:00:00+09:00') + ({ 1: 780, 3: 800, 2: 1100 })[shift] * 60000 - 1
    ).toISOString(),
    parseDate_: value => ({ start: new Date(value + 'T00:00:00+09:00') }),
    today_: value => new Date(new Date(value).getTime() + 9 * 3600000).toISOString().slice(0, 10),
  });
  vm.runInContext(school + '\n' + calendar, ctx);
  const member = { id: 1, name: '예시', day: 1, shift: 1, type: 1, grade: 2 };
  const result = ctx.calendarBuildMonth_(month, [member], events, records, notes,
    '2026-01-01T00:00:00.000Z', schoolRules);
  return { result, parsed };
}

const baseline = { id: 1, userId: 1, effectiveAt: '2026-01-01T00:00:00.000Z',
  patch: '{"name":"예시","day":1,"shift":1,"type":1,"grade":2}' };

test('monthly calendar reconstructs one timeline while preserving actual attendance', () => {
  const change = { id: 2, userId: 1, effectiveAt: '2026-06-14T15:00:00.000Z',
    patch: '{"day":2,"shift":2}' };
  const { result } = project('2026-06', [baseline, change],
    [{ id: 7, date: '2026-06-10', category: 'activity', title: '농구 경기', detail: '', userId: 0 }],
    [{ id: 8, date: '2026-06-10', kind: 'makeup', userId: 1, shift: 0 }],
    [{ id: 9, category: 'closed', title: '재량휴업일', startDate: '2026-06-10',
      endDate: '2026-06-10', supersedesId: 0, cancelled: 0 }]);
  const before = result.days.find(d => d.date === '2026-06-08');
  const after = result.days.find(d => d.date === '2026-06-16');
  const holiday = result.days.find(d => d.date === '2026-06-10');
  assert.equal(result.days.length, 42);
  assert.equal(before.slots[0].members.length, 1);
  assert.equal(after.slots[2].members.length, 1);
  assert.equal(holiday.school.all, true);
  assert.equal(holiday.notes[0].title, '농구 경기');
  assert.equal(holiday.records[0].kind, 'makeup');
});

test('six months of changes are parsed at most once each when building a month', () => {
  const events = [baseline];
  for (let i = 1; i <= 170; i++) {
    const date = new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);
    events.push({ id: i + 1, userId: 1, effectiveAt: date + 'T00:00:00.000Z',
      patch: JSON.stringify({ shift: i % 2 ? 2 : 1 }) });
  }
  const { result, parsed } = project('2026-06', events);
  assert.equal(result.days.length, 42);
  assert.ok(parsed <= events.length, 'each event should be decoded at most once');
  assert.ok(parsed >= 140, 'historical changes should be applied before the selected month');
});

test('retroactive holiday flags existing absences for review without deleting records', () => {
  const { result } = project('2026-06', [baseline], [], [
    { id: 21, date: '2026-06-08', kind: 'absent', userId: 1, shift: 1 }
  ], [{ id: 9, category: 'closed', title: '재량휴업일', startDate: '2026-06-08',
    endDate: '2026-06-08', supersedesId: 0, cancelled: 0 }]);
  const flagged = result.days.find(d => d.date === '2026-06-08');
  assert.equal(flagged.needsReview, true);
  assert.equal(flagged.records[0].kind, 'absent');
});
