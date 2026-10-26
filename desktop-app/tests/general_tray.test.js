const test = require("node:test");
const assert = require("node:assert/strict");
const { createPrefs } = require("../src/prefs");
const { createShortcuts } = require("../src/shortcuts");
const { createLoginItem } = require("../src/loginItem");
const { createGeneral } = require("../src/general");
const { createTray } = require("../src/tray");
const { registerIpc } = require("../src/ipc");

function memoryFs(initial) {
  const files = initial ? { "/p.json": initial } : {};
  return {
    files,
    readFileSync: (p) => { if (!(p in files)) throw new Error("ENOENT"); return files[p]; },
    writeFileSync: (p, data) => { files[p] = data; },
    renameSync: (from, to) => { files[to] = files[from]; delete files[from]; },
  };
}

function fakeGlobalShortcut() {
  const registered = new Map();
  return {
    registered,
    register: (a, cb) => { registered.set(a, cb); return true; },
    unregisterAll: () => registered.clear(),
  };
}

function fakeApp({ openAtLogin = false, wasOpenedAtLogin = false } = {}) {
  const state = { openAtLogin, calls: [] };
  return {
    state,
    getLoginItemSettings: () => ({ openAtLogin: state.openAtLogin, wasOpenedAtLogin }),
    setLoginItemSettings: (s) => { state.calls.push(s); state.openAtLogin = s.openAtLogin; },
  };
}

// ----- prefs: paused -----

test("paused is off by default, saved when changed, and survives a restart", () => {
  const fs = memoryFs();
  const prefs = createPrefs({ fs, filePath: "/p.json" });
  assert.equal(prefs.get().paused, false);
  prefs.setPaused(true);
  assert.equal(createPrefs({ fs, filePath: "/p.json" }).get().paused, true);
  prefs.setPaused(false);
  assert.equal(createPrefs({ fs, filePath: "/p.json" }).get().paused, false);
});

test("pausing doesn't lose the chosen shortcuts, and choosing shortcuts doesn't lose the pause", () => {
  const fs = memoryFs();
  const prefs = createPrefs({ fs, filePath: "/p.json" });
  prefs.setHotkey("message", "Control+J");
  prefs.setPaused(true);
  prefs.setHotkey("email", "Control+K");
  prefs.resetHotkey("email");
  const reloaded = createPrefs({ fs, filePath: "/p.json" }).get();
  assert.deepEqual(reloaded, { hotkeys: { message: "Control+J", email: "Command+G" }, paused: true });
});

test("a garbage paused value is ignored", () => {
  const prefs = createPrefs({ fs: memoryFs('{"paused":"yes","hotkeys":{}}'), filePath: "/p.json" });
  assert.equal(prefs.get().paused, false);
  assert.equal(prefs.setPaused("yes"), false);
});

// ----- shortcuts: user pause vs recording pause -----

test("turning shortcuts off unregisters both, turning them on registers both", () => {
  const gs = fakeGlobalShortcut();
  const shortcuts = createShortcuts({ globalShortcut: gs, prefs: createPrefs({ fs: memoryFs(), filePath: "/p.json" }), onTrigger() {} });
  shortcuts.apply();
  assert.equal(gs.registered.size, 2);
  shortcuts.setUserPaused(true);
  assert.equal(gs.registered.size, 0);
  assert.equal(shortcuts.isUserPaused(), true);
  shortcuts.setUserPaused(false);
  assert.equal(gs.registered.size, 2);
});

test("recording a new shortcut never switches shortcuts back on while the user has them off", () => {
  const gs = fakeGlobalShortcut();
  const shortcuts = createShortcuts({ globalShortcut: gs, prefs: createPrefs({ fs: memoryFs(), filePath: "/p.json" }), onTrigger() {} });
  shortcuts.setUserPaused(true);
  shortcuts.pause();
  shortcuts.resume();
  shortcuts.apply();
  assert.equal(gs.registered.size, 0);
  shortcuts.setUserPaused(false);
  assert.equal(gs.registered.size, 2);
});

test("turning shortcuts on while recording keeps them off until recording ends", () => {
  const gs = fakeGlobalShortcut();
  const shortcuts = createShortcuts({ globalShortcut: gs, prefs: createPrefs({ fs: memoryFs(), filePath: "/p.json" }), onTrigger() {} });
  shortcuts.apply();
  shortcuts.pause();
  shortcuts.setUserPaused(false);
  assert.equal(gs.registered.size, 0);
  shortcuts.resume();
  assert.equal(gs.registered.size, 2);
});

