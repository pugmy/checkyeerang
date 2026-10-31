// 도서부 출석체크: 화면(Index.html) + 서버 로직 + 구글 시트 DB를 모두 Apps Script에서 돌린다.
// 처음 한 번 setup()을 실행하면 시트 파일(User, choolsuck 탭)과 결석 자동 기록 트리거가 만들어진다.

var TZ = 'Asia/Seoul';
// shift 값: 1 점심 전, 2 저녁, 3 점심 후 (기존 데이터의 1/2를 그대로 쓰려고 점심 후를 3으로 추가했다)
var LUNCH = 1;
var DINNER = 2;
var LUNCH_AFTER = 3;
// 당번 출석 마감 시각(분): 점심 전 13:00, 점심 후 13:20, 저녁 18:20
var DEADLINE_MINUTE = { 1: 13 * 60, 3: 13 * 60 + 20, 2: 18 * 60 + 20 };
var SHIFT_ORDER = { 1: 1, 3: 2, 2: 3 }; // 목록 정렬용: 점심 전, 점심 후, 저녁

var SCHEMA = {
  User: ['id', 'name', 'grade', 'day', 'shift', 'workCount', 'addCount', 'runCount', 'createdAt', 'updatedAt'],
  choolsuck: ['id', 'userId', 'day', 'shift', 'kind', 'date', 'detail', 'createdAt', 'updatedAt'],
};
var TEXT_COLS = ['name', 'kind', 'date', 'detail', 'createdAt', 'updatedAt'];

// ---------- 진입점 / 설치 ----------

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('도서부 출석체크')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// 시트 파일이 없으면 만들고, 탭/헤더를 맞추고, 결석 자동 기록 트리거(5분마다)를 건다. 여러 번 실행해도 된다.
function setup() {
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('SHEET_ID');
  var ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('도서부 출석체크 DB');
  if (!id) props.setProperty('SHEET_ID', ss.getId());

  var fresh = ss.getSheets()[0]; // 새 파일에 처음부터 있는 빈 탭
  Object.keys(SCHEMA).forEach(function (t) {
    var cols = SCHEMA[t];
    var sh = ss.getSheetByName(t) || ss.insertSheet(t);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]);
    // "2026-10-29"가 날짜로, "=..."가 수식으로 바뀌지 않게 문자열 열은 일반 텍스트로 고정
    cols.forEach(function (c, i) {
      if (TEXT_COLS.indexOf(c) >= 0) sh.getRange(1, i + 1, sh.getMaxRows(), 1).setNumberFormat('@');
    });
  });
  if (!id && SCHEMA[fresh.getName()] === undefined && ss.getSheets().length > 1) ss.deleteSheet(fresh);

  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'recordAbsencesToday') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('recordAbsencesToday').timeBased().everyMinutes(5).create();

  Logger.log('DB 시트: ' + ss.getUrl());
}

// ---------- 시트 DB ----------

var SS_;
function sheet_(table) {
  SS_ = SS_ || SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  return SS_.getSheetByName(table);
}

function read_(table) {
  var cols = SCHEMA[table];
  var vals = sheet_(table).getDataRange().getValues();
  return vals.slice(1).map(function (v, i) {
    var o = { _row: i + 2 };
    cols.forEach(function (c, j) {
      o[c] = TEXT_COLS.indexOf(c) >= 0 ? String(v[j]) : Number(v[j]);
    });
    return o;
  });
}

function write_(table, row) {
  var cols = SCHEMA[table];
  var values = cols.map(function (c) {
    return row[c] === undefined ? '' : row[c]; // undefined는 setValues가 거부한다
  });
  var sh = sheet_(table);
  var range = sh.getRange(row._row || sh.getLastRow() + 1, 1, 1, cols.length);
  // 시트가 늘어나며 새로 생긴 행은 텍스트 서식을 물려받지 못할 수 있어 쓸 때마다 지정한다
  range.setNumberFormats([cols.map(function (c) { return TEXT_COLS.indexOf(c) >= 0 ? '@' : '0'; })]);
  range.setValues([values]);
}

