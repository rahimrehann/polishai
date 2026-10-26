// Runs in the window. It can't use the network or Node; everything goes
// through window.polish (see preload.js).

const S = window.PolishStats;
const HK = window.PolishHotkeys;
const PASSWORD_HINT = "Use at least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol.";
const CALENDAR_WEEKS = 20;
const APP_VIEWS = ["dashboard-screen", "history-screen", "settings-screen"];

const $ = (id) => document.getElementById(id);

function showScreen(id) {
  const inApp = APP_VIEWS.includes(id);
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  $("app-shell").classList.toggle("hidden", !inApp);

  if (inApp) {
    APP_VIEWS.forEach((view) => $(view).classList.toggle("hidden", view !== id));
    $("nav-home").classList.toggle("is-active", id === "dashboard-screen");
    $("nav-settings").classList.toggle("is-active", id === "settings-screen");
    $("nav-history").classList.toggle("is-active", id === "history-screen");
    if (id !== "settings-screen") cancelRecording();
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

// ----- Forgot password -----

$("forgot-link").addEventListener("click", () => {
  hideMessage("forgot-error");
  $("forgot-email").value = $("login-email").value.trim();
  showScreen("forgot-screen");
});

$("forgot-back-btn").addEventListener("click", () => showScreen("login-screen"));

function openResetScreen(email, info) {
  $("reset-email").value = email || "";
  $("reset-code").value = "";
  $("reset-password").value = "";
  hideMessage("reset-error", "reset-info");
  if (info) showMessage("reset-info", info);
  showScreen("reset-screen");
}

$("forgot-submit-btn").addEventListener("click", async () => {
  hideMessage("forgot-error");
  const email = $("forgot-email").value.trim();
  if (!email) {
    showMessage("forgot-error", "Enter your email first.");
    return;
  }
  await withButton($("forgot-submit-btn"), "Sending...", async () => {
    try {
      await rpc(window.polish.auth.forgot, email);
      // Same wording whether or not the account exists, so nobody can use this to look people up.
      openResetScreen(email, "If an account exists for that email, we've sent a code.");
    } catch (err) {
      showMessage("forgot-error", err.message);
    }
  });
});

$("forgot-have-code").addEventListener("click", () => openResetScreen($("forgot-email").value.trim()));
$("reset-back-btn").addEventListener("click", () => showScreen("forgot-screen"));

$("reset-resend-link").addEventListener("click", async () => {
  hideMessage("reset-error", "reset-info");
  const email = $("reset-email").value.trim();
  if (!email) {
    showMessage("reset-error", "Enter your email first.");
    return;
  }
  try {
    await rpc(window.polish.auth.forgot, email);
    showMessage("reset-info", "We sent a new code, if an account exists for that email.");
  } catch (err) {
    showMessage("reset-error", err.message);
  }
});

$("reset-submit-btn").addEventListener("click", async () => {
  hideMessage("reset-error", "reset-info");
  const email = $("reset-email").value.trim();
  const code = $("reset-code").value.trim();
  const password = $("reset-password").value;

  if (!email || !code || !password) {
    showMessage("reset-error", "Please fill in all fields.");
    return;
  }
  if (!passwordIsStrong(password)) {
    showMessage("reset-error", PASSWORD_HINT);
    return;
  }

  await withButton($("reset-submit-btn"), "Resetting...", async () => {
    try {
      await rpc(window.polish.auth.resetPassword, email, code, password);
      $("reset-password").value = "";
      $("login-email").value = email;
      $("login-password").value = "";
      hideMessage("login-error");
      showMessage("login-info", "Password changed. Log in with your new password.");
      showScreen("login-screen");
    } catch (err) {
      showMessage("reset-error", err.message);
    }
  });
});

// ----- Privacy and terms -----

let privacyReturn = "welcome-screen";

function openPrivacy(returnTo) {
  privacyReturn = returnTo;
  showScreen("privacy-screen");
  window.scrollTo(0, 0);
}

$("welcome-privacy-link").addEventListener("click", () => openPrivacy("welcome-screen"));
$("signup-privacy-link").addEventListener("click", () => openPrivacy("signup-screen"));
$("privacy-back-btn").addEventListener("click", () => showScreen(privacyReturn));

// ----- App version -----

let appInfo = { version: "", platform: "darwin" };

async function loadAppInfo() {
  try {
    appInfo = await rpc(window.polish.app.info);
  } catch {
    // The version line just stays empty.
  }
  $("app-version").textContent = appInfo.version ? `PolishAI ${appInfo.version}` : "";
}

// ----- Shared bits -----

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const REFRESH_AFTER_MS = 10000;

let calendarRevealed = false;
let lastLoadedAt = 0;
let platform = "darwin";
let hotkeys = { message: "Command+K", email: "Command+G" };
let dayRows = {};

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

function formatLongDate(dateString) {
  return S.fromDateString(dateString).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" });
}

function dayHeading(dateString) {
  const today = S.toDateString(new Date());
  const yesterday = S.toDateString(S.addDays(new Date(), -1));
  if (dateString === today) return "Today";
  if (dateString === yesterday) return "Yesterday";
  return formatLongDate(dateString);
}

function firstName(name) {
  if (!name || name.includes("@")) return "";
  return name.trim().split(/\s+/)[0];
}

function renderKeycaps(container, accelerator) {
  container.innerHTML = "";
  HK.display(accelerator, platform).forEach((part) => container.appendChild(el("span", "keycap", part)));
}

function renderChips() {
  renderKeycaps($("chip-message"), hotkeys.message);
  renderKeycaps($("chip-email"), hotkeys.email);
  renderKeycaps($("step-keys-message"), hotkeys.message);
  renderKeycaps($("step-keys-email"), hotkeys.email);
}

async function loadPrefs() {
  try {
    const prefs = await rpc(window.polish.prefs.get);
    hotkeys = prefs.hotkeys;
    platform = prefs.platform;
  } catch {
    // Keep the defaults on screen.
  }
  renderChips();
  renderShortcutButtons();
}

// ----- Dashboard -----

function renderHeader(totals, days, today) {
  const name = firstName(profile.name);
  $("greeting").textContent = `${S.greeting(today.getHours())}${name ? `, ${name}` : ""}.`;
  $("summary").textContent = S.summarySentence({ totals, days, today });
}

function renderLedger(totals, map, today, days) {
  const rewrites = Number(totals.rewrites) || 0;
  const week = S.weekTotals(days, today);
  $("stat-rewrites-sub").textContent = `${week.rewrites.toLocaleString()} this week`;
  $("stat-words-sub").textContent = `${week.words.toLocaleString()} this week`;
  $("stat-rewrites").textContent = rewrites.toLocaleString();
  $("stat-words").textContent = (Number(totals.inputWords) || 0).toLocaleString();
  $("stat-time").textContent = S.formatDuration(rewrites * S.SECONDS_SAVED_PER_REWRITE);
  $("stat-streak").textContent = String(S.currentStreak(map, today));
}

function selectDay(date, source) {
  document.querySelectorAll(".is-selected").forEach((node) => node.classList.remove("is-selected"));
  document.querySelectorAll(`[data-date="${date}"]`).forEach((node) => node.classList.add("is-selected"));

  const own = source === "calendar" ? $("calendar-detail") : $("week-detail");
  const other = source === "calendar" ? $("week-detail") : $("calendar-detail");
  other.textContent = source === "calendar" ? "Click a bar to see that day." : "Click a square to see that day.";
  other.dataset.date = "";
  renderDayDetail(own, date);
}

async function renderDayDetail(container, date) {
  container.dataset.date = date;
  container.innerHTML = "";
  const row = dayRows[date];
  container.appendChild(el("strong", "", formatLongDate(date)));

  if (!row || !row.rewrites) {
    container.appendChild(document.createTextNode(" No rewrites this day."));
    return;
  }
  const message = row.message || 0;
  const email = row.email || 0;
  container.appendChild(document.createTextNode(
    ` ${S.plural(row.rewrites, "rewrite")}, ${S.plural(row.inputWords || 0, "word")} polished (${message} Message, ${email} Email). `
  ));

  try {
    const { entries } = await rpc(window.polish.history.list, { date, limit: 1 });
    if (container.dataset.date !== date) return;
    if (entries.length > 0) {
      const link = el("button", "link-btn", "See them in History");
      link.addEventListener("click", () => openHistory({ date }));
      container.appendChild(link);
    } else {
      container.appendChild(el("span", "day-note", "The text isn't saved on this computer."));
    }
  } catch {
    // The counts above are still correct.
  }
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
      const cell = el("button", "cell");
      cell.type = "button";
      cell.dataset.level = String(day.level);
      cell.dataset.date = day.date;
      cell.style.setProperty("--col", String(index));
      if (day.today) cell.classList.add("is-today");
      if (day.future) {
        cell.classList.add("is-future");
        cell.disabled = true;
        cell.tabIndex = -1;
      } else {
        const label = `${formatLongDate(day.date)}: ${S.plural(day.count, "rewrite")}`;
        cell.title = label;
        cell.setAttribute("aria-label", label);
        cell.addEventListener("click", () => selectDay(day.date, "calendar"));
      }
      calendar.appendChild(cell);
    });
  });

  // The fill-in animation plays only the first time. Later refreshes rebuild the
  // squares, and they must not blink again.
  calendar.classList.toggle("is-revealing", !calendarRevealed);
  calendarRevealed = true;

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
    list.appendChild(el("p", "empty-text", "Apps appear here once you rewrite with a shortcut."));
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
    const col = el("button", "week-col");
    col.type = "button";
    col.dataset.date = day.date;
    if (day.date === S.toDateString(today)) col.classList.add("is-today");
    const label = `${formatLongDate(day.date)}: ${S.plural(day.count, "rewrite")}`;
    col.title = label;
    col.setAttribute("aria-label", label);

    const bar = el("div", "week-bar");
    bar.style.height = `${(day.count / max) * 100}%`;
    const track = el("div", "week-track");
    track.appendChild(bar);
    col.append(el("span", "week-value", day.count > 0 ? String(day.count) : ""), track, el("span", "week-label", WEEKDAYS[day.weekday]));
    col.addEventListener("click", () => selectDay(day.date, "week"));
    bars.appendChild(col);
  });

  const total = days.reduce((sum, d) => sum + d.count, 0);
  $("week-note").textContent = S.plural(total, "rewrite");
}

