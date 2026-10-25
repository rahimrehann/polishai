const test = require("node:test");
const assert = require("node:assert/strict");
const V = require("../version.js");

test("versions are compared as numbers, not text", () => {
  assert.equal(V.compare("0.9.0", "0.10.0"), -1);
  assert.equal(V.compare("1.10.0", "1.9.9"), 1);
  assert.equal(V.compare("0.1.0", "0.1.0"), 0);
  assert.equal(V.compare("0.1", "0.1.0"), 0);
  assert.equal(V.compare("2", "1.99.99"), 1);
});

test("anything unreadable gives no answer instead of a wrong one", () => {
  for (const bad of [null, undefined, "", "abc", "1.2.x", "1..2", "1.2.3.4.5", 5, "9999999"]) {
    assert.equal(V.compare(bad, "0.1.0"), null, String(bad));
    assert.equal(V.compare("0.1.0", bad), null, String(bad));
  }
});