function dup_(rows, keys, row, exceptId) {
  return rows.some(function (r) {
    return r.id !== exceptId && keys.every(function (k) { return r[k] === row[k]; });
  });
}

// 중복이면 null
function insert_(table, row, unique) {
  var rows = read_(table);
  if (unique && dup_(rows, unique, row, -1)) return null;
  var now = new Date().toISOString();
  row.id = rows.reduce(function (m, r) { return Math.max(m, r.id); }, 0) + 1;
  row.createdAt = row.createdAt || now;
  row.updatedAt = now;
  write_(table, row);
  return row;
}

// 반환: 'NOTFOUND' | 'DUP' | 갱신된 행
function update_(table, id, set, inc, unique) {
  var rows = read_(table);
  var cur = rows.filter(function (r) { return r.id === id; })[0];
  if (!cur) return 'NOTFOUND';
  Object.keys(set || {}).forEach(function (k) { cur[k] = set[k]; });
  Object.keys(inc || {}).forEach(function (k) { cur[k] += inc[k]; });
  if (unique && dup_(rows, unique, cur, cur.id)) return 'DUP';
  cur.updatedAt = new Date().toISOString();
  write_(table, cur);
  return cur;
}

function delete_(table, field, value) {
  var sh = sheet_(table);
  // 아래 행부터 지워야 위쪽 행 번호가 밀리지 않는다
  read_(table).filter(function (r) { return r[field] === value; }).reverse().forEach(function (r) {
    sh.deleteRow(r._row);
  });
}

function locked_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// ---------- 시간 / 당번 규칙 ----------

function today_(now) {
  return Utilities.formatDate(now || new Date(), TZ, 'yyyy-MM-dd');
}

// 한국 시간 기준 {day: 1~5(월~금), shift}. 당번 시간이 아니면 null.
function currentShift_(now) {
  now = now || new Date();
  var day = Number(Utilities.formatDate(now, TZ, 'u')); // 1 월 ~ 7 일
  if (day > 5) return null;
  var min = Number(Utilities.formatDate(now, TZ, 'H')) * 60 + Number(Utilities.formatDate(now, TZ, 'm'));
  if (min >= 12 * 60 + 30 && min < 13 * 60) return { day: day, shift: LUNCH };
  if (min >= 13 * 60 && min < 13 * 60 + 20) return { day: day, shift: LUNCH_AFTER };
  if (min >= 18 * 60 && min < 18 * 60 + 20) return { day: day, shift: DINNER };
  return null;
}

// "YYYY-MM-DD"(한국 날짜) -> {start, end, day(1~5, 주말 0)}. 형식이 틀리면 null.
function parseDate_(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return null;
  var start = new Date(value + 'T00:00:00+09:00');
  if (isNaN(start.getTime()) || today_(start) !== value) return null; // 2026-02-31처럼 넘쳐서 다른 날이 되는 값 거부
  var u = Number(Utilities.formatDate(start, TZ, 'u'));
  return { start: start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000), day: u <= 5 ? u : 0 };
}

function byName_(a, b) {
  return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
}

function result_(ok, message) {
  return { ok: ok, message: message };
}

// ---------- 결석 자동 기록 (트리거 + 화면 접속 시) ----------

