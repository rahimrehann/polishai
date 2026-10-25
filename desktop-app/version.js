// Compares app versions like "0.1.0" and "0.10.2" as numbers (so 0.10 is newer than 0.9).
(function (root) {
  function parse(text) {
    if (typeof text !== "string") return null;
    const parts = text.trim().split(".");
    if (parts.length < 1 || parts.length > 4 || !parts.every((p) => /^\d{1,6}$/.test(p))) return null;
    const numbers = parts.map(Number);
    while (numbers.length < 4) numbers.push(0);
    return numbers;
  }

  // -1 if a is older than b, 1 if newer, 0 if the same, null if either can't be read.
  function compare(a, b) {
    const left = parse(a);
    const right = parse(b);
    if (!left || !right) return null;
    for (let i = 0; i < 4; i++) {
      if (left[i] !== right[i]) return left[i] < right[i] ? -1 : 1;
    }
    return 0;
  }

  const api = { parse, compare };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.PolishVersion = api;
})(typeof window !== "undefined" ? window : globalThis);
