const USER_POOL_ID = "us-east-1_betXW17AO";
const CLIENT_ID = "15fipvbne122u6ng7diesu55tr";
const REGION = "us-east-1";
const COGNITO_URL = `https://cognito-idp.${REGION}.amazonaws.com/`;

let pendingSignupEmail = null;

// ----- Screen switching -----

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

// ----- Cognito API calls (raw HTTP, no SDK) -----

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

// ----- Token storage -----

function saveSession(authResult, name, email) {
  chrome.storage.local.set({
    idToken: authResult.IdToken,
    accessToken: authResult.AccessToken,
    refreshToken: authResult.RefreshToken,
    name: name,
    email: email,
  });
}

function clearSession() {
  chrome.storage.local.remove(["idToken", "accessToken", "refreshToken", "name", "email"]);
}

function decodeJwtPayload(token) {
  const payload = token.split(".")[1];
  const decoded = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
  return JSON.parse(decoded);
}

// ----- Screen: Welcome -----

document.getElementById("show-login-btn").addEventListener("click", () => {
  showScreen("login-screen");
});

document.getElementById("show-signup-link").addEventListener("click", (e) => {
  e.preventDefault();
  showScreen("signup-screen");
});

// ----- Screen: Login -----

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
    const name = claims.name || email;

    saveSession(authResult, name, email);
    showLoggedInScreen(name, email);
  } catch (err) {
    showError("login-error", err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "Log In";
  }
});

// ----- Screen: Signup -----

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

// ----- Screen: Confirm code -----

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

// ----- Screen: Logged in -----

function showLoggedInScreen(name, email) {
  document.getElementById("loggedin-name").textContent = `Welcome, ${name}`;
  document.getElementById("loggedin-email").textContent = email;
  showScreen("loggedin-screen");
}

document.getElementById("logout-btn").addEventListener("click", () => {
  clearSession();
  showScreen("welcome-screen");
});

// ----- On popup open: check if already logged in -----

chrome.storage.local.get(["idToken", "name", "email"], (result) => {
  if (result.idToken) {
    showLoggedInScreen(result.name, result.email);
  } else {
    showScreen("welcome-screen");
  }
});