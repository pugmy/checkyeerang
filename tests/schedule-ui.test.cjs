const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const html = fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8');
const script = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)?.[1] || '';
const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || '';

test('weekly schedule is a keyboard-accessible five-day, three-shift table', () => {
  assert.doesNotThrow(() => new Function(script));
  assert.match(script, /const scheduleShifts = \[1, 3, 2\]/);
  assert.match(script, /DAYS\.map\(day => h\('th', \{ scope: 'col' \}/);
  assert.match(script, /h\('th', \{ scope: 'row' \}/);
  assert.match(script, /members\.filter\(m => m\.day === index \+ 1 && m\.shift === shift\)/);
  assert.match(script, /onclick: \(\) => memberModal\(m\)/);
  assert.match(script, /aria-label': '주간 당번 시간표, 가로 스크롤 가능'/);
  assert.match(script, /aria-expanded': 'true'/);
  assert.match(css, /\.schedule-scroll \{overflow-x:auto/);
  assert.match(css, /\.schedule-person:focus-visible/);
});

test('graduation language is consistent across grades', () => {
  assert.match(script, /졸업은 학년과 관계없이 같은 항목에서 처리합니다/);
  assert.match(script, /졸업생 명단으로 이동합니다\. 학년과 관계없이 같은 방식으로 처리되며/);
  assert.doesNotMatch(script, /조기졸업/);
  assert.match(script, /\['graduate', '졸업 처리'\]/);
});
