const { validate } = require("../hotkeys");

const KINDS = ["message", "email"];
const DEFAULTS = { hotkeys: { message: "Control+Q", email: "Control+Y" }, paused: false };

// Small settings file kept on this computer (not secrets).
function createPrefs({ fs, filePath }) {
  let data = load();

  function load() {
    const loaded = { hotkeys: { ...DEFAULTS.hotkeys }, paused: false };
    try {
      const saved = JSON.parse(fs.readFileSync(filePath, "utf8"));
      for (const kind of KINDS) {
        const accelerator = saved && saved.hotkeys && saved.hotkeys[kind];
        if (validate(accelerator).ok) loaded.hotkeys[kind] = accelerator;
      }
      // Two actions on one shortcut can't work: fall back to the defaults.
      if (loaded.hotkeys.message === loaded.hotkeys.email) loaded.hotkeys = { ...DEFAULTS.hotkeys };
      loaded.paused = saved.paused === true;
    } catch {
      // No file yet, or unreadable: use the defaults.
    }
    return loaded;
  }

  function save() {
    const temp = `${filePath}.tmp`;
    fs.writeFileSync(temp, JSON.stringify(data, null, 2));
    fs.renameSync(temp, filePath);
  }

  return {
    get: () => ({ hotkeys: { ...data.hotkeys }, paused: data.paused }),

    setPaused(paused) {
      data = { ...data, paused: paused === true };
      save();
      return data.paused;
    },

    setHotkey(kind, accelerator) {
      if (!KINDS.includes(kind)) return { ok: false, error: "Unknown shortcut." };
      const result = validate(accelerator);
      if (!result.ok) return result;
      const other = KINDS.find((k) => k !== kind);
      if (data.hotkeys[other] === accelerator) {
        return { ok: false, error: `That shortcut is already used for ${other === "email" ? "Email" : "Message"} rewrites. Choose a different one.` };
      }
      data = { ...data, hotkeys: { ...data.hotkeys, [kind]: accelerator } };
      save();
      return result;
    },

    resetHotkey(kind) {
      if (!KINDS.includes(kind)) return { ok: false, error: "Unknown shortcut." };
      const other = KINDS.find((k) => k !== kind);
      if (data.hotkeys[other] === DEFAULTS.hotkeys[kind]) {
        return { ok: false, error: `The default is in use for ${other === "email" ? "Email" : "Message"}. Change that one first.` };
      }
      data = { ...data, hotkeys: { ...data.hotkeys, [kind]: DEFAULTS.hotkeys[kind] } };
      save();
      return { ok: true, accelerator: DEFAULTS.hotkeys[kind] };
    },
  };
}

module.exports = { createPrefs, DEFAULTS, KINDS };
