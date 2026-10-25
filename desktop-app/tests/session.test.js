const test = require("node:test");
const assert = require("node:assert/strict");
const { createSession } = require("../src/session");
const { AppError } = require("../src/errors");
const { fakeIdToken, memoryStore } = require("./helpers");

const auth = (extra = {}) => ({
  AccessToken: "access-1",
  IdToken: fakeIdToken({ email: "me@x.com", name: "Me" }),
  RefreshToken: "refresh-1",
  ExpiresIn: 3600,
  ...extra,
});

function setup({ cognito = {}, stored = null, clock = { t: 1_000_000 } } = {}) {
  const store = memoryStore(stored);
  const calls = { login: 0, refresh: 0, revoke: [], expired: 0 };
  const fake = {
    login: async () => { calls.login++; return auth(); },
    refresh: async () => { calls.refresh++; return auth({ AccessToken: "access-2", RefreshToken: undefined }); },
    revoke: async (t) => { calls.revoke.push(t); },
    ...cognito,
  };
  const session = createSession({ cognito: fake, store, now: () => clock.t, onExpired: () => calls.expired++ });
  return { session, store, calls, clock };
}

test("login returns the profile and saves only the refresh token, email and name", async () => {
  const { session, store } = setup();
  assert.deepEqual(await session.login("me@x.com", "pw"), { email: "me@x.com", name: "Me" });
  assert.deepEqual(store.data, { refreshToken: "refresh-1", email: "me@x.com", name: "Me" });
  assert.equal(JSON.stringify(store.data).includes("access-1"), false);
});

test("access token is reused until 5 minutes before it expires, then refreshed", async () => {
  const { session, calls, clock } = setup();
  await session.login("me@x.com", "pw");
  assert.equal(await session.getAccessToken(), "access-1");
  assert.equal(calls.refresh, 0);

  clock.t += 56 * 60 * 1000;
  assert.equal(await session.getAccessToken(), "access-2");
  assert.equal(calls.refresh, 1);
});

test("parallel requests share one refresh", async () => {
  const { session, calls, clock } = setup();
  await session.login("me@x.com", "pw");
  clock.t += 60 * 60 * 1000;
  const tokens = await Promise.all([session.getAccessToken(), session.getAccessToken(), session.forceRefresh()]);
  assert.deepEqual(tokens, ["access-2", "access-2", "access-2"]);
  assert.equal(calls.refresh, 1);
});

test("refresh keeps the original refresh token when Cognito sends none", async () => {
  const { session, store, clock } = setup();
  await session.login("me@x.com", "pw");
  clock.t += 60 * 60 * 1000;
  await session.getAccessToken();
  assert.equal(store.data.refreshToken, "refresh-1");
});

test("a rejected refresh logs the user out and notifies the window", async () => {
  const cognito = { refresh: async () => { throw new AppError("NotAuthorizedException", "x"); } };
  const { session, store, calls, clock } = setup({ cognito });
  await session.login("me@x.com", "pw");
  clock.t += 60 * 60 * 1000;
  await assert.rejects(session.getAccessToken(), (e) => e.code === "SESSION_EXPIRED");
  assert.equal(store.data, null);
  assert.equal(calls.expired, 1);
  await assert.rejects(session.getAccessToken(), (e) => e.code === "NOT_LOGGED_IN");
});

test("a network failure during refresh keeps the login", async () => {
  const cognito = { refresh: async () => { throw new AppError("NETWORK", "offline"); } };
  const { session, store, calls, clock } = setup({ cognito });
  await session.login("me@x.com", "pw");
  clock.t += 60 * 60 * 1000;
  await assert.rejects(session.getAccessToken(), (e) => e.code === "NETWORK");
  assert.notEqual(store.data, null);
  assert.equal(calls.expired, 0);
});

test("current() restores a saved login silently", async () => {
  const stored = { refreshToken: "saved-refresh", email: "me@x.com", name: "Me" };
  const { session, calls } = setup({ stored });
  assert.deepEqual(await session.current(), { email: "me@x.com", name: "Me" });
  assert.equal(calls.refresh, 1);
  assert.equal(await session.getAccessToken(), "access-2");
});

test("current() with nothing saved returns null", async () => {
  const { session } = setup();
  assert.equal(await session.current(), null);
});

test("current() with an expired saved login returns null without a popup", async () => {
  const stored = { refreshToken: "old", email: "me@x.com", name: "Me" };
  const cognito = { refresh: async () => { throw new AppError("NotAuthorizedException", "x"); } };
  const { session, store, calls } = setup({ stored, cognito });
  assert.equal(await session.current(), null);
  assert.equal(store.data, null);
  assert.equal(calls.expired, 0);
});

test("current() while offline keeps the user logged in", async () => {
  const stored = { refreshToken: "saved", email: "me@x.com", name: "Me" };
  const cognito = { refresh: async () => { throw new AppError("NETWORK", "offline"); } };
  const { session } = setup({ stored, cognito });
  assert.deepEqual(await session.current(), { email: "me@x.com", name: "Me" });
});

test("logout clears everything and revokes the refresh token", async () => {
  const { session, store, calls } = setup();
  await session.login("me@x.com", "pw");
  await session.logout();
  assert.equal(store.data, null);
  assert.deepEqual(calls.revoke, ["refresh-1"]);
  assert.equal(await session.current(), null);
});

test("logout still works if revoking fails", async () => {
  const { session, store } = setup({ cognito: { revoke: async () => { throw new Error("down"); } } });
  await session.login("me@x.com", "pw");
  await session.logout();
  assert.equal(store.data, null);
});

test("saving the login failing does not break login", async () => {
  const { session, store } = setup();
  store.write = () => { throw new Error("disk full"); };
  assert.deepEqual(await session.login("me@x.com", "pw"), { email: "me@x.com", name: "Me" });
});
