const { _electron: electron } = require("playwright-core");
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "desktop-app");
const ELECTRON = path.join(APP, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const PY = path.join(ROOT, "backend", ".venv", "bin", "python");
const POOL = "us-east-1_betXW17AO";
const CLIENT = "15fipvbne122u6ng7diesu55tr";
const URL_ = "https://zrixwg6huied4ttlcdhxuoa2mq0lnnkf.lambda-url.us-east-1.on.aws/";
const PROFILE = fs.mkdtempSync("/tmp/polishai-e2e-profile-");
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const email = `polishai-e2e-${crypto.randomBytes(3).toString("hex")}@example.com`;
const password = "Aa1!" + crypto.randomBytes(8).toString("hex");
const results = [];

function aws(...args) {
  const out = execFileSync("aws", ["--region", "us-east-1", ...args], { encoding: "utf8" });
  return out.trim() ? JSON.parse(out) : {};
}
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  [${String(detail).slice(0, 240)}]` : ""}`);
}
async function launch() {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [APP, `--user-data-dir=${PROFILE}`],
    env: { ...process.env, POLISHAI_FAKE_KEYS: "1", POLISHAI_DEMO: "1" },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}
const visible = (page, sel) => page.locator(sel).first().isVisible();
const text = (page, sel) => page.locator(sel).first().innerText();
const settled = (page) => page.waitForFunction(() => !document.querySelector("#summary").textContent.startsWith("Loading"), null, { timeout: 30000 });
const registered = (app, accelerator) => app.evaluate(({ globalShortcut }, a) => globalShortcut.isRegistered(a), accelerator);
const keycapText = async (page, sel) => (await page.locator(`${sel} .keycap`).allInnerTexts()).join(" ");

