// Takes the README screenshots from the real app: a throwaway account with sample data, nothing personal.
// Writes to ../docs/images. Needs AWS access like the other end-to-end scripts. Run: node screenshots.js
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
const PROFILE = fs.mkdtempSync("/tmp/polishai-shots-profile-");
const OUT = path.join(ROOT, "docs", "images");
fs.mkdirSync(OUT, { recursive: true });

const email = `polishai-shots-${crypto.randomBytes(3).toString("hex")}@example.com`;
const password = "Aa1!" + crypto.randomBytes(8).toString("hex");

function aws(...args) {
  const out = execFileSync("aws", ["--region", "us-east-1", ...args], { encoding: "utf8" });
  return out.trim() ? JSON.parse(out) : {};
}
async function launch(env = {}) {
  const app = await electron.launch({ executablePath: ELECTRON, args: [APP, `--user-data-dir=${PROFILE}`],
    env: { ...process.env, POLISHAI_FAKE_KEYS: "1", ...env }, timeout: 60000 });
  const page = await app.firstWindow();
  await page.waitForLoadState("domcontentloaded");
  return { app, page };
}
const shot = (page, name) => page.screenshot({ path: path.join(OUT, name) });
const settled = (page) => page.waitForFunction(() => !document.querySelector("#summary").textContent.startsWith("Loading"), null, { timeout: 30000 });

async function main() {
  aws("cognito-idp", "admin-create-user", "--user-pool-id", POOL, "--username", email,
    "--user-attributes", `Name=email,Value=${email}`, "Name=email_verified,Value=true", "Name=name,Value=Alex Morgan", "--message-action", "SUPPRESS");
  aws("cognito-idp", "admin-set-user-password", "--user-pool-id", POOL, "--username", email, "--password", password, "--permanent");
  const sub = aws("cognito-idp", "admin-get-user", "--user-pool-id", POOL, "--username", email).UserAttributes.find((a) => a.Name === "sub").Value;
  try {
    let { app, page } = await launch();
    await shot(page, "welcome.png");
    await page.click("#show-login-btn");
    await page.fill("#login-email", email);
    await page.fill("#login-password", password);
    await page.click("#login-submit-btn");
    await page.waitForSelector("#app-shell:not(.hidden)", { timeout: 30000 });
    await settled(page);
    await page.waitForTimeout(800);
    await shot(page, "getting-started.png");
    await app.close();

    execFileSync(PY, [path.join(__dirname, "seed_demo.py"), sub], { encoding: "utf8" });
    ({ app, page } = await launch({ POLISHAI_DEMO: "1" }));
    await page.waitForSelector("#app-shell:not(.hidden)", { timeout: 30000 });
    await settled(page);
    await page.waitForTimeout(2200);
    await shot(page, "dashboard.png");
    await page.evaluate(() => document.querySelector(".stage").scrollTo(0, 900));
    await page.waitForTimeout(600);
    await shot(page, "dashboard-more.png");
    await page.evaluate(() => document.querySelector(".stage").scrollTo(0, 0));

    await page.click("#nav-history");
    await page.waitForSelector("#history-screen:not(.hidden)");
    await page.waitForTimeout(600);
    const first = page.locator("#history-screen [aria-expanded], #history-screen .history-row, #history-screen summary").first();
    if (await first.count()) await first.click().catch(() => {});
    await page.waitForTimeout(500);
    await shot(page, "history.png");

    await page.click("#nav-settings");
    await page.waitForFunction(() => document.querySelector("#settings-status").textContent.includes("of 20") || document.querySelector("#settings-status").textContent.includes("free"), null, { timeout: 20000 });
    await page.evaluate(() => { document.querySelector("#settings-email").textContent = "alex@example.com"; });
    await page.waitForTimeout(500);
    await shot(page, "settings.png");
    await app.close();
  } finally {
    try { execFileSync("aws", ["--region", "us-east-1", "cognito-idp", "admin-delete-user", "--user-pool-id", POOL, "--username", email]); } catch (e) {}
    console.log("test user deleted");
  }
}
main().catch((e) => { console.error("crashed:", e.message); process.exit(1); });
