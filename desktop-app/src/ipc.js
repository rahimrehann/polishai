const { AppError } = require("./errors");

const PROVIDERS = ["gemini", "openai", "anthropic"];

function registerIpc({ ipcMain, cognito, session, api, prefs, shortcuts, history, permissions, clipboard, platform, localDate, seedDemo }) {
  function handle(channel, fn) {
    ipcMain.handle(channel, async (_event, ...args) => {
      try {
        return { ok: true, data: await fn(...args) };
      } catch (e) {
        const known = e instanceof AppError;
        if (!known) console.error(`${channel} failed:`, e.message);
        return {
          ok: false,
          error: {
            code: known ? e.code : "UNKNOWN",
            message: known ? e.message : "Something went wrong. Please try again.",
          },
        };
      }
    });
  }

  const text = (value, max = 200) => {
    if (typeof value !== "string" || value.length > max) throw new AppError("BAD_INPUT", "Invalid input.");
    return value;
  };

  handle("auth:login", (email, password) => session.login(text(email), text(password)));
  handle("auth:signup", (name, email, password) => cognito.signUp(text(name), text(email), text(password)).then(() => ({})));
  handle("auth:confirm", (email, code) => cognito.confirmSignUp(text(email), text(code, 20)).then(() => ({})));
  handle("auth:resend", (email) => cognito.resendCode(text(email)).then(() => ({})));
  handle("auth:current", () => session.current());
  handle("auth:logout", () => session.logout());

  handle("prefs:get", () => ({ hotkeys: prefs.get().hotkeys, status: shortcuts.status(), platform }));

  // Setting a shortcut: save it, register it, and undo if another app owns it.
  function applyHotkey(kind, change) {
    const previous = prefs.get().hotkeys[kind];
    const result = change();
    if (!result.ok) {
      shortcuts.resume();
      throw new AppError("BAD_HOTKEY", result.error);
    }
    const status = shortcuts.resume();
    if (!status[kind].ok) {
      prefs.setHotkey(kind, previous);
      shortcuts.apply();
      throw new AppError("HOTKEY_TAKEN", status[kind].error);
    }
    return { hotkeys: prefs.get().hotkeys, warning: result.warning || null, status };
  }

  handle("hotkeys:set", (kind, accelerator) => applyHotkey(text(kind, 20), () => prefs.setHotkey(kind, text(accelerator, 40))));
  handle("hotkeys:reset", (kind) => applyHotkey(text(kind, 20), () => prefs.resetHotkey(kind)));
  handle("hotkeys:pause", () => { shortcuts.pause(); return {}; });
  handle("hotkeys:resume", () => ({ status: shortcuts.resume() }));

  handle("permissions:status", () => ({ accessibility: permissions.isTrusted() }));
  handle("permissions:request", () => { permissions.request(); return {}; });

  handle("history:list", (options = {}) => {
    const date = typeof options.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(options.date) ? options.date : undefined;
    const limit = Math.min(Math.max(Number(options.limit) || 100, 1), 500);
    if (seedDemo) seedDemo();
    return { entries: history.list({ limit, date, localDate }) };
  });
  handle("history:remove", (id) => ({ removed: history.remove(text(id, 80)) }));
  handle("history:clear", () => { history.clear(); return {}; });
  handle("clipboard:write", (value) => { clipboard.writeText(text(value, 20000)); return {}; });

  handle("api:stats", () => api.stats());
  handle("api:recent", (limit) => api.recent(Math.min(Math.max(Number(limit) || 10, 1), 50)));
  handle("api:settings", () => api.settings());
  handle("api:saveKey", (provider, apiKey) => {
    if (!PROVIDERS.includes(provider)) throw new AppError("BAD_INPUT", "Choose Gemini, OpenAI or Anthropic.");
    return api.saveKey(provider, text(apiKey, 300));
  });
  handle("api:deleteKey", () => api.deleteKey());
}

module.exports = { registerIpc };
