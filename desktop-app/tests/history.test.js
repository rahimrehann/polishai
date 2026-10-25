const test = require("node:test");
const assert = require("node:assert/strict");
const { createHistory, MAX_ENTRIES } = require("../src/history");

function setup({ email = "a@x.com", start = "2026-10-25T10:00:00.000Z" } = {}) {
  const files = {};
  const state = { email, clock: new Date(start), n: 0 };
  const openStore = (who) => ({
    read: () => files[who] || null,
    write: (data) => { files[who] = JSON.parse(JSON.stringify(data)); },
    clear: () => { delete files[who]; },
  });
  const history = createHistory({
    openStore,
    getEmail: () => state.email,
    now: () => state.clock,
    makeId: () => `id-${++state.n}`,
  });
  return { history, files, state };
}

const entry = (text = "hello") => ({ format: "message", app: "Slack", input: text, output: text.toUpperCase() });

test("entries are saved newest first with the full text", () => {
  const { history, state } = setup();
  history.add(entry("first"));
  state.clock = new Date("2026-10-25T11:00:00.000Z");
  history.add({ ...entry("second"), format: "email" });
  const [newest, oldest] = history.list();
  assert.deepEqual([newest.input, newest.output, newest.format, newest.app], ["second", "SECOND", "email", "Slack"]);
  assert.equal(oldest.input, "first");
  assert.equal(newest.at, "2026-10-25T11:00:00.000Z");
});

test("each account only sees its own history", () => {
  const { history, state } = setup();
  history.add(entry("mine"));
  state.email = "b@x.com";
  assert.deepEqual(history.list(), []);
  history.add(entry("theirs"));
  state.email = "a@x.com";
  assert.deepEqual(history.list().map((e) => e.input), ["mine"]);
});

test("nothing is saved or shown while logged out", () => {
  const { history, state, files } = setup({ email: null });
  assert.equal(history.add(entry()), null);
  assert.deepEqual(history.list(), []);
  assert.deepEqual(files, {});
  state.email = "a@x.com";
  assert.deepEqual(history.list(), []);
});

test("filtering by day uses the caller's local date", () => {
  const { history, state } = setup();
  history.add(entry("a"));
  state.clock = new Date("2026-10-26T15:00:00.000Z");
  history.add(entry("b"));
  const localDate = (iso) => iso.slice(0, 10);
  assert.deepEqual(history.list({ date: "2026-10-25", localDate }).map((e) => e.input), ["a"]);
  assert.deepEqual(history.list({ date: "2026-10-30", localDate }), []);
  assert.equal(history.list().length, 2);
});

test("limit and the 500 entry cap drop the oldest", () => {
  const { history } = setup();
  for (let i = 0; i < MAX_ENTRIES + 5; i++) history.add(entry(`t${i}`));
  const all = history.list({ limit: 10000 });
  assert.equal(all.length, MAX_ENTRIES);
  assert.equal(all[0].input, `t${MAX_ENTRIES + 4}`);
  assert.equal(history.list({ limit: 3 }).length, 3);
});

test("remove deletes one entry, clear deletes all", () => {
  const { history } = setup();
  const a = history.add(entry("a"));
  history.add(entry("b"));
  assert.equal(history.remove(a.id), true);
  assert.equal(history.remove(a.id), false);
  assert.deepEqual(history.list().map((e) => e.input), ["b"]);
  history.clear();
  assert.deepEqual(history.list(), []);
});

test("odd input is stored safely", () => {
  const { history } = setup();
  const saved = history.add({ format: "poem", app: undefined, input: 42, output: null });
  assert.equal(saved.format, "message");
  assert.equal(saved.app, "");
  assert.equal(saved.input, "42");
});
