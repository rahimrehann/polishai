const { AppError } = require("./errors");

function registerIpc({ ipcMain, cognito, session, api }) {
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

  handle("api:stats", () => api.stats());
  handle("api:recent", (limit) => api.recent(Math.min(Math.max(Number(limit) || 10, 1), 50)));
  handle("api:settings", () => api.settings());
  handle("api:saveKey", (apiKey) => api.saveKey(text(apiKey)));
  handle("api:deleteKey", () => api.deleteKey());
}

module.exports = { registerIpc };
