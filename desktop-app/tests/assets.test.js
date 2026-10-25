const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

// The size sits in the PNG header: width at byte 16, height at byte 20.
function pngSize(file) {
  const bytes = fs.readFileSync(path.join(__dirname, "..", "assets", file));
  assert.equal(bytes.toString("latin1", 1, 4), "PNG", `${file} is a PNG`);
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test("the menu-bar icon is menu-bar sized: 18 pixels, and 36 for Retina", () => {
  // Too big and macOS draws it taller than every other icon in the bar.
  assert.deepEqual(pngSize("trayTemplate.png"), { width: 18, height: 18 });
  assert.deepEqual(pngSize("trayTemplate@2x.png"), { width: 36, height: 36 });
});

test("the icon names end in Template so macOS tints them for light and dark bars", () => {
  assert.ok(fs.existsSync(path.join(__dirname, "..", "assets", "trayTemplate.png")));
  assert.ok(fs.existsSync(path.join(__dirname, "..", "assets", "trayTemplate@2x.png")));
});
