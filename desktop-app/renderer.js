const USER_POOL_ID = "us-east-1_betXW17AO";
const CLIENT_ID = "15fipvbne122u6ng7diesu55tr";
const REGION = "us-east-1";
const COGNITO_URL = `https://cognito-idp.${REGION}.amazonaws.com/`;
const BACKEND_URL = "https://zrixwg6huied4ttlcdhxuoa2mq0lnnkf.lambda-url.us-east-1.on.aws/";

const SECONDS_SAVED_PER_REWRITE = 25;

let pendingSignupEmail = null;
let session = null;

function showScreen(id) {
  document.querySelectorAll(".screen").forEach((el) => el.classList.add("hidden"));
  document.getElementById(id).classList.remove("hidden");
}

function showError(id, message) {
  const el = document.getElementById(id);
  el.textContent = message;
  el.classList.remove("hidden");
}

function hideError(id) {
  document.getElementById(id).classList.add("hidden");
}

async function cognitoRequest(target, body) {
  const response = await fetch(COGNITO_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-amz-json-1.1",
      "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || "Something went wrong");
  }

  return data;
}

async function signUp(name, email, password) {
  return cognitoRequest("SignUp", {
    ClientId: CLIENT_ID,
    Username: email,
    Password: password,
    UserAttributes: [
      { Name: "email", Value: email },
      { Name: "name", Value: name },
    ],
  });
}

async function confirmSignUp(email, code) {
  return cognitoRequest("ConfirmSignUp", {
    ClientId: CLIENT_ID,
    Username: email,
    ConfirmationCode: code,
  });
}

async function login(email, password) {
  return cognitoRequest("InitiateAuth", {
    AuthFlow: "USER_PASSWORD_AUTH",
    ClientId: CLIENT_ID,
    AuthParameters: {
      USERNAME: email,
      PASSWORD: password,
    },
  });
}

function decodeJwtPayload(token) {
  const payload = token.split(".")[1];
  const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(decoded);
}

document.getElementById("show-login-btn").addEventListener("click", () => {
  showScreen("login-screen");
});

document.getElementById("show-signup-link").addEventListener("click", () => {
  showScreen("signup-screen");
});

document.getElementById("login-back-btn").addEventListener("click", () => {
  showScreen("welcome-screen");
});