function preview(text, length = 70) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > length ? `${flat.slice(0, length)}...` : flat;
}

function renderRecent(localEntries, serverItems) {
  const list = $("today-list");
  list.innerHTML = "";
  $("recent-all").classList.toggle("hidden", localEntries.length === 0);

  if (localEntries.length > 0) {
    localEntries.slice(0, 8).forEach((entry) => {
      const row = el("button", "recent-row recent-link");
      row.type = "button";
      const kind = entry.format === "email" ? "Email" : "Message";
      const main = el("span", "recent-main");
      main.append(el("span", "recent-kind", kind + (entry.app ? ` in ${entry.app}` : "")), el("span", "recent-text", preview(entry.output)));
      row.append(main, el("span", "recent-meta", formatClock(entry.at)));
      row.addEventListener("click", () => openHistory({ focusId: entry.id }));
      list.appendChild(row);
    });
    return;
  }

  if (serverItems.length === 0) {
    list.appendChild(el("p", "empty-text", "No rewrites yet. Highlight text in any app and press a shortcut."));
    return;
  }

  // Rewrites from before history was saved on this computer: counts only.
  serverItems.slice(0, 8).forEach((item) => {
    const row = el("div", "recent-row");
    const kind = item.format === "email" ? "Email" : "Message";
    const detail = [S.plural(item.inputWords, "word"), item.app].filter(Boolean).join(", ");
    row.append(el("span", "recent-main", kind), el("span", "recent-meta", `${detail} - ${formatClock(item.at)}`));
    list.appendChild(row);
  });
}

