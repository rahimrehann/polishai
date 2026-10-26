// A brand-new person's whole journey, against the real app and the live backend.
const { _electron: electron } = require("playwright-core");
const { execFileSync } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "desktop-app");
const ELECTRON = path.join(APP, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron");
const POOL = "us-east-1_betXW17AO";
const PROFILE = fs.mkdtempSync("/tmp/polishai-e2e-profile-");
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const email = `polishai-e2e-${crypto.randomBytes(3).toString("hex")}@example.com`;
const password = "Aa1!" + crypto.randomBytes(8).toString("hex");
const newPassword = "Bb2@" + crypto.randomBytes(8).toString("hex");
const results = [];

function aws(...args) {
  const out = execFileSync("aws", ["--region", "us-east-1", ...args], { encoding: "utf8" });
  return out.trim() ? JSON.parse(out) : {};
}
function check(name, ok, detail = "") {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  [${String(detail).slice(0, 260)}]` : ""}`);
}
async function launch(extraEnv = {}) {
  const app = await electron.launch({
    executablePath: ELECTRON,
    args: [APP, `--user-data-dir=${PROFILE}`],
    env: { ...process.env, POLISHAI_FAKE_KEYS: "1", ...extraEnv },
    timeout: 60000,
  });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}
const visible = (page, sel) => page.locator(sel).first().isVisible();
const text = (page, sel) => page.locator(sel).first().innerText();
const settled = (page) => page.waitForFunction(() => !document.querySelector("#summary").textContent.startsWith("Loading"), null, { timeout: 30000 });
async function logIn(page, who, pw) {
  await page.click("#show-login-btn");
  await page.fill("#login-email", who);
  await page.fill("#login-password", pw);
  await page.click("#login-submit-btn");
}

