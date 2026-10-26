const test = require("node:test");
const assert = require("node:assert/strict");
const { createPrefs, DEFAULTS } = require("../src/prefs");
const { createShortcuts } = require("../src/shortcuts");

function memoryFs(initial) {
  const files = initial ? { "/p.json": initial } : {};
  return {
    files,
    readFileSync: (p) => { if (!(p in files)) throw new Error("ENOENT"); return files[p]; },
    writeFileSync: (p, data) => { files[p] = data; },
    renameSync: (from, to) => { files[to] = files[from]; delete files[from]; },
  };
}

test("first run uses the default shortcuts", () => {
  const prefs = createPrefs({ fs: memoryFs(), filePath: "/p.json" });
  assert.deepEqual(prefs.get(), DEFAULTS);
  assert.deepEqual(DEFAULTS.hotkeys, { message: "Command+F", email: "Command+G" });
});

test("a chosen shortcut is saved and survives a restart", () => {
  const fs = memoryFs();
  const prefs = createPrefs({ fs, filePath: "/p.json" });
  assert.equal(prefs.setHotkey("message", "Control+J").ok, true);
  assert.equal(createPrefs({ fs, filePath: "/p.json" }).get().hotkeys.message, "Control+J");
  assert.equal(createPrefs({ fs, filePath: "/p.json" }).get().hotkeys.email, "Command+G");
});

test("invalid shortcuts are refused and nothing is saved", () => {
  const fs = memoryFs();
  const prefs = createPrefs({ fs, filePath: "/p.json" });
  assert.equal(prefs.setHotkey("message", "Command+C").ok, false);
  assert.equal(prefs.setHotkey("message", "Q").ok, false);
  assert.equal(prefs.setHotkey("poem", "Control+J").ok, false);
  assert.deepEqual(fs.files, {});
  assert.equal(prefs.get().hotkeys.message, "Command+F");
});

test("Message and Email can't share a shortcut", () => {
  const prefs = createPrefs({ fs: memoryFs(), filePath: "/p.json" });
  const result = prefs.setHotkey("message", "Command+G");
  assert.equal(result.ok, false);
  assert.match(result.error, /already used for Email/);
  assert.equal(prefs.setHotkey("email", "Command+F").ok, false);
});

test("the warning travels back with a valid shortcut", () => {
  const prefs = createPrefs({ fs: memoryFs(), filePath: "/p.json" });
  const result = prefs.setHotkey("message", "Command+N");
  assert.equal(result.ok, true);
  assert.match(result.warning, /used by many apps/);
});

test("reset puts the default back unless the other action is using it", () => {
  const prefs = createPrefs({ fs: memoryFs(), filePath: "/p.json" });
  prefs.setHotkey("message", "Control+J");
  assert.deepEqual(prefs.resetHotkey("message"), { ok: true, accelerator: "Command+F" });
  prefs.setHotkey("message", "Control+J");
  prefs.setHotkey("email", "Command+F");
  assert.equal(prefs.resetHotkey("message").ok, false);
});

test("a corrupt or tampered file falls back to safe defaults", () => {
  for (const bad of ["not json", "{}", '{"hotkeys":{"message":"Command+C","email":"Q"}}', '{"hotkeys":{"message":"Control+J","email":"Control+J"}}']) {
    const prefs = createPrefs({ fs: memoryFs(bad), filePath: "/p.json" });
    assert.deepEqual(prefs.get().hotkeys, bad.includes("Control+J") ? DEFAULTS.hotkeys : DEFAULTS.hotkeys, bad);
  }
  const partial = createPrefs({ fs: memoryFs('{"hotkeys":{"message":"Control+J"}}'), filePath: "/p.json" });
  assert.deepEqual(partial.get().hotkeys, { message: "Control+J", email: "Command+G" });
});

function fakeGlobalShortcut({ refuse = [] } = {}) {
  const registered = new Map();
  return {
    registered,
    register: (accelerator, callback) => {
      if (refuse.includes(accelerator)) return false;
      registered.set(accelerator, callback);
      return true;
    },
    unregisterAll: () => registered.clear(),
  };
}

test("both shortcuts are registered and trigger the right kind", () => {
  const triggered = [];
  const gs = fakeGlobalShortcut();
  const shortcuts = createShortcuts({ globalShortcut: gs, prefs: createPrefs({ fs: memoryFs(), filePath: "/p.json" }), onTrigger: (k) => triggered.push(k) });
  assert.deepEqual(shortcuts.apply(), { message: { ok: true }, email: { ok: true } });
  gs.registered.get("Command+F")();
  gs.registered.get("Command+G")();
  assert.deepEqual(triggered, ["message", "email"]);
});

test("a shortcut another app owns is reported, the other one still works", () => {
  const gs = fakeGlobalShortcut({ refuse: ["Command+G"] });
  const shortcuts = createShortcuts({ globalShortcut: gs, prefs: createPrefs({ fs: memoryFs(), filePath: "/p.json" }), onTrigger() {} });
  const status = shortcuts.apply();
  assert.equal(status.message.ok, true);
  assert.equal(status.email.ok, false);
  assert.match(status.email.error, /Another app/);
});

test("changing a shortcut re-registers it, and pausing releases everything", () => {
  const gs = fakeGlobalShortcut();
  const prefs = createPrefs({ fs: memoryFs(), filePath: "/p.json" });
  const shortcuts = createShortcuts({ globalShortcut: gs, prefs, onTrigger() {} });
  shortcuts.apply();
  prefs.setHotkey("message", "Control+J");
  shortcuts.apply();
  assert.deepEqual([...gs.registered.keys()].sort(), ["Command+G", "Control+J"]);
  shortcuts.pause();
  assert.equal(gs.registered.size, 0);
  shortcuts.apply();
  assert.equal(gs.registered.size, 0);
  shortcuts.resume();
  assert.equal(gs.registered.size, 2);
});

test("a registration that throws is reported, not fatal", () => {
  const gs = { register: () => { throw new Error("boom"); }, unregisterAll() {} };
  const shortcuts = createShortcuts({ globalShortcut: gs, prefs: createPrefs({ fs: memoryFs(), filePath: "/p.json" }), onTrigger() {} });
  assert.equal(shortcuts.apply().message.ok, false);
});
