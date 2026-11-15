/* eslint-disable */
// @ts-nocheck
// 옛 Index.html의 화면 코드를 그대로 옮긴 것이다. 화면은 DOM을 직접 만들어 #nav, #main에 붙인다.
// 바뀐 곳: 서버 호출(api)이 /api/rpc를 쓰고, 전역 이벤트 리스너를 정리할 수 있게 했다.
export function mountApp() {
  const DAYS = ['월', '화', '수', '목', '금'];
  const SHIFT = { 1: '점심 전', 3: '점심 후', 2: '저녁' };
  const TIME = { 1: '12:30 ~ 13:00', 3: '13:00 ~ 13:20', 2: '18:00 ~ 18:20' };
  const WEEK = ['일', '월', '화', '수', '목', '금', '토'];


  // ---------- 헬퍼 ----------
  // 사용자 입력(이름, 특이사항)은 textContent로만 넣어서 HTML로 해석되지 않게 한다
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : String(c));
    return el;
  }

  // 서버 함수 호출: /api/rpc로 보낸다. 실패하면 서버가 준 메시지로 reject한다.
  const api = async (fn, ...args) => {
    const res = await fetch('/api/rpc', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fn, args }) });
    const data = await res.json().catch(() => null);
    if (!data || data.error !== undefined) throw new Error((data && data.error) || '요청 실패');
    return data.result;
  };
  const disposers = [];
  const listen = (type, fn) => { document.addEventListener(type, fn); disposers.push(() => document.removeEventListener(type, fn)); };

  const errText = (e) => {
    const message = String((e && e.message) || e || '');
    if (/관리자 로그인|로그인이 만료/.test(message)) return '관리자 로그인이 만료됐습니다. 다시 로그인해 주세요.';
    return '요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요.';
  };

  // 관리자 토큰은 메모리에만 보관한다. 탭/브라우저를 닫으면 다시 로그인해야 한다.
  let adminToken = '';
  let adminIdleTimer = null;
  const ADMIN_IDLE_MS = 15 * 60 * 1000;
  function renewAdminIdle() {
    clearTimeout(adminIdleTimer);
    if (!adminToken) return;
    adminIdleTimer = setTimeout(() => { if (adminToken) logoutAdmin(); }, ADMIN_IDLE_MS);
  }
  // 공용 PC에서 학생의 일반 출석 조작은 관리자 세션을 연장하지 않는다.
  ['pointerdown', 'keydown'].forEach((eventName) => listen(eventName, () => {
    if (adminToken && currentTab !== 'home') renewAdminIdle();
  }));
  const adminApi = async (name, ...args) => {
    try { return await api(name, ...args, adminToken); }
    catch (e) {
      if (/관리자 로그인|로그인이 만료/.test(String((e && e.message) || e))) adminToken = '';
      throw e;
    }
  };
  async function logoutAdmin() {
    const token = adminToken;
    adminToken = '';
    clearTimeout(adminIdleTimer);
    show('home');
    try { await api('api_adminLogout', token); } catch (_) { /* 로컬 세션은 폐기됨 */ }
  }
  function adminLoginView(destination) {
    const password = h('input', { type: 'password', class: 'field', autocomplete: 'current-password',
      'aria-label': '관리자 비밀번호' });
    const message = h('p', { class: 'msg bad-text', role: 'alert' });
    const submit = h('button', { type: 'submit', class: 'btn primary lg' }, '로그인');
    const form = h('form', { class: 'col', onsubmit: async (event) => {
      event.preventDefault();
      let response;
      try { response = await busy(submit, '확인 중...', () => api('api_adminLogin', password.value)); }
      catch (e) { response = { ok: false, message: errText(e) }; }
      password.value = '';
      if (!response.ok) { message.textContent = response.message; return; }
      adminToken = response.token;
      renewAdminIdle();
      show(destination);
    } });
    form.append(h('label', { class: 'label' }, '관리자 비밀번호', password), message, submit);
    return h('section', { class: 'card stack mt5', style: 'gap:1rem' },
      h('h1', { class: 'title', style: 'margin:0' }, '관리자 로그인'),
      h('p', { class: 'muted' }, '출석 및 부원 관리는 도서부 담당자만 사용할 수 있습니다.'),
      form);
  }
  function logoutControl() {
    return h('button', { type: 'button', class: 'btn ghost sm', onclick: logoutAdmin }, '로그아웃');
  }

  const svg = (d, cls) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 20 20');
    s.setAttribute('fill', 'none');
    s.setAttribute('stroke', 'currentColor');
    s.setAttribute('stroke-width', '2.5');
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('class', cls);
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', d);
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    s.append(p);
    return s;
  };
  const checkIcon = () => svg('M4 10.5l4 4 8-9', 'check-pop');
  const chevron = () => { const s = svg('M5 8l5 5 5-5', ''); s.style.cssText = 'width:1rem;height:1rem;color:var(--muted)'; return s; };

  const skeleton = (...heights) =>
    h('div', { role: 'status', 'aria-label': '불러오는 중', class: 'stack', style: 'gap:.75rem' },
      heights.map((x) => h('div', { class: 'skeleton', 'aria-hidden': 'true', style: 'height:' + x })));

  // 요청 중에는 버튼을 잠그고 문구를 바꾼다
  async function busy(btn, text, fn) {
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = text;
    try { return await fn(); } finally { btn.disabled = false; btn.textContent = label; }
  }

  // ---------- 모달 (바깥 클릭·Esc로 닫힘, 맨 위 모달만 닫는다) ----------
  const stack = [];
  const modalFocusables = (box) =>
    Array.from(box.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'))
      .filter(el => el.getClientRects().length && el.getAttribute('aria-hidden') !== 'true');

  listen('keydown', (e) => {
    const active = stack[stack.length - 1];
    if (!active) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      active.tryClose();
    } else if (e.key === 'Tab') {
      // 중첩 확인창에서도 현재 가장 위에 있는 모달 안에서만 이동한다.
      const focusable = modalFocusables(active.box);
      if (!focusable.length) { e.preventDefault(); active.box.focus(); return; }
      const first = focusable[0], last = focusable[focusable.length - 1];
      if (e.shiftKey && (document.activeElement === first || !active.box.contains(document.activeElement))) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && (document.activeElement === last || !active.box.contains(document.activeElement))) {
        e.preventDefault(); first.focus();
      }
    }
  });

  function openModal({ label, narrow = false, alert = false, canClose = () => true }, build) {
    const opener = document.activeElement;
    const box = h('div', { class: 'modal' + (narrow ? ' narrow' : ''), role: alert ? 'alertdialog' : 'dialog',
      'aria-modal': 'true', 'aria-label': label, tabindex: '-1' });
    const back = h('div', { class: 'modal-backdrop', onmousedown: (e) => e.target === back && entry.tryClose() }, box);
    let closed = false;
    const entry = { box, tryClose: () => canClose() && close() };
    function close() {
      if (closed) return;
      closed = true;
      back.remove();
      const index = stack.indexOf(entry);
      if (index !== -1) stack.splice(index, 1);
      document.body.classList.toggle('modal-open', stack.length > 0);
      if (opener && opener.isConnected && opener.focus) opener.focus();
      else if (stack.length) stack[stack.length - 1].box.focus();
    }
    stack.push(entry);
    document.body.classList.add('modal-open');
    document.body.append(back);
    try { build(box, close); }
    catch (error) { close(); throw error; }
    const first = modalFocusables(box)[0];
    (first || box).focus();
  }

  // 브라우저 기본 alert/confirm 대신 쓰는 모달. ask는 확인하면 true, 취소·바깥 클릭·Esc면 false.
  function ask(message, withCancel = true) {
    return new Promise((resolve) => {
      openModal({ label: message, alert: true, narrow: true, canClose: () => { resolve(false); return true; } }, (box, close) => {
        const done = (value) => () => { resolve(value); close(); };
        box.append(
          h('p', {}, message),
          h('div', { class: 'row mt8' },
            withCancel ? h('button', { type: 'button', class: 'btn ghost', onclick: done(false) }, '취소') : null,
            h('button', { type: 'button', class: 'btn primary', onclick: done(true) }, '확인')));
      });
    });
  }
  const notify = (message) => ask(message, false);

  function choice(label, options, value, onChange) {
    const row = h('div', { class: 'row' });
    const buttons = options.map((o) =>
      h('button', {
        type: 'button', class: 'choice', 'aria-pressed': String(o.value === value),
        onclick: () => {
          value = o.value;
          buttons.forEach((b, i) => b.setAttribute('aria-pressed', String(options[i].value === value)));
          onChange(value);
        },
      }, o.label));
    row.append(...buttons);
    return h('div', { class: 'label', role: 'group', 'aria-label': label }, label, row);
  }

  // ---------- 출석 면제 일정 ----------
  function schoolRuleModal(rule) {
    openModal({ label: '등교·시험 일정 설정' }, (box, close) => {
      const type = h('select', { class: 'field', 'aria-label': '면제 일정 종류' },
        h('option', { value: 'closed' }, '휴업·방학·공휴일'),
        h('option', { value: 'exam' }, '시험'),
        h('option', { value: 'event' }, '학년별 행사'));
      const gradeBoxes = [1, 2, 3].map(g => h('input', { type: 'checkbox', value: String(g) }));
      const gradeRow = h('div', { class: 'label', role: 'group', 'aria-label': '대상 학년' }, '대상 학년',
        h('div', { class: 'row' }, [1, 2, 3].map((g, i) => h('label', { class: 'row' }, gradeBoxes[i], g + '학년'))));
      const start = h('input', { class: 'field', type: 'date', 'aria-label': '시작일' });
      const end = h('input', { class: 'field', type: 'date', 'aria-label': '종료일' });
      const name = h('input', { class: 'field', maxlength: '80', placeholder: '예: 2학기 기말고사',
        'aria-label': '일정 이름' });
      const note = h('p', { class: 'muted', role: 'note' });
      const msg = h('p', { role: 'alert', class: 'msg bad-text' });
      const save = h('button', { class: 'btn primary', type: 'button' }, '저장');
      if (rule) {
        type.value = rule.category; start.value = rule.startDate;
        end.value = rule.endDate; name.value = rule.title;
        gradeBoxes.forEach(b => { b.checked = (rule.grades || '').split(',').includes(b.value); });
      } else {
        start.value = calendarSelected || new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
        end.value = start.value;
      }
      function updateTip() {
        gradeRow.hidden = type.value !== 'event';
        note.textContent = type.value === 'exam'
          ? '시험 시작일 14일 전부터 종료일까지 출석 의무가 면제됩니다. 시작일에는 시험 첫날을 입력해 주세요.'
          : type.value === 'event'
            ? '선택한 학년의 부원만 이 기간에 출석 의무가 면제됩니다. 해외체험학습·대학탐방 등에 사용하세요.'
            : '선택한 기간 동안 출석 의무가 면제됩니다. 공휴일·재량휴업일·연휴·방학에 사용하세요.';
      }
      type.addEventListener('change', updateTip);
      updateTip();
      save.onclick = async () => {
        const data = { category: type.value, startDate: start.value,
          endDate: end.value, title: name.value.trim(),
          grades: gradeBoxes.filter(b => b.checked).map(b => b.value).join(',') };
        let result;
        try { result = await busy(save, '저장 중...', () =>
          adminApi('api_schoolRuleSave', data, rule?.id || 0)); }
        catch (e) { result = { ok: false, message: errText(e) }; }
        if (!result.ok) { msg.textContent = result.message; return; }
        close(); show('calendar');
      };
      box.append(h('h2', {}, rule ? '면제 일정 수정' : '면제 일정 등록'),
        h('label', { class: 'label' }, '종류', type), gradeRow,
        h('label', { class: 'label' }, '시작일', start),
        h('label', { class: 'label' }, '종료일', end),
        h('label', { class: 'label' }, '일정 이름', name), note, msg,
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn ghost', onclick: close }, '취소'), save));
    });
  }
  async function schoolRulesModal() {
    const rules = await adminApi('api_schoolRules');
    openModal({ label: '일정 관리' }, (box, close) => {
      const list = rules.map(rule =>
        h('li', { class: 'calendar-detail-row' },
          h('div', {},
            h('strong', {}, rule.title),
            h('small', { class: 'calendar-caption' },
              rule.startDate + (rule.endDate !== rule.startDate ? ' ~ ' + rule.endDate : '') +
              ' · ' + (rule.category === 'exam' ? '시험' : rule.category === 'event' ? '학년별 행사 · ' + rule.grades.replace(/,/g, '·') + '학년' : '휴업·방학') + (rule.neisKey ? ' · NEIS' : ''))),
          h('div', { class: 'row wrap' },
            h('button', { type: 'button', class: 'btn ghost sm',
              onclick: () => { close(); schoolRuleModal(rule); } }, '수정'),
            h('button', { type: 'button', class: 'btn ghost sm', onclick: async () => {
              if (!(await ask('이 면제 일정을 해제할까요?'))) return;
              let result;
              try { result = await adminApi('api_schoolRuleCancel', rule.id); }
              catch (e) { result = { ok: false, message: errText(e) }; }
              if (!result.ok) { notify(result.message); return; }
              close(); show('calendar');
            } }, '해제'))));
      const sync = h('button', { type: 'button', class: 'btn ghost' }, 'NEIS에서 가져오기');
      sync.onclick = async () => {
        let res;
        try { res = await busy(sync, '가져오는 중...', () => adminApi('api_schoolRulesSync')); }
        catch (e) { res = { ok: false, message: errText(e) }; }
        await notify(res.message);
        if (res.ok) { close(); schoolRulesModal().catch(e => notify(errText(e))); show('calendar'); }
      };
      box.append(h('h2', {}, '일정 관리'),
        h('p', { class: 'muted' }, '휴업일·공휴일·시험 기간은 NEIS에서 자동으로 가져오며, 여기서 수정하거나 해제할 수 있습니다. 시험은 시작일 14일 전부터 면제됩니다.'),
        h('ul', { class: 'calendar-detail-list' },
          list.length ? list : [h('li', { class: 'muted' }, '등록된 면제 일정이 없습니다.')]),
        h('div', { class: 'actions' },
          h('button', { type: 'button', class: 'btn ghost', onclick: close }, '닫기'), sync,
          h('button', { type: 'button', class: 'btn primary',
            onclick: () => { close(); schoolRuleModal(null); } }, '+ 일정 등록')));
    });
  }

  // ---------- 월간 일정 ----------
  // 달력 선·상세 목록에 쓰는 면제 사유 이름. 학년별 행사는 대상 학년을 붙인다.
  const schoolLabel = (r) => r.category === 'exam' ? (r.lead ? '시험 기간' : '시험') + ' · ' + r.title
    : r.category === 'event' ? '행사 · ' + r.title + ' (' + r.grades.replace(/,/g, '·') + '학년)'
    : '휴업 · ' + r.title;
  const CALENDAR_LABELS = { activity: '활동·행사', makeup_plan: '보충 예정', notice: '메모' };
  let calendarMonth = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 7);
  let calendarSelected = '';
  function calendarMove(month, delta) {
    const [year, number] = month.split('-').map(Number);
    return new Date(Date.UTC(year, number - 1 + delta, 1)).toISOString().slice(0, 7);
  }
  function calendarNoteModal(date) {
    openModal({ label: '일정 등록' }, (box, close) => {
      const title = h('input', { class: 'field', placeholder: '일정 이름', maxlength: '80', 'aria-label': '일정 이름' });
      const detail = h('textarea', { class: 'field', rows: '3', maxlength: '300',
        placeholder: '필요하면 메모를 적어 주세요.', 'aria-label': '일정 메모' });
      const type = h('select', { class: 'field', 'aria-label': '일정 종류' },
        Object.entries(CALENDAR_LABELS).map(([value, label]) => h('option', { value }, label)));
      const member = h('select', { class: 'field', 'aria-label': '보충 예정 부원' });
      const memberRow = h('label', { class: 'label' }, '보충 예정 부원', member);
      memberRow.hidden = true;
      type.addEventListener('change', () => { memberRow.hidden = type.value !== 'makeup_plan'; });
      const info = h('p', { class: 'msg bad-text', role: 'alert' });
      const save = h('button', { class: 'btn primary', type: 'button' }, '일정 저장');
      save.onclick = async () => {
        const payload = {
          date, category: type.value, title: title.value.trim(), detail: detail.value.trim(),
          userId: type.value === 'makeup_plan' ? Number(member.value) : 0
        };
        if (!payload.title) { info.textContent = '일정 이름을 입력해 주세요.'; return; }
        try {
          const res = await busy(save, '저장 중...', () => adminApi('api_calendarAdd', payload));
          if (!res.ok) { info.textContent = res.message; return; }
          close(); show('calendar');
        } catch (e) { info.textContent = errText(e); }
      };
      box.append(h('h2', {}, '일정 등록'), h('p', { class: 'muted' }, date),
        h('label', { class: 'label' }, '종류', type), memberRow,
        h('label', { class: 'label' }, '일정 이름', title),
        h('label', { class: 'label' }, '메모', detail), info,
        h('div', { class: 'actions' },
          h('button', { class: 'btn ghost', type: 'button', onclick: close }, '취소'), save));
      adminApi('api_members').then(users => {
        users.filter(u => u.type === 1).forEach(u =>
          member.append(h('option', { value: String(u.id) }, u.name + ' · ' + u.grade + '학년')));
      }).catch(() => { info.textContent = '부원 명단을 불러오지 못했습니다.'; });
    });
  }
  async function renderCalendar() {
    const data = await adminApi('api_calendarMonth', calendarMonth);
    if (!data.ok) throw new Error(data.message || '달력을 불러오지 못했습니다.');
    if (!data.days.some(d => d.date === calendarSelected && d.inMonth)) {
      const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
      calendarSelected = data.days.find(d => d.date === today && d.inMonth)?.date ||
        data.days.find(d => d.inMonth)?.date || '';
    }
    const dayDetail = h('section', { class: 'calendar-details', 'aria-live': 'polite' });
    const shiftNames = { 1: '점심 전', 3: '점심 후', 2: '저녁' };
    let grid;
    function detail(date) {
      const day = data.days.find(d => d.date === date);
      if (!day) return;
      calendarSelected = date;
      const slots = day.slots.map(slot =>
        h('li', { class: 'calendar-detail-row' },
          h('span', { class: 'bold' }, shiftNames[slot.shift]),
          h('span', {}, day.verified ?
            (slot.members.length ? slot.members.map(m => m.name).join(', ') : '—') : '이력 미확인')));
      const notes = day.notes.map(note =>
        h('li', { class: 'calendar-detail-row' },
          h('span', {}, CALENDAR_LABELS[note.category] + ' · ' +
            (note.name ? note.name + ' · ' : '') + note.title,
            note.detail ? h('small', { class: 'calendar-caption' }, note.detail) : null),
          h('button', { type: 'button', class: 'btn ghost sm', onclick: async () => {
            if (!(await ask('이 일정을 삭제할까요?'))) return;
            try {
              const res = await adminApi('api_calendarDelete', note.id);
              if (res.ok) show('calendar'); else notify(res.message);
            } catch (e) { notify(errText(e)); }
          } }, '삭제')));
      // 휴업·공휴일·시험 일정(NEIS에서 가져왔거나 일정 관리에서 등록한 것)도 같은 목록에 읽기 전용으로 보여 준다.
      const schoolRows = (day.school?.reasons || []).map(r =>
        h('li', { class: 'calendar-detail-row' },
          h('span', {}, schoolLabel(r))));
      const records = day.records.map(rec =>
        h('li', { class: 'calendar-detail-row' }, rec.name + ' · ' +
          ({ duty: '출석 완료', makeup: '보충 완료', absent: '결석' })[rec.kind]));
      // replaceChildren은 false를 "false" 글자로 넣으므로 조건부 항목은 걸러낸다.
      dayDetail.replaceChildren(...[
        h('div', { class: 'between' },
          h('h2', { class: 'sub' }, date + ' 일정'),
          h('div', { class: 'row wrap' },
            h('button', { class: 'btn ghost sm', type: 'button', onclick: () => {
              adminDate = date; show('admin');
            } }, '출석 기록 보기'),
            h('button', { class: 'btn primary sm', type: 'button', onclick: () => calendarNoteModal(date) }, '+ 일정 추가'))),
        day.school?.all && h('p', { class: 'school-notice', role: 'note' },
          day.school.reasons.some(r => r.category === 'exam') ? '시험 기간입니다' : '출석 의무가 없는 날입니다'),
        day.needsReview && h('p', { class: 'bad-text', role: 'note' },
          '이 날짜에 면제 대상 결석 기록이 있습니다. 출석 관리에서 확인해 주세요.'),
        !day.verified && h('p', { class: 'muted' }, '이력 도입 전 시간표는 확인되지 않습니다.'),
        h('h3', { class: 'calendar-detail-title' }, '정규 당번'),
        h('ul', { class: 'calendar-detail-list' }, slots),
        h('h3', { class: 'calendar-detail-title' }, '등록된 일정'),
        h('ul', { class: 'calendar-detail-list' },
          schoolRows.length + notes.length ? [...schoolRows, ...notes] : [h('li', { class: 'muted' }, '등록된 일정이 없습니다.')]),
        h('h3', { class: 'calendar-detail-title' }, '출석 기록'),
        h('ul', { class: 'calendar-detail-list' },
          records.length ? records : [h('li', { class: 'muted' }, '출석 기록이 없습니다.')]),
      ].filter(Boolean));
    }
    const headings = ['월', '화', '수', '목', '금', '토', '일'].map(day =>
      h('span', { class: 'calendar-weekday' }, day));
    // 휴업·시험 일정을 같은 이름끼리 연속된 날짜로 묶어 선(bar)으로 그린다. 이름이 다른 일정은 줄(lane)과 색이 다르다.
    const events = [], open = new Map(), lanes = [];
    data.days.forEach((day, i) => {
      const keys = new Set();
      if (day.inMonth) for (const r of day.school?.reasons || []) {
        const kind = r.category === 'exam' ? (r.lead ? 'lead' : 'exam') : r.category === 'event' ? 'event' : 'closed';
        const key = kind + '|' + r.title + '|' + (r.grades || '');
        keys.add(key);
        let ev = open.get(key);
        if (!ev) {
          ev = { kind, title: r.title, from: i, to: i };
          ev.label = schoolLabel(r);
          ev.lane = lanes.findIndex(end => end < i);
          if (ev.lane < 0) ev.lane = lanes.length;
          ev.color = events.length % 5;
          open.set(key, ev); events.push(ev);
        }
        ev.to = i;
        lanes[ev.lane] = i;
      }
      for (const key of [...open.keys()]) if (!keys.has(key)) open.delete(key);
    });
    const bars = (i) => lanes.map((_, lane) => {
      const ev = events.find(e => e.lane === lane && e.from <= i && i <= e.to);
      if (!ev) return h('span', { class: 'cal-bar empty', 'aria-hidden': 'true' });
      const first = i === ev.from || i % 7 === 0, last = i === ev.to || i % 7 === 6;
      return h('span', { class: 'cal-bar c' + ev.color + (first ? ' first' : '') + (last ? ' last' : ''), title: ev.label },
        first ? ev.label : null);
    });
    const cells = data.days.map((day, i) => {
      // 다른 달 날짜는 칸만 남기고 비워서, 달마다 달력 크기가 달라지지 않게 한다.
      if (!day.inMonth) return h('div', { class: 'calendar-day other-month', 'aria-hidden': 'true' });
      const names = day.verified ? day.slots.flatMap(slot => slot.members.map(m => m.name)) : [];
      const button = h('button', { type: 'button',
        class: 'calendar-day',
        'aria-label': day.date + ' · 당번 ' + names.length + '명 · 일정 ' + day.notes.length + '건',
        'aria-pressed': String(day.date === calendarSelected),
        onclick: () => {
          Array.from(grid.querySelectorAll('button')).forEach(el => el.setAttribute('aria-pressed', 'false'));
          button.setAttribute('aria-pressed', 'true');
          detail(day.date);
        }
      },
        h('span', { class: 'calendar-day-number' }, String(Number(day.date.slice(-2)))),
        lanes.length ? h('span', { class: 'cal-bars' }, bars(i)) : null,
        names.length ? h('span', { class: 'calendar-day-names' },
          names.slice(0, 2).join(', ') + (names.length > 2 ? ' 외 ' + (names.length - 2) + '명' : '')) : null,
        day.notes.length ? h('span', { class: 'calendar-day-note' }, '일정 ' + day.notes.length) : null,
        day.records.some(rec => rec.kind === 'makeup') ?
          h('span', { class: 'calendar-day-record' }, '보충 완료') : null);
      return button;
    });
    grid = h('div', { class: 'calendar-grid', role: 'group', 'aria-label': calendarMonth + ' 월간 달력' }, headings, cells);
    detail(calendarSelected);
    return h('div', { class: 'stack' },
      h('div', { class: 'between' },
        h('div', {}, h('h1', { class: 'title' }, '도서관 일정'),
          h('p', { class: 'muted' }, '날짜를 선택해 당번과 행사, 보충 예정 및 출석 기록을 확인하세요.')),
        h('div', { class: 'row wrap' },
          h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => {
            try { await schoolRulesModal(); } catch (e) { notify(errText(e)); }
          } }, '일정 관리'),
          logoutControl())),
      h('div', { class: 'calendar-toolbar' },
        h('button', { type: 'button', class: 'btn ghost sm',
          onclick: () => { calendarMonth = calendarMove(calendarMonth, -1); show('calendar'); } }, '이전 달'),
        h('h2', { class: 'sub' }, calendarMonth.replace('-', '년 ') + '월'),
        h('button', { type: 'button', class: 'btn ghost sm',
          onclick: () => { calendarMonth = calendarMove(calendarMonth, 1); show('calendar'); } }, '다음 달')),
      h('div', { class: 'calendar-scroll', tabindex: '0' }, grid), dayDetail,
      h('p', { class: 'muted' }, '행사와 보충 예정은 일정 표시이며, 출석 인정이나 결석 면제에 자동 반영되지 않습니다.'));
  }

  // ---------- 탭 ----------
  const tabs = { home: ['출석체크', renderHome], admin: ['출석관리', renderAdmin], member: ['부원관리', renderMember], calendar: ['달력', renderCalendar] };
  const nav = document.getElementById('nav');
  const main = document.getElementById('main');
  let token = 0;
  let currentTab = 'home';

  async function show(name) {
    currentTab = name;
    const mine = ++token;
    for (const b of nav.children) b.removeAttribute('aria-current');
    nav.querySelector('[data-tab="' + name + '"]').setAttribute('aria-current', 'page');
    main.replaceChildren(skeleton('1.5rem', '9rem', '3rem'));
    try {
      const el = name !== 'home' && !adminToken ? adminLoginView(name) : await tabs[name][1]();
      if (mine === token) main.replaceChildren(el);
    } catch (e) {
      if (mine === token) main.replaceChildren(h('div', { class: 'card big' }, h('p', { class: 'bad-text bold' }, errText(e)), h('button', { class: 'btn ghost mt4', onclick: () => show(name) }, '다시 시도')));
    }
  }
  for (const [key, [label]] of Object.entries(tabs)) nav.append(h('button', { type: 'button', 'data-tab': key, onclick: () => show(key) }, label));

  // ---------- 출석체크 ----------
  function attendButton(m) {
    const slot = h('div', { style: 'width:100%' });
    const done = () => slot.replaceChildren(h('div', { class: 'pill ok big', role: 'status' }, checkIcon(), '출석 완료'));
    if (m.attended) done();
    else slot.append(h('button', { type: 'button', class: 'btn primary lg', onclick: open }, '출석하기'));

    function open() {
      let finished = false;
      openModal({ label: m.name + ' 출석' }, (box, close) => {
        const ta = h('textarea', { class: 'field mt2', id: 'detail', maxlength: '1000', rows: '5', 'aria-label': '특이사항' });
        const count = h('p', { class: 'count' }, '0 / 1000');
        ta.addEventListener('input', () => (count.textContent = ta.value.length + ' / 1000'));
        const msg = h('p', { role: 'status', class: 'msg' });
        const cancel = h('button', { type: 'button', class: 'btn ghost', onclick: close }, '취소');
        const go = h('button', { type: 'button', class: 'btn primary', onclick: confirmIt }, '출석 기록');

        function confirmIt() {
          let pending = false;
          openModal({ label: '출석 확인', alert: true, narrow: true, canClose: () => !pending }, (b2, close2) => {
            const ok = h('button', { type: 'button', class: 'btn primary' }, '확인');
            ok.onclick = async () => {
              pending = true;
              let r;
              try { r = await busy(ok, '저장 중...', () => api('api_attend', m.id, ta.value)); }
              catch (e) { r = { ok: false, message: errText(e) }; }
              pending = false;
              msg.textContent = r.message;
              msg.className = 'msg ' + (r.ok ? 'ok-text' : 'bad-text');
              close2();
              if (r.ok) {
                finished = true;
                ta.disabled = true;
                go.remove();
                cancel.textContent = '닫기';
                done();
              }
            };
            b2.append(
              h('h3', {}, m.name + ' 님, 출석할까요?'),
              h('p', { class: 'detail' }, '특이사항: ' + (ta.value.trim() || '없음')),
              h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: close2 }, '취소'), ok));
          });
        }
        box.append(h('h2', {}, m.name + ' 출석'), h('label', { class: 'label', for: 'detail' }, '특이사항'), ta, count, msg, h('div', { class: 'actions' }, cancel, go));
      });
    }
    return slot;
  }

  function makeupSection(d) {
    let userId = 0;
    const pickLabel = h('span', { class: 'muted' }, '부원 선택');
    const detail = h('textarea', { class: 'field', maxlength: '1000', rows: '3', 'aria-label': '특이사항' });
    const msg = h('p', { role: 'status', class: 'msg', style: 'margin:0' });
    const submit = h('button', { type: 'button', class: 'btn primary', disabled: true }, '보충 기록');
    let timer;

    const pick = h('button', { type: 'button', class: 'field', 'aria-haspopup': 'dialog', onclick: openPicker }, pickLabel, chevron());
    function openPicker() {
      openModal({ label: '부원 선택' }, (box, close) => {
        const groups = [1, 2, 3].map((g) => {
          const members = d.makeup.filter((m) => m.grade === g);
          return h('div', { role: 'group', 'aria-label': g + '학년' },
            h('p', { class: 'muted bold mt2' }, g + '학년'),
            members.length
              ? h('div', { class: 'row wrap' }, members.map((m) =>
                  h('button', {
                    type: 'button', class: 'choice auto', disabled: m.onDuty, 'aria-pressed': String(userId === m.id),
                    onclick: () => {
                      userId = m.id;
                      pickLabel.textContent = m.name;
                      pickLabel.className = '';
                      submit.disabled = false;
                      close();
                    },
                  }, m.name, m.onDuty && h('span', { style: 'font-size:.75rem;font-weight:400;margin-left:.25rem' }, '(현재 당번)'))))
              : h('p', { class: 'muted', style: 'font-size:.9rem' }, '부원 없음'));
        });
        box.append(h('h2', {}, '부원 선택'), h('div', { class: 'col' }, groups), h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: close }, '닫기')));
      });
    }

    submit.onclick = async () => {
      let r;
      try { r = await busy(submit, '저장 중...', () => api('api_makeup', userId, detail.value)); }
      catch (e) { r = { ok: false, message: errText(e) }; }
      msg.textContent = r.message;
      msg.className = 'msg ' + (r.ok ? 'ok-text' : 'bad-text');
      if (r.ok) detail.value = '';
      clearTimeout(timer);
      if (r.ok) timer = setTimeout(() => (msg.textContent = ''), 3000); // 성공 메시지만 사라진다
    };

    return h('section', { class: 'makeup', 'aria-labelledby': 'makeup-title' },
      h('h2', { class: 'sub', id: 'makeup-title' }, '보충 출석'),
      h('p', { class: 'muted' }, '정규 당번이 아닌 날의 도서관 활동을 기록합니다.'),
      h('div', { class: 'label' }, '부원', pick),
      h('label', { class: 'label' }, '특이사항', detail),
      msg, submit);
  }

  let homeViewedShift = null;
  async function renderHome() {
    const d = await api('api_home');
    const displayDate = /^\d{4}-\d{2}-\d{2}$/.test(d.today || '')
      ? new Date(d.today + 'T12:00:00+09:00') : new Date();
    const fmt = (o) => displayDate.toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul', ...o });
    const shifts = [1, 3, 2];
    const actual = d.current?.shift || null;
    if (!shifts.includes(homeViewedShift)) homeViewedShift = actual || 1;
    const selected = homeViewedShift;
    const selectedIndex = shifts.indexOf(selected);
    const list = d.slots?.find(slot => slot.shift === selected)?.duty ||
      (actual === selected ? d.duty : []);
    const exempt = d.exemption?.all === true;
    const reasons = d.exemption?.reasons || [];
    const closed = reasons.some(reason => reason.category === 'closed');
    const exam = reasons.some(reason => reason.category === 'exam');
    const active = !exempt && actual === selected;
    const changeShift = (next) => { homeViewedShift = next; show('home'); };
    const duty = h('section', { class: 'mt4', 'aria-labelledby': 'duty-title' },
      h('div', { class: 'slot-viewer' },
        h('button', { type: 'button', class: 'slot-arrow', disabled: selectedIndex === 0,
          'aria-label': '이전 시간대 보기', onclick: () => changeShift(shifts[selectedIndex - 1]) }, '‹'),
        h('div', { class: 'slot-viewer-title' },
          h('h2', { class: 'sub', id: 'duty-title' }, SHIFT[selected] + ' 당번'),
          h('span', { class: 'pill info' }, TIME[selected])),
        h('button', { type: 'button', class: 'slot-arrow', disabled: selectedIndex === shifts.length - 1,
          'aria-label': '다음 시간대 보기', onclick: () => changeShift(shifts[selectedIndex + 1]) }, '›')),
      selected !== actual && actual &&
        h('button', { type: 'button', class: 'slot-return', onclick: () => changeShift(actual) }, '현재 당번으로'),
      exam && h('p', { class: 'school-notice', role: 'status' }, '시험 기간입니다',
        h('small', {}, '시험 준비 기간과 시험 기간에는 당번 출석 의무가 없습니다.')),
      !exam && exempt && h('p', { class: 'school-notice', role: 'status' },
        closed ? '오늘은 등교하지 않는 날입니다' : '오늘은 출석 의무가 없습니다',
        reasons[0]?.title ? h('small', {}, reasons[0].title) : null),
      !exempt && !actual && h('p', { class: 'school-notice subtle', role: 'status' },
        '현재는 출석 시간이 아닙니다. 다른 시간대의 담당자는 열람만 할 수 있습니다.'),
      !exempt && actual !== selected && h('p', { class: 'slot-readonly' },
        '다른 시간대의 담당자를 보고 있습니다. 이 화면에서는 출석할 수 없습니다.'),
      list.length
        ? h('ul', { class: 'grid2' }, list.map(m =>
            h('li', { class: 'card duty-card' },
              h('span', { class: 'duty-name' }, m.name),
              active ? attendButton(m) :
                h('span', { class: 'pill idle', style: 'align-self:center' },
                  exempt ? '출석 면제' : m.attended ? '출석 완료' : '담당자'))))
        : h('div', { class: 'card big' },
          h('p', { class: 'bold' }, '이 시간대에 배정된 부원이 없습니다.')));
    return h('div', { class: 'stack home-page' },
      h('h1', { class: 'sr-only' }, '출석체크'),
      h('div', { class: 'date-title' },
        h('p', { class: 'app-eyebrow' }, 'LIBRARY ATTENDANCE'),
        h('p', { class: 'y' }, fmt({ year: 'numeric' })),
        h('p', { class: 'md' }, fmt({ month: 'long', day: 'numeric' }),
          h('span', {}, fmt({ weekday: 'long' })))),
      duty,
      active && h('p', { class: 'home-note' }, '본인의 이름을 선택해 출석을 기록해 주세요.'),
      !closed && makeupSection(d));
  }

  // ---------- 출석관리 ----------
  let adminDate = '';

  function detailLine(text) { return h('p', { class: 'detail' }, '특이사항: ' + text); }
  function nameLine(u) { return h('span', { class: 'bold' }, u.name, ' ', h('span', { class: 'name-sub' }, u.grade + '학년')); }

  async function renderAdmin() {
    const d = await adminApi('api_admin', adminDate);
    adminDate = d.date;
    const picker = h('div', { class: 'row wrap' },
      h('input', {
        type: 'date', class: 'field date', value: d.date, 'aria-label': '날짜 선택',
        onchange: (e) => { if (e.target.value) { adminDate = e.target.value; show('admin'); } },
      }),
      h('button', { type: 'button', class: 'btn ghost', onclick: () => csvModal(d.today) }, 'CSV 내보내기'));
    const title = h('div', { class: 'between' },
      h('h1', { class: 'title' }, '출석 관리'), logoutControl());
    const historyNotice = d.rosterVerified === false
      ? h('p', { class: 'detail', role: 'note' },
          '이력 기록을 시작하기 전 날짜입니다. 당시 당번·학년 정보는 현재 등록 정보가 표시될 수 있습니다.')
      : null;

    if (!d.day) return h('div', { class: 'stack' }, title, picker, h('div', { class: 'card big mt5' }, h('p', { class: 'bold', style: 'font-size:1.1rem' }, '주말에는 정규 당번이 없습니다.')));

    const duty = d.records.filter((r) => r.kind === 'duty');
    const makeup = d.records.filter((r) => r.kind === 'makeup');
    const absent = d.records.filter((r) => r.kind === 'absent');
    const excused = d.records.filter((r) => r.kind === 'excused');
    const onDuty = d.users.filter((u) => u.day === d.day);
    const madeUp = d.users.filter((u) => makeup.some((r) => r.userId === u.id));
    const weekday = DAYS[d.day - 1];

    const shiftSections = [1, 3, 2].map((shift) => {
      const members = d.rosterByShift ? (d.rosterByShift[shift] || []) : onDuty.filter((u) => u.shift === shift);
      const present = members.filter((u) => duty.some((r) => r.userId === u.id)).length;
      return h('section', { class: 'mt5' },
        h('div', { class: 'between', style: 'padding:0 .25rem .5rem' },
          h('h3', { class: 'sub' }, SHIFT[shift]),
          members.length > 0 && h('span', { class: 'muted bold', style: 'font-size:.875rem' }, present + ' / ' + members.length + '명 출석')),
        members.length === 0
          ? h('p', { class: 'card muted' }, '당번 없음')
          : h('ul', { class: 'col', style: 'gap:.5rem' }, members.map((u) => {
              const rec = duty.find((r) => r.userId === u.id && r.shift === shift);
              const miss = absent.find((r) => r.userId === u.id && r.shift === shift);
              const corrected = excused.find((r) => r.userId === u.id && r.shift === shift);
              const exempt = d.exempt && (d.exempt.all || d.exempt.grades[u.grade]);
              const free = !rec && !miss && !corrected && exempt;
              const review = !!miss && !!exempt;
              const badge = rec ? '출석' : corrected ? '면제 정정' :
                review ? '면제 정정 필요' : miss ? '결석' : free ? '면제' : '미출석';
              const correctionButton = review && h('button', {
                type: 'button', class: 'btn ghost sm',
                onclick: async () => {
                  if (!(await ask(u.name + ' 학생의 ' + d.date + ' 결석을 면제로 정정할까요?'))) return;
                  try {
                    const result = await adminApi('api_excuseAbsence', miss.id);
                    if (result.ok) show('admin'); else notify(result.message);
                  } catch (e) { notify(errText(e)); }
                }
              }, '면제 정정');
              return h('li', { class: 'card' },
                h('div', { class: 'between' }, nameLine(u),
                  h('div', { class: 'row wrap' },
                    h('span', { class: 'pill ' + (rec ? 'ok' : miss && !review ? 'bad' : free || corrected || review ? 'info' : 'idle') }, badge),
                    correctionButton)),
                rec && rec.detail && detailLine(rec.detail),
                corrected && h('p', { class: 'muted' }, '관리자가 면제로 정정한 기록입니다.'));
            })));
    });

    return h('div', { class: 'stack' }, title, picker, historyNotice,
      d.exempt?.all && h('p', { class: 'school-notice', role: 'status' },
        d.exempt.reasons?.some(r => r.category === 'exam') ? '시험 기간입니다' : '출석 의무가 없는 날입니다',
        h('small', {}, (d.exempt.reasons || []).map(r => r.title).join(' · '))),
      h('h2', { class: 'sec mt8' }, d.date + ' ', h('span', { class: 'name-sub', style: 'font-size:inherit;font-weight:800;color:var(--brand)' }, '(' + weekday + ')'), ' 당번'),
      shiftSections,
      h('h2', { class: 'sec mt10' }, '보충'),
      h('ul', { class: 'col mt3', style: 'gap:.5rem' },
        madeUp.length === 0 && h('li', { class: 'card muted' }, '보충 출석 기록이 없습니다.'),
        madeUp.map((u) =>
          h('li', { class: 'card' },
            h('div', { class: 'between' }, nameLine(u), h('span', { class: 'pill info' }, '보충 완료')),
            makeup.filter((r) => r.userId === u.id).map((r) => r.detail && detailLine(r.detail))))));
  }

  function csvModal(today) {
    openModal({ label: 'CSV 내보내기' }, (box, close) => {
      const from = h('input', { type: 'date', class: 'field', value: today, 'aria-label': '시작일' });
      const to = h('input', { type: 'date', class: 'field', value: today, 'aria-label': '종료일' });
      const msg = h('p', { class: 'msg bad-text', role: 'status' });
      const go = h('button', { type: 'button', class: 'btn primary' }, '내려받기');
      go.onclick = async () => {
        msg.textContent = '';
        if (!from.value || !to.value || to.value < from.value) { msg.textContent = '종료일은 시작일 이후여야 합니다.'; return; }
        let r;
        try { r = await busy(go, '만드는 중...', () => adminApi('api_csv', from.value, to.value)); }
        catch (e) { msg.textContent = errText(e); return; }
        if (!r.ok) { msg.textContent = r.message; return; }
        // BOM을 붙여야 엑셀에서 한글이 깨지지 않는다
        const a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + r.csv], { type: 'text/csv;charset=utf-8' })), download: r.name });
        document.body.append(a);
        a.click();
        a.remove();
        close();
      };
      box.append(
        h('h2', { style: 'margin-bottom:.25rem' }, 'CSV 내보내기'),
        h('p', { class: 'muted', style: 'font-size:.9rem;margin-bottom:1rem' }, '선택한 기간의 정규 출석과 보충 출석을 내려받습니다.'),
        h('div', { class: 'col', style: 'gap:.75rem' }, h('label', { class: 'label' }, '시작일', from), h('label', { class: 'label' }, '종료일', to)),
        msg,
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: close }, '취소'), go));
    });
  }

  const ROSTER_AUDIT_LABEL = {
    MISSING_BASELINE: '시간표 기준 기록이 없습니다',
    INVALID_USER_ID: '부원 식별자가 올바르지 않습니다',
    INVALID_EVENT: '시간표 변경 기록의 형식이 잘못됐습니다',
    DUPLICATE_EVENT_ID: '변경 기록 번호가 중복됩니다',
    INVALID_PATCH: '시간표 변경 내용이 올바르지 않습니다',
    ORPHAN_EVENT: '존재하지 않는 부원을 참조하는 기록입니다',
    MISSING_HISTORY: '부원의 최초 시간표 기록이 없습니다',
    BEFORE_BASELINE: '기준 시점보다 이전의 변경 기록입니다',
    FUTURE_EVENT: '미래 시각의 변경 기록입니다',
    CURRENT_MISMATCH: '현재 시간표와 변경 기록이 일치하지 않습니다',
  };
  // 시간표 이력을 수정하지 않는 읽기 전용 점검.
  async function inspectRoster() {
    openModal({ label: '시간표 이력 점검' }, (box, close) => {
      const message = h('p', { class: 'muted', role: 'status' }, '현재 시간표와 변경 기록을 확인하고 있습니다.');
      box.append(h('h2', {}, '시간표 이력 점검'), message,
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: close }, '닫기')));
      adminApi('api_rosterAudit').then((result) => {
        message.textContent = result.ok
          ? '문제가 발견되지 않았습니다. 부원 ' + result.members + '명, 변경 기록 ' + result.events + '건을 확인했습니다.'
          : '확인이 필요한 항목 ' + result.errors.length + '건이 있습니다.';
        message.className = 'msg ' + (result.ok ? 'ok-text' : 'bad-text');
        if (!result.ok) {
          box.append(h('ul', { class: 'col mt3' }, result.errors.slice(0, 30).map((error) =>
            h('li', { class: 'detail' }, (ROSTER_AUDIT_LABEL[error.code] || '시간표 이력을 확인해 주세요') + ' · 부원 ID ' + (error.userId || '-') +
              (error.id ? ' · 기록 ID ' + error.id : '')))));
          if (result.errors.length > 30) box.append(h('p', { class: 'muted' }, '나머지 항목은 원본 시트에서 확인해 주세요.'));
        }
      }).catch((error) => {
        message.className = 'msg bad-text';
        message.textContent = errText(error);
      });
    });
  }
  // 관리자가 명단을 확인한 뒤 진급을 실행한다. 학생 출석에는 영향이 없다.
  async function openPromotion() {
    openModal({ label: '학년도 명단 정리', narrow: false }, (box, close) => {
      box.classList.add('promotion-dialog');
      const content = h('div', { class: 'col' },
        h('p', { class: 'muted', role: 'status' }, '명단을 불러오는 중입니다.'));
      box.append(h('h2', {}, '학년도 명단 정리'), content,
        h('div', { class: 'actions' },
          h('button', { class: 'btn ghost', type: 'button', onclick: close }, '닫기')));
      adminApi('api_promotionPreview').then((preview) => {
        if (!preview.ok) {
          content.replaceChildren(h('p', { class: 'bad-text' }, preview.message));
          return;
        }
        if (preview.done) {
          content.replaceChildren(h('p', {}, preview.year + '학년도 명단 정리를 마쳤습니다.'));
          return;
        }
        if (preview.reviewRequired) {
          content.replaceChildren(
            h('p', { class: 'bad-text bold' }, '이전 작업의 처리 결과를 먼저 확인해 주세요.'),
            h('p', { class: 'muted' }, '중복 적용을 막기 위해 정리를 중단했습니다. 이력 점검 후 담당자가 원본 명단을 확인해야 합니다.'));
          return;
        }

        const optionsFor = (m) => [
          ['promote', '진급 → ' + (m.fromGrade + 1) + '학년'],
          ['graduate', '졸업 처리'],
          ['exclude', '명단 제외'],
          ['keep', '현 상태 유지']
        ].filter(([action]) => action !== 'promote' || m.fromGrade < 3);
        const selected = new Map();
        const summary = h('p', { class: 'promotion-summary', role: 'status', 'aria-live': 'polite' });
        const confirm = h('input', { type: 'checkbox', 'aria-label': '명단 정리 내용 확인' });
        const apply = h('button', { type: 'button', class: 'btn primary', disabled: true }, '변경 사항 적용');
        const status = h('p', { role: 'alert', class: 'msg bad-text' });
        const recalc = () => {
          const counts = { promote: 0, graduate: 0, exclude: 0, keep: 0 };
          selected.forEach((action) => { counts[action]++; });
          summary.textContent =
            '진급 ' + counts.promote + '명 · 졸업 ' + counts.graduate +
            '명 · 명단 제외 ' + counts.exclude + '명 · 유지 ' + counts.keep + '명';
          apply.disabled = !confirm.checked || !preview.members.length;
        };

        const list = h('ul', { class: 'promotion-list' },
          preview.members.map((m) => {
            const choose = h('select', {
              class: 'field promotion-select', 'aria-label': m.name + ' 처리 방법'
            }, optionsFor(m).map(([value, label]) => h('option', { value }, label)));
            choose.value = m.action;
            selected.set(m.id, m.action);
            choose.addEventListener('change', () => {
              selected.set(m.id, choose.value);
              confirm.checked = false;
              status.textContent = '';
              recalc();
            });
            return h('li', { class: 'promotion-row' },
              h('div', { class: 'promotion-person' },
                h('span', { class: 'bold' }, m.name),
                h('span', { class: 'name-sub' }, '현재 ' + m.fromGrade + '학년')),
              h('label', { class: 'promotion-choice' },
                h('span', { class: 'sr-only' }, m.name + ' 처리 방법'), choose));
          }));

        confirm.addEventListener('change', recalc);
        apply.onclick = async () => {
          const expected = preview.members.map(m => m.id + ':' + m.fromGrade);
          const decisions = preview.members.map(m => ({ id: m.id, action: selected.get(m.id) }));
          let result;
          try {
            result = await busy(apply, '반영 중...', () =>
              adminApi('api_applyPromotion', preview.year, expected, decisions));
          } catch (e) { result = { ok: false, message: errText(e) }; }
          if (result.ok) { close(); show('member'); }
          else {
            status.textContent = result.message;
            confirm.checked = false;
            recalc();
          }
        };
        recalc();
        content.replaceChildren(
          h('p', { class: 'muted' }, preview.year + '학년도 · 기존 재학생 ' + preview.members.length + '명'),
          h('p', {}, '학생별 처리 방법을 확인해 주세요.'),
          h('p', { class: 'muted' },
            '졸업은 학년과 관계없이 같은 항목에서 처리합니다. 명단 제외·진급 유예는 아래에서, 신입생 등록은 부원 관리에서 선택하세요.'),
          list, summary,
          h('label', { class: 'row wrap promotion-confirm' }, confirm, '위 내용을 확인했습니다.'),
          status, apply);
      }).catch((e) => { content.replaceChildren(h('p', { class: 'bad-text' }, errText(e))); });
    });
  }

  // ---------- 부원관리 ----------
  function memberModal(member) {
    openModal({ label: member ? '부원 수정' : '부원 추가' }, (box, close) => {
      const f = member ? { ...member } : { name: '', grade: 1, day: 1, shift: 1 };
      const name = h('input', { class: 'field', value: f.name, 'aria-label': '이름' });
      const msg = h('p', { class: 'msg bad-text', role: 'status' });
      const save = h('button', { type: 'button', class: 'btn primary' }, member ? '저장' : '추가');
      save.onclick = () => {
        const data = { name: name.value.trim(), grade: f.grade, day: f.day, shift: f.shift };
        if (!data.name) { msg.textContent = '이름을 입력해 주세요.'; name.focus(); return; }
        if (member && ['name', 'grade', 'day', 'shift'].every(k => member[k] === data[k])) {
          msg.textContent = '변경된 내용이 없습니다.';
          return;
        }
        let pending = false;
        openModal({ label: '부원 정보 확인', alert: true, narrow: true, canClose: () => !pending }, (confirmation, dismiss) => {
          const send = h('button', { type: 'button', class: 'btn primary' }, member ? '수정 확정' : '등록 확정');
          const cancel = h('button', { type: 'button', class: 'btn ghost', onclick: dismiss }, '다시 확인');
          send.onclick = async () => {
            pending = true;
            cancel.disabled = true;
            let r;
            try { r = await busy(send, '저장 중...', () =>
              member ? adminApi('api_updateMember', member.id, data) : adminApi('api_addMember', data)); }
            catch (e) { r = { ok: false, message: errText(e) }; }
            pending = false;
            cancel.disabled = false;
            if (!r.ok) { dismiss(); msg.textContent = r.message; return; }
            dismiss();
            close();
            show('member');
          };
          confirmation.append(
            h('h3', {}, member ? '변경할 부원 정보를 확인해 주세요.' : '새 부원을 등록할까요?'),
            h('p', { class: 'detail' },
              data.name + ' · ' + data.grade + '학년 · ' + DAYS[data.day - 1] + '요일 · ' + SHIFT[data.shift]),
            h('div', { class: 'actions' }, cancel, send));
        });
      };
      box.append(
        h('h2', {}, member ? '부원 수정' : '부원 추가'),
        h('div', { class: 'col' },
          h('label', { class: 'label' }, '이름', name),
          choice('학년', [1, 2, 3].map((g) => ({ value: g, label: g + '학년' })), f.grade, (v) => (f.grade = v)),
          choice('요일', DAYS.map((d, i) => ({ value: i + 1, label: d })), f.day, (v) => (f.day = v)),
          choice('시간', [1, 3, 2].map((s) => ({ value: s, label: SHIFT[s] })), f.shift, (v) => (f.shift = v))),
        msg,
        h('div', { class: 'actions' }, h('button', { type: 'button', class: 'btn ghost', onclick: close }, '취소'), save));
    });
  }

  function deleteModal(m) {
    let pending = false;
    openModal({ label: '부원 삭제 확인', alert: true, narrow: true, canClose: () => !pending }, (box, close) => {
      const del = h('button', { type: 'button', class: 'btn danger-solid' }, '명단에서 제외');
      const cancel = h('button', { type: 'button', class: 'btn ghost', onclick: close }, '취소');
      del.onclick = async () => {
        pending = true;
        cancel.disabled = true;
        let result;
        try { result = await busy(del, '삭제 중...', () => adminApi('api_deleteMember', m.id)); }
        catch (e) { result = { ok: false, message: errText(e) }; }
        pending = false;
        cancel.disabled = false;
        if (!result.ok) { notify(result.message); return; }
        close();
        show('member');
      };
      box.append(
        h('h3', {}, m.name + ' 부원을 명단에서 제외할까요?'),
        h('p', { class: 'muted', style: 'font-size:.9rem' }, '출석 기록이 없는 부원만 명단에서 제외할 수 있습니다. 이전 시간표 기록은 보존됩니다.'),
        h('div', { class: 'actions' }, cancel, del));
    });
  }

  function graduateModal(m) {
    let pending = false;
    openModal({ label: '졸업 처리 확인', alert: true, narrow: true, canClose: () => !pending }, (box, close) => {
      const go = h('button', { type: 'button', class: 'btn primary' }, '졸업 처리');
      const cancel = h('button', { type: 'button', class: 'btn ghost', onclick: close }, '취소');
      go.onclick = async () => {
        pending = true;
        cancel.disabled = true;
        let result;
        try { result = await busy(go, '처리 중...', () => adminApi('api_graduate', m.id)); }
        catch (e) { result = { ok: false, message: errText(e) }; }
        pending = false;
        cancel.disabled = false;
        if (!result.ok) { notify(result.message); return; }
        close();
        show('member');
      };
      box.append(
        h('h3', {}, m.name + ' 부원을 졸업 처리할까요?'),
        h('p', { class: 'muted', style: 'font-size:.9rem' }, '졸업생 명단으로 이동합니다. 학년과 관계없이 같은 방식으로 처리되며, 출석 및 시간표 기록은 유지됩니다.'),
        h('div', { class: 'actions' }, cancel, go));
    });
  }

  function statsList(m) {
    return h('dl', { class: 'stats' }, [['출석', m.workCount, 'ok-text'], ['보충', m.addCount, ''], ['결석', m.runCount, 'bad-text']].map(([l, v, c]) =>
      h('div', {}, h('dt', {}, l), h('dd', { class: c, style: c ? '' : 'color:var(--brand)' }, v))));
  }

  function nameBlock(m, sub) {
    return h('div', { class: 'info' },
      h('p', { class: 'bold', style: 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }, m.name + ' ', h('span', { class: 'name-sub' }, m.grade + '학년')),
      h('p', { class: 'muted', style: 'font-size:.9rem' }, sub));
  }

  async function renderMember() {
    const all = await adminApi('api_members');
    const members = all.filter((m) => m.type === 1);
    const alumni = all.filter((m) => m.type === 0);
    const archived = all.filter((m) => m.type === -1);

    const search = h('input', { type: 'search', class: 'field',
      placeholder: '부원 이름 검색', 'aria-label': '부원 이름 검색' });
    const searchCount = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite', style: 'font-size:.875rem' });
    const emptySearch = h('p', { class: 'search-empty', role: 'status' }, '검색 결과가 없습니다. 이름을 다시 확인해 주세요.');
    emptySearch.hidden = true;
    const overview = h('p', { class: 'muted', style: 'margin:.5rem 0 1rem' },
      '재학생 ' + members.length + '명 · ' +
      [1, 2, 3].map(g => g + '학년 ' + members.filter(m => m.grade === g).length + '명').join(' · '));

    // 현재 당번을 한눈에 확인하는 5일 × 3시간대 시간표. 이름을 누르면 기존 수정 창을 연다.
    const scheduleShifts = [1, 3, 2];
    const scheduleTable = h('table', { class: 'schedule-table', 'aria-label': '도서부 주간 당번 시간표' },
      h('thead', {}, h('tr', {},
        h('th', { scope: 'col' }, '시간'),
        DAYS.map(day => h('th', { scope: 'col' }, day + '요일')))),
      h('tbody', {}, scheduleShifts.map(shift =>
        h('tr', {},
          h('th', { scope: 'row' },
            h('span', {}, SHIFT[shift]),
            h('small', { class: 'schedule-time' }, TIME[shift])),
          DAYS.map((day, index) => {
            const assigned = members.filter(m => m.day === index + 1 && m.shift === shift);
            return h('td', { class: 'schedule-cell' },
              assigned.length ? assigned.map(m => h('button', {
                type: 'button', class: 'schedule-person',
                'aria-label': m.name + ' · ' + day + '요일 ' + SHIFT[shift] + ' 당번 수정',
                onclick: () => memberModal(m)
              }, m.name, h('small', {}, m.grade + '학년')))
              : h('span', { class: 'schedule-empty' }, '—'));
          })))));
    const scheduleSection = h('section', { class: 'schedule-section', 'aria-labelledby': 'schedule-heading' },
      h('div', { class: 'between schedule-heading' },
        h('div', {},
          h('h2', { id: 'schedule-heading', class: 'sub' }, '주간 당번 시간표'),
          h('p', { class: 'muted' }, '이름을 누르면 요일과 당번 시간을 바로 수정할 수 있습니다.')),
        h('button', { type: 'button', class: 'btn ghost sm',
          onclick: async () => {
            try { await schoolRulesModal(); } catch (e) { notify(errText(e)); }
          } }, '일정 관리')),
      h('div', { class: 'schedule-scroll', tabindex: '0', role: 'region',
        'aria-label': '주간 당번 시간표, 가로 스크롤 가능' }, scheduleTable));
    const scheduleToggle = h('button', { type: 'button', class: 'btn ghost sm',
      'aria-expanded': 'true', 'aria-controls': 'schedule-board' }, '시간표 접기');
    scheduleSection.id = 'schedule-board';
    scheduleToggle.addEventListener('click', () => {
      const visible = !scheduleSection.hidden;
      scheduleSection.hidden = visible;
      scheduleToggle.setAttribute('aria-expanded', String(!visible));
      scheduleToggle.textContent = visible ? '시간표 펼치기' : '시간표 접기';
    });

    const list = members.length === 0
      ? h('div', { class: 'card big' }, h('p', { class: 'bold' }, '등록된 부원이 없습니다.'), h('p', { class: 'muted', style: 'font-size:.9rem' }, '오른쪽 위 “부원 추가”로 시작해 보세요.'))
      : h('ul', { class: 'member-roster' }, members.map((m) =>
          h('li', { class: 'card member' },
            nameBlock(m, DAYS[m.day - 1] + '요일 · ' + SHIFT[m.shift]),
            statsList(m),
            h('div', { class: 'row' },
              h('button', { type: 'button', class: 'btn ghost sm', onclick: () => memberModal(m) }, '수정'),
              h('button', { type: 'button', class: 'btn ghost sm', onclick: () => graduateModal(m) }, '졸업'),
              h('button', { type: 'button', class: 'btn danger sm', onclick: () => deleteModal(m) }, '명단 제외')))));

    const restore = async (btn, m) => {
      let r;
      try { r = await busy(btn, '처리 중...', () => adminApi('api_restore', m.id)); }
      catch (e) { r = { ok: false, message: errText(e) }; }
      if (r.ok) show('member'); else notify(r.message);
    };
    const graduates = alumni.length > 0 && h('details', { class: 'mt8' },
      h('summary', { class: 'bold', style: 'cursor:pointer;padding:.5rem 0' }, '졸업생 (' + alumni.length + '명)'),
      h('ul', { class: 'col mt3', style: 'gap:.5rem' }, alumni.map((m) => {
        const back = h('button', { type: 'button', class: 'btn ghost sm' }, '복귀');
        back.onclick = () => restore(back, m);
        return h('li', { class: 'card member' },
          nameBlock(m, '졸업'),
          statsList(m),
          h('div', { class: 'row' }, back, h('button', { type: 'button', class: 'btn danger sm', onclick: () => deleteModal(m) }, '명단 제외')));
      })));

    const archivedList = archived.length > 0 && h('details', { class: 'mt8' },
      h('summary', { class: 'bold', style: 'cursor:pointer;padding:.5rem 0' },
        '명단에서 제외된 부원 (' + archived.length + '명)'),
      h('p', { class: 'muted mt2' }, '실수로 제외한 부원은 여기서 복귀시킬 수 있습니다. 이전 시간표 기록은 유지됩니다.'),
      h('ul', { class: 'col mt3' }, archived.map((m) => {
        const button = h('button', { type: 'button', class: 'btn ghost sm' }, '명단에 복귀');
        button.onclick = () => restore(button, m);
        return h('li', { class: 'card member' },
          nameBlock(m, '명단 제외'), h('div', { class: 'row' }, button));
      })));
    search.addEventListener('input', () => {
      const query = search.value.trim().toLocaleLowerCase('ko-KR');
      let visible = 0;
      Array.from(list.children).forEach((item, i) => {
        const member = members[i];
        const matches = !!member && member.name.toLocaleLowerCase('ko-KR').includes(query);
        item.style.display = matches ? '' : 'none';
        if (matches) visible++;
      });
      searchCount.textContent = query ? '검색 결과 ' + visible + '명' : '';
      emptySearch.hidden = !query || visible !== 0 || !members.length;
    });

    return h('div', { class: 'stack' },
      h('div', { class: 'between', style: 'margin-bottom:1rem' }, h('h1', { class: 'title', style: 'margin:0' }, '부원 관리'), h('div', { class: 'row wrap' }, logoutControl(),
        scheduleToggle,
        h('button', { type: 'button', class: 'btn ghost sm', onclick: inspectRoster }, '이력 점검'),
        h('button', { type: 'button', class: 'btn ghost sm', onclick: openPromotion }, '학년도 정리'),
        h('button', { type: 'button', class: 'btn primary', onclick: () => memberModal() }, '+ 부원 추가'))),
      overview,
      scheduleSection,
      search,
      searchCount,
      list,
      emptySearch,
      graduates,
      archivedList);
  }

  show('home');

  return () => {
    disposers.forEach((d) => d());
    clearTimeout(adminIdleTimer);
    token++; // 진행 중인 화면 요청의 결과는 버린다
    stack.forEach((m) => m.box.parentNode && m.box.parentNode.remove());
    document.body.classList.remove('modal-open');
    nav.replaceChildren();
    main.replaceChildren();
  };
}
