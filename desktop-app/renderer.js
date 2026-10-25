// Runs in the window. It can't use the network or Node; everything goes
// through window.polish (see preload.js).

const S = window.PolishStats;
const PASSWORD_HINT = "Use at least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol.";
const CALENDAR_WEEKS = 20;
const APP_VIEWS = ["dashboard-screen", "settings-screen"];

const $ = (id) => document.getElementById(id);

function showScreen(id) {
  const inApp = APP_VIEWS.includes(id);
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  $("app-shell").classList.toggle("hidden", !inApp);

  if (inApp) {
    APP_VIEWS.forEach((view) => $(view).classList.toggle("hidden", view !== id));
    $("nav-settings").classList.toggle("is-active", id === "settings-screen");
  } else {
    $(id).classList.remove("hidden");
  }
}

function showMessage(id, message) {
  const el = $(id);
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideMessage(...ids) {
  ids.forEach((id) => $(id).classList.add("hidden"));
}

// Calls the background process and turns { ok, data, error } into a normal
// result or a thrown error with a friendly message.
async function rpc(fn, ...args) {
  const result = await fn(...args);
  if (!result.ok) {
    const error = new Error(result.error.message);
    error.code = result.error.code;
    throw error;
  }
  return result.data;
}

function isSessionError(error) {
  return ["SESSION_EXPIRED", "NOT_LOGGED_IN", "UNAUTHORIZED"].includes(error.code);
}

function goToLoginExpired() {
  hideMessage("login-error");
  showMessage("login-info", "Your session expired. Please log in again.");
  showScreen("login-screen");
}

function passwordIsStrong(password) {
  return (
    password.length >= 8 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /[0-9]/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

async function withButton(button, busyLabel, task) {
  const label = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.textContent = label;
  }
}

let profile = null;

// ----- Welcome -----

$("show-login-btn").addEventListener("click", () => {
  hideMessage("login-error", "login-info");
  showScreen("login-screen");
});

$("show-signup-link").addEventListener("click", () => {
  hideMessage("signup-error");
  showScreen("signup-screen");
});

// ----- Login -----

$("login-back-btn").addEventListener("click", () => showScreen("welcome-screen"));

function openConfirmScreen(email, info) {
  $("confirm-email").value = email || "";
  $("confirm-code").value = "";
  hideMessage("confirm-error", "confirm-info");
  if (info) showMessage("confirm-info", info);
  showScreen("confirm-screen");
}

$("login-confirm-link").addEventListener("click", () => {
  openConfirmScreen($("login-email").value.trim());
});

$("login-submit-btn").addEventListener("click", async () => {
  hideMessage("login-error", "login-info");
  const email = $("login-email").value.trim();
  const password = $("login-password").value;

  if (!email || !password) {
    showMessage("login-error", "Please enter your email and password.");
    return;
  }

  await withButton($("login-submit-btn"), "Logging in...", async () => {
    try {
      profile = await rpc(window.polish.auth.login, email, password);
      $("login-password").value = "";
      await openDashboard();
    } catch (err) {
      if (err.code === "UserNotConfirmedException") {
        openConfirmScreen(email, "Your email isn't confirmed yet. Enter the code we sent you.");
        return;
      }
      showMessage("login-error", err.message);
    }
  });
});

// ----- Signup -----

$("signup-back-btn").addEventListener("click", () => showScreen("welcome-screen"));

$("signup-submit-btn").addEventListener("click", async () => {
  hideMessage("signup-error");
  const name = $("signup-name").value.trim();
  const email = $("signup-email").value.trim();
  const password = $("signup-password").value;

  if (!name || !email || !password) {
    showMessage("signup-error", "Please fill in all fields.");
    return;
  }
  if (!passwordIsStrong(password)) {
    showMessage("signup-error", PASSWORD_HINT);
    return;
  }

  await withButton($("signup-submit-btn"), "Signing up...", async () => {
    try {
      await rpc(window.polish.auth.signup, name, email, password);
      $("signup-password").value = "";
      openConfirmScreen(email, "We emailed you a confirmation code.");
    } catch (err) {
      showMessage("signup-error", err.message);
    }
  });
});

// ----- Confirm email -----

$("confirm-back-btn").addEventListener("click", () => showScreen("signup-screen"));

$("confirm-submit-btn").addEventListener("click", async () => {
  hideMessage("confirm-error", "confirm-info");
  const email = $("confirm-email").value.trim();
  const code = $("confirm-code").value.trim();

  if (!email || !code) {
    showMessage("confirm-error", "Please enter your email and the confirmation code.");
    return;
  }

  await withButton($("confirm-submit-btn"), "Confirming...", async () => {
    try {
      await rpc(window.polish.auth.confirm, email, code);
      $("login-email").value = email;
      hideMessage("login-error");
      showMessage("login-info", "Email confirmed. Log in to continue.");
      showScreen("login-screen");
    } catch (err) {
      showMessage("confirm-error", err.message);
    }
  });
});

$("confirm-resend-link").addEventListener("click", async () => {
  hideMessage("confirm-error", "confirm-info");
  const email = $("confirm-email").value.trim();
  if (!email) {
    showMessage("confirm-error", "Enter your email first.");
    return;
  }
  try {
    await rpc(window.polish.auth.resend, email);
    showMessage("confirm-info", "We sent you a new code.");
  } catch (err) {
    showMessage("confirm-error", err.message);
  }
});

// ----- Dashboard -----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const REFRESH_AFTER_MS = 10000;

let calendarRevealed = false;
let lastLoadedAt = 0;

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatClock(iso) {
  const date = new Date(iso);
  if (date.toDateString() === new Date().toDateString()) {
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function firstName(name) {
  if (!name || name.includes("@")) return "";
  return name.trim().split(/\s+/)[0];
}

function renderHeader(totals, days, today) {
  const name = firstName(profile.name);
  $("greeting").textContent = `${S.greeting(today.getHours())}${name ? `, ${name}` : ""}.`;
  $("summary").textContent = S.summarySentence({ totals, days, today });
}

function renderLedger(totals, map, today) {
  const rewrites = Number(totals.rewrites) || 0;
  const streak = S.currentStreak(map, today);
  $("stat-rewrites").textContent = rewrites.toLocaleString();
  $("stat-words").textContent = (Number(totals.inputWords) || 0).toLocaleString();
  $("stat-time").textContent = S.formatDuration(rewrites * S.SECONDS_SAVED_PER_REWRITE);
  $("stat-streak").textContent = String(streak);
}

function renderCalendar(map, today) {
  const weeks = S.calendarWeeks(map, CALENDAR_WEEKS, today);
  const calendar = $("calendar");
  const months = $("calendar-months");
  calendar.innerHTML = "";
  months.innerHTML = "";
  calendar.style.setProperty("--weeks", String(CALENDAR_WEEKS));
  months.style.setProperty("--weeks", String(CALENDAR_WEEKS));

  weeks.forEach((week, index) => {
    const startMonth = week[0].month;
    const previousMonth = index === 0 ? -1 : weeks[index - 1][0].month;
    if (startMonth !== previousMonth && !(index === 0 && week[0].day > 20)) {
      const label = el("span", "", MONTHS[startMonth]);
      label.style.gridColumn = String(index + 1);
      months.appendChild(label);
    }

    week.forEach((day) => {
      const cell = el("span", "cell");
      cell.dataset.level = String(day.level);
      cell.style.setProperty("--col", String(index));
      if (day.future) cell.classList.add("is-future");
      if (day.today) cell.classList.add("is-today");
      if (!day.future) {
        const date = S.fromDateString(day.date).toLocaleDateString([], { month: "short", day: "numeric" });
        cell.title = `${date}: ${S.plural(day.count, "rewrite")}`;
      }
      calendar.appendChild(cell);
    });
  });

  if (!calendarRevealed) {
    calendarRevealed = true;
    calendar.classList.add("is-revealing");
  }

  const longest = S.longestStreak(map);
  $("streak-note").textContent = longest > 0 ? `Longest streak: ${S.plural(longest, "day")}` : "";
}

function renderMix(totals, apps) {
  const message = Number(totals.fmt_message) || 0;
  const email = Number(totals.fmt_email) || 0;
  const total = message + email;

  const split = $("format-split");
  const key = $("format-key");
  split.innerHTML = "";
  key.innerHTML = "";

  if (total === 0) {
    key.appendChild(el("p", "empty-text", "Message and email rewrites will show up here."));
  } else {
    const messageBar = el("span", "split-message");
    const emailBar = el("span", "split-email");
    messageBar.style.width = `${S.percent(message, total)}%`;
    emailBar.style.width = `${100 - S.percent(message, total)}%`;
    split.append(messageBar, emailBar);

    [["Message", "swatch-message", message], ["Email", "swatch-email", email]].forEach(([label, swatch, count]) => {
      const row = el("div", "split-key");
      const left = el("span");
      left.append(el("span", `swatch ${swatch}`), document.createTextNode(label));
      row.append(left, el("span", "", `${count.toLocaleString()} (${S.percent(count, total)}%)`));
      key.appendChild(row);
    });
  }

  const list = $("app-list");
  list.innerHTML = "";
  if (!apps.length) {
    list.appendChild(el("p", "empty-text", "Apps appear here once you rewrite with the desktop shortcut."));
    return;
  }
  apps.slice(0, 5).forEach((app) => {
    const row = el("div", "app-row");
    row.append(el("span", "", app.name), el("span", "", app.rewrites.toLocaleString()));
    list.appendChild(row);
  });
}

function renderWeek(map, today) {
  const days = S.lastDays(map, 7, today);
  const max = Math.max(1, ...days.map((d) => d.count));
  const bars = $("week-bars");
  bars.innerHTML = "";

  days.forEach((day) => {
    const col = el("div", "week-col");
    if (day.date === S.toDateString(today)) col.classList.add("is-today");
    const bar = el("div", "week-bar");
    bar.style.height = `${(day.count / max) * 100}%`;
    const track = el("div", "week-track");
    track.appendChild(bar);
    col.title = `${S.plural(day.count, "rewrite")}`;
    col.append(el("span", "week-value", day.count > 0 ? String(day.count) : ""), track, el("span", "week-label", WEEKDAYS[day.weekday]));
    bars.appendChild(col);
  });

  const total = days.reduce((sum, d) => sum + d.count, 0);
  $("week-note").textContent = S.plural(total, "rewrite");
}

function renderRecent(items) {
  const list = $("today-list");
  list.innerHTML = "";

  if (items.length === 0) {
    list.appendChild(el("p", "empty-text", "No rewrites yet. Highlight text in any app and press a shortcut."));
    return;
  }

  items.forEach((item) => {
    const row = el("div", "recent-row");
    const kind = item.format === "email" ? "Email" : "Message";
    const detail = [S.plural(item.inputWords, "word"), item.app].filter(Boolean).join(", ");
    const main = el("span", "recent-main", kind);
    const meta = el("span", "recent-meta", `${detail} - ${formatClock(item.at)}`);
    row.append(main, meta);
    list.appendChild(row);
  });
}

function renderKeyNotice(settings) {
  const notice = $("key-notice");
  if (!settings || settings.hasCustomKey) {
    notice.classList.add("hidden");
    return;
  }
  $("key-notice-text").textContent =
    `You're using PolishAI's shared Gemini key: ${settings.usedToday} of ${settings.dailyLimit} free rewrites used today.`;
  notice.classList.remove("hidden");
}

async function loadDashboard() {
  const today = new Date();
  try {
    const [stats, recent, settings] = await Promise.all([
      rpc(window.polish.api.stats),
      rpc(window.polish.api.recent, 10),
      rpc(window.polish.api.settings).catch((err) => {
        if (isSessionError(err)) throw err;
        return null;
      }),
    ]);

    const totals = stats.totals || {};
    const days = stats.days || [];
    const map = S.buildDayMap(days);

    renderHeader(totals, days, today);
    renderLedger(totals, map, today);
    renderCalendar(map, today);
    renderMix(totals, stats.apps || []);
    renderWeek(map, today);
    renderRecent(recent.items || []);
    renderKeyNotice(settings);
    lastLoadedAt = Date.now();
  } catch (err) {
    if (isSessionError(err)) return;
    $("summary").textContent = err.code === "NETWORK" ? err.message : "Couldn't load your insights. Try again in a moment.";
  }
}

async function openDashboard() {
  const name = firstName(profile.name);
  $("greeting").textContent = name ? `Welcome, ${name}.` : "Welcome.";
  $("summary").textContent = "Loading your insights...";
  showScreen("dashboard-screen");
  await loadDashboard();
}

$("nav-home").addEventListener("click", () => {
  showScreen("dashboard-screen");
  loadDashboard();
});

$("notice-settings").addEventListener("click", () => openSettings());

// Rewrites happen in other apps, so refresh when the window comes back.
window.addEventListener("focus", () => {
  const onDashboard = profile && !$("dashboard-screen").classList.contains("hidden") && !$("app-shell").classList.contains("hidden");
  if (onDashboard && Date.now() - lastLoadedAt > REFRESH_AFTER_MS) loadDashboard();
});

// ----- Settings -----

async function loadSettingsStatus() {
  const status = $("settings-status");
  const removeBtn = $("settings-remove-btn");
  status.textContent = "";
  removeBtn.classList.add("hidden");

  try {
    const settings = await rpc(window.polish.api.settings);
    if (settings.hasCustomKey) {
      status.textContent = `Using your own Gemini key (ending in ${settings.keyLast4 || "????"}). No daily limit.`;
      removeBtn.classList.remove("hidden");
    } else {
      status.textContent =
        `Using PolishAI's shared Gemini key: ${settings.usedToday} of ${settings.dailyLimit} free rewrites used today. ` +
        "Add your own key for no limit.";
    }
  } catch (err) {
    if (!isSessionError(err)) status.textContent = err.message;
  }
}

function openSettings() {
  $("settings-email").textContent = profile.email;
  hideMessage("settings-error", "settings-success");
  showScreen("settings-screen");
  loadSettingsStatus();
}

$("nav-settings").addEventListener("click", openSettings);

$("settings-back-btn").addEventListener("click", () => {
  showScreen("dashboard-screen");
  loadDashboard();
});

$("settings-save-btn").addEventListener("click", async () => {
  hideMessage("settings-error", "settings-success");
  const apiKey = $("settings-api-key").value.trim();

  if (!apiKey) {
    showMessage("settings-error", "Enter your Gemini API key first.");
    return;
  }

  await withButton($("settings-save-btn"), "Checking key...", async () => {
    try {
      await rpc(window.polish.api.saveKey, apiKey);
      $("settings-api-key").value = "";
      showMessage("settings-success", "Key saved. PolishAI will use it for your rewrites.");
      loadSettingsStatus();
    } catch (err) {
      if (!isSessionError(err)) showMessage("settings-error", err.message);
    }
  });
});

$("settings-remove-btn").addEventListener("click", async () => {
  hideMessage("settings-error", "settings-success");
  try {
    await rpc(window.polish.api.deleteKey);
    showMessage("settings-success", "Key removed. You're back on the shared key.");
    loadSettingsStatus();
  } catch (err) {
    if (!isSessionError(err)) showMessage("settings-error", err.message);
  }
});

$("logout-btn").addEventListener("click", async () => {
  await rpc(window.polish.auth.logout).catch(() => {});
  profile = null;
  calendarRevealed = false;
  hideMessage("login-error", "login-info");
  showScreen("welcome-screen");
});

// ----- Start -----

window.polish.onAuthExpired(() => {
  profile = null;
  goToLoginExpired();
});

// Keep this last. If anything above throws, later listeners never register
// and the app looks broken.
async function boot() {
  try {
    profile = await rpc(window.polish.auth.current);
  } catch {
    profile = null;
  }

  if (profile) {
    await openDashboard();
  } else {
    showScreen("welcome-screen");
  }
}

showScreen("welcome-screen");
boot();
