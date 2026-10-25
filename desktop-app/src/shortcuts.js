// Registers the Message and Email shortcuts with the operating system.
function createShortcuts({ globalShortcut, prefs, onTrigger }) {
  const status = { message: { ok: true }, email: { ok: true } };
  let paused = false;

  function apply() {
    globalShortcut.unregisterAll();
    if (paused) return status;
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
      paused = true;
      globalShortcut.unregisterAll();
    },
    resume() {
      paused = false;
      return apply();
    },
    stop: () => globalShortcut.unregisterAll(),
  };
}

module.exports = { createShortcuts };
