const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("hud", {
  onUpdate: (callback) => ipcRenderer.on("hud:update", (_event, payload) => callback(payload)),
});