// 오늘 마감이 지난 당번 중 출석하지 않은 부원을 결석(absent)으로 기록하고 runCount를 1 올린다.
// 같은 (부원, 날짜, 당번, 종류)는 insert_의 unique 검사로 한 번만 들어가므로 여러 번 불러도 된다.
function recordAbsencesToday() {
  var now = new Date();
  var date = today_(now);
  var range = parseDate_(date);
  if (!range || !range.day) return;

  var due = [LUNCH, LUNCH_AFTER, DINNER].filter(function (shift) {
    return now >= new Date(range.start.getTime() + DEADLINE_MINUTE[shift] * 60 * 1000);
  });
  if (!due.length) return; // 마감 전에는 시트를 읽지 않는다

  // 학사일정을 못 읽으면 면제 여부를 모르므로 잘못된 결석을 남기지 않게 이번에는 건너뛴다(다음 실행에서 다시 시도)
  var exempt;
  try {
    exempt = exemption_(date);
  } catch (e) {
    Logger.log('학사일정 조회 실패로 결석 기록을 건너뜁니다: ' + e.message);
    return;
  }

  locked_(function () {
    var users = read_('User');
    var records = read_('choolsuck').filter(function (r) { return r.date === date; });
    due.forEach(function (shift) {
      var deadline = new Date(range.start.getTime() + DEADLINE_MINUTE[shift] * 60 * 1000);
      users
        .filter(function (u) {
          return (
            u.day === range.day &&
            u.shift === shift &&
            !isExempt_(exempt, u.grade) &&
            u.createdAt < range.start.toISOString() && // 오늘 이전에 등록된 부원만
            !records.some(function (r) {
              return r.userId === u.id && r.shift === shift && (r.kind === 'duty' || r.kind === 'absent');
            })
          );
        })
        .forEach(function (u) {
          var row = insert_(
            'choolsuck',
            { userId: u.id, date: date, day: range.day, shift: shift, kind: 'absent', detail: '', createdAt: deadline.toISOString() },
            ['userId', 'date', 'shift', 'kind']
          );
          if (row) update_('User', u.id, null, { runCount: 1 });
        });
    });
  });
}

// ---------- 화면용 API (google.script.run으로 호출) ----------

function api_home() {
  recordAbsencesToday();
  var date = today_();
  var current = currentShift_();
  var users = read_('User');

  var duty = [];
  if (current) {
    var attended = {};
    read_('choolsuck').forEach(function (r) {
      if (r.date === date && r.kind === 'duty') attended[r.userId] = true;
    });
    duty = users
      .filter(function (u) { return u.day === current.day && u.shift === current.shift; })
      .map(function (u) { return { id: u.id, name: u.name, attended: !!attended[u.id] }; });
  }

  var makeup = users.slice().sort(byName_).map(function (u) {
    return {
      id: u.id,
      name: u.name,
      grade: u.grade,
      onDuty: !!current && u.day === current.day && u.shift === current.shift,
    };
  });
  return { today: date, current: current, duty: duty, makeup: makeup };
}

function api_attend(userId, detail) {
  userId = Number(userId);
  detail = String(detail || '').trim().slice(0, 1000);
  // 클라이언트 값은 믿지 않고, 서버에서 현재 당번 시간대와 해당 부원인지 다시 검증
  var current = currentShift_();
  if (!current) return result_(false, '지금은 당번 시간이 아닙니다.');

  return locked_(function () {
    var member = read_('User').filter(function (u) {
      return u.id === userId && u.day === current.day && u.shift === current.shift;
    })[0];
    if (!member) return result_(false, '지금 당번이 아닙니다.');

    var date = today_();
    var already = read_('choolsuck').some(function (r) {
      return r.userId === member.id && r.date === date && r.shift === current.shift && (r.kind === 'duty' || r.kind === 'absent');
    });
    if (already) return result_(false, '오늘은 이미 출석했습니다.');

    var row = insert_(
      'choolsuck',
      { userId: member.id, date: date, day: current.day, shift: current.shift, kind: 'duty', detail: detail },
      ['userId', 'date', 'shift', 'kind']
    );
    if (!row) return result_(false, '오늘은 이미 출석했습니다.');
    update_('User', member.id, null, { workCount: 1 });
    return result_(true, '출석이 기록되었습니다.');
  });
}

// 보충 출석: 당번이 아닌 부원이 오늘 보충한 기록 (kind=makeup, shift=0)
function api_makeup(userId, detail) {
  userId = Number(userId);
  detail = String(detail || '').trim().slice(0, 1000);
  var date = today_();
  var today = parseDate_(date);
  if (!today.day) return result_(false, '주말에는 보충할 수 없습니다.');

  return locked_(function () {
    var member = read_('User').filter(function (u) { return u.id === userId; })[0];
    if (!member) return result_(false, '부원을 선택하세요.');

    var current = currentShift_();
    if (current && member.day === current.day && member.shift === current.shift) {
      return result_(false, '지금 당번은 보충할 수 없습니다.');
    }

    var row = insert_(
      'choolsuck',
      { userId: member.id, date: date, day: today.day, shift: 0, kind: 'makeup', detail: detail },
      ['userId', 'date', 'shift', 'kind']
    );
    if (!row) return result_(false, '오늘 보충은 이미 기록되었습니다.');
    update_('User', member.id, null, { addCount: 1 });
    return result_(true, '보충이 기록되었습니다.');
  });
}

