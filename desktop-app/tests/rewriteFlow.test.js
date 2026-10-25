const test = require("node:test");
const assert = require("node:assert/strict");
const { createRewriteFlow, messageFor } = require("../src/rewriteFlow");
const { AppError } = require("../src/errors");

// A pretend computer: a clipboard, a front app, and keys that behave like the real ones.
function setup({ selection = "pls send the doc asap", frontApps = ["Slack", "Slack"], trusted = true, apiResult, apiError, copyWorks = true } = {}) {
  const log = [];
  const board = { text: "my earlier clipboard", html: "<b>my earlier clipboard</b>", rtf: "", image: null };
  const apps = [...frontApps];
  const hudCalls = [];
  const added = [];
  const requested = [];

  const clipboard = {
    snapshot: async () => ({ ...board }),
    restore: async (snap) => { Object.assign(board, { text: "", html: "", rtf: "", image: null }, snap); log.push("restore"); },
    clear: async () => { Object.assign(board, { text: "", html: "", rtf: "", image: null }); log.push("clear"); },
    readText: async () => board.text,
    writeText: async (t) => { Object.assign(board, { text: t, html: "", rtf: "", image: null }); log.push("write"); },
  };
  const keys = {
    waitModifiersUp: async () => { log.push("modifiers-up"); return true; },
    frontApp: async () => (apps.length > 1 ? apps.shift() : apps[0]),
    copy: async () => { log.push("copy"); if (copyWorks) board.text = selection; },
    paste: async () => { log.push(`paste:${board.text}`); },
  };
  const api = {
    rewrite: async (payload) => {
      log.push("rewrite");
      requested.push(payload);
      if (apiError) throw apiError;
      return apiResult || { result: "Please send the document as soon as possible.", usedToday: 3, dailyLimit: 20 };
    },
  };
  const flow = createRewriteFlow({
    keys, clipboard, api,
    history: { add: (e) => added.push(e) },
    permissions: { isTrusted: () => trusted, request: () => log.push("ask-permission") },
    hud: { show: (kind, text) => hudCalls.push([kind, text]) },
    sleep: async () => {},
  });
  return { flow, log, board, hudCalls, added, requested };
}

test("happy path: copies, rewrites, pastes the result, then gives the clipboard back", async () => {
  const { flow, log, board, hudCalls, added, requested } = setup();
  const result = await flow.run("email");
  assert.equal(result.status, "done");
  assert.deepEqual(log, ["modifiers-up", "clear", "copy", "rewrite", "write", "paste:Please send the document as soon as possible.", "restore"]);
  assert.equal(board.text, "my earlier clipboard");
  assert.equal(board.html, "<b>my earlier clipboard</b>");
  assert.deepEqual(requested[0], { text: "pls send the doc asap", format: "email", source: "desktop", app: "Slack" });
  assert.deepEqual(hudCalls.map((c) => c[0]), ["busy", "ok"]);
  assert.deepEqual(added[0], { format: "email", app: "Slack", input: "pls send the doc asap", output: "Please send the document as soon as possible." });
  assert.equal(result.usedToday, 3);
});

test("nothing selected: says so, makes no request, and restores the clipboard", async () => {
  const { flow, log, board, hudCalls } = setup({ selection: "   " });
  assert.equal((await flow.run("message")).status, "no-selection");
  assert.ok(!log.includes("rewrite"));
  assert.equal(board.text, "my earlier clipboard");
  assert.match(hudCalls.at(-1)[1], /Select some text/);
});

test("a copy that never lands is treated as no selection", async () => {
  const { flow, board } = setup({ copyWorks: false });
  assert.equal((await flow.run("message")).status, "no-selection");
  assert.equal(board.text, "my earlier clipboard");
});

test("without permission it asks and does not touch the clipboard or other apps", async () => {
  const { flow, log, board, hudCalls } = setup({ trusted: false });
  assert.equal((await flow.run("message")).status, "no-permission");
  assert.deepEqual(log, ["ask-permission"]);
  assert.equal(board.text, "my earlier clipboard");
  assert.match(hudCalls[0][1], /Accessibility/);
});

