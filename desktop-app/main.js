const { app, BrowserWindow, ipcMain, safeStorage } = require("electron");
const fs = require("fs");
const path = require("path");

const config = require("./src/config");
const { createCognito } = require("./src/cognito");
const { createSession } = require("./src/session");
const { createApi } = require("./src/api");
const { createStore } = require("./src/store");
const { registerIpc } = require("./src/ipc");

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
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
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    const cognito = createCognito({ fetch, url: config.COGNITO_URL, clientId: config.CLIENT_ID });
    const store = createStore({
      safeStorage,
      fs,
      filePath: path.join(app.getPath("userData"), "session.bin"),
    });
    const session = createSession({
      cognito,
      store,
      onExpired: () => {
        if (mainWindow) mainWindow.webContents.send("auth:expired");
      },
    });
    const api = createApi({ session, fetch, url: config.BACKEND_URL });

    registerIpc({ ipcMain, cognito, session, api });
    createWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