// ----- login item -----

test("start at login works only in the installed app", () => {
  const dev = createLoginItem({ app: fakeApp(), platform: "darwin", isPackaged: false });
  assert.equal(dev.supported(), false);
  assert.equal(dev.get(), false);
  assert.equal(dev.startedAtLogin(), false);
  assert.throws(() => dev.set(true), (e) => e.code === "DEV_BUILD");

  const linux = createLoginItem({ app: fakeApp(), platform: "linux", isPackaged: true });
  assert.equal(linux.supported(), false);
});

test("the installed app can turn start at login on and off", () => {
  const app = fakeApp();
  const item = createLoginItem({ app, platform: "darwin", isPackaged: true });
  assert.equal(item.supported(), true);
  assert.equal(item.set(true), true);
  assert.equal(item.get(), true);
  assert.deepEqual(app.state.calls[0], { openAtLogin: true });
  assert.equal(item.set(false), false);
  assert.equal(item.set("yes"), false);
});

test("it knows when the system started it at login", () => {
  const item = createLoginItem({ app: fakeApp({ wasOpenedAtLogin: true }), platform: "darwin", isPackaged: true });
  assert.equal(item.startedAtLogin(), true);
  const normal = createLoginItem({ app: fakeApp(), platform: "darwin", isPackaged: true });
  assert.equal(normal.startedAtLogin(), false);
});

// ----- general (shared by Settings and the menu) -----

function generalSetup({ packaged = true } = {}) {
  const fs = memoryFs();
  const prefs = createPrefs({ fs, filePath: "/p.json" });
  const gs = fakeGlobalShortcut();
  const shortcuts = createShortcuts({ globalShortcut: gs, prefs, onTrigger() {} });
  shortcuts.apply();
  const app = fakeApp();
  const loginItem = createLoginItem({ app, platform: "darwin", isPackaged: packaged });
  let changes = 0;
  const general = createGeneral({ prefs, shortcuts, loginItem, onChange: () => changes++ });
  return { general, prefs, gs, app, changes: () => changes, fs };
}

test("general reports both switches", () => {
  const { general } = generalSetup();
  assert.deepEqual(general.get(), { paused: false, launchAtLogin: { supported: true, enabled: false } });
});

test("pausing from anywhere saves it, releases the shortcuts and tells everyone", () => {
  const { general, gs, prefs, changes } = generalSetup();
  assert.equal(general.setPaused(true).paused, true);
  assert.equal(gs.registered.size, 0);
  assert.equal(prefs.get().paused, true);
  assert.equal(changes(), 1);
  general.setPaused(false);
  assert.equal(gs.registered.size, 2);
});

test("start at login turns on in the installed app and reports why not in development", () => {
  const { general, app } = generalSetup();
  assert.equal(general.setLaunchAtLogin(true).launchAtLogin.enabled, true);
  assert.equal(app.state.openAtLogin, true);

  const dev = generalSetup({ packaged: false });
  assert.throws(() => dev.general.setLaunchAtLogin(true), (e) => e.code === "DEV_BUILD");
  assert.equal(dev.changes(), 0);
});

test("general refuses anything that isn't a true/false", () => {
  const { general } = generalSetup();
  for (const bad of ["yes", 1, null, undefined, {}]) {
    assert.throws(() => general.setPaused(bad), (e) => e.code === "BAD_INPUT");
    assert.throws(() => general.setLaunchAtLogin(bad), (e) => e.code === "BAD_INPUT");
  }
});

// ----- tray menu -----

