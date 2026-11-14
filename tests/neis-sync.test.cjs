const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = f => fs.readFileSync(path.join(__dirname, '..', f), 'utf8');

function neisRow(date, name, kind, grades = '') {
  const g = n => (grades.includes(n) ? 'Y' : 'N');
  return { AA_YMD: date.replace(/-/g, ''), EVENT_NM: name, SBTR_DD_SC_NM: kind,
    ONE_GRADE_EVENT_YN: g('1'), TW_GRADE_EVENT_YN: g('2'), THREE_GRADE_EVENT_YN: g('3') };
}

function fixture(neisRowsList) {
  const sheet = [];
  const props = {};
  const cache = {};
  const ctx = vm.createContext({
    console, Date, JSON, Math, Number, String, Object, Array,
    Utilities: { formatDate: (d, _tz, f) => f === 'u'
      ? String(((new Date(d.getTime() + 9 * 3600000).getUTCDay() + 6) % 7) + 1)
      : new Date(d.getTime() + 9 * 3600000).toISOString().slice(0, 10) },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: k => props[k] ?? null, setProperty: (k, v) => { props[k] = v; } }) },
    CacheService: { getScriptCache: () => ({ get: k => cache[k] ?? null, put: (k, v) => { cache[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
  });
  vm.runInContext(read('Code.gs'), ctx);
  vm.runInContext(read('SchoolDays.gs'), ctx);
  ctx.today_ = d => new Date((d ? d.getTime() : Date.now()) + 9 * 3600000).toISOString().slice(0, 10);
  ctx.schoolParams_ = () => ({});
  ctx.neis_ = () => ({});
  ctx.neisRows_ = () => ({ code: 'INFO-000', rows: neisRowsList });
  ctx.read_ = () => sheet.map(r => ({ ...r }));
  ctx.sheet_ = () => ({
    getLastRow: () => sheet.length + 1,
    getRange: (_r, _c, n, cols) => ({ setNumberFormats() {}, setValues: values => values.forEach(v => {
      const row = {}; ctx.SCHEMA.SchoolDays.forEach((c, i) => { row[c] = v[i]; }); sheet.push(row);
    }) }),
  });
  return { ctx, sheet, props };
}

test('sync imports closures, exams and grade events, skipping Saturdays and unflagged events', () => {
  const rows = [
    neisRow('2026-12-23', '겨울방학', '휴업일', '123'), neisRow('2026-12-24', '겨울방학', '휴업일', '123'),
    neisRow('2026-12-25', '성탄절', '공휴일', '123'), neisRow('2026-12-26', '토요휴업일', '휴업일', '123'),
    neisRow('2026-12-28', '겨울방학', '휴업일', '123'),
    neisRow('2026-12-07', '2차 정기시험', '해당없음', '123'), neisRow('2026-12-08', '2차 정기시험', '해당없음', '123'),
    neisRow('2026-12-29', '종업식', '해당없음', '12'),
    neisRow('2026-12-18', '진로탐색활동', '해당없음', ''),
    neisRow('2026-12-17', '학교행사', '해당없음', '123'),
  ];
  const { ctx, sheet, props } = fixture(rows);
  assert.equal(ctx.syncNeisSchedule_(true), 3 + 1);
  const winter = sheet.find(r => r.title === '겨울방학');
  // 성탄절·토요일을 사이에 두고 이어진 방학은 한 기간이다
  assert.deepEqual([winter.startDate, winter.endDate], ['2026-12-23', '2026-12-28']);
  assert.ok(sheet.some(r => r.category === 'closed' && r.title === '성탄절'));
  assert.deepEqual(sheet.find(r => r.category === 'exam').startDate, '2026-12-07');
  assert.equal(sheet.find(r => r.category === 'event').grades, '1,2');
  assert.ok(!sheet.some(r => r.title === '토요휴업일' || r.title === '학교행사' || r.title === '진로탐색활동'));
  assert.ok(props.NEIS_SYNCED);
});

test('sync does not recreate imported, edited or cancelled schedules', () => {
  const rows = [neisRow('2026-12-29', '종업식', '해당없음', '12')];
  const { ctx, sheet } = fixture(rows);
  assert.equal(ctx.syncNeisSchedule_(true), 1);
  assert.equal(ctx.syncNeisSchedule_(true), 0);
  sheet[0].cancelled = 0; // 수정 개정행이 추가돼도 원본의 neisKey가 남아 있다
  sheet.push({ ...sheet[0], id: 9, supersedesId: sheet[0].id, neisKey: '' });
  assert.equal(ctx.syncNeisSchedule_(true), 0);
  assert.equal(ctx.syncNeisSchedule_(false), 0); // 하루 한 번 제한
});

test('NEIS error codes fail instead of silently importing nothing', () => {
  const { ctx } = fixture([]);
  ctx.neisRows_ = () => ({ code: 'ERROR-290', rows: [] });
  assert.throws(() => ctx.syncNeisSchedule_(true), /ERROR-290/);
});

test('event schedules exempt only the listed grades, and exam lead days are flagged', () => {
  const { ctx } = fixture([]);
  const rows = [
    { id: 1, category: 'event', title: '해외체험학습', startDate: '2026-10-07', endDate: '2026-10-16', supersedesId: 0, cancelled: 0, grades: '1' },
    { id: 2, category: 'exam', title: '2차 정기시험', startDate: '2026-12-07', endDate: '2026-12-10', supersedesId: 0, cancelled: 0, grades: '' },
  ];
  ctx.read_ = () => rows;
  const day = ctx.schoolExemption_('2026-10-08');
  assert.equal(day.all, false);
  assert.equal(ctx.isExempt_(day, 1), true);
  assert.equal(ctx.isExempt_(day, 2), false);
  assert.equal(ctx.schoolExemption_('2026-11-23').reasons[0].lead, true);
  assert.equal(ctx.schoolExemption_('2026-12-07').reasons[0].lead, false);
  assert.equal(ctx.isExempt_(ctx.schoolExemption_('2026-12-07'), 3), true);
  assert.match(ctx.schoolRuleValidate_({ category: 'event', startDate: '2026-10-07', endDate: '2026-10-08', title: 'x', grades: '' }), /학년/);
});
