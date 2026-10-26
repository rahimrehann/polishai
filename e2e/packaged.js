// Tests the REAL built app (not the development version). Usage: node e2e5-packaged.js arm64|x64
const { _electron: electron } = require("playwright-core");
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const arch = process.argv[2] || "arm64";
const DIST = path.join(path.resolve(__dirname, ".."), "desktop-app", "dist");
const APP_DIR = path.join(DIST, arch === "arm64" ? "mac-arm64" : "mac", "PolishAI.app");
const EXE = path.join(APP_DIR, "Contents/MacOS/PolishAI");
const POOL = "us-east-1_betXW17AO";
const PROFILE = fs.mkdtempSync("/tmp/polishai-packaged-profile-");
const email = `polishai-e2e-${crypto.randomBytes(3).toString("hex")}@example.com`;
const password = "Aa1!" + crypto.randomBytes(8).toString("hex");
const results = [];

const sh = (cmd, args) => execFileSync(cmd, args, { encoding: "utf8" }).trim();
const aws = (...a) => { const o = sh("aws", ["--region", "us-east-1", ...a]); return o ? JSON.parse(o) : {}; };
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  [${String(detail).slice(0, 240)}]` : ""}`);
}
const plist = (key) => sh("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, path.join(APP_DIR, "Contents/Info.plist")]);

async function main() {
  console.log(`--- testing the built ${arch} app: ${APP_DIR}`);
  check("the built app exists", fs.existsSync(EXE));

  // ---- the bundle itself ----
  check("name is PolishAI", plist("CFBundleName") === "PolishAI", plist("CFBundleName"));
  check("identifier is com.polishai.desktop", plist("CFBundleIdentifier") === "com.polishai.desktop");
  check("version is 0.1.0", plist("CFBundleShortVersionString") === "0.1.0", plist("CFBundleShortVersionString"));
  check("it has our icon", fs.existsSync(path.join(APP_DIR, "Contents/Resources/icon.icns")) && plist("CFBundleIconFile").startsWith("icon"));
  console.log("      minimum macOS:", plist("LSMinimumSystemVersion"));

  const helper = path.join(APP_DIR, "Contents/Resources/native/polish-keys");
  const helperInfo = sh("file", [helper]);
  check("the key-pressing helper is inside the app", fs.existsSync(helper), helperInfo);
  check(`...and built for ${arch === "arm64" ? "Apple Silicon" : "Intel"}`, helperInfo.includes(arch === "arm64" ? "arm64" : "x86_64"), helperInfo);
  check("...and runs", sh(helper, ["frontapp"]) !== undefined);
  const exeInfo = sh("file", [EXE]);
  check(`the app itself is ${arch === "arm64" ? "Apple Silicon" : "Intel"}`, exeInfo.includes(arch === "arm64" ? "arm64" : "x86_64"), exeInfo);

  const sig = require("child_process").spawnSync("codesign", ["-dv", APP_DIR], { encoding: "utf8" }).stderr || "";
  let verify = "ok";
  try { execFileSync("codesign", ["--verify", "--deep", "--strict", APP_DIR], { stdio: "pipe" }); } catch (e) { verify = String(e.stderr || e.message).trim(); }
  check("the signature is valid (needed to run on Apple Silicon)", verify === "ok", verify);
  console.log("      signature:", (sig.match(/Signature=.*/) || sig.match(/flags=.*/) || ["?"])[0]);

  aws("cognito-idp", "admin-create-user", "--user-pool-id", POOL, "--username", email,
    "--user-attributes", `Name=email,Value=${email}`, "Name=email_verified,Value=true", "Name=name,Value=Pat Packaged", "--message-action", "SUPPRESS");
  aws("cognito-idp", "admin-set-user-password", "--user-pool-id", POOL, "--username", email, "--password", password, "--permanent");

  let app;
  try {
    app = await electron.launch({
      executablePath: EXE,
      args: [`--user-data-dir=${PROFILE}`],
      env: { ...process.env, POLISHAI_FAKE_KEYS: "1", POLISHAI_DEMO: "1", POLISHAI_FAKE_VERSION: "0.0.1" },
      timeout: 90000,
    });
    const page = await app.firstWindow();
    await page.waitForLoadState("domcontentloaded");

    const info = await app.evaluate(({ app }) => ({ name: app.getName(), packaged: app.isPackaged, version: app.getVersion(), seam: typeof global.__polish }));
    check("it runs as the installed app", info.packaged === true && info.name === "PolishAI", JSON.stringify(info));
    check("the test-only switches are off in the installed app", info.seam === "undefined", JSON.stringify(info));

    await page.waitForSelector("#welcome-screen:not(.hidden)", { timeout: 15000 });
    check("the first screen shows, with the logo loaded", await page.evaluate(() => {
      const img = document.querySelector("#welcome-screen .logo");
      return !!img && img.complete && img.naturalWidth > 0;
    }));
    const iso = await page.evaluate(() => ({ require: typeof require, process: typeof process, api: Object.keys(window.polish).sort().join(",") }));
    check("the page still has no direct access to the computer", iso.require === "undefined" && iso.process === "undefined" && iso.api.includes("auth"), JSON.stringify(iso));

    // Look inside the app's packed archive from outside it.
    const asar = require(path.join(path.resolve(__dirname, ".."), "desktop-app", "node_modules", "@electron", "asar"));
    const inside = new Set(asar.listPackage(path.join(APP_DIR, "Contents/Resources/app.asar")).map((f) => f.replace(/^\//, "")));
    const needed = ["assets/trayTemplate.png", "assets/trayTemplate@2x.png", "assets/logo.png", "hud.html", "hud.css", "hud.js", "hud-preload.js", "version.js", "stats.js", "hotkeys.js", "main.js", "preload.js", "renderer.js", "index.html", "styles.css", "src/account.js", "src/tray.js", "src/rewriteFlow.js"];
    const missing = needed.filter((f) => !inside.has(f));
    check("every file the app needs is inside it", missing.length === 0, missing.join(", "));
    const extras = [...inside].filter((f) => /^(tests|scripts|native|build-resources|dist)\//.test(f) || /\.swift$/.test(f) || f.includes("electron-builder"));
    check("and the test and build files were left out", extras.length === 0, extras.slice(0, 5).join(", "));
    console.log(`      ${inside.size} entries inside the app archive`);

    const registered = await app.evaluate(({ globalShortcut }) => [globalShortcut.isRegistered("Command+F"), globalShortcut.isRegistered("Command+G")]);
    check("the two shortcuts are registered", registered[0] && registered[1], JSON.stringify(registered));

    if (arch === "arm64") {
      // ---- log in and use the real app ----
      await page.click("#show-login-btn");
      await page.fill("#login-email", email);
      await page.fill("#login-password", password);
      await page.click("#login-submit-btn");
      await page.waitForSelector("#app-shell:not(.hidden)", { timeout: 30000 });
      check("a new user can log in to the installed app", true);
      await page.waitForSelector("#getting-started:not(.hidden)", { timeout: 15000 });
      check("and sees the getting-started guide", true);

      await page.click("#nav-settings");
      await page.waitForFunction(() => document.querySelector("#app-version").textContent.startsWith("PolishAI "), null, { timeout: 8000 });
      check("Settings shows the version", (await page.locator("#app-version").innerText()).startsWith("PolishAI "));
      await page.waitForFunction(() => document.querySelector("#general-note") !== null, null, { timeout: 8000 });
      check("start at login is available (not greyed out) in the installed app", !(await page.isDisabled("#toggle-login")) && (await page.locator("#general-note").isHidden()));
      const before = await app.evaluate(({ app }) => app.getLoginItemSettings().openAtLogin);
      await page.locator("label[for=toggle-login]").click();
      await page.waitForFunction(() => document.querySelector("#toggle-login").checked, null, { timeout: 8000 });
      const during = await app.evaluate(({ app }) => app.getLoginItemSettings().openAtLogin);
      check("switching it on really registers the app to start at login", before === false && during === true, `${before} -> ${during}`);
      await page.locator("label[for=toggle-login]").click();
      await page.waitForFunction(() => !document.querySelector("#toggle-login").checked, null, { timeout: 8000 });
      const after = await app.evaluate(({ app }) => app.getLoginItemSettings().openAtLogin);
      check("and switching it off removes it again", after === false, String(after));
      await page.screenshot({ path: path.join(__dirname, "shots", "w-packaged-settings.png") });
      await page.click("#logout-btn");
      await page.waitForSelector("#welcome-screen:not(.hidden)");
      check("log out works", true);
    }
  } finally {
    try { if (app) await app.close(); } catch {}
    try { aws("cognito-idp", "admin-delete-user", "--user-pool-id", POOL, "--username", email); } catch {}
    fs.rmSync(PROFILE, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `\n${failed} FAILED of ${results.length}` : `\nALL ${results.length} PASSED`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
