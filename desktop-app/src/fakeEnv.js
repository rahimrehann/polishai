// Development and test only: pretend clipboard and keys, so the whole rewrite
// flow can run without pressing real keys in the user's apps.
function createFakeEnv() {
  const board = { text: "", html: "", rtf: "", image: null };
  const state = { selection: "", frontApp: "Notes", pasted: [], trusted: true };

  const clipboard = {
    snapshot: () => ({ ...board }),
    restore: (snap) => Object.assign(board, { text: "", html: "", rtf: "", image: null }, snap),
    clear: () => Object.assign(board, { text: "", html: "", rtf: "", image: null }),
    readText: () => board.text,
    writeText: (text) => Object.assign(board, { text, html: "", rtf: "", image: null }),
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

module.exports = { createFakeEnv };