function renderUpdateNotice(settings) {
  const notice = $("update-notice");
  const V = window.PolishVersion;
  if (!settings || !appInfo.version) {
    notice.classList.add("hidden");
    return;
  }
  if (V.compare(appInfo.version, settings.minAppVersion) === -1) {
    $("update-notice-text").textContent = "This version of PolishAI is out of date, so rewrites are off until you update.";
  } else if (V.compare(appInfo.version, settings.latestAppVersion) === -1) {
    $("update-notice-text").textContent = `A newer version of PolishAI is available (${settings.latestAppVersion}).`;
  } else {
    notice.classList.add("hidden");
    return;
  }
  notice.classList.remove("hidden");
}

$("update-notice-btn").addEventListener("click", () => rpc(window.polish.app.openDownload).catch(() => {}));

// New people see three steps until their first rewrite.
let permissionAllowed = true;
let gettingStartedOn = false;

function renderStepAccess() {
  $("step-access-state").textContent = permissionAllowed ? "Done" : "";
  $("step-access-btn").classList.toggle("hidden", permissionAllowed);
  // The step carries the button, so don't show the same ask twice.
  $("permission-notice").classList.toggle("hidden", permissionAllowed || gettingStartedOn);
}

function renderGettingStarted(totals, localEntries) {
  gettingStartedOn = (Number(totals.rewrites) || 0) === 0 && localEntries.length === 0;
  $("getting-started").classList.toggle("hidden", !gettingStartedOn);
  renderStepAccess();
}

