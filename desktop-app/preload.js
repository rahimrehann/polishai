const { contextBridge, ipcRenderer } = require("electron");

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

// The only things the page is allowed to do.
contextBridge.exposeInMainWorld("polish", {
  auth: {
    login: call("auth:login"),
    signup: call("auth:signup"),
    confirm: call("auth:confirm"),
    resend: call("auth:resend"),
    forgot: call("auth:forgot"),
    resetPassword: call("auth:resetPassword"),
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
  prefs: { get: call("prefs:get") },
  hotkeys: {
    set: call("hotkeys:set"),
    reset: call("hotkeys:reset"),
    pause: call("hotkeys:pause"),
    resume: call("hotkeys:resume"),
  },
  account: { changePassword: call("account:changePassword"), delete: call("account:delete") },
  app: { info: call("app:info"), openDownload: call("app:openDownload") },
  general: {
    get: call("general:get"),
    setPaused: call("general:setPaused"),
    setLaunchAtLogin: call("general:setLaunchAtLogin"),
  },
  permissions: { status: call("permissions:status"), request: call("permissions:request") },
  history: { list: call("history:list"), remove: call("history:remove"), clear: call("history:clear") },
  clipboard: { write: call("clipboard:write") },
  onAuthExpired: (callback) => ipcRenderer.on("auth:expired", () => callback()),
  onStatsChanged: (callback) => ipcRenderer.on("stats:changed", () => callback()),
  onGeneralChanged: (callback) => ipcRenderer.on("general:changed", () => callback()),
});
