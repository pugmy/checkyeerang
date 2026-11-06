const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

function kiosk() {
  const users = [
    { id: 1, name: '점심 전 담당', day: 5, shift: 1, type: 1, grade: 2 },
    { id: 2, name: '점심 후 담당', day: 5, shift: 3, type: 1, grade: 2 },
    { id: 3, name: '저녁 담당', day: 5, shift: 2, type: 1, grade: 3 }
  ];
  let exemption = { all: false, reasons: [], grades: {} };
  const context = vm.createContext({ Date, Number, Object });
  vm.runInContext(code, context);
  context.recordAbsencesToday_ = () => {};
  context.today_ = () => '2026-11-06';
  context.currentShift_ = () => ({ day: 5, shift: 3 });
  context.parseDate_ = () => ({ day: 5 });
  context.read_ = name => name === 'User' ? users.map(x => ({ ...x })) : [];
  context.rosterIndex_ = () => ({});
  context.rosterAtDeadline_ = (_day, shift) => String(shift);
  context.rosterHistoryFor_ = input => input.map(x => ({ ...x }));
  context.schoolExemption_ = () => exemption;
  context.schoolRuleEffective_ = () => exemption;
  context.locked_ = callback => callback();
  return { context, users, setExemption: next => { exemption = next; } };
}

test('all three slots can be viewed but only the server-defined current slot can check in', () => {
  const { context } = kiosk();
  const home = context.api_home();
  assert.equal(home.current.shift, 3);
  assert.deepEqual(Array.from(home.slots, slot => slot.shift), [1, 3, 2]);
  assert.deepEqual(Array.from(home.slots, slot => slot.duty.length), [1, 1, 1]);
  assert.equal(context.api_attend(1, '').ok, false);
  assert.equal(context.api_attend(3, '').ok, false);
});

test('manual exam exemption prevents mandatory check-in, while roster remains visible', () => {
  const { context, setExemption } = kiosk();
  setExemption({ all: true, reasons: [{ category: 'exam', title: '기말고사' }], grades: {} });
  assert.equal(context.api_home().slots.length, 3);
  assert.equal(context.api_home().exemption.all, true);
  assert.equal(context.api_attend(2, '').ok, false);
});
