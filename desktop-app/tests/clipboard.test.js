const test = require("node:test");
const assert = require("node:assert/strict");
const { createClipboard } = require("../src/clipboard");

// A stand-in for Electron 44's asynchronous clipboard.
class FakeItem {
  constructor(data) { this.data = data; this.types = Object.keys(data); }
  async getType(type) {
    if (!(type in this.data)) throw new Error("no such type");
    return this.data[type];
  }
}

function fakeElectronClipboard({ initial = [], refuse = () => false } = {}) {
  let items = initial.map((d) => new FakeItem(d));
  return {
    get items() { return items; },
    read: async () => items,
    readText: async () => {
      const found = items.find((i) => i.types.includes("text/plain"));
      return found ? found.data["text/plain"] : "";
    },
    clear: () => { items = []; },
    write: async (list) => {
      if (list.some(refuse)) throw new Error("can't write that kind");
      items = list;
    },
    writeText: async (text) => { items = [new FakeItem({ "text/plain": text })]; },
  };
}

const make = (clipboard) => createClipboard({ clipboard, ClipboardItem: FakeItem });

test("every kind of data on the clipboard survives a borrow and return", async () => {
  const native = fakeElectronClipboard({ initial: [{ "text/plain": "hello", "text/html": "<b>hello</b>", "image/png": "PNG-BYTES" }] });
  const board = make(native);
  const saved = await board.snapshot();
  await board.clear();
  assert.equal(await board.readText(), "");
  await board.writeText("the rewrite");
  assert.equal(await board.readText(), "the rewrite");
  await board.restore(saved);
  assert.equal(await board.readText(), "hello");
  assert.deepEqual(native.items[0].types.sort(), ["image/png", "text/html", "text/plain"]);
  assert.equal(await native.items[0].getType("text/html"), "<b>hello</b>");
});

test("several items on the clipboard are all kept", async () => {
  const native = fakeElectronClipboard({ initial: [{ "text/plain": "one" }, { "image/png": "IMG" }] });
  const board = make(native);
  const saved = await board.snapshot();
  await board.clear();
  await board.restore(saved);
  assert.equal(native.items.length, 2);
});

test("an empty clipboard stays empty after a borrow", async () => {
  const native = fakeElectronClipboard();
  const board = make(native);
  const saved = await board.snapshot();
  await board.writeText("temporary");
  await board.restore(saved);
  assert.deepEqual(native.items, []);
  assert.equal(await board.readText(), "");
});

test("a kind that can't be read is skipped, not fatal", async () => {
  class Picky extends FakeItem {
    async getType(type) { if (type === "weird/type") throw new Error("nope"); return super.getType(type); }
  }
  const native = fakeElectronClipboard();
  native.read = async () => [new Picky({ "text/plain": "keep", "weird/type": "x" })];
  const board = createClipboard({ clipboard: native, ClipboardItem: FakeItem });
  const saved = await board.snapshot();
  assert.deepEqual(Object.keys(saved[0]), ["text/plain"]);
});

test("if the system refuses a special kind, the common kinds still come back", async () => {
  const refuse = (item) => item.types.includes("system/only");
  const native = fakeElectronClipboard({ initial: [{ "text/plain": "keep me", "text/html": "<i>keep</i>", "system/only": "?" }], refuse });
  const board = make(native);
  const saved = await board.snapshot();
  await board.clear();
  await board.restore(saved);
  assert.equal(await board.readText(), "keep me");
  assert.deepEqual(native.items[0].types.sort(), ["text/html", "text/plain"]);
});

test("restoring when even the fallback has nothing writable leaves it empty without throwing", async () => {
  const native = fakeElectronClipboard({ initial: [{ "system/only": "?" }], refuse: () => true });
  const board = make(native);
  const saved = await board.snapshot();
  await board.restore(saved);
  assert.deepEqual(native.items, []);
});
