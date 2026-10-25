// Registers the Message and Email shortcuts with the operating system.
function createShortcuts({ globalShortcut, prefs, onTrigger }) {
  const status = { message: { ok: true }, email: { ok: true } };
  let recording = false; // the settings page is listening for a new shortcut
  let userPaused = false; // the user turned shortcuts off

  function apply() {
    globalShortcut.unregisterAll();
    if (recording || userPaused) return status;
    const { hotkeys } = prefs.get();
    for (const kind of Object.keys(status)) {
      let registered = false;
      try {
        registered = globalShortcut.register(hotkeys[kind], () => onTrigger(kind));
      } catch {
        registered = false;
      }
      status[kind] = registered
        ? { ok: true }
        : { ok: false, error: "Another app is already using this shortcut. Choose a different one." };
    }
    return status;
  }

  return {
    apply,
    status: () => ({ message: { ...status.message }, email: { ...status.email } }),
    // Pausing lets the settings page capture a key press without triggering a rewrite.
    pause() {
      recording = true;
      globalShortcut.unregisterAll();
    },
    resume() {
      recording = false;
      return apply();
    },
    // Turning shortcuts off keeps them off until the user turns them back on,
    // even while the settings page is recording a new one.
    setUserPaused(value) {
      userPaused = value === true;
      return apply();
    },
    isUserPaused: () => userPaused,
    stop: () => globalShortcut.unregisterAll(),
  };
}

module.exports = { createShortcuts };
