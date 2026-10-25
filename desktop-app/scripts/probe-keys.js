// Checks that the native helper can really press Copy and Paste in an app.
// Opens a small window, tries 5 rounds, prints the result and quits.
//   npm run probe:keys        (needs the Accessibility permission, see Settings > Permissions)
// It borrows your clipboard for a moment and puts your clipboard text back.
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

app.whenReady().then(async () => {
  const savedText = execFileSync("pbpaste", { encoding: "utf8" });
  const win = new BrowserWindow({ width: 480, height: 260, show: true });
  await win.loadURL('data:text/html,<body><textarea id=t rows=4 cols=40></textarea></body>');
  app.focus({ steal: true });
  win.focus();
  await sleep(700);

  const trusted = (await run(["trusted"])) === "1";
  let copied = 0;
  let pasted = 0;
  for (let round = 0; round < 5; round++) {
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
