const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, safeStorage, globalShortcut, screen, clipboard: electronClipboard, ClipboardItem, systemPreferences, shell } = require("electron");
const crypto = require("crypto");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");

const config = require("./src/config");
const { createCognito } = require("./src/cognito");
const { createSession } = require("./src/session");
const { createApi } = require("./src/api");
const { createStore } = require("./src/store");
const { createPrefs } = require("./src/prefs");
const { createShortcuts } = require("./src/shortcuts");
const { createHistory } = require("./src/history");
const { createKeys } = require("./src/keys");
const { createClipboard } = require("./src/clipboard");
const { createRewriteFlow } = require("./src/rewriteFlow");
const { createHud } = require("./src/hud");
const { registerIpc } = require("./src/ipc");
const { createDemoSeeder } = require("./src/demoHistory");
const { createFakeEnv } = require("./src/fakeEnv");
const { createLoginItem } = require("./src/loginItem");
const { createGeneral } = require("./src/general");
const { createTray } = require("./src/tray");
const { toDateString } = require("./stats");

// Development-only switches. They do nothing in a packaged app.
const DEV = !app.isPackaged;
const FAKE_KEYS = DEV && process.env.POLISHAI_FAKE_KEYS === "1";
const DEMO = DEV && process.env.POLISHAI_DEMO === "1";

let mainWindow = null;

function createWindow({ show = true } = {}) {
  mainWindow = new BrowserWindow({
    show: false,
    width: 1100,
    height: 760,
    minWidth: 860,
    minHeight: 620,
    backgroundColor: "#f6f7f3",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // The page never needs to open other windows or go to other sites.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  mainWindow.webContents.on("will-navigate", (event) => event.preventDefault());

  mainWindow.loadFile("index.html");
  if (show) mainWindow.once("ready-to-show", () => mainWindow && mainWindow.show());
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// Bring the window back (from the menu bar or the Dock), making one if it was closed.
function openWindow() {
  if (!mainWindow) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function sendToWindow(channel) {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => openWindow());

  app.whenReady().then(() => {
    const userData = app.getPath("userData");

    const cognito = createCognito({ fetch, url: config.COGNITO_URL, clientId: config.CLIENT_ID });
    const store = createStore({ safeStorage, fs, filePath: path.join(userData, "session.bin") });
    const session = createSession({ cognito, store, onExpired: () => sendToWindow("auth:expired") });
    const api = createApi({ session, fetch, url: config.BACKEND_URL });

    const prefs = createPrefs({ fs, filePath: path.join(userData, "prefs.json") });
    const history = createHistory({
      getEmail: () => (session.profile() || {}).email,
      openStore: (email) => {
        const id = crypto.createHash("sha256").update(email.toLowerCase()).digest("hex").slice(0, 16);
        return createStore({ safeStorage, fs, filePath: path.join(userData, `history-${id}.bin`) });
      },
    });

    // Real keys and clipboard, or pretend ones for tests.
    const fake = FAKE_KEYS ? createFakeEnv() : null;
    const helperPath = app.isPackaged
      ? path.join(process.resourcesPath, "native", "polish-keys")
      : path.join(__dirname, "native", "polish-keys");
    const keys = fake ? fake.keys : createKeys({ execFile, helperPath });
    const realClipboard = createClipboard({ clipboard: electronClipboard, ClipboardItem });
    const clipboard = fake ? fake.clipboard : realClipboard;
    const permissions = fake
      ? fake.permissions
      : {
          isTrusted: () => process.platform !== "darwin" || systemPreferences.isTrustedAccessibilityClient(false),
          request: () => {
            systemPreferences.isTrustedAccessibilityClient(true);
            shell.openExternal("x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility");
          },
        };

    const hud = createHud({
      BrowserWindow,
      screen,
      path,
      htmlPath: path.join(__dirname, "hud.html"),
      preloadPath: path.join(__dirname, "hud-preload.js"),
    });

    const flow = createRewriteFlow({
      keys,
      clipboard,
      history,
      permissions,
      hud,
      api: {
        rewrite: async (payload) => {
          if (!session.profile()) {
            const { AppError } = require("./src/errors");
            throw new AppError("NOT_LOGGED_IN", "Please log in.");
          }
          return api.rewrite(payload);
        },
      },
      onFinished: () => sendToWindow("stats:changed"),
    });

    const shortcuts = createShortcuts({ globalShortcut, prefs, onTrigger: (kind) => flow.run(kind) });
    shortcuts.setUserPaused(prefs.get().paused);

    const loginItem = createLoginItem({ app, platform: process.platform, isPackaged: app.isPackaged });

    const tray = createTray({
      Tray,
      Menu,
      nativeImage,
      platform: process.platform,
      iconPath: path.join(__dirname, "assets", "trayTemplate.png"),
      getState: () => ({
        hotkeys: prefs.get().hotkeys,
        paused: prefs.get().paused,
        launchSupported: loginItem.supported(),
        launchAtLogin: loginItem.get(),
      }),
      actions: {
        open: openWindow,
        setPaused: (paused) => general.setPaused(paused),
        setLaunchAtLogin: (enabled) => {
          try {
            general.setLaunchAtLogin(enabled);
          } catch {
            tray.refresh();
          }
        },
        quit: () => app.quit(),
      },
    });

    // The menu and the settings page change the same switches, so tell both.
    const settingsChanged = () => {
      tray.refresh();
      sendToWindow("general:changed");
    };
    const general = createGeneral({ prefs, shortcuts, loginItem, onChange: settingsChanged });

    registerIpc({
      ipcMain,
      cognito,
      session,
      api,
      prefs,
      shortcuts,
      history,
      permissions,
      clipboard,
      general,
      onSettingsChanged: settingsChanged,
      platform: process.platform,
      localDate: (iso) => toDateString(new Date(iso)),
      seedDemo: DEMO ? createDemoSeeder({ history, getEmail: () => (session.profile() || {}).email }) : null,
    });

    // Test seam: lets the end-to-end test drive the real flow with pretend keys.
    if (FAKE_KEYS) global.__polish = { fake, realClipboard, run: (kind) => flow.run(kind), tray, general, loginItem, hud, screen };

    shortcuts.apply();
    tray.create();

    // Started by the system at login: stay in the menu bar until asked.
    if (!loginItem.startedAtLogin()) createWindow();

    app.on("activate", () => openWindow());
  });

  app.on("will-quit", () => globalShortcut.unregisterAll());

  app.on("window-all-closed", () => {
    // Stay running on a Mac so the shortcuts keep working after the window is closed.
    if (process.platform !== "darwin") app.quit();
  });
}
