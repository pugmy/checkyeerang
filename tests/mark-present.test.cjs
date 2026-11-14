const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  const rows = { User: [{ id: 7, runCount: 2, workCount: 1 }],
    choolsuck: [{ id: 31, userId: 7, date: '2026-11-12', shift: 1, kind: 'absent', detail: '' }],
    AttendanceCorrections: [] };
  const ctx = vm.createContext({
    Date, JSON, Number, Object, Array, String,
    read_: t => rows[t].map(r => ({ ...r })),
    result_: (ok, message) => ({ ok, message }),
    requireAdmin_: token => { if (token !== 'admin') throw Error('관리자 로그인'); },
    locked_: f => f(),
    insert_: (t, v) => { rows[t].push({ ...v, id: rows[t].length + 1 }); return v; },
    update_: (t, id, set, inc, unique) => {
      const row = rows[t].find(r => r.id === id);
      if (!row) return 'NOTFOUND';
      if (unique && rows[t].some(r => r.id !== id && unique.every(k => r[k] === (set && k in set ? set[k] : row[k])))) return 'DUP';
      Object.assign(row, set || {});
      Object.entries(inc || {}).forEach(([k, v]) => { row[k] += v; });
      return row;
    },
  });
  const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');
  vm.runInContext(code.match(/function api_markPresent[\s\S]*?\n}\n/)[0], ctx);
  return { ctx, rows };
}

test('admin can turn an absence into attendance, keeping an audit row and fixing counts', () => {
  const { ctx, rows } = fixture();
  assert.throws(() => ctx.api_markPresent(31, 'nope'), /관리자/);
  assert.equal(ctx.api_markPresent(31, 'admin').ok, true);
  assert.equal(rows.choolsuck[0].kind, 'duty');
  assert.deepEqual([rows.User[0].runCount, rows.User[0].workCount], [1, 2]);
  assert.equal(rows.AttendanceCorrections.length, 1);
  assert.equal(ctx.api_markPresent(31, 'admin').ok, false); // 두 번째는 거부
  rows.choolsuck.push({ id: 32, userId: 7, date: '2026-11-12', shift: 1, kind: 'absent', detail: '' });
  assert.equal(ctx.api_markPresent(32, 'admin').ok, false); // 같은 당번의 중복 출석 방지
});