async function main() {
  aws("cognito-idp", "admin-create-user", "--user-pool-id", POOL, "--username", email,
    "--user-attributes", `Name=email,Value=${email}`, "Name=email_verified,Value=true", "Name=name,Value=Sam Newuser", "--message-action", "SUPPRESS");
  aws("cognito-idp", "admin-set-user-password", "--user-pool-id", POOL, "--username", email, "--password", password, "--permanent");
  const sub = aws("cognito-idp", "admin-get-user", "--user-pool-id", POOL, "--username", email).UserAttributes.find((a) => a.Name === "sub").Value;
  let accountDeleted = false;

  try {
    let { app, page } = await launch();

    // ---- Privacy and terms, before anyone signs up ----
    await page.click("#welcome-privacy-link");
    check("privacy and terms open from the first screen", await visible(page, "#privacy-screen"));
    const legal = await text(page, ".legal");
    check("it says what is and isn't stored on our servers", legal.includes("We do not keep the text you write") && legal.includes("encrypted"));
    check("it warns that the free shared key goes through Google", legal.includes("Google") && legal.includes("free tier") && legal.includes("own key"));
    check("it explains how to delete everything", legal.includes("Delete my account"));
    await page.screenshot({ path: `${SHOTS}/r-privacy.png` });
    await page.click("#privacy-back-btn");
    check("back returns to the first screen", await visible(page, "#welcome-screen"));

    await page.click("#show-signup-link");
    await page.fill("#signup-name", "Typed Name");
    await page.click("#signup-privacy-link");
    await page.click("#privacy-back-btn");
    check("signup shows the agreement line, and the privacy notice keeps what was typed", (await page.inputValue("#signup-name")) === "Typed Name" && (await text(page, "#signup-screen .fine-print")).includes("agree"));
    await page.click("#signup-back-btn");

    // ---- Forgot password (the screens, and a real code request) ----
    await page.click("#show-login-btn");
    await page.fill("#login-email", email);
    await page.click("#forgot-link");
    check("Forgot password opens with the email already filled in", (await visible(page, "#forgot-screen")) && (await page.inputValue("#forgot-email")) === email);
    await page.click("#forgot-back-btn");
    check("and goes back to log in", await visible(page, "#login-screen"));
    await page.click("#forgot-link");
    await page.fill("#forgot-email", "");
    await page.click("#forgot-submit-btn");
    check("sending a code needs an email", (await text(page, "#forgot-error")).includes("Enter your email"));
    await page.fill("#forgot-email", email);
    await page.click("#forgot-submit-btn");
    await page.waitForSelector("#reset-screen:not(.hidden)", { timeout: 20000 });
    check("a code is requested and the reset screen opens", (await text(page, "#reset-info")).includes("we've sent a code") && (await page.inputValue("#reset-email")) === email);
    await page.screenshot({ path: `${SHOTS}/s-reset.png` });
    await page.click("#reset-submit-btn");
    check("the reset needs every field", (await text(page, "#reset-error")).includes("fill in all fields"));
    await page.fill("#reset-code", "123456");
    await page.fill("#reset-password", "weak");
    await page.click("#reset-submit-btn");
    check("a weak new password is explained before asking the server", (await text(page, "#reset-error")).includes("uppercase letter"));
    await page.fill("#reset-password", newPassword);
    await page.fill("#reset-code", "000000");
    await page.click("#reset-submit-btn");
    await page.waitForFunction(() => document.querySelector("#reset-error").textContent.length > 0 && !document.querySelector("#reset-error").classList.contains("hidden") && !document.querySelector("#reset-error").textContent.includes("fill"), null, { timeout: 20000 });
    check("a wrong code is rejected in plain words", /isn't right|expired/.test(await text(page, "#reset-error")), await text(page, "#reset-error"));
    await page.click("#reset-resend-link");
    await page.waitForFunction(() => document.querySelector("#reset-info").textContent.includes("new code"), null, { timeout: 20000 });
    check("a new code can be requested", true);
    await page.click("#reset-back-btn");
    await page.click("#forgot-back-btn");

    // ---- First login: the getting-started guide ----
    await page.fill("#login-password", password);
    await page.click("#login-submit-btn");
    await page.waitForSelector("#app-shell:not(.hidden)", { timeout: 30000 });
    await settled(page);
    await page.waitForSelector("#getting-started:not(.hidden)", { timeout: 10000 });
    const steps = await text(page, "#getting-started");
    check("a new user sees the three-step guide", steps.includes("Get started") && (await page.locator("#getting-started li").count()) === 3, steps);
    check("the guide shows their real shortcuts", (await page.locator("#step-keys-message .keycap").allInnerTexts()).join(" ") === "⌘ K" && (await page.locator("#step-keys-email .keycap").allInnerTexts()).join(" ") === "⌘ G");
    check("step one shows Done when the permission is allowed", (await text(page, "#step-access-state")) === "Done" && !(await visible(page, "#step-access-btn")));
    await app.evaluate(() => { global.__polish.fake.state.trusted = false; });
    await page.click("#nav-history");
    await page.click("#nav-home");
    await page.waitForSelector("#step-access-btn:not(.hidden)", { timeout: 10000 });
    check("without the permission, step one has the button and the page doesn't ask twice", !(await visible(page, "#permission-notice")) && (await visible(page, "#step-access-btn")));
    await page.screenshot({ path: `${SHOTS}/t-getting-started.png` });
    await app.evaluate(() => { global.__polish.fake.state.trusted = true; });

    // ---- The first rewrite makes the guide go away ----
    await app.evaluate(() => { const f = global.__polish.fake; f.state.selection = "need the report by friday pls"; f.state.frontApp = "Mail"; });
    const first = await app.evaluate(() => global.__polish.run("email"));
    check("the first rewrite works", first.status === "done", JSON.stringify(first));
    await page.waitForFunction(() => document.querySelector("#getting-started").classList.contains("hidden"), null, { timeout: 20000 });
    check("and the guide disappears by itself", true);

    // ---- Settings: version, password ----
    await page.click("#nav-settings");
    await page.waitForFunction(() => document.querySelector("#app-version").textContent.startsWith("PolishAI "), null, { timeout: 8000 });
    check("Settings shows the app version", (await text(page, "#app-version")) === "PolishAI 0.1.0", await text(page, "#app-version"));
    check("Settings has a privacy link that returns to Settings", await (async () => {
      await page.click("#settings-privacy-link");
      const opened = await visible(page, "#privacy-screen");
      await page.click("#privacy-back-btn");
      return opened && (await visible(page, "#settings-screen"));
    })());

    await page.click("#password-toggle");
    await page.click("#password-save");
    check("changing the password needs both fields", (await text(page, "#password-error")).includes("current password and a new one"));
    await page.fill("#password-old", password);
    await page.fill("#password-new", "weak");
    await page.click("#password-save");
    check("a weak new password is explained", (await text(page, "#password-error")).includes("uppercase letter"));
    await page.fill("#password-new", password);
    await page.click("#password-save");
    check("the same password is refused", (await text(page, "#password-error")).includes("different"));
    await page.fill("#password-old", "Wrong1!password");
    await page.fill("#password-new", newPassword);
    await page.click("#password-save");
    await page.waitForFunction(() => document.querySelector("#password-error").textContent.includes("isn't right"), null, { timeout: 20000 });
    check("a wrong current password is called that", true);
    await page.fill("#password-old", password);
    await page.click("#password-save");
    await page.waitForSelector("#password-success:not(.hidden)", { timeout: 20000 });
    check("the password changes for real", (await text(page, "#password-success")).includes("Password changed") && !(await visible(page, "#password-form")));

    await page.click("#logout-btn");
    await page.waitForSelector("#welcome-screen:not(.hidden)");
    await logIn(page, email, password);
    await page.waitForSelector("#login-error:not(.hidden)", { timeout: 20000 });
    check("the old password no longer works", (await text(page, "#login-error")) === "Incorrect email or password.", await text(page, "#login-error"));
    await page.fill("#login-password", newPassword);
    await page.click("#login-submit-btn");
    await page.waitForSelector("#app-shell:not(.hidden)", { timeout: 30000 });
    check("the new password works", true);
    await app.close();

    // ---- An out-of-date app is told to update ----
    ({ app, page } = await launch({ POLISHAI_FAKE_VERSION: "0.0.5" }));
    await page.waitForSelector("#app-shell:not(.hidden)", { timeout: 30000 });
    await page.waitForSelector("#update-notice:not(.hidden)", { timeout: 20000 });
    check("an old copy of the app shows an update notice", (await text(page, "#update-notice")).includes("out of date"), await text(page, "#update-notice"));
    check("with a download button", (await text(page, "#update-notice-btn")).includes("Download"));
    await page.screenshot({ path: `${SHOTS}/u-update-notice.png` });
    await app.evaluate(() => { const f = global.__polish.fake; f.state.selection = "hello there"; f.state.frontApp = "Notes"; f.state.pasted = []; });
    const blocked = await app.evaluate(() => global.__polish.run("message"));
    const nothingPasted = await app.evaluate(() => global.__polish.fake.state.pasted.length === 0);
    check("rewriting is refused for an old copy and nothing is pasted", blocked.status === "error" && blocked.code === "UPDATE_REQUIRED" && nothingPasted, JSON.stringify(blocked));
    await app.close();

    // ---- Deleting the account ----
    ({ app, page } = await launch());
    await page.waitForSelector("#app-shell:not(.hidden)", { timeout: 30000 });
    check("the guide stays away for someone who has already used the app", !(await visible(page, "#getting-started")));
    await page.click("#nav-settings");
    check("the delete form is hidden until asked for", !(await visible(page, "#delete-confirm")));
    await page.click("#delete-open");
    check("it asks for the email", await visible(page, "#delete-confirm"));
    await page.click("#delete-confirm-btn");
    check("an empty confirmation is refused", (await text(page, "#delete-error")).includes("Type your email"));
    await page.fill("#delete-email", "someone-else@example.com");
    await page.click("#delete-confirm-btn");
    await page.waitForFunction(() => document.querySelector("#delete-error").textContent.includes("doesn't match"), null, { timeout: 20000 });
    check("the wrong email deletes nothing", aws("cognito-idp", "admin-get-user", "--user-pool-id", POOL, "--username", email).Username !== undefined);
    await page.screenshot({ path: `${SHOTS}/v-delete.png` });
    await page.click("#delete-cancel");
    check("Cancel closes the form", !(await visible(page, "#delete-confirm")));
    await page.click("#delete-open");
    await page.fill("#delete-email", email.toUpperCase());
    await page.click("#delete-confirm-btn");
    await page.waitForSelector("#welcome-screen:not(.hidden)", { timeout: 30000 });
    accountDeleted = true;
    check("deleting returns to the first screen with a note", (await text(page, "#welcome-note")).includes("deleted"));

    let gone = false;
    try { aws("cognito-idp", "admin-get-user", "--user-pool-id", POOL, "--username", email); } catch { gone = true; }
    check("the login account is really gone", gone);
    const rows = aws("dynamodb", "query", "--table-name", "polishai-usage", "--key-condition-expression", "userId = :u", "--expression-attribute-values", JSON.stringify({ ":u": { S: sub } }), "--select", "COUNT").Count;
    check("their stats on the server are really gone", rows === 0, String(rows));
    const left = aws("dynamodb", "get-item", "--table-name", "polishai-users", "--key", JSON.stringify({ userId: { S: sub } }));
    check("their settings row is gone too", !left.Item);
    check("and the history file on this computer", fs.readdirSync(PROFILE).filter((f) => f.startsWith("history-")).length === 0);
    check("and the saved login", !fs.existsSync(path.join(PROFILE, "session.bin")));
    await logIn(page, email, newPassword);
    await page.waitForSelector("#login-error:not(.hidden)", { timeout: 20000 });
    check("they can't log in any more", (await text(page, "#login-error")) === "Incorrect email or password.");
    await app.close();
  } finally {
    if (!accountDeleted) {
      try { aws("cognito-idp", "admin-delete-user", "--user-pool-id", POOL, "--username", email); console.log("cleanup: test user deleted"); } catch (e) { console.log("cleanup user:", e.message.slice(0, 80)); }
      try { execFileSync("aws", ["--region", "us-east-1", "dynamodb", "delete-item", "--table-name", "polishai-users", "--key", JSON.stringify({ userId: { S: sub } })]); } catch {}
    }
    fs.rmSync(PROFILE, { recursive: true, force: true });
  }
  const failed = results.filter((r) => !r).length;
  console.log(failed ? `\n${failed} FAILED of ${results.length}` : `\nALL ${results.length} PASSED`);
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.error("E2E crashed:", e.message); process.exit(2); });
