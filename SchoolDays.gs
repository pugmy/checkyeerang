// School attendance exemptions are administered separately from ordinary calendar notes.
// Dates are inclusive in Asia/Seoul. Revisions are append-only; the latest revision wins.
var SCHOOL_RULE_CATEGORIES_ = ['closed', 'exam'];
function schoolRulesCurrent_(rows) {
  var superseded = {};
  rows.forEach(function (r) { if (r.supersedesId > 0) superseded[r.supersedesId] = true; });
  return rows.filter(function (r) { return !superseded[r.id] && r.cancelled !== 1; });
}
function schoolRuleValidate_(d) {
  if (!d || SCHOOL_RULE_CATEGORIES_.indexOf(d.category) < 0) return '일정 종류를 선택해 주세요.';
  if (!parseDate_(d.startDate) || !parseDate_(d.endDate) || d.startDate > d.endDate) {
    return '시작일과 종료일을 확인해 주세요.';
  }
  var length = Math.round((parseDate_(d.endDate).start - parseDate_(d.startDate).start) / 86400000);
  if (length > 120) return '한 일정은 121일까지 등록할 수 있습니다.';
  if (typeof d.title !== 'string' || !d.title.trim() || d.title.trim().length > 80) {
    return '일정 이름은 1~80자로 입력해 주세요.';
  }
  return null;
}
function schoolRuleExemption_(date, rows) {
  var reasons = [];
  schoolRulesCurrent_(rows).forEach(function (r) {
    var begin = r.startDate;
    if (r.category === 'exam') {
      var start = parseDate_(r.startDate);
      begin = today_(new Date(start.start.getTime() - 14 * 86400000));
    }
    if (begin <= date && date <= r.endDate) {
      reasons.push({ category: r.category, title: r.title,
        message: r.category === 'exam' ? '시험 기간입니다' : r.title + ' · 등교하지 않는 날' });
    }
  });
  return { all: reasons.length > 0, reasons: reasons };
}
function schoolRuleEffective_(date) {
  return schoolRuleExemption_(date, read_('SchoolDays'));
}
function api_schoolRules(token) {
  requireAdmin_(token);
  return schoolRulesCurrent_(read_('SchoolDays')).sort(function (a, b) {
    return a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : a.id - b.id;
  });
}
function api_schoolRuleSave(data, replaceId, token) {
  requireAdmin_(token);
  var err = schoolRuleValidate_(data);
  if (err) return result_(false, err);
  replaceId = Number(replaceId || 0);
  if (!Number.isSafeInteger(replaceId) || replaceId < 0) return result_(false, '수정할 일정을 다시 선택해 주세요.');
  return locked_(function () {
    var previous = read_('SchoolDays');
    if (replaceId && !schoolRulesCurrent_(previous).some(function (r) { return r.id === replaceId; })) {
      return result_(false, '이미 변경된 일정입니다. 목록을 다시 불러와 주세요.');
    }
    var row = insert_('SchoolDays', { startDate: data.startDate, endDate: data.endDate,
      category: data.category, title: data.title.trim(), supersedesId: replaceId, cancelled: 0 });
    return row ? { ok: true, id: row.id } : result_(false, '일정을 저장하지 못했습니다.');
  });
}
function api_schoolRuleCancel(id, token) {
  requireAdmin_(token);
  id = Number(id);
  if (!Number.isSafeInteger(id) || id <= 0) return result_(false, '일정 번호를 확인해 주세요.');
  return locked_(function () {
    var current = schoolRulesCurrent_(read_('SchoolDays'));
    var target = current.filter(function (r) { return r.id === id; })[0];
    if (!target) return result_(false, '이미 변경된 일정입니다.');
    var row = insert_('SchoolDays', { startDate: target.startDate, endDate: target.endDate,
      category: target.category, title: target.title, supersedesId: id, cancelled: 1 });
    return row ? result_(true, '면제 일정을 해제했습니다. 과거 결석 기록은 자동 삭제되지 않습니다.') :
      result_(false, '일정을 변경하지 못했습니다.');
  });
}
function schoolExemption_(date) {
  var manual = schoolRuleEffective_(date);
  if (manual.all) return { all: true, grades: { 1: true, 2: true, 3: true }, reasons: manual.reasons };
  var neis = exemption_(date);
  neis.reasons = [];
  return neis;
}
