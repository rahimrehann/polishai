const test = require("node:test");
const assert = require("node:assert");
const { createVault } = require("../src/vault");

function fakeKeychain() {
  const items = {};
  return (args) => {
    if (args[0] === "find-generic-password") return items.k ? { ok: true, out: items.k + "\n" } : { ok: false, out: "" };
    items.k = args[args.indexOf("-w") + 1];
    return { ok: true, out: "" };
  };
}

test("round trip, and a second vault reuses the saved key", () => {
  const run = fakeKeychain();
  const a = createVault({ runSecurity: run });
  const enc = a.encryptString("secret login");
  assert.ok(!enc.toString().includes("secret"));
  assert.strictEqual(createVault({ runSecurity: run }).decryptString(enc), "secret login");
});

test("tampered or foreign data fails to decrypt", () => {
  const v = createVault({ runSecurity: fakeKeychain() });
  const enc = v.encryptString("x");
  enc[enc.length - 1] ^= 1;
  assert.throws(() => v.decryptString(enc));
  assert.throws(() => v.decryptString(Buffer.from("old data from the previous storage")));
});

test("unavailable when the Keychain refuses", () => {
  const v = createVault({ runSecurity: () => ({ ok: false, out: "" }) });
  assert.strictEqual(v.isEncryptionAvailable(), false);
  assert.throws(() => v.encryptString("x"));
});
