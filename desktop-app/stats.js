// Turns the backend's daily rows into what the dashboard shows.
// Plain script so the page can load it; also works under Node for tests.
(function (root) {
  const SECONDS_SAVED_PER_REWRITE = 25;

  // Local calendar dates as "YYYY-MM-DD". Built at noon so daylight saving
  // changes can never move a date.
  function toDateString(date) {
    const pad = (n) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function fromDateString(text) {
    const [y, m, d] = text.split("-").map(Number);
    return new Date(y, m - 1, d, 12);
  }

  function addDays(date, amount) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12);
    return next;
  }

  function buildDayMap(days) {
    const map = {};
    for (const day of days || []) map[day.date] = Number(day.rewrites) || 0;
    return map;
  }

  function currentStreak(map, today) {
    let cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
    if (!map[toDateString(cursor)]) cursor = addDays(cursor, -1);
    let streak = 0;
    while (map[toDateString(cursor)] > 0) {
      streak++;
      cursor = addDays(cursor, -1);
    }
    return streak;
  }

  function longestStreak(map) {
    const dates = Object.keys(map).filter((d) => map[d] > 0).sort();
    let best = 0;
    let run = 0;
    let previous = null;
    for (const date of dates) {
      const continues = previous && toDateString(addDays(fromDateString(previous), 1)) === date;
      run = continues ? run + 1 : 1;
      best = Math.max(best, run);
      previous = date;
    }
    return best;
  }

  // Oldest first, ending today.
  function lastDays(map, count, today) {
    const end = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
    const result = [];
    for (let i = count - 1; i >= 0; i--) {
      const date = addDays(end, -i);
      const key = toDateString(date);
      result.push({ date: key, count: map[key] || 0, weekday: date.getDay() });
    }
    return result;
  }

  // Columns are weeks (Sunday first). The last column holds today.
  function calendarWeeks(map, weekCount, today) {
    const todayNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
    const lastSunday = addDays(todayNoon, -todayNoon.getDay());
    const firstSunday = addDays(lastSunday, -7 * (weekCount - 1));
    const todayKey = toDateString(todayNoon);

    const cells = [];
    let max = 0;
    for (let w = 0; w < weekCount; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        const date = addDays(firstSunday, w * 7 + d);
        const key = toDateString(date);
        const future = key > todayKey;
        const count = future ? 0 : map[key] || 0;
        max = Math.max(max, count);
        week.push({ date: key, count, future, today: key === todayKey, month: date.getMonth(), day: date.getDate() });
      }
      cells.push(week);
    }
    for (const week of cells) {
      for (const cell of week) cell.level = cell.count === 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((4 * cell.count) / max)));
    }
    return cells;
  }

  function weekTotals(days, today) {
    const keys = new Set(lastDays({}, 7, today).map((d) => d.date));
    let rewrites = 0;
    let words = 0;
    for (const day of days || []) {
      if (keys.has(day.date)) {
        rewrites += Number(day.rewrites) || 0;
        words += Number(day.inputWords) || 0;
      }
    }
    return { rewrites, words };
  }

  function lastActiveDate(map) {
    const dates = Object.keys(map).filter((d) => map[d] > 0).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }

  function daysBetween(fromKey, today) {
    const todayNoon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12);
    return Math.round((todayNoon - fromDateString(fromKey)) / 86400000);
  }

  function formatDuration(totalSeconds) {
    if (totalSeconds < 60) return `${totalSeconds}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
  }

  function greeting(hour) {
    if (hour < 5) return "Up late";
    if (hour < 12) return "Good morning";
    if (hour < 18) return "Good afternoon";
    return "Good evening";
  }

  function plural(count, word) {
    return `${count.toLocaleString()} ${word}${count === 1 ? "" : "s"}`;
  }

  // One plain sentence under the greeting.
  function summarySentence({ totals, days, today }) {
    const allTime = Number(totals && totals.rewrites) || 0;
    if (allTime === 0) return "Highlight text in any app and press a shortcut to polish it.";

    const week = weekTotals(days, today);
    if (week.rewrites > 0) {
      return `This week you polished ${plural(week.words, "word")} in ${plural(week.rewrites, "rewrite")}.`;
    }
    const last = lastActiveDate(buildDayMap(days));
    const ago = last ? daysBetween(last, today) : null;
    return ago ? `Nothing yet this week. Your last rewrite was ${plural(ago, "day")} ago.` : "Nothing yet this week.";
  }

  function percent(part, whole) {
    return whole > 0 ? Math.round((part / whole) * 100) : 0;
  }

  const api = {
    SECONDS_SAVED_PER_REWRITE,
    toDateString, fromDateString, addDays, buildDayMap, currentStreak, longestStreak,
    lastDays, calendarWeeks, weekTotals, formatDuration, greeting, plural, summarySentence, percent,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PolishStats = api;
})(typeof window !== "undefined" ? window : globalThis);
