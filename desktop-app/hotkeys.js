// Shortcut rules shared by the settings page and the main process.
// A shortcut is exactly one modifier plus one key, written the way Electron
// expects: "Control+Q", "Command+Shift" is not allowed.
(function (root) {
  const MODIFIERS = ["Control", "Alt", "Command", "Shift"];
  const MAC_SYMBOLS = { Control: "⌃", Alt: "⌥", Command: "⌘", Shift: "⇧" };
  const PLAIN_NAMES = { Control: "Ctrl", Alt: "Alt", Command: "Cmd", Shift: "Shift" };

  const KEY_HELP = "Use one modifier key (Control, Option, Command or Shift) plus one other key.";

  const isLetter = (key) => /^[A-Z]$/.test(key);
  const isDigit = (key) => /^[0-9]$/.test(key);
  const isFunctionKey = (key) => /^F([1-9]|1[0-2])$/.test(key);
  const isSupportedKey = (key) => isLetter(key) || isDigit(key) || isFunctionKey(key) || key === "Space";

  // Combos that would break the computer for everyone, so PolishAI refuses them.
  const BLOCKED = {
    "Command+C": "Command+C is Copy. PolishAI uses it to read your selection.",
    "Command+V": "Command+V is Paste. PolishAI uses it to put the rewrite back.",
    "Command+X": "Command+X is Cut.",
    "Command+A": "Command+A is Select All.",
    "Command+Z": "Command+Z is Undo.",
    "Command+Q": "Command+Q quits apps.",
    "Command+W": "Command+W closes windows.",
    "Command+H": "Command+H hides apps.",
    "Command+M": "Command+M minimizes windows.",
    "Command+Space": "Command+Space opens Spotlight.",
  };

  // Allowed, but other apps use them, so say so.
  const COMMON_COMMAND_LETTERS = "BFGIJKLNOPRSTUY".split("");
  const EMACS_CONTROL_LETTERS = "ABDEFHKNOPT".split("");

  function parse(accelerator) {
    if (typeof accelerator !== "string") return null;
    const parts = accelerator.split("+");
    if (parts.length !== 2) return null;
    const [modifier, key] = parts;
    if (!MODIFIERS.includes(modifier) || !isSupportedKey(key)) return null;
    return { modifier, key };
  }

  function validate(accelerator) {
    const parsed = parse(accelerator);
    if (!parsed) return { ok: false, error: KEY_HELP };
    const { modifier, key } = parsed;
    const label = `${PLAIN_NAMES[modifier] === "Alt" ? "Option" : modifier}+${key}`;

    if (BLOCKED[accelerator]) return { ok: false, error: `${BLOCKED[accelerator]} Choose another shortcut.` };
    if (modifier === "Shift" && !isFunctionKey(key)) {
      return { ok: false, error: "Shift plus a letter is how you type capitals. Choose another shortcut." };
    }

    let warning = null;
    if (modifier === "Alt" && !isFunctionKey(key)) {
      warning = `${label} types special characters in many apps. PolishAI will take it over while it's running.`;
    } else if (modifier === "Command" && COMMON_COMMAND_LETTERS.includes(key)) {
      warning = `${label} is used by many apps. PolishAI will take it over while it's running.`;
    } else if (modifier === "Control" && EMACS_CONTROL_LETTERS.includes(key)) {
      warning = `${label} moves the cursor in some text fields. PolishAI will take it over while it's running.`;
    } else if (modifier === "Control" && key === "Space") {
      warning = "Control+Space switches your keyboard language if you use more than one.";
    }
    return { ok: true, accelerator, warning };
  }

  // Turns a keydown event into an accelerator. `pending` means only modifiers
  // are down so far, so keep listening.
  function fromEvent(event) {
    const code = event.code || "";
    if (/^(Control|Alt|Meta|Shift|OS)(Left|Right)?$/.test(code)) return { pending: true };

    let key = null;
    if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
    else if (/^Digit[0-9]$/.test(code)) key = code.slice(5);
    else if (/^F([1-9]|1[0-2])$/.test(code)) key = code;
    else if (code === "Space") key = "Space";

    const held = [];
    if (event.ctrlKey) held.push("Control");
    if (event.altKey) held.push("Alt");
    if (event.metaKey) held.push("Command");
    if (event.shiftKey) held.push("Shift");

    if (held.length !== 1) return { error: KEY_HELP };
    if (!key) return { error: "That key can't be used. Pick a letter, number, F key or Space." };
    return { accelerator: `${held[0]}+${key}` };
  }

  // ["⌃", "Q"] on a Mac, ["Ctrl", "Q"] elsewhere.
  function display(accelerator, platform) {
    const parsed = parse(accelerator);
    if (!parsed) return [];
    const modifier = platform === "darwin" ? MAC_SYMBOLS[parsed.modifier] : PLAIN_NAMES[parsed.modifier];
    return [modifier, parsed.key];
  }

  const api = { MODIFIERS, KEY_HELP, parse, validate, fromEvent, display };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PolishHotkeys = api;
})(typeof window !== "undefined" ? window : globalThis);