function api_admin(date) {
  var today = today_();
  var range = parseDate_(date);
  if (!range) {
    date = today;
    range = parseDate_(date);
  }
  if (date === today) recordAbsencesToday();
  if (!range.day) return { today: today, date: date, day: 0, users: [], records: [], exempt: null };

  var records = read_('choolsuck')
    .filter(function (r) { return r.date === date; })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0; });
  var exempt = null;
  try {
    exempt = exemption_(date);
  } catch (e) {} // 학사일정을 못 읽어도 출석 화면은 보여 준다(면제 표시만 빠진다)
  return { today: today, date: date, day: range.day, users: read_('User').sort(byName_), records: records, exempt: exempt };
}

function api_members() {
  return read_('User').sort(function (a, b) {
    return a.day - b.day || SHIFT_ORDER[a.shift] - SHIFT_ORDER[b.shift] || byName_(a, b);
  });
}

function validateMember_(d) {
  if (!d || !String(d.name || '').trim()) return '이름을 입력하세요.';
  var grade = Number(d.grade), day = Number(d.day), shift = Number(d.shift);
  if (!(grade >= 1 && grade <= 3 && grade % 1 === 0)) return '학년은 1~3 중에서 선택하세요.';
  if (!(day >= 1 && day <= 5 && day % 1 === 0)) return '요일은 월~금 중에서 선택하세요.';
  if (!SHIFT_ORDER[shift]) return '점심 전/점심 후/저녁을 선택하세요.';
  return null;
}

function api_addMember(d) {
  var error = validateMember_(d);
  if (error) return result_(false, error);
  return locked_(function () {
    var row = insert_(
      'User',
      { name: String(d.name).trim(), grade: Number(d.grade), day: Number(d.day), shift: Number(d.shift), workCount: 0, addCount: 0, runCount: 0 },
      ['name']
    );
    return row ? result_(true, '추가되었습니다.') : result_(false, '이미 같은 이름의 부원이 있습니다.');
  });
}

function api_updateMember(id, d) {
  var error = validateMember_(d);
  if (error) return result_(false, error);
  return locked_(function () {
    var r = update_(
      'User',
      Number(id),
      { name: String(d.name).trim(), grade: Number(d.grade), day: Number(d.day), shift: Number(d.shift) },
      null,
      ['name']
    );
    if (r === 'DUP') return result_(false, '이미 같은 이름의 부원이 있습니다.');
    if (r === 'NOTFOUND') return result_(false, '존재하지 않는 부원입니다.');
    return result_(true, '수정되었습니다.');
  });
}

// 출석/보충/결석 기록이 부원을 참조하므로 함께 지운다
function api_deleteMember(id) {
  return locked_(function () {
    delete_('choolsuck', 'userId', Number(id));
    delete_('User', 'id', Number(id));
    return result_(true, '삭제되었습니다.');
  });
}

// ---------- CSV ----------

var DAY_NAME = ['일', '월', '화', '수', '목', '금', '토'];
var KIND_LABEL = { makeup: '보충', absent: '결석' }; // 정규 출석은 빈칸
var SHIFT_LABEL = { 0: '', 1: '점심 전', 2: '저녁', 3: '점심 후' };

// 엑셀에서 수식으로 실행되지 않게 하고, CSV 규칙에 맞게 따옴표로 감싼다
function cell_(value) {
  var text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}

// 한국 시간 기준 "2026. 9. 11 오후 12:35:40"
function formatKST_(d) {
  var h = Number(Utilities.formatDate(d, TZ, 'H'));
  return Utilities.formatDate(d, TZ, 'yyyy. M. d') + ' ' + (h < 12 ? '오전' : '오후') + ' ' + (h % 12 || 12) + Utilities.formatDate(d, TZ, ':mm:ss');
}

