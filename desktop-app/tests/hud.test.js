const test = require("node:test");
const assert = require("node:assert/strict");
const { topCenter } = require("../src/hud");

test("the pill sits in the horizontal middle of the screen, just under the menu bar", () => {
  // A 1440 x 900 screen whose usable area starts below a 25 px menu bar.
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  assert.deepEqual(topCenter(area, 200, 48), { x: 620, y: 39, width: 200, height: 48 });
});

test("it is centred whatever the width, so a long error message stays centred too", () => {
  const area = { x: 0, y: 25, width: 1440, height: 875 };
  for (const width of [150, 224, 380]) {
    const { x } = topCenter(area, width, 48);
    assert.equal(x + width / 2, 720, `width ${width}`);
  }
});

test("on a second screen placed to the left or above, it follows that screen", () => {
  const left = { x: -1920, y: 25, width: 1920, height: 1055 };
  assert.deepEqual(topCenter(left, 240, 48), { x: -1920 + 840, y: 39, width: 240, height: 48 });
  const above = { x: 100, y: -1055, width: 1920, height: 1055 };
  assert.equal(topCenter(above, 240, 48).y, -1041);
});

test("an odd width never produces a half pixel", () => {
  const area = { x: 0, y: 25, width: 1441, height: 800 };
  assert.ok(Number.isInteger(topCenter(area, 223, 48).x));
});

test("the pill is never wider than the screen", () => {
  // The widest message the pill ever shows is 380 px; the smallest Mac screen is far wider.
  const small = { x: 0, y: 25, width: 1024, height: 700 };
  const { x, width } = topCenter(small, 380, 78);
  assert.ok(x >= 0 && x + width <= small.width);
});
