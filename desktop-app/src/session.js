const { AppError } = require("./errors");

const REFRESH_EARLY_MS = 5 * 60 * 1000;

function decodeClaims(idToken) {
  try {
    return JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
  } catch {
    return {};
  }
}

// Holds the logged-in user. Tokens live in memory; only the refresh token,
// email and name are saved (encrypted) through `store`.
function createSession({ cognito, store, now = Date.now, onExpired = () => {} }) {
  let state = null;
  let refreshing = null;
  let startingUp = false;

  function persist() {
    try {
      store.write({ refreshToken: state.refreshToken, email: state.email, name: state.name });
    } catch {
      // Saving is a convenience; the session still works without it.
    }
  }

  function apply(auth, previous) {
    const claims = auth.IdToken ? decodeClaims(auth.IdToken) : {};
    const email = claims.email || previous.email;
    state = {
      accessToken: auth.AccessToken,
      expiresAt: now() + (auth.ExpiresIn || 3600) * 1000,
      refreshToken: auth.RefreshToken || previous.refreshToken,
      email,
      name: claims.name || previous.name || email,
    };
    persist();
  }

  function profile() {
    return state ? { email: state.email, name: state.name } : null;
  }

  function expire() {
    state = null;
    store.clear();
    if (!startingUp) onExpired();
    return new AppError("SESSION_EXPIRED", "Your session expired. Please log in again.");
  }

  async function doRefresh() {
    try {
      apply(await cognito.refresh(state.refreshToken), state);
      return state.accessToken;
    } catch (e) {
      if (e.code === "NotAuthorizedException") throw expire();
      throw e;
    }
  }

  function refreshNow() {
    if (!state) return Promise.reject(new AppError("NOT_LOGGED_IN", "Please log in."));
    if (!refreshing) refreshing = doRefresh().finally(() => { refreshing = null; });
    return refreshing;
  }

  return {
    async login(email, password) {
      apply(await cognito.login(email, password), { email });
      return profile();
    },

    // Called at app start. Returns the profile if a saved login still works.
    async current() {
      if (state) return profile();
      const saved = store.read();
      if (!saved || !saved.refreshToken) return null;
      state = { accessToken: null, expiresAt: 0, ...saved };
      startingUp = true;
      try {
        await doRefresh();
      } catch (e) {
        if (e.code === "SESSION_EXPIRED") return null;
        if (e.code !== "NETWORK") {
          state = null;
          return null;
        }
        // Offline at startup: stay logged in, refresh on the next request.
      } finally {
        startingUp = false;
      }
      return profile();
    },

    async getAccessToken() {
      if (!state) throw new AppError("NOT_LOGGED_IN", "Please log in.");
      if (state.accessToken && state.expiresAt - now() > REFRESH_EARLY_MS) return state.accessToken;
      return refreshNow();
    },

    forceRefresh: refreshNow,

    async logout() {
      const token = state && state.refreshToken;
      state = null;
      store.clear();
      if (token) {
        try {
          await cognito.revoke(token);
        } catch {
          // Best effort. The local session is already gone.
        }
      }
    },
  };
}

module.exports = { createSession };
