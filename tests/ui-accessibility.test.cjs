const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const html = fs.readFileSync(path.join(__dirname, "..", "Index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/)?.[1];
const css = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];

test("client code remains parseable after dialog and search improvements", () => {
  assert.ok(script);
  assert.ok(css);
  assert.doesNotThrow(() => new Function(script));
});

test("modal focus is limited to the uppermost active dialog", () => {
  assert.match(script, /const active = stack\[stack\.length - 1\]/);
  assert.match(script, /e\.key === 'Tab'/);
  assert.match(script, /e\.shiftKey/);
  assert.match(script, /modalFocusables\(active\.box\)/);
  assert.match(script, /first\.focus\(\)/);
  assert.match(script, /last\.focus\(\)/);
  assert.match(script, /role: alert \? 'alertdialog' : 'dialog'/);
  assert.match(script, /'aria-modal': 'true'/);
});

test("modal close removes its own stack entry and restores connected focus", () => {
  assert.match(script, /const index = stack\.indexOf\(entry\)/);
  assert.match(script, /if \(index !== -1\) stack\.splice\(index, 1\)/);
  assert.match(script, /opener\.isConnected/);
  assert.match(script, /if \(closed\) return/);
  assert.match(css, /body\.modal-open \{overflow:hidden;/);
});

test("search has clear results and empty state", () => {
  assert.match(script, /searchCount\.textContent = query/);
  assert.match(script, /emptySearch\.hidden = !query \|\| visible !== 0/);
  assert.match(script, /list\.children/);
  assert.match(css, /\.search-empty\[hidden\]/);
});

test("mobile touch targets, input sizes and reduced motion are preserved", () => {
  assert.match(css, /\.btn\.sm \{min-height:44px;/);
  assert.match(css, /input, textarea, select \{font-size:16px;/);
  assert.match(css, /touch-action:manipulation/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(html, /SUIT-Variable\.css/);
});
