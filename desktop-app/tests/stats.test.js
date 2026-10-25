const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../stats.js");

const at = (text) => S.fromDateString(text);
const day = (date, rewrites = 1, inputWords = 10) => ({ date, rewrites, inputWords });

test("date strings round-trip and survive daylight saving changes", () => {
  assert.equal(S.toDateString(at("2026-03-08")), "2026-03-08");
  assert.equal(S.toDateString(S.addDays(at("2026-03-07"), 1)), "2026-03-08");
  assert.equal(S.toDateString(S.addDays(at("2026-03-08"), 1)), "2026-03-09");
  assert.equal(S.toDateString(S.addDays(at("2026-11-01"), 1)), "2026-11-02");
  assert.equal(S.toDateString(S.addDays(at("2026-12-31"), 1)), "2027-01-01");
});

test("streak counts back from today when today is active", () => {
  const map = S.buildDayMap([day("2026-10-25"), day("2026-10-24"), day("2026-10-23"), day("2026-10-20")]);
  assert.equal(S.currentStreak(map, at("2026-10-25")), 3);
});

test("streak survives an inactive today (still alive until the day ends)", () => {
  const map = S.buildDayMap([day("2026-10-24"), day("2026-10-23")]);
  assert.equal(S.currentStreak(map, at("2026-10-25")), 2);
});

test("a gap of a full day breaks the streak", () => {
  const map = S.buildDayMap([day("2026-10-23"), day("2026-10-22")]);
  assert.equal(S.currentStreak(map, at("2026-10-25")), 0);
  assert.equal(S.currentStreak({}, at("2026-10-25")), 0);
});

test("streaks cross month and year boundaries", () => {
  const map = S.buildDayMap([day("2026-12-31"), day("2027-01-01"), day("2027-01-02")]);
  assert.equal(S.currentStreak(map, at("2027-01-02")), 3);
  assert.equal(S.longestStreak(map), 3);
});

test("longest streak finds the best run", () => {
  const map = S.buildDayMap([day("2026-10-01"), day("2026-10-02"), day("2026-10-10"), day("2026-10-11"), day("2026-10-12")]);
  assert.equal(S.longestStreak(map), 3);
  assert.equal(S.longestStreak({}), 0);
});

test("lastDays returns 7 days oldest first ending today", () => {
  const map = S.buildDayMap([day("2026-10-25", 4), day("2026-10-21", 2)]);
  const days = S.lastDays(map, 7, at("2026-10-25"));
  assert.equal(days.length, 7);
  assert.equal(days[0].date, "2026-10-19");
  assert.equal(days[6].date, "2026-10-25");
  assert.deepEqual(days.map((d) => d.count), [0, 0, 2, 0, 0, 0, 4]);
});

test("calendar has weeks x 7 cells, today in the last column, nothing in the future", () => {
  const map = S.buildDayMap([day("2026-10-25", 8), day("2026-10-24", 2), day("2026-10-01", 1)]);
  const weeks = S.calendarWeeks(map, 20, at("2026-10-25")); // a Sunday
  assert.equal(weeks.length, 20);
  assert.ok(weeks.every((w) => w.length === 7));
  const last = weeks[19];
  assert.equal(last[0].date, "2026-10-25");
  assert.equal(last[0].today, true);
  assert.ok(last.slice(1).every((c) => c.future && c.count === 0 && c.level === 0));
  assert.equal(weeks[18][6].date, "2026-10-24");
});

test("calendar levels scale with the busiest day and empty days are level 0", () => {
  const map = S.buildDayMap([day("2026-10-25", 8), day("2026-10-24", 4), day("2026-10-23", 1), day("2026-10-22", 0)]);
  const cells = S.calendarWeeks(map, 4, at("2026-10-25")).flat();
  const level = (d) => cells.find((c) => c.date === d).level;
  assert.equal(level("2026-10-25"), 4);
  assert.equal(level("2026-10-24"), 2);
  assert.equal(level("2026-10-23"), 1);
  assert.equal(level("2026-10-22"), 0);
});

test("calendar with no data has no NaN levels", () => {
  const cells = S.calendarWeeks({}, 4, at("2026-10-25")).flat();
  assert.ok(cells.every((c) => c.level === 0));
});

test("week totals only include the last 7 days", () => {
  const days = [day("2026-10-25", 3, 30), day("2026-10-19", 2, 20), day("2026-10-18", 9, 90)];
  assert.deepEqual(S.weekTotals(days, at("2026-10-25")), { rewrites: 5, words: 50 });
});

test("durations", () => {
  assert.equal(S.formatDuration(0), "0s");
  assert.equal(S.formatDuration(25), "25s");
  assert.equal(S.formatDuration(60), "1m");
  assert.equal(S.formatDuration(25 * 38), "15m");
  assert.equal(S.formatDuration(3600 + 25 * 60), "1h 25m");
});

test("greeting by hour", () => {
  assert.equal(S.greeting(3), "Up late");
  assert.equal(S.greeting(9), "Good morning");
  assert.equal(S.greeting(14), "Good afternoon");
  assert.equal(S.greeting(21), "Good evening");
});

test("summary sentence covers new, active and lapsed users", () => {
  const today = at("2026-10-25");
  assert.match(S.summarySentence({ totals: {}, days: [], today }), /Highlight text in any app/);
  assert.equal(
    S.summarySentence({ totals: { rewrites: 5 }, days: [day("2026-10-25", 3, 1240), day("2026-10-24", 2, 10)], today }),
    "This week you polished 1,250 words in 5 rewrites."
  );
  assert.equal(
    S.summarySentence({ totals: { rewrites: 1 }, days: [day("2026-10-25", 1, 1)], today }),
    "This week you polished 1 word in 1 rewrite."
  );
  assert.equal(
    S.summarySentence({ totals: { rewrites: 4 }, days: [day("2026-10-10", 4, 40)], today }),
    "Nothing yet this week. Your last rewrite was 15 days ago."
  );
});

test("percent handles zero", () => {
  assert.equal(S.percent(1, 0), 0);
  assert.equal(S.percent(1, 4), 25);
});
