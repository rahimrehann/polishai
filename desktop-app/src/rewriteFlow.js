const { AppError } = require("./errors");

const COPY_WAIT_MS = 700;
const COPY_POLL_MS = 25;
const MODIFIER_WAIT_MS = 1500;
const PASTE_SETTLE_MS = 450;

const FRIENDLY = {
  NOT_LOGGED_IN: "Log in to PolishAI first, then try again.",
  SESSION_EXPIRED: "Your session expired. Open PolishAI and log in again.",
  UNAUTHORIZED: "Your session expired. Open PolishAI and log in again.",
  NETWORK: "Can't reach PolishAI. Check your internet connection.",
};
// These come from the server already worded for the user.
const SERVER_WORDED = ["RATE_LIMITED", "SLOW_DOWN", "UPDATE_REQUIRED", "BUSY", "CUSTOM_KEY_INVALID", "CUSTOM_KEY_QUOTA", "TEXT_TOO_LONG", "EMPTY_TEXT"];

function messageFor(error) {
  if (FRIENDLY[error.code]) return FRIENDLY[error.code];
  if (SERVER_WORDED.includes(error.code) && error.message) return error.message;
  return "Rewrite failed. Try again in a moment.";
}

// One rewrite, start to finish: copy the selection, rewrite it, paste it back,
// and leave the clipboard the way we found it.
function createRewriteFlow({ keys, clipboard, api, history, permissions, hud, onFinished, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  let busy = false;

  async function readSelection() {
    await clipboard.clear();
    await keys.copy();
    for (let waited = 0; waited <= COPY_WAIT_MS; waited += COPY_POLL_MS) {
      const text = await clipboard.readText();
      if (text && text.trim()) return text;
      await sleep(COPY_POLL_MS);
    }
    return "";
  }

  async function run(format) {
    if (busy) return { status: "busy" };
    busy = true;
    let saved = null;
    try {
      if (!permissions.isTrusted()) {
        permissions.request();
        hud.show("error", "Allow PolishAI under Privacy & Security > Accessibility so it can rewrite text in other apps.");
        return { status: "no-permission" };
      }

      await keys.waitModifiersUp(MODIFIER_WAIT_MS);
      const app = await keys.frontApp();
      saved = await clipboard.snapshot();

      const text = await readSelection();
      if (!text) {
        await clipboard.restore(saved);
        saved = null;
        hud.show("error", "Select some text first, then press the shortcut.");
        return { status: "no-selection" };
      }

      hud.show("busy", "Polishing...");
      const reply = await api.rewrite({ text, format, source: "desktop", app });
      const result = reply.result;

      const stillThere = (await keys.frontApp()) === app;
      if (stillThere) {
        await clipboard.writeText(result);
        await keys.paste();
        await sleep(PASTE_SETTLE_MS);
        await clipboard.restore(saved);
        hud.show("ok", "Polished");
      } else {
        // You switched apps while it was working: don't paste into the wrong place.
        await clipboard.writeText(result);
        hud.show("ok", "Done. Switched apps, so the result is on your clipboard.");
      }
      saved = null;

      try {
        history.add({ format, app, input: text, output: result });
      } catch {
        // History is a convenience; the rewrite already worked.
      }
      return { status: "done", usedToday: reply.usedToday, dailyLimit: reply.dailyLimit };
    } catch (error) {
      if (saved) {
        try {
          await clipboard.restore(saved);
        } catch {
          // Nothing more we can do.
        }
      }
      const known = error instanceof AppError;
      if (!known) console.error("rewrite failed:", error.message);
      hud.show("error", known ? messageFor(error) : "Rewrite failed. Try again in a moment.");
      return { status: "error", code: known ? error.code : "UNKNOWN" };
    } finally {
      busy = false;
      if (onFinished) onFinished();
    }
  }

  return { run };
}

module.exports = { createRewriteFlow, messageFor };
