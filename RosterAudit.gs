// 읽기 전용 시간표 감사. 이력을 임의로 수정하거나 빈 구간을 추정하지 않는다.
function rosterAuditData_(users, events, baseline, at) {
  var errors = [];
  var current = {};
  var history = {};
  users.forEach(function (u) {
    if (!Number.isSafeInteger(u.id) || u.id <= 0 || current[u.id]) {
      errors.push({ code: 'INVALID_USER_ID', userId: u.id });
    }
    current[u.id] = u;
  });
  events.forEach(function (e) {
    if (!Number.isSafeInteger(e.id) || e.id <= 0 ||
        !Number.isSafeInteger(e.userId) || e.userId <= 0 ||
        typeof e.effectiveAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(e.effectiveAt) ||
        Number.isNaN(Date.parse(e.effectiveAt))) {
      errors.push({ code: 'INVALID_EVENT', id: e.id });
      return;
    }
    var patch;
    try { patch = JSON.parse(e.patch); }
    catch (_) { errors.push({ code: 'INVALID_PATCH', id: e.id }); return; }
    if (!patch || Array.isArray(patch) || typeof patch !== 'object' ||
        !Object.keys(patch).length ||
        Object.keys(patch).some(function (key) {
          return ROSTER_FIELDS_.indexOf(key) < 0;
        })) {
      errors.push({ code: 'INVALID_PATCH', id: e.id });
      return;
    }
    if (!current[e.userId]) {
      errors.push({ code: 'ORPHAN_EVENT', id: e.id, userId: e.userId });
      return;
    }
    (history[e.userId] = history[e.userId] || []).push(e);
  });
  Object.keys(current).forEach(function (key) {
    var chronological = (history[key] || []).sort(function (a, b) {
      return a.effectiveAt < b.effectiveAt ? -1 :
        a.effectiveAt > b.effectiveAt ? 1 : a.id - b.id;
    });
    if (!chronological.length) {
      errors.push({ code: 'MISSING_HISTORY', userId: Number(key) });
      return;
    }
    if (chronological[0].effectiveAt < baseline) {
      errors.push({ code: 'BEFORE_BASELINE', userId: Number(key) });
    }
    if (chronological.some(function (e) { return e.effectiveAt > at; })) {
      errors.push({ code: 'FUTURE_EVENT', userId: Number(key) });
      return;
    }
    var state = rosterStateAt_((function () {
      var index = {}; index[key] = chronological; return index;
    })(), Number(key), at);
    if (!state || ROSTER_FIELDS_.some(function (field) {
      return state[field] !== current[key][field];
    })) {
      errors.push({ code: 'CURRENT_MISMATCH', userId: Number(key) });
    }
  });
  return { ok: !!baseline && errors.length === 0, baseline: baseline || null,
    checkedAt: at, members: users.length, events: events.length, errors: errors };
}

function rosterAudit_() {
  var baseline = PropertiesService.getScriptProperties().getProperty('ROSTER_BASELINE_AT');
  if (!baseline) return { ok: false, errors: [{ code: 'MISSING_BASELINE' }] };
  return rosterAuditData_(read_('User'), read_('RosterHistory'), baseline, new Date().toISOString());
}

// Admin-only read endpoint. No data modification.
function api_rosterAudit(token) {
  requireAdmin_(token);
  return rosterAudit_();
}

function rosterAssertConsistent_() {
  var result = rosterAudit_();
  if (!result.ok) {
    throw new Error('시간표 이력과 현재 부원 정보가 일치하지 않습니다. 관리자에게 기록 점검을 요청하세요.');
  }
}
