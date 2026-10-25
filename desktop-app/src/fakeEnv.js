// Development and test only: pretend clipboard and keys, so the whole rewrite
// flow can run without pressing real keys in the user's apps.
function createFakeEnv() {
  const board = { text: "", html: "", rtf: "", image: null };
  const state = { selection: "", frontApp: "Notes", pasted: [], trusted: true };

  const clipboard = {
    snapshot: async () => ({ ...board }),
    restore: async (snap) => { Object.assign(board, { text: "", html: "", rtf: "", image: null }, snap); },
    clear: async () => { Object.assign(board, { text: "", html: "", rtf: "", image: null }); },
    readText: async () => board.text,
    writeText: async (text) => { Object.assign(board, { text, html: "", rtf: "", image: null }); },
  };
  const keys = {
    waitModifiersUp: async () => true,
    frontApp: async () => state.frontApp,
    copy: async () => { board.text = state.selection; },
    paste: async () => { state.pasted.push(board.text); },
  };
  const permissions = { isTrusted: () => state.trusted, request: () => {} };

  return { board, state, clipboard, keys, permissions };
}

// Test runs must never open the macOS Keychain: after an Electron update macOS asks the person
// at the keyboard for their password, and an automated test waits on that prompt forever.
// This stand-in scrambles the text so it is not readable on disk, but it is NOT secure.
function createFakeSafeStorage() {
  const mark = "fake-safe-storage:";
  return {
    isEncryptionAvailable: () => true,
    encryptString: (text) => Buffer.from(mark + Buffer.from(String(text)).toString("base64"), "utf8"),
    decryptString: (buffer) => {
      const text = Buffer.from(buffer).toString("utf8");
      if (!text.startsWith(mark)) throw new Error("not encrypted by this storage");
      return Buffer.from(text.slice(mark.length), "base64").toString("utf8");
    },
  };
}

module.exports = { createFakeEnv, createFakeSafeStorage };
