// Encrypts the saved login and History with a random key kept in the macOS Keychain.
// The key is read through Apple's own `security` tool, which the Keychain always trusts, so
// macOS never shows a password pop-up (even after an update changes the app's signature).
const crypto = require("crypto");

const SERVICE = "PolishAI Local Key";
const ACCOUNT = "polishai";

function createVault({ runSecurity }) {
  let key = null;

  function loadKey() {
    if (key) return key;
    const found = runSecurity(["find-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w"]);
    if (found.ok && /^[0-9a-f]{64}$/.test(found.out.trim())) {
      key = Buffer.from(found.out.trim(), "hex");
      return key;
    }
    const fresh = crypto.randomBytes(32);
    const saved = runSecurity(["add-generic-password", "-s", SERVICE, "-a", ACCOUNT, "-w", fresh.toString("hex"), "-U"]);
    if (!saved.ok) return null;
    key = fresh;
    return key;
  }

  return {
    isEncryptionAvailable: () => loadKey() !== null,
    encryptString(text) {
      const k = loadKey();
      if (!k) throw new Error("Encryption is not available.");
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", k, iv);
      const body = Buffer.concat([cipher.update(String(text), "utf8"), cipher.final()]);
      return Buffer.concat([Buffer.from("PV1"), iv, cipher.getAuthTag(), body]);
    },
    decryptString(buffer) {
      const data = Buffer.from(buffer);
      const k = loadKey();
      if (!k || data.length < 31 || data.subarray(0, 3).toString() !== "PV1") throw new Error("Cannot decrypt.");
      const decipher = crypto.createDecipheriv("aes-256-gcm", k, data.subarray(3, 15));
      decipher.setAuthTag(data.subarray(15, 31));
      return Buffer.concat([decipher.update(data.subarray(31)), decipher.final()]).toString("utf8");
    },
  };
}

// Runs /usr/bin/security without a shell. Never logs the key.
function realRunSecurity(execFileSync) {
  return (args) => {
    try {
      return { ok: true, out: execFileSync("/usr/bin/security", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) };
    } catch {
      return { ok: false, out: "" };
    }
  };
}

module.exports = { createVault, realRunSecurity };