document.getElementById("login-submit-btn").addEventListener("click", async () => {
  hideError("login-error");
  const email = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;

  if (!email || !password) {
    showError("login-error", "Please enter your email and password.");
    return;
  }

  const btn = document.getElementById("login-submit-btn");
  btn.disabled = true;
  btn.textContent = "Logging in...";

  try {
    const result = await login(email, password);
    const authResult = result.AuthenticationResult;
    const claims = decodeJwtPayload(authResult.IdToken);

    session = {
      idToken: authResult.IdToken,
      accessToken: authResult.AccessToken,
      name: claims.name || email,
      email: email,
    };

    await loadDashboard();
    showScreen("dashboard-screen");
  } catch (err) {
    showError("login-error", "Account not found, kindly create an account or retry.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Log In";
  }
});

document.getElementById("signup-back-btn").addEventListener("click", () => {
  showScreen("welcome-screen");
});

document.getElementById("signup-submit-btn").addEventListener("click", async () => {
  hideError("signup-error");
  const name = document.getElementById("signup-name").value.trim();
  const email = document.getElementById("signup-email").value.trim();
  const password = document.getElementById("signup-password").value;

  if (!name || !email || !password) {
    showError("signup-error", "Please fill in all fields.");
    return;
  }

  if (password.length < 8) {
    showError("signup-error", "Password must be at least 8 characters.");
    return;
  }

  const btn = document.getElementById("signup-submit-btn");
  btn.disabled = true;
  btn.textContent = "Signing up...";

  try {
    await signUp(name, email, password);
    pendingSignupEmail = email;
    showScreen("confirm-screen");
  } catch (err) {
    showError("signup-error", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Sign Up";
  }
});

document.getElementById("confirm-submit-btn").addEventListener("click", async () => {
  hideError("confirm-error");
  const code = document.getElementById("confirm-code").value.trim();

  if (!code) {
    showError("confirm-error", "Please enter the confirmation code.");
    return;
  }

  const btn = document.getElementById("confirm-submit-btn");
  btn.disabled = true;
  btn.textContent = "Confirming...";

  try {
    await confirmSignUp(pendingSignupEmail, code);
    showScreen("login-screen");
    document.getElementById("login-email").value = pendingSignupEmail;
  } catch (err) {
    showError("confirm-error", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Confirm";
  }
});

function isToday(timestampMs) {
  const date = new Date(Number(timestampMs));
  const now = new Date();
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function formatTime(timestampMs) {
  const date = new Date(Number(timestampMs));
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function formatDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0) {
    return `${hours}h ${remainingMinutes}m`;
  }
  return `${minutes}m`;
}

async function fetchUsage() {
  const response = await fetch(BACKEND_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${session.accessToken}`,
    },
    body: JSON.stringify({ action: "get_usage" }),
  });

  const data = await response.json();
  return data.items || [];
}

async function loadDashboard() {
  document.getElementById("dashboard-name").textContent = `Welcome back, ${session.name}`;

  const listEl = document.getElementById("today-list");
  listEl.innerHTML = "<p class='loading-text'>Loading...</p>";

  try {
    const items = await fetchUsage();

    const totalWords = items.reduce((sum, item) => sum + (item.wordCount || 0), 0);
    const totalTimeSaved = items.length * SECONDS_SAVED_PER_REWRITE;

    document.getElementById("stat-words").textContent = totalWords.toLocaleString();
    document.getElementById("stat-time").textContent = formatDuration(totalTimeSaved);

    const todayItems = items.filter((item) => isToday(item.timestamp));

    if (todayItems.length === 0) {
      listEl.innerHTML = "<p class='empty-text'>No rewrites yet today.</p>";
      return;
    }

    listEl.innerHTML = "";
    todayItems.forEach((item) => {
      const row = document.createElement("div");
      row.className = "today-item";

      const text = document.createElement("p");
      text.className = "today-item-text";
      text.textContent = item.originalText.length > 80
        ? item.originalText.slice(0, 80) + "..."
        : item.originalText;

      const time = document.createElement("span");
      time.className = "today-item-time";
      time.textContent = formatTime(item.timestamp);

      row.appendChild(text);
      row.appendChild(time);
      listEl.appendChild(row);
    });
  } catch (err) {
    listEl.innerHTML = "<p class='empty-text'>Couldn't load your usage data.</p>";
  }
}

document.getElementById("settings-btn").addEventListener("click", () => {
  document.getElementById("settings-email").textContent = session.email;
  hideError("settings-error");
  document.getElementById("settings-success").classList.add("hidden");
  showScreen("settings-screen");
});

document.getElementById("settings-back-btn").addEventListener("click", () => {
  showScreen("dashboard-screen");
});

document.getElementById("settings-save-btn").addEventListener("click", async () => {
  hideError("settings-error");
  document.getElementById("settings-success").classList.add("hidden");

  const apiKey = document.getElementById("settings-api-key").value.trim();

  if (!apiKey) {
    showError("settings-error", "Please enter an API key.");
    return;
  }

  const btn = document.getElementById("settings-save-btn");
  btn.disabled = true;
  btn.textContent = "Saving...";

  try {
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({ action: "save_api_key", apiKey: apiKey }),
    });

    const data = await response.json();

    if (!response.ok) {
      showError("settings-error", data.error || "Something went wrong.");
      return;
    }

    const successEl = document.getElementById("settings-success");
    successEl.textContent = "API key saved successfully.";
    successEl.classList.remove("hidden");
    document.getElementById("settings-api-key").value = "";
  } catch (err) {
    showError("settings-error", "Could not reach the server. Please try again.");
  } finally {
    btn.disabled = false;
    btn.textContent = "Save";
  }
});

document.getElementById("logout-btn").addEventListener("click", () => {
  session = null;
  showScreen("welcome-screen");
});

showScreen("welcome-screen");