test("switching apps mid-rewrite never pastes into the wrong app", async () => {
  const { flow, log, board, hudCalls, added } = setup({ frontApps: ["Slack", "Notes"] });
  assert.equal((await flow.run("message")).status, "done");
  assert.ok(!log.some((l) => l.startsWith("paste")));
  assert.equal(board.text, "Please send the document as soon as possible.");
  assert.match(hudCalls.at(-1)[1], /clipboard/);
  assert.equal(added.length, 1);
});

test("server problems are reported plainly and the clipboard comes back", async () => {
  const cases = [
    [new AppError("RATE_LIMITED", "You've used all 20 free rewrites for today."), /used all 20/],
    [new AppError("BUSY", "PolishAI is busy right now."), /busy right now/],
    [new AppError("AT_CAPACITY", "PolishAI is at its limit for today. Please try again tomorrow."), /at its limit for today/],
    [new AppError("CUSTOM_KEY_INVALID", "Your OpenAI API key was rejected."), /OpenAI/],
    [new AppError("NETWORK", "x"), /Can't reach PolishAI/],
    [new AppError("SESSION_EXPIRED", "x"), /log in again/],
    [new AppError("NOT_LOGGED_IN", "x"), /Log in to PolishAI first/],
    [new AppError("SOMETHING_ELSE", "internal detail"), /Rewrite failed/],
    [new Error("kaboom"), /Rewrite failed/],
  ];
  const quiet = console.error;
  console.error = () => {};
  for (const [error, pattern] of cases) {
    const { flow, board, hudCalls, added } = setup({ apiError: error });
    const result = await flow.run("message");
    assert.equal(result.status, "error");
    assert.equal(board.text, "my earlier clipboard", error.code);
    assert.equal(hudCalls.at(-1)[0], "error");
    assert.match(hudCalls.at(-1)[1], pattern);
    assert.doesNotMatch(hudCalls.at(-1)[1], /internal detail|kaboom/);
    assert.equal(added.length, 0);
  }
  console.error = quiet;
});

test("pressing the shortcut again while one is running is ignored", async () => {
  const { flow, requested } = setup();
  const [first, second] = await Promise.all([flow.run("message"), flow.run("message")]);
  assert.deepEqual([first.status, second.status], ["done", "busy"]);
  assert.equal(requested.length, 1);
});

test("it can run again after finishing, even after a failure", async () => {
  const { flow } = setup({ apiError: new AppError("BUSY", "busy") });
  assert.equal((await flow.run("message")).status, "error");
  assert.equal((await flow.run("message")).status, "error");
});

test("a history failure doesn't undo a successful rewrite", async () => {
  const log = [];
  const { flow } = setup();
  const failingHistoryFlow = (() => {
    const s = setup();
    return createRewriteFlow({
      keys: { waitModifiersUp: async () => {}, frontApp: async () => "Slack", copy: async () => { s.board.text = "hi"; }, paste: async () => {} },
      clipboard: { snapshot: async () => ({ text: "old" }), restore: async () => {}, clear: async () => { s.board.text = ""; }, readText: async () => s.board.text, writeText: async () => {} },
      api: { rewrite: async () => ({ result: "Hello" }) },
      history: { add: () => { throw new Error("disk full"); } },
      permissions: { isTrusted: () => true, request() {} },
      hud: { show: (k, t) => log.push([k, t]) },
      sleep: async () => {},
    });
  })();
  assert.equal((await failingHistoryFlow.run("message")).status, "done");
  assert.equal(log.at(-1)[0], "ok");
  assert.ok(flow);
});

test("unknown errors fall back to a generic message", () => {
  assert.equal(messageFor({ code: "WHAT", message: "secret" }), "Rewrite failed. Try again in a moment.");
});
