// Checks that the native helper can really press Copy and Paste in an app.
// Opens a small window, tries 5 rounds, prints the result and quits.
//   npm run probe:keys        (needs the Accessibility permission, see Settings > Permissions)
// It borrows your clipboard for a moment and puts your clipboard text back.
// Safety: it presses keys ONLY while its own window is the app in front. If another app
// is in front, it stops without pressing anything, so it can't type into your work.
const { app, BrowserWindow, clipboard } = require("electron");
const { execFile, execFileSync } = require("child_process");
const path = require("path");

const helper = path.join(__dirname, "..", "native", "polish-keys");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const run = (args) =>
  new Promise((resolve) =>
    execFile(helper, args, { timeout: 2500, killSignal: "SIGKILL" }, (error, out) => resolve(error ? "failed" : String(out).trim()))
  );
const script = (code) => `(() => { const t = document.getElementById("t"); ${code} })()`;

// True only when this test window's app is the one in front.
const weAreInFront = async () => (await run(["frontapp"])) === app.getName();
async function bringToFront(win) {
  for (let attempt = 0; attempt < 5; attempt++) {
    app.focus({ steal: true });
    win.show();
    win.focus();
    await sleep(400);
    if (await weAreInFront()) return true;
  }
  return false;
}

app.whenReady().then(async () => {
  const savedText = execFileSync("pbpaste", { encoding: "utf8" });
  const win = new BrowserWindow({ width: 480, height: 260, show: true });
  await win.loadURL('data:text/html,<body><textarea id=t rows=4 cols=40></textarea></body>');
  if (!(await bringToFront(win))) {
    execFileSync("pbcopy", { input: savedText });
    console.log("Stopped: the test window couldn't get to the front, so no keys were pressed. Click it and run again.");
    app.exit(2);
    return;
  }

  const trusted = (await run(["trusted"])) === "1";
  let copied = 0;
  let pasted = 0;
  for (let round = 0; round < 5; round++) {
    // Re-check before every round: if focus moved, stop before pressing anything.
    if (!(await weAreInFront())) {
      execFileSync("pbcopy", { input: savedText });
      console.log(`Stopped after ${round} rounds: another app came to the front, so no more keys were pressed.`);
      app.exit(2);
      return;
    }
    await win.webContents.executeJavaScript(script('t.value = "hello probe text"; t.focus(); t.select();'));
    await clipboard.writeText("BEFORE");
    await run(["copy"]);
    await sleep(400);
    if ((await clipboard.readText()) === "hello probe text") copied++;

    await clipboard.writeText("PASTED");
    await win.webContents.executeJavaScript(script('t.value = ">"; t.focus(); t.setSelectionRange(1, 1);'));
    await run(["paste"]);
    await sleep(400);
    if ((await win.webContents.executeJavaScript(script("return t.value;"))).includes("PASTED")) pasted++;
  }

  execFileSync("pbcopy", { input: savedText });
  console.log(`Accessibility allowed: ${trusted ? "yes" : "NO (turn it on in System Settings > Privacy & Security > Accessibility)"}`);
  console.log(`Copy worked ${copied}/5, Paste worked ${pasted}/5`);
  app.exit(copied === 5 && pasted === 5 ? 0 : 1);
});
