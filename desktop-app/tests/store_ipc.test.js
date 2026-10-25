const test = require("node:test");
const assert = require("node:assert/strict");
const { createStore } = require("../src/store");
const { registerIpc } = require("../src/ipc");
const { AppError } = require("../src/errors");

function fakeFs() {
  const files = {};
  return {
    files,
    writeFileSync: (p, data, opts) => { files[p] = { data, opts }; },
    readFileSync: (p) => { if (!files[p]) throw new Error("ENOENT"); return files[p].data; },
    unlinkSync: (p) => { if (!files[p]) throw new Error("ENOENT"); delete files[p]; },
  };
}

const safeStorage = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from("enc:" + Buffer.from(s).toString("base64")),
  decryptString: (b) => {
    const text = b.toString();
    if (!text.startsWith("enc:")) throw new Error("bad");
    return Buffer.from(text.slice(4), "base64").toString();
  },
});

test("store saves encrypted, private to the user, and reads it back", () => {
  const fs = fakeFs();
  const store = createStore({ safeStorage: safeStorage(), fs, filePath: "/data/session.bin" });
  store.write({ refreshToken: "secret-token" });
  const saved = fs.files["/data/session.bin"];
  assert.equal(saved.data.toString().includes("secret-token"), false);
  assert.equal(saved.opts.mode, 0o600);
  assert.deepEqual(store.read(), { refreshToken: "secret-token" });
  store.clear();
  assert.equal(store.read(), null);
});

test("store saves nothing when encryption is unavailable", () => {
  const fs = fakeFs();
  createStore({ safeStorage: safeStorage(false), fs, filePath: "/x" }).write({ a: 1 });
  assert.deepEqual(fs.files, {});
});

test("store treats a corrupt file as no login, and clear never throws", () => {
  const fs = fakeFs();
  fs.files["/x"] = { data: Buffer.from("garbage") };
  const store = createStore({ safeStorage: safeStorage(), fs, filePath: "/x" });
  assert.equal(store.read(), null);
  store.clear();
  store.clear();
});

function ipcSetup(overrides = {}) {
  const handlers = {};
  const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn; } };
  const session = { login: async (e, p) => ({ email: e }), current: async () => null, logout: async () => {} };
  const cognito = { signUp: async () => ({}), confirmSignUp: async () => ({}), resendCode: async () => ({}) };
  const api = { stats: async () => ({ totals: {} }), recent: async (n) => ({ n }), settings: async () => ({}), saveKey: async () => ({}), deleteKey: async () => ({}) };
  registerIpc({ ipcMain, cognito: { ...cognito, ...overrides.cognito }, session: { ...session, ...overrides.session }, api: { ...api, ...overrides.api } });
  return (channel, ...args) => handlers[channel]({}, ...args);
}

test("ipc wraps success as { ok, data }", async () => {
  const call = ipcSetup();
  assert.deepEqual(await call("auth:login", "me@x.com", "pw"), { ok: true, data: { email: "me@x.com" } });
});

test("ipc passes known errors through with their message", async () => {
  const call = ipcSetup({ session: { login: async () => { throw new AppError("NotAuthorizedException", "Incorrect email or password."); } } });
  assert.deepEqual(await call("auth:login", "a", "b"), {
    ok: false,
    error: { code: "NotAuthorizedException", message: "Incorrect email or password." },
  });
});

test("ipc hides unexpected error details", async () => {
  const log = console.error;
  console.error = () => {};
  const call = ipcSetup({ api: { stats: async () => { throw new Error("secret internals"); } } });
  const result = await call("api:stats");
  console.error = log;
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "UNKNOWN");
  assert.equal(result.error.message.includes("secret"), false);
});

test("ipc rejects non-string or oversized input", async () => {
  const call = ipcSetup();
  assert.equal((await call("auth:login", { evil: true }, "pw")).error.code, "BAD_INPUT");
  assert.equal((await call("auth:login", "a".repeat(500), "pw")).error.code, "BAD_INPUT");
  assert.equal((await call("api:saveKey", 42)).error.code, "BAD_INPUT");
});

test("ipc clamps the recent limit", async () => {
  const call = ipcSetup();
  assert.equal((await call("api:recent", 9999)).data.n, 50);
  assert.equal((await call("api:recent", "abc")).data.n, 10);
  assert.equal((await call("api:recent", -5)).data.n, 1);
});
