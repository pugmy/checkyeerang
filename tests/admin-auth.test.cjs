const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createHash, randomUUID } = require("node:crypto");

const source = fs.readFileSync(path.join(__dirname, "..", "AdminAuth.gs"), "utf8");
const code = fs.readFileSync(path.join(__dirname, "..", "Code.gs"), "utf8");
const html = fs.readFileSync(path.join(__dirname, "..", "Index.html"), "utf8");

function setup() {
  const password = "one-time-password-generated-outside-repository";
  const salt = "0123456789abcdef0123456789abcdef";
  const hash = createHash("sha256").update(salt + ":" + password).digest("hex");
  const config = { value: salt + ":" + hash };
  const cache = new Map();
  const env = {
    Utilities: {
      DigestAlgorithm: { SHA_256: 1 },
      computeDigest: (_kind, input) => [...createHash("sha256").update(input).digest()].map(n => n > 127 ? n - 256 : n),
      getUuid: () => randomUUID(),
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => key === "ADMIN_PASSWORD_HASH" ? config.value : null,
    }) },
    CacheService: { getScriptCache: () => ({
      get: key => cache.get(key) ?? null,
      put: (key, value) => cache.set(key, value),
      remove: key => cache.delete(key),
    }) },
    result_: (ok, message) => ({ ok, message }),
  };
  const context = vm.createContext(env);
  vm.runInContext(source, context, { filename: "AdminAuth.gs" });
  return { context, password, config, cache };
}

test("valid high-entropy password creates a usable administrator session", () => {
  const { context, password } = setup();
  const logged = context.api_adminLogin(password);
  assert.equal(logged.ok, true);
  assert.match(logged.token, /^[0-9a-f-]{72}$/i);
  assert.doesNotThrow(() => context.requireAdmin_(logged.token));
  context.api_adminLogout(logged.token);
  assert.throws(() => context.requireAdmin_(logged.token), /로그인/);
});

test("wrong password and missing configuration fail closed", () => {
  const { context, config } = setup();
  assert.equal(context.api_adminLogin("wrong").ok, false);
  assert.throws(() => context.requireAdmin_(undefined), /로그인/);
  config.value = null;
  assert.equal(context.api_adminLogin("anything").ok, false);
});

test("changing administrator credentials revokes previous sessions", () => {
  const { context, password, config } = setup();
  const token = context.api_adminLogin(password).token;
  config.value = "f".repeat(32) + ":" + "a".repeat(64);
  assert.throws(() => context.requireAdmin_(token), /만료/);
});

test("too many failed login attempts are rejected", () => {
  const { context, password } = setup();
  for (let i = 0; i < 12; i++) assert.equal(context.api_adminLogin("wrong").ok, false);
  assert.match(context.api_adminLogin(password).message, /시도/);
});

test("maintenance entrypoints are private to Apps Script", () => {
  for (const name of ["setup", "findSchool", "recordAbsencesToday", "promoteYearly"]) {
    assert.doesNotMatch(code, new RegExp("function\\s+" + name + "\\s*\\("));
    assert.match(code, new RegExp("function\\s+" + name + "_\\s*\\("));
  }
});

test("all administrative server endpoints call authorization first", () => {
  for (const name of ["api_admin", "api_members", "api_addMember", "api_updateMember",
    "api_deleteMember", "api_graduate", "api_restore", "api_csv",
    "api_promotionPreview", "api_applyPromotion", "api_rosterAudit"]) {
    assert.match(code, new RegExp("function\\s+" + name +
      "\\s*\\([^)]*\\)\\s*\\{\\s*requireAdmin_\\(token\\)"));
  }
});

test("browser script parses and privileged calls use the authenticated wrapper", () => {
  const client = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
  assert.ok(client);
  assert.doesNotThrow(() => new Function(client[1]));
  assert.doesNotMatch(client[1], /\bapi\('api_(?:admin|members|csv|addMember|updateMember|graduate|restore|deleteMember)'/);
  assert.match(client[1], /adminLoginView/);
});
