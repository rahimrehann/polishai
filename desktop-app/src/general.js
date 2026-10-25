const { AppError } = require("./errors");

// The two switches in Settings > General and the menu-bar menu: shortcuts on/off
// and start at login. Both places call the same functions.
function createGeneral({ prefs, shortcuts, loginItem, onChange = () => {} }) {
  const get = () => ({
    paused: prefs.get().paused,
    launchAtLogin: { supported: loginItem.supported(), enabled: loginItem.get() },
  });

  return {
    get,

    setPaused(paused) {
      if (typeof paused !== "boolean") throw new AppError("BAD_INPUT", "Invalid input.");
      prefs.setPaused(paused);
      shortcuts.setUserPaused(paused);
      onChange();
      return get();
    },

    setLaunchAtLogin(enabled) {
      if (typeof enabled !== "boolean") throw new AppError("BAD_INPUT", "Invalid input.");
      loginItem.set(enabled);
      onChange();
      return get();
    },
  };
}

module.exports = { createGeneral };
