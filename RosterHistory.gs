// 변경 시점만 저장하는 시간표 이력. 한 이벤트에는 바뀐 필드만 JSON으로 저장한다.
// RosterHistory: id, userId, effectiveAt(UTC ISO), patch(JSON), createdAt(UTC ISO).
var ROSTER_FIELDS_ = ['name', 'grade', 'day', 'shift', 'type'];

function rosterPatch_(before, after) {
  var delta = {};
  ROSTER_FIELDS_.forEach(function (field) {
    if (!before || before[field] !== after[field]) delta[field] = after[field];
  });
  return delta;
}

function rosterWriteEvents_(items, stamp) {
  if (!items.length) return;
  var sh = sheet_('RosterHistory');
  var start = sh.getLastRow() + 1;
  var rows = items.map(function (item, i) {
    return [start + i - 1, item.userId, stamp, JSON.stringify(item.patch), new Date().toISOString()];
  });
  // Read_ converts numeric identifiers; timestamp and JSON remain text.
  var range = sh.getRange(start, 1, rows.length, 5);
  range.setNumberFormats(rows.map(function () { return ['0', '0', '@', '@', '@']; }));
  range.setValues(rows);
}

function rosterBaseline_() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('ROSTER_BASELINE_AT')) return;
  var sh = sheet_('RosterHistory');
  // Only initialize an empty history; this avoids overwriting partial migrations.
  if (sh.getLastRow() > 1) {
    throw new Error('시간표 이력이 이미 있지만 기준 시점이 없습니다. 먼저 이력 시트를 확인하세요.');
  }
  var stamp = new Date().toISOString();
  var users = read_('User');
  rosterWriteEvents_(users.map(function (u) {
    return { userId: u.id, patch: rosterPatch_(null, u) };
  }), stamp);
  props.setProperty('ROSTER_BASELINE_AT', stamp);
}

function rosterRequireBaseline_() {
  if (!PropertiesService.getScriptProperties().getProperty('ROSTER_BASELINE_AT')) {
    throw new Error('시간표 이력이 준비되지 않았습니다. 관리자가 setup_을 실행해야 합니다.');
  }
}

function rosterLog_(userId, before, after, stamp) {
  rosterRequireBaseline_();
  var patch = rosterPatch_(before, after);
  if (!Object.keys(patch).length) return;
  rosterWriteEvents_([{ userId: userId, patch: patch }], stamp || new Date().toISOString());
}

function rosterIndex_() {
  var index = {};
  read_('RosterHistory').forEach(function (row) {
    (index[row.userId] = index[row.userId] || []).push(row);
  });
  Object.keys(index).forEach(function (id) {
    index[id].sort(function (a, b) {
      return a.effectiveAt < b.effectiveAt ? -1 : a.effectiveAt > b.effectiveAt ? 1 : a.id - b.id;
    });
  });
  return index;
}

// null: 대상 시점 이전에 관측된 상태 없음.
// null의 의미는 기준선 전(미확인) 또는 기준선 이후 아직 추가되지 않은 부원이다.
function rosterStateAt_(index, userId, at) {
  var state = null;
  (index[userId] || []).forEach(function (event) {
    if (event.effectiveAt > at) return;
    var patch = JSON.parse(event.patch);
    state = Object.assign(state || { id: Number(userId) }, patch);
  });
  return state;
}

function rosterCovered_(at) {
  var baseline = PropertiesService.getScriptProperties().getProperty('ROSTER_BASELINE_AT');
  return !!baseline && at >= baseline;
}

// 정규 당번 조회는 해당 시간대의 마감 직전 상태를 기준으로 한다.
function rosterAtDeadline_(date, shift) {
  var dateRange = parseDate_(date);
  if (!dateRange) return null;
  return new Date(dateRange.start.getTime() + DEADLINE_MINUTE[shift] * 60000 - 1).toISOString();
}

function rosterHistoryFor_(users, index, at) {
  return users.map(function (u) {
    var state = rosterStateAt_(index, u.id, at);
    // 기준선 이전 기록은 현재 상태를 표시하되 UI/CSV에 미확인 표시를 한다.
    return state || (!rosterCovered_(at) ? u : null);
  }).filter(function (u) { return u !== null; });
}

// 과거 날짜 조회는 시간대별 마감 직전의 배정 상태를 복원한다.
// 같은 날 점심/저녁 사이에 시간표가 바뀌어도 각 당번의 이력이 유지된다.
function rosterDayView_(date, users, records) {
  var range = parseDate_(date);
  var index = rosterIndex_();
  var endOfDay = new Date(range.end.getTime() - 1).toISOString();
  var historicalUsers = rosterHistoryFor_(users, index, endOfDay)
    .filter(function (u) {
      return u.type === 1 || records.some(function (r) { return r.userId === u.id; });
    });
  var slots = {};
  [LUNCH, LUNCH_AFTER, DINNER].forEach(function (shift) {
    var at = rosterAtDeadline_(date, shift);
    slots[shift] = rosterHistoryFor_(users, index, at).filter(function (u) {
      return u.type === 1 && u.day === range.day && u.shift === shift;
    }).sort(byName_);
  });
  var verified = [LUNCH, LUNCH_AFTER, DINNER].every(function (shift) {
    return rosterCovered_(rosterAtDeadline_(date, shift));
  });
  return { users: historicalUsers.sort(byName_), shifts: slots, verified: verified };
}

// CSV는 기록 날짜에 해당하는 시간대 마감 시점의 학년·담당 요일·시간을 출력한다.
function rosterForRecord_(index, record, fallback) {
  var at = record.shift && DEADLINE_MINUTE[record.shift]
    ? rosterAtDeadline_(record.date, record.shift)
    : new Date(parseDate_(record.date).end.getTime() - 1).toISOString();
  var historical = rosterStateAt_(index, record.userId, at);
  return { user: historical || fallback, verified: rosterCovered_(at) && !!historical };
}
