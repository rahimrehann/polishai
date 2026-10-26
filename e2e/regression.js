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
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `  [${String(detail).slice(0, 200)}]` : ""}`);
}
async function launch() {
  const app = await electron.launch({ executablePath: ELECTRON, args: [APP, `--user-data-dir=${PROFILE}`],
    env: { ...process.env, POLISHAI_FAKE_KEYS: "1" }, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}
const visible = (page, id) => page.locator(`#${id}`).isVisible();
const text = (page, id) => page.locator(`#${id}`).innerText();
const settled = (page) => page.waitForFunction(() => !document.querySelector("#summary").textContent.startsWith("Loading"), null, { timeout: 30000 });

async function main() {
  aws("cognito-idp", "admin-create-user", "--user-pool-id", POOL, "--username", email,
    "--user-attributes", `Name=email,Value=${email}`, "Name=email_verified,Value=true", "Name=name,Value=Rahim Rehan", "--message-action", "SUPPRESS");
  aws("cognito-idp", "admin-set-user-password", "--user-pool-id", POOL, "--username", email, "--password", password, "--permanent");
  const sub = aws("cognito-idp", "admin-get-user", "--user-pool-id", POOL, "--username", email).UserAttributes.find((a) => a.Name === "sub").Value;

  try {
    let { app, page } = await launch();
    const size = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].getSize());
    check("window opens at the dashboard size", size[0] === 1100 && size[1] === 760, size.join("x"));
    check("welcome screen first", await visible(page, "welcome-screen"));
    await page.screenshot({ path: `${SHOTS}/a-welcome.png` });

    await page.click("#show-login-btn");
    await page.fill("#login-email", email);
    await page.fill("#login-password", password);
    await page.screenshot({ path: `${SHOTS}/b-login.png` });
    await page.click("#login-submit-btn");
    await page.waitForSelector("#app-shell:not(.hidden)", { timeout: 30000 });
    await settled(page);

    check("rail has the logo, History and Settings", (await page.locator(".rail button").count()) === 3);
    check("greeting uses the first name", /^(Good|Up).*, Rahim\.$/.test(await text(page, "greeting")), await text(page, "greeting"));
    check("new account sentence invites a first rewrite", (await text(page, "summary")).includes("Highlight text in any app"), await text(page, "summary"));
    check("shared key notice shows with the limit", (await text(page, "key-notice")).includes("0 of 20"), await text(page, "key-notice"));
    check("empty states are helpful", (await text(page, "today-list")).includes("No rewrites yet") && (await text(page, "app-list")).includes("shortcut"));
    check("calendar still draws 140 cells when empty", (await page.locator("#calendar .cell").count()) === 140);
    await page.screenshot({ path: `${SHOTS}/c-dashboard-empty.png` });

    await page.click("#nav-settings");
    await page.waitForFunction(() => document.querySelector("#settings-status").textContent.includes("of 20"), null, { timeout: 20000 });
    check("settings shows account email and shared-key status", (await text(page, "settings-email")) === email && (await text(page, "settings-status")).includes("shared Gemini key"));
    check("three providers offered, Gemini selected first", (await page.locator(".seg").count()) === 3
      && (await page.getAttribute('.seg[data-provider="gemini"]', "aria-checked")) === "true");
    check("free-key switch hidden when there is no own key", !(await visible(page, "settings-remove-btn")));
    await page.click('.seg[data-provider="openai"]');
    check("choosing OpenAI updates the label, placeholder and hint",
      (await text(page, "settings-key-label")).includes("OpenAI")
      && (await page.getAttribute("#settings-api-key", "placeholder")).includes("OpenAI")
      && (await text(page, "settings-key-hint")).includes("platform.openai.com"));
    check("only one provider is selected at a time", (await page.locator('.seg[aria-checked="true"]').count()) === 1);
    await page.screenshot({ path: `${SHOTS}/d-settings.png` });

    await page.fill("#settings-api-key", "not-a-real-key-1234567890");
    await page.click("#settings-save-btn");
    await page.waitForSelector("#settings-error:not(.hidden)", { timeout: 40000 });
    check("fake OpenAI key rejected by name", (await text(page, "settings-error")).includes("OpenAI key doesn't seem to work"), await text(page, "settings-error"));
    await page.click('.seg[data-provider="anthropic"]');
    check("switching provider clears the old error", !(await visible(page, "settings-error")));
    await page.fill("#settings-api-key", "");
    await page.click("#settings-save-btn");
    check("empty key asks for it by provider name", (await text(page, "settings-error")).includes("Anthropic API key first"));
    await page.fill("#settings-api-key", "not-a-real-key-1234567890");
    await page.click("#settings-save-btn");
    await page.waitForFunction(() => document.querySelector("#settings-error").textContent.includes("Anthropic key doesn't seem"), null, { timeout: 40000 });
    check("fake Anthropic key rejected by name", true);
    await page.click('.seg[data-provider="gemini"]');
    await page.fill("#settings-api-key", "not-a-real-key-1234567890");
    await page.click("#settings-save-btn");
    await page.waitForFunction(() => document.querySelector("#settings-error").textContent.includes("Gemini key doesn't seem"), null, { timeout: 40000 });
    check("fake Gemini key rejected by name", true);
    check("still on the shared key after failed saves", (await text(page, "settings-status")).includes("shared Gemini key"));
    await page.click("#settings-back-btn");
    check("back returns to insights", await visible(page, "dashboard-screen"));
    await app.close();

    // Seed lots of fake history, then reopen.
    const expected = JSON.parse(execFileSync(PY, [path.join(__dirname, "seed_demo.py"), sub], { encoding: "utf8" }));
    ({ app, page } = await launch());
    await page.waitForSelector("#app-shell:not(.hidden)", { timeout: 30000 });
    await settled(page);
    await page.waitForTimeout(1800); // let the calendar reveal finish

    check("rewrites figure", (await text(page, "stat-rewrites")) === expected.rewrites.toLocaleString(), `${await text(page, "stat-rewrites")} vs ${expected.rewrites}`);
    check("words figure", (await text(page, "stat-words")) === expected.words.toLocaleString(), `${await text(page, "stat-words")} vs ${expected.words}`);
    const secs = expected.rewrites * 25, m = Math.floor(secs / 60), h = Math.floor(m / 60);
    check("time saved figure", (await text(page, "stat-time")) === (h > 0 ? `${h}h ${m % 60}m` : `${m}m`), await text(page, "stat-time"));
    check("streak figure", (await text(page, "stat-streak")) === String(expected.streak), await text(page, "stat-streak"));
    check("sentence reports the week", (await text(page, "summary")).includes(`${expected.weekRewrites} rewrites`) || (await text(page, "summary")).includes("polished"), await text(page, "summary"));
    check("calendar has 140 cells, with active days shaded", (await page.locator("#calendar .cell[data-level]:not([data-level='0']):not(.is-future)").count()) === expected.windowActive,
      `${await page.locator("#calendar .cell:not([data-level='0']):not(.is-future)").count()} vs ${expected.windowActive}`);
    check("today is marked", (await page.locator("#calendar .cell.is-today").count()) === 1);
    check("calendar cells have readable tooltips", /: \d+ rewrites?$/.test((await page.locator("#calendar .cell.is-today").getAttribute("title")) || ""));
    check("month labels drawn", (await page.locator("#calendar-months span").count()) >= 4);
    check("longest streak note", (await text(page, "streak-note")).startsWith("Longest streak"), await text(page, "streak-note"));
    const formatText = await text(page, "format-key");
    check("format split lists both", formatText.includes("Message") && formatText.includes("Email") && formatText.includes("%"), formatText);
    check("top app first", (await page.locator("#app-list .app-row").first().innerText()).includes("Slack"));
    check("seven bars", (await page.locator("#week-bars .week-col").count()) === 7);
    const recent = await text(page, "today-list");
    check("recent list has 8 rows with no rewrite text", (await page.locator("#today-list .recent-row").count()) === 8 && /Email|Message/.test(recent));
    check("key notice still visible", await visible(page, "key-notice"));
    await page.screenshot({ path: `${SHOTS}/e-dashboard-full.png` });

    await page.evaluate(() => document.querySelector(".stage").scrollTo(0, 99999));
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${SHOTS}/g-dashboard-bottom.png` });
    await page.evaluate(() => document.querySelector(".stage").scrollTo(0, 0));

    // Narrow window layout
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(880, 700));
    await page.waitForTimeout(500);
    const overflow = await page.evaluate(() => document.querySelector(".stage").scrollWidth > document.querySelector(".stage").clientWidth);
    check("no sideways scrolling at the narrowest width", !overflow);
    const cell = await page.evaluate(() => Math.round(document.querySelector("#calendar .cell").getBoundingClientRect().width));
    const wraps = await page.evaluate(() => [...document.querySelectorAll(".figure-value")].some((n) => n.getBoundingClientRect().height > 60));
    check("big numbers never wrap when narrow", !wraps);
    check("calendar cells stay a sensible size when narrow", cell >= 14 && cell <= 34, `${cell}px`);
    await page.screenshot({ path: `${SHOTS}/f-dashboard-narrow.png` });

    // Pretend the user saved their own Anthropic key, then switch back to the free key.
    aws("dynamodb", "update-item", "--table-name", "polishai-users", "--key", JSON.stringify({ userId: { S: sub } }),
      "--update-expression", "SET apiProvider = :p, apiKeyEnc = :e, apiKeyLast4 = :l",
      "--expression-attribute-values", JSON.stringify({ ":p": { S: "anthropic" }, ":e": { S: "x" }, ":l": { S: "9z9z" } }));
    await page.click("#nav-settings");
    await page.waitForFunction(() => document.querySelector("#settings-status").textContent.includes("Anthropic"), null, { timeout: 20000 });
    const own = await text(page, "settings-status");
    check("settings shows the saved provider and last 4", own.includes("own Anthropic key") && own.includes("9z9z") && own.includes("No daily limit"), own);
    check("the provider picker shows the saved provider", (await page.getAttribute('.seg[data-provider="anthropic"]', "aria-checked")) === "true");
    check("switch-back button appears", await visible(page, "settings-remove-btn"));
    await page.screenshot({ path: `${SHOTS}/h-settings-own-key.png` });
    await page.click("#settings-remove-btn");
    await page.waitForFunction(() => document.querySelector("#settings-status").textContent.includes("shared Gemini key"), null, { timeout: 20000 });
    check("switching back returns to the shared key", !(await visible(page, "settings-remove-btn")) && (await text(page, "settings-success")).includes("free daily rewrites"));
    await page.click("#logout-btn");
    await page.waitForSelector("#welcome-screen:not(.hidden)", { timeout: 15000 });
    check("log out lives in settings and works", await visible(page, "welcome-screen"));
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