$("step-access-btn").addEventListener("click", () => rpc(window.polish.permissions.request).catch(() => {}));

// "You have 20 free rewrites a day, and 17 left today."
function freeRewritesLine(settings) {
  const limit = Number(settings.dailyLimit) || 0;
  const left = Math.max(0, limit - (Number(settings.usedToday) || 0));
  return `You have ${limit} free rewrites a day, and ${left} left today.`;
}

function renderKeyNotice(settings) {
  const notice = $("key-notice");
  if (!settings || settings.hasCustomKey) {
    notice.classList.add("hidden");
    return;
  }
  $("key-notice-text").textContent = `${freeRewritesLine(settings)} Add your own Gemini, OpenAI or Anthropic key to rewrite as many times as you like.`;
  notice.classList.remove("hidden");
}

async function loadDashboard() {
  const today = new Date();
  loadPrefs();
  try {
    const [stats, recent, settings, local] = await Promise.all([
      rpc(window.polish.api.stats),
      rpc(window.polish.api.recent, 10),
      rpc(window.polish.api.settings).catch((err) => {
        if (isSessionError(err)) throw err;
        return null;
      }),
      rpc(window.polish.history.list, { limit: 10 }).catch(() => ({ entries: [] })),
    ]);

    const totals = stats.totals || {};
    const days = stats.days || [];
    const map = S.buildDayMap(days);
    dayRows = {};
    days.forEach((day) => { dayRows[day.date] = day; });

    renderHeader(totals, days, today);
    renderLedger(totals, map, today, days);
    renderCalendar(map, today);
    renderMix(totals, stats.apps || []);
    renderWeek(map, today);
    renderRecent(local.entries, recent.items || []);
    renderKeyNotice(settings);
    renderUpdateNotice(settings);
    renderGettingStarted(totals, local.entries);
    loadNotices();
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
$("recent-all").addEventListener("click", () => openHistory());

// Rewrites happen in other apps, so refresh when the window comes back
// or when a rewrite finishes.
function refreshVisibleScreen() {
  if (!profile || $("app-shell").classList.contains("hidden")) return;
  if (!$("dashboard-screen").classList.contains("hidden")) loadDashboard();
  else if (!$("history-screen").classList.contains("hidden")) renderHistory();
}

window.addEventListener("focus", () => {
  if (Date.now() - lastLoadedAt > REFRESH_AFTER_MS) refreshVisibleScreen();
});
window.polish.onStatsChanged(refreshVisibleScreen);

// ----- History -----

let historyFilterDate = null;
let clearArmed = null;

function openHistory({ date = null, focusId = null } = {}) {
  historyFilterDate = date;
  showScreen("history-screen");
  return renderHistory(focusId);
}

function buildEntry(entry) {
  const article = el("article", "entry");
  article.id = `entry-${entry.id}`;

  const head = el("button", "entry-head");
  head.type = "button";
  head.setAttribute("aria-expanded", "false");
  const kind = entry.format === "email" ? "Email" : "Message";
  head.append(
    el("span", `chip chip-${entry.format === "email" ? "email" : "message"}`, kind),
    el("span", "entry-app", entry.app || ""),
    el("span", "entry-preview", preview(entry.output, 90)),
    el("time", "entry-time", new Date(entry.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }))
  );

  const body = el("div", "entry-body hidden");
  const original = el("div", "entry-col");
  original.append(el("h3", "", "What you wrote"), el("p", "entry-text", entry.input));
  const rewritten = el("div", "entry-col");
  rewritten.append(el("h3", "", "What PolishAI wrote"), el("p", "entry-text", entry.output));

  const actions = el("div", "entry-actions");
  const copy = el("button", "btn-quiet small", "Copy rewrite");
  copy.type = "button";
  copy.addEventListener("click", async () => {
    try {
      await rpc(window.polish.clipboard.write, entry.output);
      copy.textContent = "Copied";
      setTimeout(() => { copy.textContent = "Copy rewrite"; }, 1500);
    } catch {
      copy.textContent = "Couldn't copy";
    }
  });
  const remove = el("button", "btn-quiet small", "Delete");
  remove.type = "button";
  remove.addEventListener("click", async () => {
    await rpc(window.polish.history.remove, entry.id).catch(() => {});
    renderHistory();
  });
  actions.append(copy, remove);
  body.append(original, rewritten, actions);

  head.addEventListener("click", () => {
    const open = body.classList.toggle("hidden") === false;
    head.setAttribute("aria-expanded", String(open));
    article.classList.toggle("is-open", open);
  });

  article.append(head, body);
  return article;
}

async function renderHistory(focusId = null) {
  const list = $("history-list");
  const filter = $("history-filter");
  list.innerHTML = "";
  list.appendChild(el("p", "loading-text", "Loading..."));

  filter.classList.toggle("hidden", !historyFilterDate);
  if (historyFilterDate) $("history-filter-text").textContent = `Showing ${formatLongDate(historyFilterDate)}`;

  try {
    const { entries } = await rpc(window.polish.history.list, { limit: 500, date: historyFilterDate || undefined });
    list.innerHTML = "";
    $("history-clear").classList.toggle("hidden", entries.length === 0 && !historyFilterDate);

    if (entries.length === 0) {
      list.appendChild(el("p", "empty-text", historyFilterDate
        ? "Nothing saved on this computer for this day."
        : "No history yet. Rewrites you make with a shortcut show up here, with the full text."));
      return;
    }

    let currentDay = null;
    entries.forEach((entry) => {
      const day = S.toDateString(new Date(entry.at));
      if (day !== currentDay) {
        currentDay = day;
        list.appendChild(el("h2", "day-heading", dayHeading(day)));
      }
      list.appendChild(buildEntry(entry));
    });

    if (focusId) {
      const target = document.getElementById(`entry-${focusId}`);
      if (target) {
        target.querySelector(".entry-head").click();
        target.scrollIntoView({ block: "center" });
      }
    }
  } catch (err) {
    list.innerHTML = "";
    if (!isSessionError(err)) list.appendChild(el("p", "empty-text", "Couldn't load your history."));
  }
}

$("nav-history").addEventListener("click", () => openHistory());

$("history-filter-clear").addEventListener("click", () => openHistory());

$("history-clear").addEventListener("click", async () => {
  const button = $("history-clear");
  if (!clearArmed) {
    button.textContent = "Click again to delete everything";
    clearArmed = setTimeout(() => {
      clearArmed = null;
      button.textContent = "Clear history";
    }, 4000);
    return;
  }
  clearTimeout(clearArmed);
  clearArmed = null;
  button.textContent = "Clear history";
  await rpc(window.polish.history.clear).catch(() => {});
  historyFilterDate = null;
  renderHistory();
});

// ----- Settings: AI provider -----

const PROVIDERS = {
  gemini: {
    name: "Gemini",
    hint: "Get a free key at aistudio.google.com.",
  },
  openai: {
    name: "OpenAI",
    hint: "Create a key at platform.openai.com/api-keys. Usage is billed to your OpenAI account.",
  },
  anthropic: {
    name: "Anthropic",
    hint: "Create a key at platform.claude.com. Usage is billed to your Anthropic account.",
  },
};

let selectedProvider = "gemini";

function selectProvider(provider) {
  selectedProvider = provider;
  const info = PROVIDERS[provider];
  document.querySelectorAll(".seg").forEach((button) => {
    button.setAttribute("aria-checked", String(button.dataset.provider === provider));
  });
  $("settings-key-label").textContent = `Your ${info.name} API key`;
  $("settings-api-key").placeholder = `Paste your ${info.name} API key`;
  $("settings-key-hint").textContent = info.hint;
}

document.querySelectorAll(".seg").forEach((button) => {
  button.addEventListener("click", () => {
    hideMessage("settings-error", "settings-success");
    selectProvider(button.dataset.provider);
  });
});

async function loadSettingsStatus() {
  const status = $("settings-status");
  const removeBtn = $("settings-remove-btn");
  status.textContent = "";
  removeBtn.classList.add("hidden");

  try {
    const settings = await rpc(window.polish.api.settings);
    if (settings.hasCustomKey) {
      const info = PROVIDERS[settings.provider] || PROVIDERS.gemini;
      status.textContent = `Using your own ${info.name} key (ending in ${settings.keyLast4 || "????"}). No daily limit.`;
      removeBtn.classList.remove("hidden");
      selectProvider(settings.provider in PROVIDERS ? settings.provider : "gemini");
    } else {
      status.textContent = freeRewritesLine(settings);
    }
  } catch (err) {
    if (!isSessionError(err)) status.textContent = err.message;
  }
}

$("settings-save-btn").addEventListener("click", async () => {
  hideMessage("settings-error", "settings-success");
  const apiKey = $("settings-api-key").value.trim();
  const info = PROVIDERS[selectedProvider];

  if (!apiKey) {
    showMessage("settings-error", `Enter your ${info.name} API key first.`);
    return;
  }

  await withButton($("settings-save-btn"), "Checking key...", async () => {
    try {
      await rpc(window.polish.api.saveKey, selectedProvider, apiKey);
      $("settings-api-key").value = "";
      showMessage("settings-success", `Key saved. Your rewrites now use ${info.name}.`);
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
    selectProvider("gemini");
    showMessage("settings-success", "Switched back to your free daily rewrites.");
    loadSettingsStatus();
  } catch (err) {
    if (!isSessionError(err)) showMessage("settings-error", err.message);
  }
});

// ----- Settings: shortcuts -----

const SHORTCUT_KINDS = ["message", "email"];
let recording = null;

function renderShortcutButtons() {
  SHORTCUT_KINDS.forEach((kind) => {
    const button = $(`hotkey-${kind}`);
    button.classList.toggle("is-recording", recording === kind);
    if (recording === kind) {
      button.textContent = "Press your shortcut...";
    } else {
      renderKeycaps(button, hotkeys[kind]);
    }
  });
}

function cancelRecording() {
  if (!recording) return;
  recording = null;
  document.removeEventListener("keydown", onRecordKey, true);
  document.removeEventListener("mousedown", onRecordClickAway, true);
  renderShortcutButtons();
  rpc(window.polish.hotkeys.resume).catch(() => {});
}

function onRecordClickAway(event) {
  if (!event.target.closest(".shortcut-btn")) cancelRecording();
}

async function finishRecording(kind, accelerator) {
  recording = null;
  document.removeEventListener("keydown", onRecordKey, true);
  document.removeEventListener("mousedown", onRecordClickAway, true);
  try {
    const result = await rpc(window.polish.hotkeys.set, kind, accelerator);
    hotkeys = result.hotkeys;
    renderChips();
    renderShortcutButtons();
    showMessage("hotkey-success", `${kind === "email" ? "Email" : "Message"} shortcut saved.`);
    if (result.warning) showMessage("hotkey-warning", result.warning);
  } catch (err) {
    renderShortcutButtons();
    showMessage("hotkey-error", err.message);
  }
}

function onRecordKey(event) {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === "Escape") {
    cancelRecording();
    return;
  }
  const result = HK.fromEvent(event);
  if (result.pending) return;
  hideMessage("hotkey-error", "hotkey-warning", "hotkey-success");
  if (result.error) {
    showMessage("hotkey-error", result.error);
    return;
  }
  // Refuse bad combos right here and keep listening, so the user can just press another.
  const check = HK.validate(result.accelerator);
  if (!check.ok) {
    showMessage("hotkey-error", check.error);
    return;
  }
  finishRecording(recording, result.accelerator);
}

async function startRecording(kind) {
  if (recording === kind) {
    cancelRecording();
    return;
  }
  cancelRecording();
  hideMessage("hotkey-error", "hotkey-warning", "hotkey-success");
  recording = kind;
  renderShortcutButtons();
  // Pause the real shortcuts so pressing one here doesn't start a rewrite.
  await rpc(window.polish.hotkeys.pause).catch(() => {});
  document.addEventListener("keydown", onRecordKey, true);
  document.addEventListener("mousedown", onRecordClickAway, true);
}

SHORTCUT_KINDS.forEach((kind) => {
  $(`hotkey-${kind}`).addEventListener("click", () => startRecording(kind));
  $(`hotkey-reset-${kind}`).addEventListener("click", async () => {
    cancelRecording();
    hideMessage("hotkey-error", "hotkey-warning", "hotkey-success");
    try {
      const result = await rpc(window.polish.hotkeys.reset, kind);
      hotkeys = result.hotkeys;
      renderChips();
      renderShortcutButtons();
      showMessage("hotkey-success", `${kind === "email" ? "Email" : "Message"} shortcut reset.`);
    } catch (err) {
      showMessage("hotkey-error", err.message);
    }
  });
});

// ----- Settings: general switches and dashboard notices -----

let general = { paused: false, launchAtLogin: { supported: false, enabled: false } };

function renderGeneral() {
  $("toggle-shortcuts").checked = !general.paused;
  const login = general.launchAtLogin;
  $("toggle-login").checked = login.enabled;
  $("toggle-login").disabled = !login.supported;
  $("general-note").classList.add("hidden");
  $("paused-notice").classList.toggle("hidden", !general.paused);
}

async function loadGeneral() {
  try {
    general = await rpc(window.polish.general.get);
  } catch {
    // Keep what's on screen.
  }
  renderGeneral();
}

async function loadNotices() {
  loadGeneral();
  try {
    const { accessibility } = await rpc(window.polish.permissions.status);
    permissionAllowed = accessibility;
  } catch {
    permissionAllowed = true;
  }
  renderStepAccess();
}

async function changeGeneral(call, ...args) {
  hideMessage("general-error");
  try {
    general = await rpc(call, ...args);
  } catch (err) {
    if (!isSessionError(err)) showMessage("general-error", err.message);
  }
  renderGeneral();
}

$("toggle-shortcuts").addEventListener("change", (event) => {
  changeGeneral(window.polish.general.setPaused, !event.target.checked);
});

$("toggle-login").addEventListener("change", (event) => {
  changeGeneral(window.polish.general.setLaunchAtLogin, event.target.checked);
});

$("resume-btn").addEventListener("click", () => changeGeneral(window.polish.general.setPaused, false));
$("permission-notice-btn").addEventListener("click", () => rpc(window.polish.permissions.request).catch(() => {}));

// The menu-bar menu changes the same switches.
window.polish.onGeneralChanged(() => {
  loadGeneral();
  loadPrefs();
});

// ----- Settings: password, privacy and deleting the account -----

function resetAccountForms() {
  $("password-form").classList.add("hidden");
  $("password-old").value = "";
  $("password-new").value = "";
  hideMessage("password-error", "password-success");
  $("delete-confirm").classList.add("hidden");
  $("delete-email").value = "";
  hideMessage("delete-error");
}

$("password-toggle").addEventListener("click", () => {
  hideMessage("password-success", "password-error");
  $("password-form").classList.toggle("hidden");
});

$("password-cancel").addEventListener("click", resetAccountForms);

$("password-save").addEventListener("click", async () => {
  hideMessage("password-error", "password-success");
  const oldPassword = $("password-old").value;
  const newPassword = $("password-new").value;

  if (!oldPassword || !newPassword) {
    showMessage("password-error", "Enter your current password and a new one.");
    return;
  }
  if (!passwordIsStrong(newPassword)) {
    showMessage("password-error", PASSWORD_HINT);
    return;
  }
  if (oldPassword === newPassword) {
    showMessage("password-error", "Choose a password that's different from the current one.");
    return;
  }

  await withButton($("password-save"), "Saving...", async () => {
    try {
      await rpc(window.polish.account.changePassword, oldPassword, newPassword);
      resetAccountForms();
      showMessage("password-success", "Password changed.");
    } catch (err) {
      if (!isSessionError(err)) showMessage("password-error", err.message);
    }
  });
});

$("settings-privacy-link").addEventListener("click", () => openPrivacy("settings-screen"));

$("delete-open").addEventListener("click", () => {
  $("delete-confirm").classList.remove("hidden");
  $("delete-email").focus();
});

$("delete-cancel").addEventListener("click", resetAccountForms);

$("delete-confirm-btn").addEventListener("click", async () => {
  hideMessage("delete-error");
  const typed = $("delete-email").value.trim();
  if (!typed) {
    showMessage("delete-error", "Type your email address to confirm.");
    return;
  }

  await withButton($("delete-confirm-btn"), "Deleting...", async () => {
    try {
      await rpc(window.polish.account.delete, typed);
      profile = null;
      calendarRevealed = false;
      dayRows = {};
      historyFilterDate = null;
      resetAccountForms();
      showMessage("welcome-note", "Your account and its data were deleted.");
      showScreen("welcome-screen");
    } catch (err) {
      if (!isSessionError(err)) showMessage("delete-error", err.message);
    }
  });
});

// ----- Settings: permission -----

async function loadPermission() {
  const status = $("permission-status");
  try {
    const { accessibility } = await rpc(window.polish.permissions.status);
    status.textContent = accessibility
      ? "Allowed. PolishAI can copy and paste in other apps."
      : "Not allowed yet. Shortcuts won't work until you turn PolishAI on.";
    $("permission-open").classList.toggle("hidden", accessibility);
  } catch {
    status.textContent = "";
  }
}

$("permission-open").addEventListener("click", async () => {
  await rpc(window.polish.permissions.request).catch(() => {});
});

window.addEventListener("focus", () => {
  if (!$("settings-screen").classList.contains("hidden")) loadPermission();
  if (profile && !$("dashboard-screen").classList.contains("hidden")) loadNotices();
});

function openSettings() {
  $("settings-email").textContent = profile.email;
  hideMessage("settings-error", "settings-success", "hotkey-error", "hotkey-warning", "hotkey-success");
  resetAccountForms();
  selectProvider(selectedProvider);
  showScreen("settings-screen");
  loadSettingsStatus();
  loadPrefs();
  loadPermission();
  loadGeneral();
}

$("nav-settings").addEventListener("click", openSettings);

$("settings-back-btn").addEventListener("click", () => {
  showScreen("dashboard-screen");
  loadDashboard();
});

$("logout-btn").addEventListener("click", async () => {
  await rpc(window.polish.auth.logout).catch(() => {});
  profile = null;
  calendarRevealed = false;
  dayRows = {};
  historyFilterDate = null;
  hideMessage("login-error", "login-info", "welcome-note");
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
  await loadAppInfo();
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
