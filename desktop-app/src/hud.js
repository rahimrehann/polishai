// Where the pill goes: top middle of the usable part of a screen, just under
// the menu bar (`area` is the display's workArea, which already leaves room for it).
function topCenter(area, width, height, margin = 14) {
  return {
    x: Math.round(area.x + (area.width - width) / 2),
    y: area.y + margin,
    width,
    height,
  };
}

// A small floating pill at the top middle of the screen you're using, saying
// what PolishAI is doing. It never takes focus, so the paste still lands in
// the app you were using.
function createHud({ BrowserWindow, screen, path, htmlPath, preloadPath }) {
  let win = null;
  let hideTimer = null;

  function ensureWindow() {
    if (win && !win.isDestroyed()) return win;
    win = new BrowserWindow({
      width: 320,
      height: 56,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      type: process.platform === "darwin" ? "panel" : undefined,
      webPreferences: { preload: preloadPath, contextIsolation: true, nodeIntegration: false, sandbox: true },
    });
    win.setAlwaysOnTop(true, "screen-saver");
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.on("will-navigate", (event) => event.preventDefault());
    win.loadFile(htmlPath);
    return win;
  }

  // The screen the mouse is on is the one you're working on.
  function place(window, width, height) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    window.setBounds(topCenter(display.workArea, width, height));
  }

  return {
    show(kind, text) {
      clearTimeout(hideTimer);
      const window = ensureWindow();
      const width = Math.min(380, Math.max(150, 70 + text.length * 6.5));
      const height = text.length > 48 ? 78 : 48;
      place(window, Math.round(width), height);

      const send = () => {
        window.webContents.send("hud:update", { kind, text });
        window.showInactive();
      };
      if (window.webContents.isLoading()) window.webContents.once("did-finish-load", send);
      else send();

      if (kind !== "busy") {
        hideTimer = setTimeout(() => this.hide(), kind === "error" ? 4500 : 1400);
      }
    },

    hide() {
      clearTimeout(hideTimer);
      if (win && !win.isDestroyed()) win.hide();
    },

    // For tests: where the pill is right now.
    bounds: () => (win && !win.isDestroyed() && win.isVisible() ? win.getBounds() : null),
  };
}

module.exports = { createHud, topCenter };
