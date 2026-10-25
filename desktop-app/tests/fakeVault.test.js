const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeSafeStorage } = require("../src/fakeEnv");
const { createStore } = require("../src/store");

test("the test-mode stand-in scrambles text and gives it back", () => {
  const vault = createFakeSafeStorage();
  const sealed = vault.encryptString("secret refresh token");
  assert.equal(sealed.toString().includes("secret refresh token"), false);
  assert.equal(vault.decryptString(sealed), "secret refresh token");
});

test("it refuses data it didn't make, like the real thing", () => {
  assert.throws(() => createFakeSafeStorage().decryptString(Buffer.from("plain text")));
});

test("it works with the saved-login store end to end", () => {
  const files = {};
  const fs = {
    writeFileSync: (p, d) => { files[p] = d; },
    readFileSync: (p) => { if (!files[p]) throw new Error("ENOENT"); return files[p]; },
    unlinkSync: (p) => { delete files[p]; },
  };
  const store = createStore({ safeStorage: createFakeSafeStorage(), fs, filePath: "/s.bin" });
  store.write({ refreshToken: "abc" });
  assert.equal(files["/s.bin"].toString().includes("abc"), false);
  assert.deepEqual(store.read(), { refreshToken: "abc" });
});