function api_csv(from, to) {
  var f = parseDate_(from);
  var t = parseDate_(to);
  if (!f || !t) return { ok: false, message: '시작일과 종료일을 올바르게 입력하세요.' };
  if (t.start < f.start) return { ok: false, message: '종료일이 시작일보다 빠릅니다.' };

  var start = f.start.toISOString();
  var end = t.end.toISOString();
  var users = {};
  read_('User').forEach(function (u) { users[u.id] = u; });
  var records = read_('choolsuck')
    .filter(function (r) { return r.createdAt >= start && r.createdAt < end && users[r.userId]; })
    .sort(function (a, b) { return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id; });

  var lines = [['요일', '일시', '시간', '이름', '학년', '구분', '담당 요일', '담당 시간', '특이사항'].map(cell_).join(',')];
  records.forEach(function (r) {
    var u = users[r.userId];
    var at = new Date(r.createdAt);
    var h = Number(Utilities.formatDate(at, TZ, 'H'));
    var recorded = h >= 12 && h < 14 ? '점심' : h >= 17 && h < 19 ? '저녁' : ''; // 기록된 시각 기준
    lines.push(
      [
        DAY_NAME[Number(Utilities.formatDate(at, TZ, 'u')) % 7],
        formatKST_(at),
        recorded,
        u.name,
        u.grade,
        KIND_LABEL[r.kind] || '',
        DAY_NAME[u.day],
        SHIFT_LABEL[r.kind === 'makeup' ? u.shift : r.shift] || '', // 보충 기록의 shift는 0이라 부원의 당번 시간을 쓴다
        r.detail,
      ].map(cell_).join(',')
    );
  });
  return { ok: true, name: 'attendance_' + from + '_' + to + '.csv', csv: lines.join('\r\n') + '\r\n' };
}

// ---------- NEIS 학사일정 ----------
// 스크립트 속성: NEIS_KEY(필수). ATPT_CODE, SCHUL_CODE는 findSchool()을 한 번 실행하면 자동으로 저장된다.

var SCHOOL_NAME = '창원과학고등학교';

