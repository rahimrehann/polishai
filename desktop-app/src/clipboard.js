// Wraps the system clipboard so a rewrite can borrow it and give it back.
function createClipboard({ clipboard }) {
  return {
    snapshot() {
      const image = clipboard.readImage();
      return {
        text: clipboard.readText(),
        html: clipboard.readHTML(),
        rtf: clipboard.readRTF(),
        image: image.isEmpty() ? null : image,
      };
    },

    restore(snapshot) {
      const parts = {};
      if (snapshot.text) parts.text = snapshot.text;
      if (snapshot.html) parts.html = snapshot.html;
      if (snapshot.rtf) parts.rtf = snapshot.rtf;
      if (snapshot.image) parts.image = snapshot.image;
      if (Object.keys(parts).length === 0) clipboard.clear();
      else clipboard.write(parts);
    },

    clear: () => clipboard.clear(),
    readText: () => clipboard.readText(),
    writeText: (text) => clipboard.writeText(text),
  };
}

module.exports = { createClipboard };
