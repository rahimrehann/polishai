// Runs in the window. It can't use the network or Node; everything goes
// through window.polish (see preload.js).

const SECONDS_SAVED_PER_REWRITE = 25;
const PASSWORD_HINT = "Use at least 8 characters with an uppercase letter, a lowercase letter, a number and a symbol.";

const $ = (id) => document.getElementById(id);

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  $(id).classList.remove("hidden");
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

function formatTime(iso) {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDay(iso) {
  const date = new Date(iso);
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return formatTime(iso);
  return date.toLocaleDateString([], { month: "short", day: "numeric" });
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  return hours > 0 ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

function describeRewrite(item) {
  const kind = item.format === "email" ? "Email" : "Message";
  const words = `${item.inputWords} ${item.inputWords === 1 ? "word" : "words"}`;
  return item.app ? `${kind} · ${words} · ${item.app}` : `${kind} · ${words}`;
}

async function loadDashboard() {
  $("dashboard-name").textContent = `Welcome back, ${profile.name}`;
  const listEl = $("today-list");
  listEl.innerHTML = "<p class='loading-text'>Loading...</p>";

  try {
    const [stats, recent] = await Promise.all([rpc(window.polish.api.stats), rpc(window.polish.api.recent, 10)]);

    const totals = stats.totals || {};
    $("stat-words").textContent = (totals.inputWords || 0).toLocaleString();
    $("stat-time").textContent = formatDuration((totals.rewrites || 0) * SECONDS_SAVED_PER_REWRITE);

    if (recent.items.length === 0) {
      listEl.innerHTML = "<p class='empty-text'>No rewrites yet.</p>";
      return;
    }

    listEl.innerHTML = "";
    recent.items.forEach((item) => {
      const row = document.createElement("div");
      row.className = "today-item";

      const text = document.createElement("p");
      text.className = "today-item-text";
      text.textContent = describeRewrite(item);

      const time = document.createElement("span");
      time.className = "today-item-time";
      time.textContent = formatDay(item.at);

      row.appendChild(text);
      row.appendChild(time);
      listEl.appendChild(row);
    });
  } catch (err) {
    if (isSessionError(err)) return;
    listEl.innerHTML = "";
    const message = document.createElement("p");
    message.className = "empty-text";
    message.textContent = err.code === "NETWORK" ? err.message : "Couldn't load your usage data.";
    listEl.appendChild(message);
  }
}

async function openDashboard() {
  showScreen("dashboard-screen");
  await loadDashboard();
}

$("logout-btn").addEventListener("click", async () => {
  await rpc(window.polish.auth.logout).catch(() => {});
  profile = null;
  hideMessage("login-error", "login-info");
  showScreen("welcome-screen");
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

$("settings-btn").addEventListener("click", () => {
  $("settings-email").textContent = profile.email;
  hideMessage("settings-error", "settings-success");
  showScreen("settings-screen");
  loadSettingsStatus();
});

$("settings-back-btn").addEventListener("click", () => {
  showScreen("dashboard-screen");
});

$("settings-save-btn").addEventListener("click", async () => {
  hideMessage("settings-error", "settings-success");
  const apiKey = $("settings-api-key").value.trim();

  if (!apiKey) {
    showMessage("settings-error", "Please enter an API key.");
    return;
  }

  await withButton($("settings-save-btn"), "Checking key...", async () => {
    try {
      await rpc(window.polish.api.saveKey, apiKey);
      $("settings-api-key").value = "";
      showMessage("settings-success", "API key saved successfully.");
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
    showMessage("settings-success", "Your key was removed. You're using the shared key again.");
    loadSettingsStatus();
  } catch (err) {
    if (!isSessionError(err)) showMessage("settings-error", err.message);
  }
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
