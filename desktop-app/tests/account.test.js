const test = require("node:test");
const assert = require("node:assert/strict");
const { createAccount } = require("../src/account");
const { createCognito } = require("../src/cognito");
const { createApi } = require("../src/api");
const { registerIpc } = require("../src/ipc");
const { AppError } = require("../src/errors");
const { jsonResponse, fakeFetch } = require("./helpers");

// ----- Cognito: forgot password, change password, delete -----

const makeCognito = (fetch) => createCognito({ fetch, url: "https://cognito.test/", clientId: "client-1" });
const target = (call) => call.options.headers["X-Amz-Target"].split(".")[1];

test("forgot password sends the email, and the reset sends code plus new password", async () => {
  const fetch = fakeFetch(jsonResponse(200, {}));
  const cognito = makeCognito(fetch);
  await cognito.forgotPassword("me@x.com");
  await cognito.confirmForgotPassword("me@x.com", "123456", "New-Pass1!");
  assert.deepEqual(fetch.calls.map(target), ["ForgotPassword", "ConfirmForgotPassword"]);
  assert.deepEqual(fetch.calls[0].body, { ClientId: "client-1", Username: "me@x.com" });
  assert.deepEqual(fetch.calls[1].body, { ClientId: "client-1", Username: "me@x.com", ConfirmationCode: "123456", Password: "New-Pass1!" });
});

test("a wrong or expired reset code gets a plain explanation", async () => {
  for (const [type, fragment] of [["CodeMismatchException", "isn't right"], ["ExpiredCodeException", "expired"]]) {
    const cognito = makeCognito(fakeFetch(jsonResponse(400, { __type: type })));
    await assert.rejects(cognito.confirmForgotPassword("a", "1", "p"), (e) => e.code === type && e.message.includes(fragment));
  }
});

test("a weak new password keeps Cognito's explanation of the rules", async () => {
  const cognito = makeCognito(fakeFetch(jsonResponse(400, { __type: "InvalidPasswordException", message: "Password must have symbol characters" })));
  await assert.rejects(cognito.confirmForgotPassword("a", "1", "weak"), (e) => e.message === "Password must have symbol characters");
});

test("forgot password for an unconfirmed account explains what to do instead", async () => {
  const cognito = makeCognito(fakeFetch(jsonResponse(400, { __type: "InvalidParameterException", message: "Cannot reset password for the user as there is no registered/verified email" })));
  await assert.rejects(cognito.forgotPassword("a@x.com"), (e) => e.message.includes("isn't confirmed yet") && !e.message.includes("registered/verified"));
});

test("too many reset attempts says to wait", async () => {
  const cognito = makeCognito(fakeFetch(jsonResponse(400, { __type: "LimitExceededException" })));
  await assert.rejects(cognito.forgotPassword("a@x.com"), (e) => e.message.includes("Too many attempts"));
});

test("changing the password: a wrong current password is called that, not 'incorrect email or password'", async () => {
  const cognito = makeCognito(fakeFetch(jsonResponse(400, { __type: "NotAuthorizedException" })));
  await assert.rejects(cognito.changePassword("token", "old", "New-Pass1!"), (e) => e.code === "WRONG_PASSWORD" && e.message === "Your current password isn't right.");
});

test("changing the password sends the token and both passwords", async () => {
  const fetch = fakeFetch(jsonResponse(200, {}));
  await makeCognito(fetch).changePassword("tok", "old", "new");
  assert.equal(target(fetch.calls[0]), "ChangePassword");
  assert.deepEqual(fetch.calls[0].body, { AccessToken: "tok", PreviousPassword: "old", ProposedPassword: "new" });
});

test("deleting the login account sends the access token", async () => {
  const fetch = fakeFetch(jsonResponse(200, {}));
  await makeCognito(fetch).deleteUser("tok");
  assert.equal(target(fetch.calls[0]), "DeleteUser");
  assert.deepEqual(fetch.calls[0].body, { AccessToken: "tok" });
});

// ----- api: version and delete -----

test("every request says which version of the app sent it", async () => {
  const fetch = fakeFetch(jsonResponse(200, {}));
  const api = createApi({ session: { getAccessToken: async () => "t", forceRefresh: async () => {} }, fetch, url: "https://b.test/", timezone: "UTC", appVersion: "0.1.0" });
  await api.stats();
  await api.deleteMyData();
  assert.equal(fetch.calls[0].body.appVersion, "0.1.0");
  assert.deepEqual(fetch.calls[1].body, { tz: "UTC", appVersion: "0.1.0", action: "delete_my_data" });
});

// ----- account -----

