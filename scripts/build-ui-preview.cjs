// Creates a local, non-networked preview of the real Apps Script HTML interface.
// Usage: node scripts/build-ui-preview.cjs
// The generated preview-ui.html is intentionally untracked and uses synthetic records only.
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const index = fs.readFileSync(path.join(root, "Index.html"), "utf8");
const logo = fs.readFileSync(path.join(root, "Logo.html"), "utf8");
const include = "<?!= HtmlService.createHtmlOutputFromFile('Logo').getContent(); ?>";
if (index.split(include).length !== 2) throw new Error("Apps Script logo include changed");
if (!/<script>[\s\S]+<\/script>\s*<\/body>/.test(index)) throw new Error("Client script missing");

const mocks = String.raw`<script>
/* PREVIEW ONLY: fake service; no Sheets, Apps Script, passwords or production records. */
(() => {
  const roster = [
    { id: 101, name: '예시 학생 A', grade: 1, day: 5, shift: 1, type: 1, workCount: 7, addCount: 2, runCount: 0 },
    { id: 102, name: '예시 학생 B', grade: 2, day: 5, shift: 1, type: 1, workCount: 6, addCount: 1, runCount: 1 },
    { id: 103, name: '예시 학생 C', grade: 3, day: 5, shift: 3, type: 1, workCount: 5, addCount: 3, runCount: 0 },
    { id: 104, name: '예시 학생 D', grade: 1, day: 2, shift: 2, type: 1, workCount: 8, addCount: 0, runCount: 0 },
    { id: 105, name: '예시 졸업생', grade: 3, day: 1, shift: 1, type: 0, workCount: 22, addCount: 4, runCount: 1 },
  ];
  const attended = new Set([102]);
  const today = '2026-11-06';
  let scenario = 'regular';
  const crowded = ['예시 학생 E', '예시 학생 F', '예시 학생 G', '예시 학생 H', '예시 학생 I', '예시 학생 J']
    .map((name, i) => ({ id: 200 + i, name, grade: i % 3 + 1, day: 5, shift: 1, type: 1,
      workCount: 1, addCount: 0, runCount: 0 }));
  const server = {
    api_home: () => {
      const dutyMembers = scenario === 'crowded'
        ? roster.filter(m => m.type === 1 && m.day === 5 && m.shift === 1).concat(crowded)
        : scenario === 'empty' ? [] : roster.filter(m => m.type === 1 && m.day === 5 && m.shift === 1);
      return {
        today, current: scenario === 'closed' ? null : { day: 5, shift: 1 },
        duty: dutyMembers.map(m => ({ id: m.id, name: m.name, attended: attended.has(m.id) })),
        makeup: roster.filter(m => m.type === 1)
          .map(m => ({ id: m.id, name: m.name, grade: m.grade, onDuty: m.day === 5 && m.shift === 1 }))
      };
    },
    api_adminLogin: () => ({ ok: true, token: 'preview-session-not-real' }),
    api_adminLogout: () => ({ ok: true }),
    api_admin: (date) => ({
      today, date: date || today, day: 5, rosterVerified: true,
      users: roster.filter(m => m.type === 1),
      rosterByShift: { 1: roster.filter(m => m.day === 5 && m.shift === 1),
        3: roster.filter(m => m.day === 5 && m.shift === 3), 2: [] },
      records: [{ id: 11, userId: 102, shift: 1, kind: 'duty', detail: '' }],
      exempt: { all: false, grades: {} }
    }),
    api_members: () => roster.slice(),
    api_rosterAudit: () => ({ ok: true, members: roster.length, events: roster.length + 3, errors: [] }),
    api_promotionPreview: () => ({ ok: true, year: 2027, done: false, reviewRequired: false,
      promotions: 2, graduates: 1,
      members: roster.filter(m => m.type === 1).slice(0, 3)
        .map(m => ({ id: m.id, name: m.name, fromGrade: m.grade,
          action: m.grade === 3 ? 'graduate' : 'promote', toGrade: m.grade === 3 ? null : m.grade + 1 })) }),
    api_attend: (id) => { attended.add(Number(id)); return { ok: true, message: '출석이 기록되었습니다.' }; },
    api_makeup: () => ({ ok: true, message: '보충 출석이 기록되었습니다.' }),
    api_addMember: () => ({ ok: true, message: '미리보기에서 변경이 반영된 것처럼 표시됩니다.' }),
    api_updateMember: () => ({ ok: true }),
    api_graduate: () => ({ ok: true }),
    api_restore: () => ({ ok: true }),
    api_deleteMember: () => ({ ok: false, message: '미리보기에서는 명단을 변경하지 않습니다.' }),
    api_applyPromotion: () => ({ ok: false, message: '미리보기에서는 진급을 실행하지 않습니다.' }),
    api_csv: () => ({ ok: true, csv: '요일,이름\n금,예시 학생 B' })
  };
  function runner(ok, fail) {
    return new Proxy({
      withSuccessHandler(fn) { return runner(fn, fail); },
      withFailureHandler(fn) { return runner(ok, fn); }
    }, {
      get(target, name) {
        if (name in target) return target[name];
        return (...args) => queueMicrotask(() => {
          try {
            if (!Object.hasOwn(server, name)) throw new Error('미리보기 미지원: ' + String(name));
            if (ok) ok(server[name](...args));
          } catch (err) { if (fail) fail(err); }
        });
      }
    });
  }
  window.google = { script: { run: runner(null, null) } };
  // Preview controls are injected outside the production UI and never sent to Google.
  document.addEventListener('DOMContentLoaded', () => {
    const selector = document.getElementById('preview-scenario');
    if (!selector) return;
    selector.addEventListener('change', () => {
      scenario = selector.value;
      if (typeof show === 'function') show('home');
    });
  });
})();
</script>
<style>
.preview-banner {
  position:fixed;right:1rem;bottom:1rem;z-index:40;
  padding:.55rem .8rem;background:#202d3a;color:#fff;
  font:600 12px/1.4 system-ui,sans-serif;border-radius:6px;
  box-shadow:0 3px 14px #0002;display:flex;flex-direction:column;gap:.25rem;max-width:17rem;
}
.preview-banner label {font-weight:700;}
.preview-banner small {color:#d7e5e0;}
.preview-banner select {font:inherit;padding:.35rem;border-radius:.35rem;border:1px solid #aab8b1;background:white;color:#202d3a;}
@media(max-width:500px) {.preview-banner {left:1rem;right:1rem;bottom:.5rem;max-width:none;}}
</style>
<div class="preview-banner" aria-label="테스트 데이터 미리보기">
  <label for="preview-scenario">화면 테스트</label>
  <select id="preview-scenario" aria-label="가상 출석 화면 조건">
    <option value="regular">정상 출석 시간</option>
    <option value="crowded">당번 8명</option>
    <option value="empty">배정된 당번 없음</option>
    <option value="closed">출석 시간 외</option>
  </select>
  <small>가상 데이터 · 실제 서버 연결 없음</small>
</div>`;
const output = index.replace(include, logo + "\n" + mocks);
const destination = path.join(root, "preview-ui.html");
fs.writeFileSync(destination, output, "utf8");
console.log("Created " + destination);
console.log("Open preview-ui.html in Chrome / Edge; administrator login accepts any demo text.");
console.log("All names and attendance records are synthetic, not real school data.");
