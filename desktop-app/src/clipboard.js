// Wraps the system clipboard so a rewrite can borrow it and give it back.
// Electron 44's clipboard is asynchronous and works with "clipboard items"
// (like the browser clipboard API): one item per kind of data (text, html, image...).
function createClipboard({ clipboard, ClipboardItem }) {
  // Keeps every kind of data currently on the clipboard, not just text.
  async function snapshot() {
    const kept = [];
    for (const item of await clipboard.read()) {
      const data = {};
      for (const type of item.types) {
        try {
          data[type] = await item.getType(type);
        } catch {
          // A kind we can't read can't be restored either.
        }
      }
      if (Object.keys(data).length > 0) kept.push(data);
    }
    return kept;
  }

  async function restore(kept) {
    await clipboard.clear();
    if (!kept || kept.length === 0) return;
    try {
      await clipboard.write(kept.map((data) => new ClipboardItem(data)));
    } catch {
      // Some system-only kinds can't be written back. Keep the common ones.
      const common = {};
      for (const data of kept) {
        for (const type of ["text/plain", "text/html", "image/png"]) {
          if (data[type] && !common[type]) common[type] = data[type];
        }
      }
      if (Object.keys(common).length > 0) await clipboard.write([new ClipboardItem(common)]);
    }
  }

  return {
    snapshot,
    restore,
    clear: async () => clipboard.clear(),
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text),
  };
}

module.exports = { createClipboard };
