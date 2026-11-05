// A month is built with one chronological pass through schedule deltas.
// CalendarNotes stores manually entered plans; attendance remains in choolsuck.
var CALENDAR_CATEGORIES_ = ['activity', 'makeup_plan', 'notice'];

function calendarMonthRange_(month) {
  if (typeof month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return null;
  var year = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  if (year < 2020 || year > 2100) return null;
  var first = new Date(Date.UTC(year, m - 1, 1));
  var offset = (first.getUTCDay() + 6) % 7;
  var begin = new Date(Date.UTC(year, m - 1, 1 - offset));
  return { month: month, begin: begin, days: 42 };
}

function calendarDate_(utcDate) {
  return utcDate.toISOString().slice(0, 10);
}

function calendarDateAt_(range, i) {
  return calendarDate_(new Date(range.begin.getTime() + i * 86400000));
}

function calendarBuildMonth_(month, users, events, records, notes, baseline) {
  var range = calendarMonthRange_(month);
  if (!range) throw new Error('달력 월을 확인해 주세요.');
  var history = events.slice().sort(function (a, b) {
    return a.effectiveAt < b.effectiveAt ? -1 :
      a.effectiveAt > b.effectiveAt ? 1 : a.id - b.id;
  });
  var state = {}, index = 0;
  var usersById = {};
  users.forEach(function (u) { usersById[u.id] = u; });
  var recordsByDate = {}, notesByDate = {};
  records.forEach(function (r) {
    if (r.kind !== 'duty' && r.kind !== 'makeup' && r.kind !== 'absent') return;
    (recordsByDate[r.date] = recordsByDate[r.date] || []).push(r);
  });
  notes.forEach(function (note) {
    (notesByDate[note.date] = notesByDate[note.date] || []).push(note);
  });

  function advance(until) {
    while (index < history.length && history[index].effectiveAt <= until) {
      var event = history[index++];
      // Earlier than baseline dates cannot be reconstructed reliably.
      var patch = JSON.parse(event.patch);
      state[event.userId] = Object.assign(state[event.userId] || { id: event.userId }, patch);
    }
  }
  var days = [];
  for (var i = 0; i < range.days; i++) {
    var date = calendarDateAt_(range, i);
    var dayOfWeek = (new Date(date + 'T12:00:00Z').getUTCDay() + 6) % 7 + 1;
    var slots = [];
    [LUNCH, LUNCH_AFTER, DINNER].forEach(function (shift) {
      var cutoff = rosterAtDeadline_(date, shift);
      advance(cutoff);
      var names = [];
      Object.keys(state).forEach(function (key) {
        var u = state[key];
        if (u.type === 1 && u.day === dayOfWeek && u.shift === shift) {
          names.push({ id: Number(key), name: u.name, grade: u.grade });
        }
      });
      names.sort(function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; });
      slots.push({ shift: shift, members: names });
    });
    var dayRecords = (recordsByDate[date] || []).map(function (r) {
      var person = usersById[r.userId];
      return { id: r.id, kind: r.kind, userId: r.userId,
        name: person ? person.name : '부원 ' + r.userId, detail: r.detail || '', shift: r.shift };
    });
    var dayNotes = (notesByDate[date] || []).map(function (n) {
      var person = usersById[n.userId];
      return { id: n.id, category: n.category, title: n.title, detail: n.detail,
        userId: n.userId, name: person ? person.name : '' };
    });
    days.push({ date: date, inMonth: date.slice(0, 7) === month,
      verified: !!baseline && rosterAtDeadline_(date, DINNER) >= baseline,
      slots: slots, records: dayRecords, notes: dayNotes });
  }
  return { ok: true, month: month, days: days };
}

function api_calendarMonth(month, token) {
  requireAdmin_(token);
  var baseline = PropertiesService.getScriptProperties().getProperty('ROSTER_BASELINE_AT');
  if (!calendarMonthRange_(month)) return { ok: false, message: '조회할 월을 확인해 주세요.' };
  var first = calendarMonthRange_(month);
  var from = calendarDateAt_(first, 0), to = calendarDateAt_(first, 41);
  var records = read_('choolsuck').filter(function (r) { return r.date >= from && r.date <= to; });
  var notes = read_('CalendarNotes').filter(function (r) { return r.date >= from && r.date <= to; });
  return calendarBuildMonth_(month, read_('User'), read_('RosterHistory'), records, notes, baseline);
}

function calendarValidateNote_(data) {
  if (!data || !parseDate_(data.date)) return '날짜를 확인해 주세요.';
  if (CALENDAR_CATEGORIES_.indexOf(data.category) < 0) return '일정 종류를 확인해 주세요.';
  if (typeof data.title !== 'string' || !data.title.trim() || data.title.trim().length > 80) {
    return '일정 이름은 1~80자로 입력해 주세요.';
  }
  if (typeof data.detail !== 'string' || data.detail.length > 300) return '메모는 300자까지 입력할 수 있습니다.';
  if (data.category === 'makeup_plan' && (!Number.isSafeInteger(data.userId) || data.userId <= 0)) {
    return '보충 예정인 부원을 선택해 주세요.';
  }
  return null;
}

function api_calendarAdd(data, token) {
  requireAdmin_(token);
  var problem = calendarValidateNote_(data);
  if (problem) return result_(false, problem);
  return locked_(function () {
    var userId = data.category === 'makeup_plan' ? data.userId : 0;
    if (userId && !read_('User').some(function (u) { return u.id === userId && u.type === 1; })) {
      return result_(false, '등록된 부원을 선택해 주세요.');
    }
    var note = insert_('CalendarNotes', {
      date: data.date, category: data.category, title: data.title.trim(),
      detail: data.detail.trim(), userId: userId
    });
    return note ? { ok: true, id: note.id } : result_(false, '일정을 저장하지 못했습니다.');
  });
}

function api_calendarDelete(id, token) {
  requireAdmin_(token);
  if (!Number.isSafeInteger(id) || id <= 0) return result_(false, '일정 번호를 확인해 주세요.');
  return locked_(function () {
    if (!read_('CalendarNotes').some(function (n) { return n.id === id; })) {
      return result_(false, '해당 일정을 찾을 수 없습니다.');
    }
    delete_('CalendarNotes', 'id', id);
    return result_(true, '일정을 삭제했습니다.');
  });
}
