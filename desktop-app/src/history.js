const crypto = require("crypto");

const MAX_ENTRIES = 500;

// Rewrite history lives only on this computer, encrypted, one file per account.
// `openStore(email)` returns { read, write, clear } for that account's file.
function createHistory({ openStore, getEmail, now = () => new Date(), makeId = () => crypto.randomUUID() }) {
  function store() {
    const email = getEmail();
    return email ? openStore(email) : null;
  }

  function load(s) {
    const data = s.read();
    return data && Array.isArray(data.entries) ? data.entries : [];
  }

  return {
    add({ format, app, input, output, at }) {
      const s = store();
      if (!s) return null;
      const entry = {
        id: makeId(),
        at: at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : now().toISOString(),
        format: format === "email" ? "email" : "message",
        app: app || "",
        input: String(input),
        output: String(output),
      };
      s.write({ entries: [entry, ...load(s)].slice(0, MAX_ENTRIES) });
      return entry;
    },

    // Newest first. `date` is a local YYYY-MM-DD, `localDate` turns a timestamp into one.
    list({ limit = 100, date, localDate } = {}) {
      const s = store();
      if (!s) return [];
      let entries = load(s);
      if (date && localDate) entries = entries.filter((e) => localDate(e.at) === date);
      return entries.slice(0, limit);
    },

    remove(id) {
      const s = store();
      if (!s) return false;
      const entries = load(s);
      const kept = entries.filter((e) => e.id !== id);
      if (kept.length === entries.length) return false;
      s.write({ entries: kept });
      return true;
    },

    clear() {
      const s = store();
      if (s) s.clear();
    },
  };
}

module.exports = { createHistory, MAX_ENTRIES };
