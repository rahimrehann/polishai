const test = require("node:test");
const assert = require("node:assert/strict");
const H = require("../hotkeys.js");

const key = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, metaKey: false, shiftKey: false, ...mods });

test("a modifier plus a letter is accepted", () => {
  assert.deepEqual(H.validate("Control+Q"), { ok: true, accelerator: "Control+Q", warning: null });
  assert.equal(H.validate("Control+J").ok, true);
  assert.equal(H.validate("Control+7").ok, true);
  assert.equal(H.validate("Command+F5").ok, true);
  assert.equal(H.validate("Control+Space").ok, true);
});

test("anything that isn't exactly modifier + key is refused", () => {
  for (const bad of ["Q", "Control", "Control+Shift+Q", "Control+Q+W", "", null, undefined, 42, "Ctrl+Q", "Control+q", "Control+Tab", "Control+F13", "Control+Enter", "Super+Q"]) {
    assert.equal(H.validate(bad).ok, false, String(bad));
  }
});

test("shortcuts that would break the computer are blocked with a reason", () => {
  for (const combo of ["Command+C", "Command+V", "Command+X", "Command+A", "Command+Z", "Command+Q", "Command+W", "Command+H", "Command+M", "Command+Space"]) {
    const result = H.validate(combo);
    assert.equal(result.ok, false, combo);
    assert.match(result.error, /Choose another shortcut/);
  }
});

test("Shift plus a letter is blocked because it types capitals, Shift plus an F key is fine", () => {
  assert.equal(H.validate("Shift+Q").ok, false);
  assert.equal(H.validate("Shift+5").ok, false);
  assert.equal(H.validate("Shift+Space").ok, false);
  assert.equal(H.validate("Shift+F6").ok, true);
});

test("common shortcuts are allowed with a warning", () => {
  assert.match(H.validate("Command+N").warning || "", /used by many apps/);
  assert.match(H.validate("Command+L").warning || "", /used by many apps/);
  assert.match(H.validate("Alt+P").warning || "", /special characters/);
  assert.match(H.validate("Control+A").warning || "", /moves the cursor/);
  assert.equal(H.validate("Control+Q").warning, null);
  assert.equal(H.validate("Control+Y").warning, null);
  assert.equal(H.validate("Command+F5").warning, null);
});

test("fromEvent builds the accelerator from a key press", () => {
  assert.deepEqual(H.fromEvent(key("KeyJ", { ctrlKey: true })), { accelerator: "Control+J" });
  assert.deepEqual(H.fromEvent(key("Digit4", { metaKey: true })), { accelerator: "Command+4" });
  assert.deepEqual(H.fromEvent(key("F7", { altKey: true })), { accelerator: "Alt+F7" });
  assert.deepEqual(H.fromEvent(key("Space", { ctrlKey: true })), { accelerator: "Control+Space" });
});

test("fromEvent waits while only modifiers are down", () => {
  for (const code of ["ControlLeft", "ControlRight", "AltLeft", "MetaLeft", "MetaRight", "ShiftLeft"]) {
    assert.deepEqual(H.fromEvent(key(code, { ctrlKey: true })), { pending: true }, code);
  }
});

test("fromEvent explains a wrong number of modifiers or an unsupported key", () => {
  assert.equal(H.fromEvent(key("KeyQ")).error, H.KEY_HELP);
  assert.equal(H.fromEvent(key("KeyQ", { ctrlKey: true, shiftKey: true })).error, H.KEY_HELP);
  assert.match(H.fromEvent(key("Enter", { ctrlKey: true })).error, /can't be used/);
  assert.match(H.fromEvent(key("Tab", { ctrlKey: true })).error, /can't be used/);
});

test("display shows symbols on a Mac and words elsewhere", () => {
  assert.deepEqual(H.display("Control+Q", "darwin"), ["⌃", "Q"]);
  assert.deepEqual(H.display("Alt+F3", "darwin"), ["⌥", "F3"]);
  assert.deepEqual(H.display("Command+J", "darwin"), ["⌘", "J"]);
  assert.deepEqual(H.display("Control+Q", "win32"), ["Ctrl", "Q"]);
  assert.deepEqual(H.display("nonsense", "darwin"), []);
});
