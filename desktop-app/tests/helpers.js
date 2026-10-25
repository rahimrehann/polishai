function jsonResponse(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

// A fetch stub that returns queued responses (or throws) and records calls.
function fakeFetch(...queue) {
  const calls = [];
  const fn = async (url, options) => {
    calls.push({ url, options, body: options && options.body ? JSON.parse(options.body) : null });
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next instanceof Error) throw next;
    return typeof next === "function" ? next() : next;
  };
  fn.calls = calls;
  return fn;
}

function fakeIdToken(claims) {
  const part = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  return `${part({ alg: "RS256" })}.${part(claims)}.sig`;
}

function memoryStore(initial = null) {
  const store = {
    data: initial,
    writes: 0,
    write(d) { store.data = d; store.writes++; },
    read() { return store.data; },
    clear() { store.data = null; },
  };
  return store;
}

module.exports = { jsonResponse, fakeFetch, fakeIdToken, memoryStore };
