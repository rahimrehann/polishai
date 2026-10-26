// Runs the extension's real content script against a pretend web page (jsdom) and feeds it
// different answers from the server. The rule these tests protect: the person's text may only
// ever be replaced by a real rewrite. An error must never erase it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const SOURCE = fs.readFileSync(path.join(__dirname, "..", "src", "content.js"), "utf8");
const ORIGINAL = "hey can u send me the file when ur free thx";
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const reply = (status, body) => async () => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => {
    if (body === undefined) throw new Error("no JSON in the answer");
    return body;
  },
});

// Opens a pretend page, selects the sentence, clicks ReWord, and reports what is left.
async function reword(fetchImpl, { token = "tok" } = {}) {
  const dom = new JSDOM(`<body><div id="note">${ORIGINAL}</div></body>`, { runScripts: "outside-only", pretendToBeVisual: true, url: "https://example.com/" });
  const w = dom.window;
  w.chrome = { storage: { local: { get: (keys, callback) => callback({ accessToken: token }) } } };
  w.fetch = fetchImpl;
  w.Range.prototype.getBoundingClientRect = () => ({ top: 100, right: 300, left: 100, bottom: 120, width: 200, height: 20 });
  w.eval(SOURCE);

  const node = w.document.getElementById("note").firstChild;
  const range = w.document.createRange();
  range.setStart(node, 0);
  range.setEnd(node, node.length);
  const selection = w.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  w.document.dispatchEvent(new w.MouseEvent("mouseup", { bubbles: true }));
  await wait(80);

  const button = w.document.getElementById("polish-reword-button");
  assert.ok(button, "the ReWord button appears when text is selected");
  button.dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  await wait(150);

  const after = {
    text: w.document.getElementById("note").textContent.trim(),
    button: (w.document.getElementById("polish-reword-button") || {}).textContent || "",
  };
  w.close();
  return after;
}

test("a real rewrite replaces the selected text", async () => {
  const after = await reword(reply(200, { result: "Hey, could you send me the file when you get a chance? Thanks!" }));
  assert.match(after.text, /could you send me the file/);
  assert.doesNotMatch(after.text, /ur free/);
});

test("a multi-line rewrite keeps its line breaks", async () => {
  const after = await reword(reply(200, { result: "Hi,\n\nCould you send the file?\n\nThanks,\n[Name]" }));
  assert.match(after.text, /Could you send the file/);
  assert.match(after.text, /\[Name\]/);
});

const errors = [
  ["the daily limit is reached", 429, { error: "You've used all 20 free rewrites for today. Add your own key in Settings for more.", code: "RATE_LIMITED" }, /used all 20/],
  ["the person is going too fast", 429, { error: "You're going a little fast. Wait a few seconds and try again.", code: "SLOW_DOWN" }, /going a little fast/],
  ["PolishAI is at its daily capacity", 503, { error: "PolishAI is at its limit for today. Please try again tomorrow.", code: "AT_CAPACITY" }, /at its limit/],
  ["the service is paused by the kill switch", 429, { Reason: "ReservedFunctionConcurrentInvocationLimitExceeded", message: "Rate Exceeded." }, /Something went wrong/],
  ["the server crashes with no explanation", 500, undefined, /Something went wrong/],
  ["the server says OK but sends nothing", 200, {}, /Something went wrong/],
  ["the rewrite comes back empty", 200, { result: "" }, /Something went wrong/],
  ["the rewrite is the wrong kind of thing", 200, { result: 42 }, /Something went wrong/],
];

for (const [label, status, body, message] of errors) {
  test(`the person's text is kept when ${label}`, async () => {
    const after = await reword(reply(status, body));
    assert.equal(after.text, ORIGINAL, "the text must not change");
    assert.match(after.button, message, "and the button says what went wrong");
  });
}

test("a long error message is shortened to fit the little button", async () => {
  const after = await reword(reply(429, { error: "x".repeat(300) }));
  assert.ok(after.button.length <= 48, after.button.length);
  assert.equal(after.text, ORIGINAL);
});

test("the person's text is kept when the login has expired", async () => {
  const after = await reword(reply(401, { error: "Invalid or expired token" }));
  assert.equal(after.text, ORIGINAL);
  assert.match(after.button, /Session expired/);
});

test("the person's text is kept when there is no internet", async () => {
  const quiet = console.error;
  console.error = () => {};
  const after = await reword(async () => { throw new TypeError("Failed to fetch"); });
  console.error = quiet;
  assert.equal(after.text, ORIGINAL);
});

test("with no saved login, nothing is sent and the text is kept", async () => {
  let sent = false;
  const after = await reword(async () => { sent = true; return reply(200, { result: "x" })(); }, { token: null });
  assert.equal(sent, false);
  assert.equal(after.text, ORIGINAL);
  assert.match(after.button, /Log in first/);
});
