const { AppError } = require("./errors");

// "Start PolishAI when I log in". Only the installed app can do this: in
// development the login item would launch a bare Electron, not PolishAI.
function createLoginItem({ app, platform, isPackaged }) {
  const supported = isPackaged && (platform === "darwin" || platform === "win32");

  return {
    supported: () => supported,

    get: () => (supported ? app.getLoginItemSettings().openAtLogin === true : false),

    set(enabled) {
      if (!supported) {
        throw new AppError("DEV_BUILD", "Starting at login works in the installed app, not in development builds.");
      }
      app.setLoginItemSettings({ openAtLogin: enabled === true });
      return app.getLoginItemSettings().openAtLogin === true;
    },

    // True when the system launched us at login, so we should stay in the menu bar.
    startedAtLogin() {
      if (!supported) return false;
      const settings = app.getLoginItemSettings();
      return settings.wasOpenedAtLogin === true || settings.wasOpenedAsHidden === true;
    },
  };
}

module.exports = { createLoginItem };
