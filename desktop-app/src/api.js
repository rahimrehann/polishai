const { AppError } = require("./errors");
const { NETWORK_MESSAGE } = require("./cognito");

function createApi({ session, fetch, url, timeoutMs = 30000, timezone }) {
  const tz = timezone || Intl.DateTimeFormat().resolvedOptions().timeZone;

  async function post(body, retried = false) {
    const token = await session.getAccessToken();

    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tz, ...body }),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch {
      throw new AppError("NETWORK", NETWORK_MESSAGE);
    }

    const data = await response.json().catch(() => ({}));

    if (response.status === 401 && !retried) {
      await session.forceRefresh();
      return post(body, true);
    }
    if (!response.ok) {
      throw new AppError(data.code || "SERVER_ERROR", data.error || "Something went wrong. Please try again.", response.status);
    }
    return data;
  }

  return {
    stats: () => post({ action: "get_stats" }),
    recent: (limit = 10) => post({ action: "get_recent", limit }),
    settings: () => post({ action: "get_settings" }),
    saveKey: (apiKey) => post({ action: "save_api_key", apiKey }),
    deleteKey: () => post({ action: "delete_api_key" }),
  };
}

module.exports = { createApi };
