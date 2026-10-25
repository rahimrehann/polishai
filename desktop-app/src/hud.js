// A small floating pill near the cursor that says what PolishAI is doing.
// It never takes focus, so the paste still lands in the app you were using.
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

  function place(window, width, height) {
    const point = screen.getCursorScreenPoint();
    const area = screen.getDisplayNearestPoint(point).workArea;
    const x = Math.min(Math.max(point.x + 14, area.x + 8), area.x + area.width - width - 8);
    const y = Math.min(Math.max(point.y + 22, area.y + 8), area.y + area.height - height - 8);
    window.setBounds({ x, y, width, height });
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
  };
}

module.exports = { createHud };
