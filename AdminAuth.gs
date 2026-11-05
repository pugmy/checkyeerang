// 관리자 전용 인증. 공개 웹앱이므로 모든 관리 API에서 서버 측으로 검증한다.
// 스크립트 속성 ADMIN_PASSWORD_HASH는 "salt:sha256" 형식의 무작위 비밀번호 해시다.
var ADMIN_SESSION_SECONDS_ = 4 * 60 * 60;
var ADMIN_FAILURE_WINDOW_ = 10 * 60;
var ADMIN_FAILURE_LIMIT_ = 12;

function adminHash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text)
    .map(function (n) { return ('0' + (n & 255).toString(16)).slice(-2); }).join('');
}

function adminConfig_() {
  var value = PropertiesService.getScriptProperties().getProperty('ADMIN_PASSWORD_HASH') || '';
  var parts = value.split(':');
  if (parts.length !== 2 || !/^[0-9a-f]{32}$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) return null;
  return { salt: parts[0], hash: parts[1] };
}

function api_adminLogin(password) {
  var config = adminConfig_();
  if (!config) return result_(false, '관리자 비밀번호가 설정되지 않았습니다.');
  var cache = CacheService.getScriptCache();
  var failed = Number(cache.get('admin:failed') || 0);
  if (failed >= ADMIN_FAILURE_LIMIT_) return result_(false, '로그인 시도가 많습니다. 잠시 후 다시 시도하세요.');
  if (typeof password !== 'string' || password.length > 256 ||
      adminHash_(config.salt + ':' + password) !== config.hash) {
    // 여러 사람이 공유하는 웹앱이므로 전역 속도 제한을 둔다.
    // 로그인 실패가 누적되면 정상 관리자도 일시 제한될 수 있다.
    cache.put('admin:failed', String(failed + 1), ADMIN_FAILURE_WINDOW_);
    return result_(false, '비밀번호가 올바르지 않습니다.');
  }
  // 브라우저에 비밀번호를 보관하지 않고, 짧은 수명의 불투명 토큰만 전달한다.
  var token = Utilities.getUuid() + Utilities.getUuid();
  cache.put('admin:session:' + adminHash_(token), config.hash, ADMIN_SESSION_SECONDS_);
  return { ok: true, token: token };
}

function requireAdmin_(token) {
  var config = adminConfig_();
  if (!config || typeof token !== 'string' || token.length !== 72 ||
      !/^[0-9a-f-]+$/i.test(token)) {
    throw new Error('관리자 로그인이 필요합니다.');
  }
  var stored = CacheService.getScriptCache().get('admin:session:' + adminHash_(token));
  if (stored !== config.hash) throw new Error('관리자 로그인이 만료되었습니다. 다시 로그인하세요.');
}

function api_adminLogout(token) {
  if (typeof token === 'string' && token.length === 72) {
    CacheService.getScriptCache().remove('admin:session:' + adminHash_(token));
  }
  return result_(true, '로그아웃되었습니다.');
}
