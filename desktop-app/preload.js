const { contextBridge, ipcRenderer } = require("electron");

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

// The only things the page is allowed to do.
contextBridge.exposeInMainWorld("polish", {
  auth: {
    login: call("auth:login"),
    signup: call("auth:signup"),
    confirm: call("auth:confirm"),
    resend: call("auth:resend"),
    current: call("auth:current"),
    logout: call("auth:logout"),
  },
  api: {
    stats: call("api:stats"),
    recent: call("api:recent"),
    settings: call("api:settings"),
    saveKey: call("api:saveKey"),
    deleteKey: call("api:deleteKey"),
  },
  onAuthExpired: (callback) => ipcRenderer.on("auth:expired", () => callback()),
});
