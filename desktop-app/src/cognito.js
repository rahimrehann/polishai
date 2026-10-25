const { AppError } = require("./errors");

const NETWORK_MESSAGE = "Can't reach PolishAI. Check your internet connection and try again.";

const FRIENDLY = {
  NotAuthorizedException: "Incorrect email or password.",
  UserNotConfirmedException: "Please confirm your email first. Check your inbox for the code.",
  UsernameExistsException: "An account with this email already exists. Try logging in.",
  CodeMismatchException: "That code isn't right. Check it and try again.",
  ExpiredCodeException: "That code has expired. Tap Resend code to get a new one.",
  TooManyRequestsException: "Too many attempts. Wait a minute and try again.",
  TooManyFailedAttemptsException: "Too many attempts. Wait a minute and try again.",
  LimitExceededException: "Too many attempts. Wait a minute and try again.",
};

// Cognito's own wording is already clear for these.
const USE_COGNITO_MESSAGE = ["InvalidPasswordException", "InvalidParameterException"];

function createCognito({ fetch, url, clientId }) {
  async function request(target, body) {
    let response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-amz-json-1.1",
          "X-Amz-Target": `AWSCognitoIdentityProviderService.${target}`,
        },
        body: JSON.stringify(body),
      });
    } catch {
      throw new AppError("NETWORK", NETWORK_MESSAGE);
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const type = String(data.__type || "").split("#").pop();
      let message = FRIENDLY[type];
      if (!message && USE_COGNITO_MESSAGE.includes(type) && data.message) message = data.message;
      throw new AppError(type || "COGNITO_ERROR", message || "Something went wrong. Please try again.", response.status);
    }
    return data;
  }

  return {
    signUp: (name, email, password) =>
      request("SignUp", {
        ClientId: clientId,
        Username: email,
        Password: password,
        UserAttributes: [
          { Name: "email", Value: email },
          { Name: "name", Value: name },
        ],
      }),

    confirmSignUp: (email, code) =>
      request("ConfirmSignUp", { ClientId: clientId, Username: email, ConfirmationCode: code }),

    resendCode: (email) => request("ResendConfirmationCode", { ClientId: clientId, Username: email }),

    async login(email, password) {
      const data = await request("InitiateAuth", {
        AuthFlow: "USER_PASSWORD_AUTH",
        ClientId: clientId,
        AuthParameters: { USERNAME: email, PASSWORD: password },
      });
      return data.AuthenticationResult;
    },

    async refresh(refreshToken) {
      const data = await request("InitiateAuth", {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        ClientId: clientId,
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      });
      return data.AuthenticationResult;
    },

    revoke: (refreshToken) => request("RevokeToken", { ClientId: clientId, Token: refreshToken }),
  };
}

module.exports = { createCognito, NETWORK_MESSAGE };