function accountSetup({ email = "me@x.com", deleteUserError = null, dataError = null } = {}) {
  const log = [];
  const account = createAccount({
    api: { deleteMyData: async () => { log.push("server data deleted"); if (dataError) throw dataError; } },
    cognito: {
      deleteUser: async (token) => { log.push(`account deleted with ${token}`); if (deleteUserError) throw deleteUserError; },
      changePassword: async (token, o, n) => { log.push(`password changed ${token}/${o}/${n}`); },
    },
    session: {
      profile: () => (email ? { email, name: "Me" } : null),
      getAccessToken: async () => "tok",
      logout: async () => { log.push("logged out"); },
    },
    history: { clear: () => log.push("history cleared") },
  });
  return { account, log };
}

test("deleting an account removes the server data, the account and the local history, then logs out - in that order", async () => {
  const { account, log } = accountSetup();
  await account.deleteAccount("me@x.com");
  assert.deepEqual(log, ["server data deleted", "account deleted with tok", "history cleared", "logged out"]);
});

test("the typed email must match, ignoring case and spaces", async () => {
  const { account, log } = accountSetup();
  await account.deleteAccount("  ME@X.com ");
  assert.equal(log.length, 4);
  for (const wrong of ["", "other@x.com", "me", undefined, null, 42]) {
    const s = accountSetup();
    await assert.rejects(s.account.deleteAccount(wrong), (e) => e.code === "EMAIL_MISMATCH", String(wrong));
    assert.deepEqual(s.log, [], "nothing is deleted on a mismatch");
  }
});

test("nobody logged in can't delete anything", async () => {
  const { account, log } = accountSetup({ email: null });
  await assert.rejects(account.deleteAccount("me@x.com"), (e) => e.code === "NOT_LOGGED_IN");
  assert.deepEqual(log, []);
});

test("if clearing the server data fails, nothing else is touched", async () => {
  const { account, log } = accountSetup({ dataError: new AppError("NETWORK", "offline") });
  await assert.rejects(account.deleteAccount("me@x.com"), (e) => e.code === "NETWORK");
  assert.deepEqual(log, ["server data deleted"]);
});

test("if closing the account fails after the data is gone, the user is told exactly that, and keeps their session and history", async () => {
  const { account, log } = accountSetup({ deleteUserError: new AppError("NETWORK", "Can't reach PolishAI.") });
  await assert.rejects(account.deleteAccount("me@x.com"), (e) => e.message.startsWith("Your data was deleted, but closing the account didn't finish") && e.message.includes("Try again"));
  assert.ok(!log.includes("logged out") && !log.includes("history cleared"));
});

test("changing a password uses a fresh access token", async () => {
  const { account, log } = accountSetup();
  await account.changePassword("old", "new");
  assert.deepEqual(log, ["password changed tok/old/new"]);
});

// ----- ipc -----

function ipcFor(overrides = {}) {
  const handlers = {};
  const calls = [];
  const stub = (name, value) => async (...args) => { calls.push([name, ...args]); return value; };
  registerIpc({
    ipcMain: { handle: (c, fn) => { handlers[c] = fn; } },
    cognito: { forgotPassword: stub("forgot", {}), confirmForgotPassword: stub("reset", {}) },
    session: {}, api: {}, prefs: {}, shortcuts: {}, history: {}, permissions: {}, clipboard: {}, general: {},
    account: { changePassword: stub("change", undefined), deleteAccount: stub("delete", undefined) },
    appInfo: { version: "0.1.0" },
    openDownload: () => calls.push(["open-download"]),
    platform: "darwin",
    localDate: () => "",
    ...overrides,
  });
  return { call: (c, ...a) => handlers[c]({}, ...a), calls };
}

test("ipc passes the new account requests through and rejects odd input", async () => {
  const { call, calls } = ipcFor();
  assert.equal((await call("auth:forgot", "me@x.com")).ok, true);
  assert.equal((await call("auth:resetPassword", "me@x.com", "123456", "New-Pass1!")).ok, true);
  assert.equal((await call("account:changePassword", "old", "new")).ok, true);
  assert.equal((await call("account:delete", "me@x.com")).ok, true);
  assert.deepEqual(calls.map((c) => c[0]), ["forgot", "reset", "change", "delete"]);
  assert.equal((await call("auth:forgot", { evil: 1 })).error.code, "BAD_INPUT");
  assert.equal((await call("auth:resetPassword", "a", "x".repeat(50), "p")).error.code, "BAD_INPUT");
  assert.equal((await call("account:delete", 42)).error.code, "BAD_INPUT");
});

test("ipc reports the app version, and opens only the fixed download page", async () => {
  const { call, calls } = ipcFor();
  assert.deepEqual((await call("app:info")).data, { version: "0.1.0", platform: "darwin" });
  assert.equal((await call("app:openDownload", "https://evil.example")).ok, true);
  assert.deepEqual(calls, [["open-download"]]);
});
