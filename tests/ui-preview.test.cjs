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
  assert.match(generated, /LOCAL PREVIEW/);
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
  assert.match(html, /<footer>개발 : 16기 안준표<\/footer>/);
});
