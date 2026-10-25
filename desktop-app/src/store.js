// Saves the login encrypted with the macOS Keychain (Electron safeStorage).
// If encryption isn't available, nothing is saved rather than saving plain text.
function createStore({ safeStorage, fs, filePath }) {
  return {
    write(data) {
      if (!safeStorage.isEncryptionAvailable()) return;
      fs.writeFileSync(filePath, safeStorage.encryptString(JSON.stringify(data)), { mode: 0o600 });
    },

    read() {
      try {
        return JSON.parse(safeStorage.decryptString(fs.readFileSync(filePath)));
      } catch {
        return null;
      }
    },

    clear() {
      try {
        fs.unlinkSync(filePath);
      } catch {
        // Nothing saved.
      }
    },
  };
}

module.exports = { createStore };