function trayHarness(stateOverrides = {}) {
  const log = [];
  const state = {
    hotkeys: { message: "Command+K", email: "Command+G" },
    paused: false,
    launchSupported: true,
    launchAtLogin: false,
    ...stateOverrides,
  };
  const built = [];
  class FakeTray {
    constructor(image) { this.image = image; log.push("tray-created"); }
    setContextMenu(menu) { this.menu = menu; built.push(menu); }
    setToolTip(text) { this.tip = text; }
    destroy() { log.push("destroyed"); }
  }
  const actions = {
    open: () => log.push("open"),
    setPaused: (v) => log.push(`paused:${v}`),
    setLaunchAtLogin: (v) => log.push(`login:${v}`),
    quit: () => log.push("quit"),
  };
  const tray = createTray({
    Tray: FakeTray,
    Menu: { buildFromTemplate: (t) => ({ template: t }) },
    nativeImage: { createFromPath: (p) => ({ path: p }) },
    iconPath: "/icon.png",
    platform: "darwin",
    getState: () => state,
    actions,
  });
  return { tray, state, log, built };
}

test("the menu shows the real shortcuts, the switches and the actions", () => {
  const { tray } = trayHarness();
  const labels = tray.template().map((i) => i.label || "---");
  assert.deepEqual(labels, [
    "Open PolishAI", "---", "Message rewrite:  ⌘ K", "Email rewrite:  ⌘ G", "Pause shortcuts", "Start PolishAI at login", "---", "Quit PolishAI",
  ]);
});

test("the menu follows changed shortcuts and the paused state", () => {
  const { tray, state } = trayHarness();
  tray.create();
  state.hotkeys = { message: "Control+J", email: "Alt+F3" };
  state.paused = true;
  tray.refresh();
  const template = tray.template();
  assert.equal(template[2].label, "Message rewrite:  ⌃ J");
  assert.equal(template[3].label, "Email rewrite:  ⌥ F3");
  assert.equal(template[4].checked, true);
});

test("the menu's items do what they say", () => {
  const { tray, log } = trayHarness();
  const t = tray.template();
  t[0].click();
  t[4].click({ checked: true });
  t[5].click({ checked: true });
  t[7].click();
  assert.deepEqual(log, ["open", "paused:true", "login:true", "quit"]);
});

test("start at login is greyed out and explained in development", () => {
  const { tray } = trayHarness({ launchSupported: false });
  const item = tray.template()[5];
  assert.equal(item.enabled, false);
  assert.match(item.label, /installed app only/);
});

test("creating the tray loads the icon and the menu, refreshing rebuilds it, destroying cleans up", () => {
  const { tray, log, built } = trayHarness();
  tray.refresh(); // before creation: harmless
  assert.equal(built.length, 0);
  const created = tray.create();
  assert.equal(created.image.path, "/icon.png");
  assert.equal(built.length, 1);
  assert.equal(created.tip, "PolishAI");
  tray.refresh();
  assert.equal(built.length, 2);
  tray.destroy();
  assert.ok(log.includes("destroyed"));
});

test("the tooltip says when shortcuts are paused", () => {
  const { tray } = trayHarness({ paused: true });
  assert.equal(tray.create().tip, "PolishAI (shortcuts paused)");
});

// ----- ipc -----

test("ipc exposes the general switches and tells everyone when shortcuts change", async () => {
  const handlers = {};
  const fs = memoryFs();
  const prefs = createPrefs({ fs, filePath: "/p.json" });
  const gs = fakeGlobalShortcut();
  const shortcuts = createShortcuts({ globalShortcut: gs, prefs, onTrigger() {} });
  shortcuts.apply();
  const general = createGeneral({ prefs, shortcuts, loginItem: createLoginItem({ app: fakeApp(), platform: "darwin", isPackaged: false }) });
  let changed = 0;
  registerIpc({
    ipcMain: { handle: (c, fn) => { handlers[c] = fn; } },
    cognito: {}, session: {}, api: {}, prefs, shortcuts, history: {}, permissions: {}, clipboard: {},
    general, platform: "darwin", localDate: () => "", onSettingsChanged: () => changed++,
  });
  const call = (c, ...a) => handlers[c]({}, ...a);

  assert.deepEqual((await call("general:get")).data, { paused: false, launchAtLogin: { supported: false, enabled: false } });
  assert.equal((await call("general:setPaused", true)).data.paused, true);
  assert.equal(gs.registered.size, 0);
  assert.equal((await call("general:setPaused", "yes")).error.code, "BAD_INPUT");
  assert.equal((await call("general:setLaunchAtLogin", true)).error.code, "DEV_BUILD");

  await call("hotkeys:set", "message", "Control+J");
  assert.equal(changed, 1);
  assert.equal(gs.registered.size, 0, "still paused after choosing a new shortcut");
});
