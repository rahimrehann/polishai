const { AppError } = require("./errors");

// Things a person does to their own account: change the password, delete it.
function createAccount({ api, cognito, session, history }) {
  return {
    async changePassword(oldPassword, newPassword) {
      const token = await session.getAccessToken();
      await cognito.changePassword(token, oldPassword, newPassword);
    },

    // Removes the server data, the login account and the history on this computer.
    async deleteAccount(typedEmail) {
      const profile = session.profile();
      if (!profile) throw new AppError("NOT_LOGGED_IN", "Please log in.");
      if (String(typedEmail).trim().toLowerCase() !== profile.email.toLowerCase()) {
        throw new AppError("EMAIL_MISMATCH", "That doesn't match your account email.");
      }

      await api.deleteMyData();
      try {
        await cognito.deleteUser(await session.getAccessToken());
      } catch (error) {
        // The data is already gone; say so, and a second try finishes the job.
        throw new AppError(error.code || "DELETE_FAILED", `Your data was deleted, but closing the account didn't finish: ${error.message} Try again.`);
      }

      history.clear();
      await session.logout();
    },
  };
}

module.exports = { createAccount };
