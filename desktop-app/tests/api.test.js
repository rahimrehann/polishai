const test = require("node:test");
const assert = require("node:assert/strict");
const { createApi } = require("../src/api");
const { AppError } = require("../src/errors");
const { jsonResponse, fakeFetch } = require("./helpers");

function make(fetch, session = {}) {
  const fullSession = {
    getAccessToken: async () => "token-1",
    forceRefresh: async () => "token-2",
    ...session,
  };
  return createApi({ session: fullSession, fetch, url: "https://backend.test/", timezone: "America/Toronto" });
}

test("sends the bearer token, action and time zone", async () => {
  const fetch = fakeFetch(jsonResponse(200, { totals: {} }));
  await make(fetch).stats();
  const call = fetch.calls[0];
  assert.equal(call.options.headers.Authorization, "Bearer token-1");
  assert.deepEqual(call.body, { tz: "America/Toronto", action: "get_stats" });
});

test("recent passes the limit, saveKey passes the provider and key", async () => {
  const fetch = fakeFetch(jsonResponse(200, {}));
  const api = make(fetch);
  await api.recent(5);
  await api.saveKey("openai", "sk-test");
  assert.deepEqual(fetch.calls[0].body, { tz: "America/Toronto", action: "get_recent", limit: 5 });
  assert.deepEqual(fetch.calls[1].body, { tz: "America/Toronto", action: "save_api_key", provider: "openai", apiKey: "sk-test" });
});

test("a 401 refreshes the token and retries once", async () => {
  let token = "old";
  const fetch = fakeFetch(jsonResponse(401, { code: "UNAUTHORIZED" }), jsonResponse(200, { ok: 1 }));
  const api = make(fetch, { getAccessToken: async () => token, forceRefresh: async () => { token = "new"; } });
  assert.deepEqual(await api.settings(), { ok: 1 });
  assert.equal(fetch.calls.length, 2);
  assert.equal(fetch.calls[1].options.headers.Authorization, "Bearer new");
});

test("a second 401 is an error, not a loop", async () => {
  const fetch = fakeFetch(jsonResponse(401, { code: "UNAUTHORIZED", error: "Invalid or expired token" }));
  await assert.rejects(make(fetch).settings(), (e) => e.code === "UNAUTHORIZED");
  assert.equal(fetch.calls.length, 2);
});

test("backend errors keep their code and message", async () => {
  const fetch = fakeFetch(jsonResponse(429, { code: "RATE_LIMITED", error: "You've used all 20 free rewrites" }));
  await assert.rejects(make(fetch).stats(), (e) => e.code === "RATE_LIMITED" && e.message.includes("20 free") && e.status === 429);
});

test("network failure gives the offline message", async () => {
  const fetch = fakeFetch(new TypeError("fetch failed"));
  await assert.rejects(make(fetch).stats(), (e) => e.code === "NETWORK");
});

test("a failed refresh while retrying surfaces the session error", async () => {
  const fetch = fakeFetch(jsonResponse(401, {}));
  const api = make(fetch, { forceRefresh: async () => { throw new AppError("SESSION_EXPIRED", "expired"); } });
  await assert.rejects(api.stats(), (e) => e.code === "SESSION_EXPIRED");
});

test("not being logged in stops before any network call", async () => {
  const fetch = fakeFetch(jsonResponse(200, {}));
  const api = make(fetch, { getAccessToken: async () => { throw new AppError("NOT_LOGGED_IN", "Please log in."); } });
  await assert.rejects(api.stats(), (e) => e.code === "NOT_LOGGED_IN");
  assert.equal(fetch.calls.length, 0);
});
