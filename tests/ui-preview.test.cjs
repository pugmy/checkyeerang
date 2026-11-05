const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const htmlPath = path.join(root, "Index.html");
const logoPath = path.join(root, "Logo.html");
const builderPath = path.join(root, "scripts", "build-ui-preview.cjs");

test("offline preview uses actual project markup, real logo and synthetic records", () => {
  const builder = fs.readFileSync(builderPath, "utf8");
  let generated = null;
  let destination = null;
  const fakeFs = {
    readFileSync: (file, encoding) => fs.readFileSync(file, encoding),
    writeFileSync: (file, data, encoding) => {
      assert.equal(encoding, "utf8");
      destination = file;
      generated = data;
    }
  };
  const sandbox = {
    __dirname: path.join(root, "scripts"),
    require: name => name === "node:fs" ? fakeFs : name === "node:path" ? path : null,
    console: { log() {} },
  };
  vm.runInNewContext(builder, sandbox, { filename: builderPath });
  assert.ok(generated);
  assert.equal(destination, path.join(root, "preview-ui.html"));
  assert.match(generated, /data:image\/png;base64/);
  assert.match(generated, /화면 테스트/);
  assert.match(generated, /가상 데이터 · 실제 서버 연결 없음/);
  assert.match(generated, /api_home: \(\)/);
  assert.doesNotMatch(generated, /<\?!=/);
  assert.match(generated, /SUIT-Variable\.css/);
  const original = fs.readFileSync(htmlPath, "utf8");
  const originalCss = original.match(/<style>([\s\S]*?)<\/style>/)[1];
  assert.ok(generated.includes(originalCss));
  assert.ok(original.includes("createHtmlOutputFromFile('Logo')"));
  assert.ok(fs.readFileSync(logoPath, "utf8").includes("var LOGO="));
  const scripts = Array.from(generated.matchAll(/<script>([\s\S]*?)<\/script>/g), m => m[1]);
  assert.ok(scripts.length >= 3);
  for (const script of scripts) assert.doesNotThrow(() => new Function(script));
});

test("UI has labeled navigation, keyboard focus and reduced-motion handling", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /<nav id="nav" aria-label="주 메뉴"><\/nav>/);
  assert.match(html, /:focus-visible/);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /font-family: "SUIT Variable"/);
  assert.match(html, /<main id="main"><\/main>/);
  assert.match(html, /<footer>개발 · 15기 김우준 · 16기 안준표<\/footer>/);
});

test("preview supports several kiosk display conditions without real student data", () => {
  const builder = fs.readFileSync(builderPath, "utf8");
  assert.match(builder, /value="regular"/);
  assert.match(builder, /value="single"/);
  assert.match(builder, /value="crowded"/);
  assert.match(builder, /value="empty"/);
  assert.match(builder, /value="closed"/);
  assert.match(builder, /scenario === 'closed' \? null/);
  assert.match(builder, /window\.google = \{ script:/);
  assert.doesNotMatch(builder, /https:\/\/script\.google\.com/);
});

test("viewport, Korean document title and authoritative day are provided", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  assert.match(html, /name="viewport" content="width=device-width, initial-scale=1"/);
  assert.match(html, /<title>창원과학고 도서관 출석<\/title>/);
  assert.match(html, /new Date\(d\.today \+ 'T12:00:00\+09:00'\)/);
  assert.match(html, /class: 'member-roster'/);
  assert.match(html, /\.member-roster/);
});

test("student home uses a centered layout independently of administrator pages", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const stylesheet = html.match(/<style>([\s\S]*?)<\/style>/)?.[1] || "";
  const client = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)?.[1] || "";
  assert.match(client, /class: 'stack home-page'/);
  assert.match(stylesheet, /\.home-page \{max-width:52rem;margin-inline:auto;/);
  assert.match(stylesheet, /\.home-page \.date-title \{text-align:center/);
  assert.match(stylesheet, /\.home-page \.slot-heading \{justify-content:center/);
  assert.match(stylesheet, /\.home-page \.grid2 \{/);
  assert.match(stylesheet, /justify-content:center;gap:\.85rem;width:100%;margin-inline:auto;/);
  assert.match(stylesheet, /\.home-page \.makeup \{max-width:43rem;width:100%;margin:3\.25rem auto 0;/);
  assert.match(stylesheet, /\.home-page \.grid2 \{grid-template-columns:minmax\(0,1fr\);max-width:22rem;/);
  assert.match(stylesheet, /\.member-roster \{display:grid;/);
  assert.doesNotMatch(stylesheet, /main\s*\{[^}]*max-width:52rem/);
});

test("annual roster review has per-student choices and plain-language exception help", () => {
  const html = fs.readFileSync(htmlPath, "utf8");
  const client = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)?.[1] || "";
  assert.match(client, /학년도 명단 정리/);
  assert.match(client, /졸업은 학년과 관계없이 같은 항목에서 처리합니다/);
  assert.match(client, /optionsFor\(m\)/);
  assert.match(client, /'현 상태 유지'/);
  assert.match(client, /'진급 → ' \+ \(m\.fromGrade \+ 1\) \+ '학년'/);
  assert.match(client, /selected\.set\(m\.id, choose\.value\)/);
  assert.match(client, /confirm\.checked = false/);
  assert.match(client, /adminApi\('api_applyPromotion', preview\.year, expected, decisions\)/);
  assert.match(html, /\.modal\.promotion-dialog \{max-width:38rem;/);
});