async function main() {
  aws("cognito-idp", "admin-create-user", "--user-pool-id", POOL, "--username", email,
    "--user-attributes", `Name=email,Value=${email}`, "Name=email_verified,Value=true", "Name=name,Value=Rahim Rehan", "--message-action", "SUPPRESS");
  aws("cognito-idp", "admin-set-user-password", "--user-pool-id", POOL, "--username", email, "--password", password, "--permanent");
  const sub = aws("cognito-idp", "admin-get-user", "--user-pool-id", POOL, "--username", email).UserAttributes.find((a) => a.Name === "sub").Value;
  execFileSync(PY, [path.join(__dirname, "seed_demo.py"), sub], { encoding: "utf8" });

  try {
    let { app, page } = await launch();
    await page.click("#show-login-btn");
    await page.fill("#login-email", email);
    await page.fill("#login-password", password);
    await page.click("#login-submit-btn");
    await page.waitForSelector("#app-shell:not(.hidden)", { timeout: 30000 });
    await settled(page);
    await page.waitForFunction(() => document.querySelectorAll("#today-list .recent-row").length > 0, null, { timeout: 20000 });
    await page.waitForTimeout(1500);

    // ---- The REAL system clipboard in real Electron (the pretend one hid a bug before) ----
    const userClipboard = execFileSync("pbpaste", { encoding: "utf8" });
    try {
      const real = await app.evaluate(async ({ clipboard, ClipboardItem }) => {
        const c = global.__polish.realClipboard;
        await clipboard.write([new ClipboardItem({ "text/plain": "probe original", "text/html": "<b>probe original</b>" })]);
        const snap = await c.snapshot();
        await c.clear();
        const cleared = await c.readText();
        await c.writeText("probe borrowed");
        const borrowed = await c.readText();
        await c.restore(snap);
        const back = await c.readText();
        const kinds = (await clipboard.read()).flatMap((i) => i.types);
        return { cleared, borrowed, back, kinds, saved: snap.length };
      });
      check("real clipboard: borrow, read and write work", real.cleared === "" && real.borrowed === "probe borrowed", JSON.stringify(real));
      check("real clipboard: text comes back exactly", real.back === "probe original", JSON.stringify(real));
      check("real clipboard: formatting (HTML) comes back too", real.kinds.includes("text/html") && real.kinds.includes("text/plain"), JSON.stringify(real));
    } finally {
      execFileSync("pbcopy", { input: userClipboard });
    }

    // ---- Dashboard: shortcut chips and Recent with real text ----
    check("rail has logo, History and Settings", (await page.locator(".rail button").count()) === 3 && await visible(page, "#nav-history"));
    check("History icon sits directly above Settings", await page.evaluate(() => {
      const h = document.querySelector("#nav-history").getBoundingClientRect(), s = document.querySelector("#nav-settings").getBoundingClientRect();
      return h.bottom <= s.top && Math.abs(h.left - s.left) < 2;
    }));
    check("dashboard chips show the real default shortcuts", (await keycapText(page, "#chip-message")) === "⌃ Q" && (await keycapText(page, "#chip-email")) === "⌃ Y",
      `${await keycapText(page, "#chip-message")} / ${await keycapText(page, "#chip-email")}`);
    const recent = await text(page, "#today-list");
    check("Recent shows the actual rewritten words", /Hey, could you|Hi,|Thanks|Don't forget|Does anyone|Running about|Can we move|Just pushed/.test(recent), recent);
    check("Recent offers See all", await visible(page, "#recent-all"));
    await page.screenshot({ path: `${SHOTS}/i-dashboard-recent.png` });

    // ---- Click a recent rewrite: opens History on that entry with both texts ----
    await page.locator("#today-list .recent-link").first().click();
    await page.waitForSelector("#history-screen:not(.hidden)");
    await page.waitForSelector(".entry.is-open", { timeout: 10000 });
    check("clicking Recent opens that entry in History, expanded", (await page.locator(".entry.is-open").count()) === 1);
    const opened = page.locator(".entry.is-open");
    const [wrote, polished] = await opened.locator(".entry-text").allInnerTexts();
    check("both what you wrote and what PolishAI wrote are readable", wrote.length > 10 && polished.length > 10 && wrote !== polished, `${wrote} | ${polished}`);
    check("entry shows the labels", (await opened.innerText()).includes("What you wrote") && (await opened.innerText()).includes("What PolishAI wrote"));
    await page.screenshot({ path: `${SHOTS}/j-history-open.png` });

    // ---- History screen from the rail ----
    await page.click("#nav-history");
    await page.waitForSelector("#history-list .entry");
    const total = await page.locator("#history-list .entry").count();
    check("History lists the saved rewrites under day headings", total >= 20 && (await text(page, "#history-list")).includes("Today"), `${total}`);
    check("History icon is highlighted while open", await page.evaluate(() => document.querySelector("#nav-history").classList.contains("is-active")));

    // copy
    await page.locator("#history-list .entry-head").nth(1).click();
    const second = page.locator("#history-list .entry").nth(1);
    const expectedCopy = (await second.locator(".entry-text").nth(1).innerText());
    await second.getByRole("button", { name: "Copy rewrite" }).click();
    await page.waitForFunction(() => [...document.querySelectorAll(".entry .btn-quiet")].some((b) => b.textContent === "Copied"), null, { timeout: 5000 });
    const board = await app.evaluate(() => global.__polish.fake.board.text);
    check("Copy rewrite puts the rewritten text on the clipboard", board === expectedCopy, board);

    // delete one
    await second.getByRole("button", { name: "Delete" }).click();
    await page.waitForFunction((n) => document.querySelectorAll("#history-list .entry").length === n - 1, total, { timeout: 5000 });
    check("Delete removes just that entry", (await page.locator("#history-list .entry").count()) === total - 1);

    // ---- Day detail: bars and calendar squares ----
    await page.click("#nav-home");
    await settled(page);
    await page.waitForSelector("#week-bars .week-col");
    check("seven clickable bars and 140 clickable-or-future squares", (await page.locator("#week-bars button.week-col").count()) === 7 && (await page.locator("#calendar button.cell").count()) === 140);
    const todayBar = page.locator("#week-bars .week-col.is-today");
    const todayDate = await todayBar.getAttribute("data-date");
    await todayBar.click();
    await page.waitForFunction(() => /rewrites?,/.test(document.querySelector("#week-detail").textContent), null, { timeout: 8000 });
    const barDetail = await text(page, "#week-detail");
    check("clicking a bar shows that day's usage", /\d+ rewrites?, [\d,]+ words? polished \(\d+ Message, \d+ Email\)/.test(barDetail), barDetail);
    check("the clicked day is highlighted in the bars and the calendar",
      (await page.locator(`#week-bars .week-col.is-selected[data-date="${todayDate}"]`).count()) === 1 && (await page.locator(`#calendar .cell.is-selected[data-date="${todayDate}"]`).count()) === 1);
    await page.waitForSelector("#week-detail .link-btn", { timeout: 8000 });
    check("the day links to its rewrites in History", (await text(page, "#week-detail .link-btn")).includes("History"));
    await page.screenshot({ path: `${SHOTS}/k-day-bar.png` });

    // a past day with data, from the calendar
    const pastDate = await page.evaluate(() => {
      const cells = [...document.querySelectorAll("#calendar button.cell:not(.is-future)")].filter((c) => c.dataset.level !== "0" && !c.classList.contains("is-today"));
      return cells.length ? cells[cells.length - 3].dataset.date : null;
    });
    await page.locator(`#calendar .cell[data-date="${pastDate}"]`).click();
    await page.waitForFunction(() => /rewrites?,/.test(document.querySelector("#calendar-detail").textContent), null, { timeout: 8000 });
    const calDetail = await text(page, "#calendar-detail");
    check("clicking a calendar square shows that day's usage", /\d+ rewrites?, [\d,]+ words? polished/.test(calDetail), calDetail);
    check("selection moves to the new day", (await page.locator(".cell.is-selected").count()) === 1 && (await text(page, "#week-detail")).includes("Click a bar"));
    await page.waitForFunction(() => document.querySelector("#calendar-detail").textContent.includes("isn't saved on this computer") || document.querySelector("#calendar-detail .link-btn"), null, { timeout: 8000 });

    // an empty day
    const emptyDate = await page.evaluate(() => {
      const c = [...document.querySelectorAll("#calendar button.cell:not(.is-future)")].find((x) => x.dataset.level === "0");
      return c.dataset.date;
    });
    await page.locator(`#calendar .cell[data-date="${emptyDate}"]`).click();
    check("an empty day says so", (await text(page, "#calendar-detail")).includes("No rewrites this day."), await text(page, "#calendar-detail"));
    await page.screenshot({ path: `${SHOTS}/l-day-calendar.png` });

    // day link filters History
    await todayBar.click();
    await page.waitForSelector("#week-detail .link-btn", { timeout: 8000 });
    await page.click("#week-detail .link-btn");
    await page.waitForSelector("#history-screen:not(.hidden)");
    await page.waitForSelector("#history-filter:not(.hidden)");
    check("the day link opens History filtered to that day", (await text(page, "#history-filter-text")).startsWith("Showing") && (await page.locator("#history-list .entry").count()) > 0);
    await page.click("#history-filter-clear");
    await page.waitForFunction(() => document.querySelector("#history-filter").classList.contains("hidden"));
    check("Show all removes the filter", (await page.locator("#history-list .entry").count()) >= total - 1);

    // ---- Settings: shortcuts ----
    await page.click("#nav-settings");
    await page.waitForFunction(() => document.querySelector("#permission-status").textContent.length > 0, null, { timeout: 10000 });
    check("Shortcuts section sits under AI provider", await page.evaluate(() => {
      const heads = [...document.querySelectorAll("#settings-screen .section h2")].map((h) => h.textContent);
      return heads.join("|") === "Account|Password|AI provider|Shortcuts|General|Permissions|Privacy and your data";
    }));
    check("both shortcuts show their current keys", (await keycapText(page, "#hotkey-message")) === "⌃ Q" && (await keycapText(page, "#hotkey-email")) === "⌃ Y");
    check("both are registered with the system", (await registered(app, "Control+Q")) && (await registered(app, "Control+Y")));
    await page.screenshot({ path: `${SHOTS}/m-settings-shortcuts.png` });

    await page.click("#hotkey-message");
    check("clicking starts listening", (await text(page, "#hotkey-message")).includes("Press your shortcut") && await page.evaluate(() => document.querySelector("#hotkey-message").classList.contains("is-recording")));
    check("real shortcuts are paused while listening", !(await registered(app, "Control+Q")) && !(await registered(app, "Control+Y")));
    await page.keyboard.press("Meta+c");
    await page.waitForSelector("#hotkey-error:not(.hidden)");
    check("Copy is refused with a reason, and it keeps listening", (await text(page, "#hotkey-error")).includes("Copy") && (await text(page, "#hotkey-message")).includes("Press your shortcut"), await text(page, "#hotkey-error"));
    await page.keyboard.press("q");
    check("a lone key is refused", (await text(page, "#hotkey-error")).includes("one modifier key"));
    await page.keyboard.press("Control+Shift+q");
    check("two modifiers are refused", (await text(page, "#hotkey-error")).includes("one modifier key"));
    await page.keyboard.press("Shift+q");
    check("Shift + letter is refused", (await text(page, "#hotkey-error")).includes("capitals"), await text(page, "#hotkey-error"));
    await page.keyboard.press("Escape");
    check("Escape cancels and nothing changed", (await keycapText(page, "#hotkey-message")) === "⌃ Q" && (await registered(app, "Control+Q")) && (await registered(app, "Control+Y")));

    await page.click("#hotkey-message");
    await page.keyboard.press("Control+j");
    await page.waitForSelector("#hotkey-success:not(.hidden)");
    check("pressing Control+J sets it", (await keycapText(page, "#hotkey-message")) === "⌃ J" && (await text(page, "#hotkey-success")).includes("Message shortcut saved"));
    check("the system now listens for Control+J, no longer Control+Q",
      (await registered(app, "Control+J")) && !(await registered(app, "Control+Q")) && (await registered(app, "Control+Y")));
    const saved = JSON.parse(fs.readFileSync(path.join(PROFILE, "prefs.json"), "utf8"));
    check("the choice is saved to disk", saved.hotkeys.message === "Control+J" && saved.hotkeys.email === "Control+Y", JSON.stringify(saved));

    await page.click("#hotkey-email");
    await page.keyboard.press("Control+j");
    await page.waitForSelector("#hotkey-error:not(.hidden)");
    check("Email can't reuse the Message shortcut", (await text(page, "#hotkey-error")).includes("already used for Message"), await text(page, "#hotkey-error"));
    check("after that refusal it stops listening and nothing changed", (await keycapText(page, "#hotkey-email")) === "⌃ Y");
    await page.click("#hotkey-email");
    await page.keyboard.press("Meta+n");
    await page.waitForSelector("#hotkey-warning:not(.hidden)");
    check("a commonly used shortcut is allowed with a warning", (await keycapText(page, "#hotkey-email")) === "⌘ N" && (await text(page, "#hotkey-warning")).includes("used by many apps"), await text(page, "#hotkey-warning"));
    check("Command+N is registered", await registered(app, "Command+N"));

    await page.click("#hotkey-reset-email");
    await page.waitForSelector("#hotkey-success:not(.hidden)");
    check("Reset restores the default", (await keycapText(page, "#hotkey-email")) === "⌃ Y" && (await registered(app, "Control+Y")) && !(await registered(app, "Command+N")));

    await page.click("#hotkey-message");
    await page.mouse.click(700, 120);
    check("clicking away cancels listening", !(await page.evaluate(() => document.querySelector("#hotkey-message").classList.contains("is-recording"))) && (await registered(app, "Control+J")));

    await page.click("#nav-home");
    check("dashboard chips follow the new shortcut", (await keycapText(page, "#chip-message")) === "⌃ J", await keycapText(page, "#chip-message"));

    // The calendar's fill-in animation must not replay on later refreshes
    await page.click("#nav-history");
    await page.click("#nav-home");
    await settled(page);
    check("the calendar doesn't re-animate when the dashboard refreshes",
      !(await page.evaluate(() => document.querySelector("#calendar").classList.contains("is-revealing"))));
    check("and every square is fully visible", await page.evaluate(() =>
      [...document.querySelectorAll("#calendar .cell")].every((c) => getComputedStyle(c).opacity === "1")));

    // ---- Menu-bar menu and the General switches ----
    const menuLabels = await app.evaluate(() => global.__polish.tray.template().map((i) => i.label || "---"));
    check("menu-bar menu lists the real shortcuts", menuLabels.includes("Message rewrite:  ⌃ J") && menuLabels.includes("Email rewrite:  ⌃ Y"), menuLabels.join(" | "));
    check("menu-bar menu has Open, Pause and Quit", ["Open PolishAI", "Pause shortcuts", "Quit PolishAI"].every((l) => menuLabels.includes(l)), menuLabels.join(" | "));
    check("start at login is explained as installed-app only in development", menuLabels.some((l) => l.includes("installed app only")), menuLabels.join(" | "));

    await page.click("#nav-settings");
    await page.waitForSelector("#toggle-shortcuts");
    await page.waitForFunction(() => document.querySelector("#general-note") && !document.querySelector("#general-note").classList.contains("hidden"), null, { timeout: 8000 });
    check("Shortcuts on is switched on", await page.isChecked("#toggle-shortcuts"));
    check("Start at login is off and disabled with an explanation in development",
      !(await page.isChecked("#toggle-login")) && (await page.isDisabled("#toggle-login")) && (await text(page, "#general-note")).includes("installed app"));
    await page.screenshot({ path: `${SHOTS}/o-settings-general.png` });

    await page.locator("label[for=toggle-shortcuts]").click();
    await page.waitForFunction(() => !document.querySelector("#toggle-shortcuts").checked, null, { timeout: 8000 });
    check("switching Shortcuts off releases both shortcuts", !(await registered(app, "Control+J")) && !(await registered(app, "Control+Y")));
    check("...saves it", JSON.parse(fs.readFileSync(path.join(PROFILE, "prefs.json"), "utf8")).paused === true);
    check("...and the menu-bar menu shows Pause ticked",
      await app.evaluate(() => global.__polish.tray.template().find((i) => i.label === "Pause shortcuts").checked === true));
    await page.click("#hotkey-message");
    await page.keyboard.press("Escape");
    check("recording a shortcut never switches paused shortcuts back on", !(await registered(app, "Control+J")));
    await page.click("#nav-home");
    await page.waitForSelector("#paused-notice:not(.hidden)", { timeout: 8000 });
    check("the dashboard says shortcuts are paused", (await text(page, "#paused-notice")).includes("paused"));
    await page.screenshot({ path: `${SHOTS}/p-dashboard-paused.png` });
    await page.click("#resume-btn");
    await page.waitForFunction(() => document.querySelector("#paused-notice").classList.contains("hidden"), null, { timeout: 8000 });
    check("Turn them on resumes them", (await registered(app, "Control+J")) && (await registered(app, "Control+Y")));

    // the menu bar changes the same switch, and the page follows
    await app.evaluate(() => global.__polish.general.setPaused(true));
    await page.click("#nav-settings");
    await page.waitForFunction(() => !document.querySelector("#toggle-shortcuts").checked, null, { timeout: 8000 });
    check("pausing from the menu bar updates the Settings switch", !(await page.isChecked("#toggle-shortcuts")));
    await app.evaluate(() => global.__polish.general.setPaused(false));
    await page.waitForFunction(() => document.querySelector("#toggle-shortcuts").checked, null, { timeout: 8000 });
    check("and resuming from the menu bar too", (await registered(app, "Control+J")));
    await app.evaluate(() => global.__polish.general.setPaused(true));

    // ---- Permissions ----
    await page.click("#nav-settings");
    await page.waitForFunction(() => document.querySelector("#permission-status").textContent.startsWith("Allowed"), null, { timeout: 8000 });
    check("permission shows as allowed", !(await visible(page, "#permission-open")));
    await app.evaluate(() => { global.__polish.fake.state.trusted = false; });
    await page.click("#nav-home");
    await page.click("#nav-settings");
    await page.waitForFunction(() => document.querySelector("#permission-status").textContent.startsWith("Not allowed"), null, { timeout: 8000 });
    check("a missing permission is explained, with a button to fix it", await visible(page, "#permission-open"));
    await page.click("#nav-home");
    await page.waitForSelector("#permission-notice:not(.hidden)", { timeout: 8000 });
    check("the dashboard also asks for the permission", (await text(page, "#permission-notice")).includes("Accessibility"));
    await page.screenshot({ path: `${SHOTS}/q-dashboard-permission.png` });
    await page.click("#nav-settings");
    const noPerm = await app.evaluate(() => global.__polish.run("message"));
    check("without permission, pressing a shortcut does nothing to other apps", noPerm.status === "no-permission");
    await app.evaluate(() => { global.__polish.fake.state.trusted = true; });
    await page.click("#nav-home");
    await page.waitForFunction(() => document.querySelector("#permission-notice").classList.contains("hidden"), null, { timeout: 8000 });
    check("the permission prompt goes away once allowed", true);
    await app.evaluate(() => global.__polish.general.setPaused(false));

    // ---- The real flow with pretend keys, against the live backend ----
    await app.evaluate(() => {
      const f = global.__polish.fake;
      f.board.text = "my clipboard from before";
      f.state.selection = "pls send the doc asap thx";
      f.state.frontApp = "Notes";
      f.state.pasted = [];
    });
    await page.click("#nav-home");
    await settled(page);
    // The pill goes top-middle of the screen, wherever the mouse is
    const hudCheck = await app.evaluate(async () => {
      const { hud, screen } = global.__polish;
      hud.show("busy", "Polishing...");
      await new Promise((r) => setTimeout(r, 600));
      const bounds = hud.bounds();
      const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
      hud.hide();
      return { bounds, area };
    });
    const hb = hudCheck.bounds;
    check("the pill is on screen", !!hb, JSON.stringify(hudCheck));
    check("it's centred left-to-right on the screen", hb && Math.abs(hb.x + hb.width / 2 - (hudCheck.area.x + hudCheck.area.width / 2)) <= 1, JSON.stringify(hudCheck));
    check("it's at the top, just under the menu bar", hb && hb.y >= hudCheck.area.y && hb.y <= hudCheck.area.y + 30, JSON.stringify(hudCheck));
    const done = await app.evaluate(() => global.__polish.run("email"));
    check("a rewrite runs end to end", done.status === "done" && done.usedToday === 1 && done.dailyLimit === 20, JSON.stringify(done));
    const after = await app.evaluate(() => ({ pasted: global.__polish.fake.state.pasted, board: global.__polish.fake.board.text }));
    check("the rewritten email was pasted back", after.pasted.length === 1 && after.pasted[0].length > 20 && after.pasted[0] !== "pls send the doc asap thx", JSON.stringify(after.pasted));
    check("the user's clipboard came back untouched", after.board === "my clipboard from before");
    await page.waitForFunction(() => document.querySelector("#key-notice-text").textContent.includes("1 of 20"), null, { timeout: 20000 });
    check("the dashboard refreshed by itself", true);
    await page.waitForFunction(() => document.querySelector("#today-list .recent-text").textContent.length > 0 && !document.querySelector("#today-list").textContent.includes("pls send"), null, { timeout: 8000 });
    await page.click("#nav-history");
    await page.waitForSelector("#history-list .entry");
    await page.locator("#history-list .entry-head").first().click();
    const newest = await page.locator("#history-list .entry").first().locator(".entry-text").allInnerTexts();
    check("the new rewrite is first in History with both texts", newest[0] === "pls send the doc asap thx" && newest[1] === after.pasted[0], JSON.stringify(newest));
    await page.screenshot({ path: `${SHOTS}/n-history-new-entry.png` });

    await app.evaluate(() => { global.__polish.fake.state.selection = ""; global.__polish.fake.board.text = "keep me"; });
    const none = await app.evaluate(() => global.__polish.run("message"));
    const keep = await app.evaluate(() => global.__polish.fake.board.text);
    check("with nothing selected it says so and keeps the clipboard", none.status === "no-selection" && keep === "keep me");

    await app.evaluate(() => { global.__polish.fake.state.selection = "hello there"; global.__polish.fake.state.frontApp = "Notes"; });
    const switched = app.evaluate(async () => {
      const f = global.__polish.fake;
      const p = global.__polish.run("message");
      setTimeout(() => { f.state.frontApp = "Safari"; }, 50);
      return p;
    });
    const sw = await switched;
    const swPasted = await app.evaluate(() => global.__polish.fake.state.pasted.length);
    check("switching apps mid-rewrite never pastes into the wrong app", sw.status === "done" && swPasted === 1, JSON.stringify({ sw, swPasted }));

    // ---- Clear history, then log out ----
    await page.click("#nav-history");
    await page.waitForSelector("#history-list .entry");
    await page.click("#history-clear");
    check("Clear history asks for a second click", (await text(page, "#history-clear")).includes("Click again"));
    await page.click("#history-clear");
    await page.waitForFunction(() => document.querySelector("#history-list").textContent.includes("No history yet"), null, { timeout: 8000 });
    check("history is cleared", (await page.locator("#history-list .entry").count()) === 0);
    const files = fs.readdirSync(PROFILE).filter((f) => f.startsWith("history-"));
    check("history on disk is encrypted, not readable text", files.every((f) => !fs.readFileSync(path.join(PROFILE, f)).toString("latin1").includes("pls send")));

    await page.click("#nav-settings");
    await page.click("#logout-btn");
    await page.waitForSelector("#welcome-screen:not(.hidden)");
    const loggedOut = await app.evaluate(() => global.__polish.run("message"));
    check("shortcuts do nothing useful when logged out", loggedOut.status === "error" && loggedOut.code === "NOT_LOGGED_IN", JSON.stringify(loggedOut));
    await app.close();

    // ---- Shortcut choice survives a restart ----
    ({ app, page } = await launch());
    await page.waitForTimeout(1500);
    check("a changed shortcut is registered again after restart", (await registered(app, "Control+J")) && !(await registered(app, "Control+Q")));
    await app.evaluate(() => global.__polish.general.setPaused(true));
    await app.close();

    // ---- Paused stays paused after a restart ----
    ({ app, page } = await launch());
    await page.waitForTimeout(1500);
    check("shortcuts paused by the user stay paused after a restart", !(await registered(app, "Control+J")) && !(await registered(app, "Control+Y")));
    const menuAfter = await app.evaluate(() => global.__polish.tray.template().find((i) => i.label === "Pause shortcuts").checked);
    check("and the menu-bar menu knows it", menuAfter === true);
    await app.close();
  } finally {
    try {
      const t = aws("cognito-idp", "initiate-auth", "--auth-flow", "USER_PASSWORD_AUTH", "--client-id", CLIENT, "--auth-parameters", `USERNAME=${email},PASSWORD=${password}`).AuthenticationResult.AccessToken;
      const r = await fetch(URL_, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${t}` }, body: JSON.stringify({ action: "delete_my_data" }) });
      console.log("test data deleted:", JSON.stringify(await r.json()));
    } catch (e) { console.log("cleanup data:", e.message.slice(0, 100)); }
    try { aws("cognito-idp", "admin-delete-user", "--user-pool-id", POOL, "--username", email); console.log("test user deleted"); } catch (e) { console.log("cleanup user failed:", e.message.slice(0, 100)); }
    fs.rmSync(PROFILE, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `\n${failed} FAILED of ${results.length}` : `\nALL ${results.length} PASSED`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