function neis_(path, params) {
  var key = PropertiesService.getScriptProperties().getProperty('NEIS_KEY');
  if (!key) throw new Error('스크립트 속성 NEIS_KEY가 없습니다.');
  key = key.replace(/^["'\s]+|["'\s]+$/g, ''); // 붙여넣을 때 딸려온 따옴표/공백 제거
  var hide = function (text) { return String(text).split(key).join('***'); }; // 오류 문구에 키가 새지 않게 한다
  var query = Object.keys(params).map(function (k) { return k + '=' + encodeURIComponent(params[k]); }).join('&');

  var res;
  try {
    res = UrlFetchApp.fetch('https://open.neis.go.kr/hub/' + path + '?KEY=' + key + '&Type=json&' + query, { muteHttpExceptions: true });
  } catch (e) {
    throw new Error('NEIS 호출 실패: ' + hide(e.message));
  }
  try {
    return JSON.parse(res.getContentText());
  } catch (e) {
    throw new Error('NEIS 응답이 JSON이 아닙니다(HTTP ' + res.getResponseCode() + '): ' + hide(res.getContentText().slice(0, 200)));
  }
}

// NEIS 응답은 {서비스명: [{head: [...]}, {row: [...]}]} 이거나, 결과가 없으면 {RESULT: {CODE, MESSAGE}}
function neisRows_(data, service) {
  if (data.RESULT) return { code: data.RESULT.CODE, message: data.RESULT.MESSAGE, rows: [] };
  var block = data[service];
  var result = block[0].head[1].RESULT;
  return { code: result.CODE, message: result.MESSAGE, rows: block[1] ? block[1].row : [] };
}

// 에디터에서 한 번 실행: 학교 코드를 찾아 스크립트 속성(ATPT_CODE, SCHUL_CODE)에 저장한다
function findSchool() {
  var r = neisRows_(neis_('schoolInfo', { SCHUL_NM: SCHOOL_NAME }), 'schoolInfo');
  Logger.log(JSON.stringify(r.rows.map(function (s) { return [s.SCHUL_NM, s.ATPT_OFCDC_SC_CODE, s.SD_SCHUL_CODE, s.ORG_RDNMA]; })));
  if (r.rows.length !== 1) throw new Error('학교가 ' + r.rows.length + '개 검색되었습니다. 로그를 보고 속성을 직접 넣으세요.');
  var props = PropertiesService.getScriptProperties();
  props.setProperty('ATPT_CODE', r.rows[0].ATPT_OFCDC_SC_CODE);
  props.setProperty('SCHUL_CODE', r.rows[0].SD_SCHUL_CODE);
}

function schoolParams_() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SCHUL_CODE')) throw new Error('findSchool()을 먼저 실행하세요.');
  return { ATPT_OFCDC_SC_CODE: props.getProperty('ATPT_CODE'), SD_SCHUL_CODE: props.getProperty('SCHUL_CODE') };
}

// ---------- 결석 면제 (학사일정 기준) ----------
// 면제되는 날: 휴업일/공휴일(전원), 정기시험 2주 전부터 시험 마지막 날까지(전원),
// 아래 행사 중 학년 표시가 Y인 학년(해당 학년만). 그 밖의 행사는 면제하지 않는다.

var EXAM_WORD = '정기시험';
var EXAM_LEAD_DAYS = 14;
var EXEMPT_EVENT_WORDS = ['해외체험학습', '졸업식', '종업식', '진로탐색활동', '이공계 대학탐방'];
var GRADE_FLAG = { 1: 'ONE_GRADE_EVENT_YN', 2: 'TW_GRADE_EVENT_YN', 3: 'THREE_GRADE_EVENT_YN' };

// rows: date부터 date+14일까지의 NEIS 학사일정 행. 반환: {all, grades: {1,2,3}}
function exemptFrom_(rows, date) {
  var ymd = date.replace(/-/g, '');
  var ex = { all: false, grades: { 1: false, 2: false, 3: false } };
  rows.forEach(function (r) {
    // 오늘부터 14일 안에 시험일이 있으면 시험 2주 전이거나 시험 기간 중이다
    if (String(r.EVENT_NM).indexOf(EXAM_WORD) >= 0) ex.all = true;
    if (r.AA_YMD !== ymd) return;
    if (r.SBTR_DD_SC_NM === '휴업일' || r.SBTR_DD_SC_NM === '공휴일') ex.all = true;
    if (EXEMPT_EVENT_WORDS.some(function (w) { return String(r.EVENT_NM).indexOf(w) >= 0; })) {
      [1, 2, 3].forEach(function (g) { if (r[GRADE_FLAG[g]] === 'Y') ex.grades[g] = true; });
    }
  });
  return ex;
}

function isExempt_(ex, grade) {
  return ex.all || ex.grades[grade];
}

// NEIS 조회 결과는 6시간 캐시한다. 조회에 실패하면 예외를 던진다.
function exemption_(date) {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('exempt:' + date);
  if (hit) return JSON.parse(hit);

  var from = parseDate_(date).start;
  var params = schoolParams_();
  params.AA_FROM_YMD = date.replace(/-/g, '');
  params.AA_TO_YMD = today_(new Date(from.getTime() + EXAM_LEAD_DAYS * 24 * 60 * 60 * 1000)).replace(/-/g, '');
  params.pSize = 100;
  var r = neisRows_(neis_('SchoolSchedule', params), 'SchoolSchedule');
  // INFO-200은 "일정 없음"이라 정상이다. 그 밖의 코드(키 오류 등)는 실패로 본다.
  if (r.code !== 'INFO-000' && r.code !== 'INFO-200') throw new Error('NEIS 응답 오류: ' + r.code);

  var ex = exemptFrom_(r.rows, date);
  cache.put('exempt:' + date, JSON.stringify(ex), 6 * 60 * 60);
  return ex;
}
