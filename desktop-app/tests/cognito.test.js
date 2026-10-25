const test = require("node:test");
const assert = require("node:assert/strict");
const { createCognito } = require("../src/cognito");
const { jsonResponse, fakeFetch } = require("./helpers");

const make = (fetch) => createCognito({ fetch, url: "https://cognito.test/", clientId: "client-1" });

test("login sends the password auth request and returns the tokens", async () => {
  const fetch = fakeFetch(jsonResponse(200, { AuthenticationResult: { AccessToken: "a" } }));
  const result = await make(fetch).login("me@x.com", "Pw1!pw1!");
  assert.equal(result.AccessToken, "a");
  assert.equal(fetch.calls[0].options.headers["X-Amz-Target"], "AWSCognitoIdentityProviderService.InitiateAuth");
  assert.deepEqual(fetch.calls[0].body.AuthParameters, { USERNAME: "me@x.com", PASSWORD: "Pw1!pw1!" });
});

test("Cognito errors become friendly messages", async () => {
  const cases = {
    NotAuthorizedException: "Incorrect email or password.",
    UserNotConfirmedException: "confirm your email",
    UsernameExistsException: "already exists",
    CodeMismatchException: "isn't right",
    ExpiredCodeException: "expired",
    TooManyRequestsException: "Too many attempts",
    LimitExceededException: "Too many attempts",
  };
  for (const [type, expected] of Object.entries(cases)) {
    const fetch = fakeFetch(jsonResponse(400, { __type: type, message: "raw" }));
    await assert.rejects(make(fetch).login("a", "b"), (e) => e.code === type && e.message.includes(expected));
  }
});

test("password policy errors keep Cognito's own explanation", async () => {
  const fetch = fakeFetch(jsonResponse(400, { __type: "InvalidPasswordException", message: "Password must have symbol" }));
  await assert.rejects(make(fetch).signUp("n", "e", "p"), (e) => e.message === "Password must have symbol");
});

test("a type prefix like com.amazon#Name is handled", async () => {
  const fetch = fakeFetch(jsonResponse(400, { __type: "com.amazonaws#NotAuthorizedException" }));
  await assert.rejects(make(fetch).login("a", "b"), (e) => e.code === "NotAuthorizedException");
});

test("unknown errors never leak raw details", async () => {
  const fetch = fakeFetch(jsonResponse(500, { __type: "InternalErrorException", message: "stack trace stuff" }));
  await assert.rejects(make(fetch).login("a", "b"), (e) => !e.message.includes("stack trace"));
});

test("network failure gives the offline message", async () => {
  const fetch = fakeFetch(new TypeError("fetch failed"));
  await assert.rejects(make(fetch).login("a", "b"), (e) => e.code === "NETWORK" && e.message.includes("Can't reach PolishAI"));
});

test("signUp, confirm, resend and revoke hit the right targets", async () => {
  const fetch = fakeFetch(jsonResponse(200, {}));
  const c = make(fetch);
  await c.signUp("Ann", "a@x.com", "pw");
  await c.confirmSignUp("a@x.com", "123456");
  await c.resendCode("a@x.com");
  await c.revoke("refresh");
  const targets = fetch.calls.map((x) => x.options.headers["X-Amz-Target"].split(".")[1]);
  assert.deepEqual(targets, ["SignUp", "ConfirmSignUp", "ResendConfirmationCode", "RevokeToken"]);
  assert.deepEqual(fetch.calls[0].body.UserAttributes, [
    { Name: "email", Value: "a@x.com" },
    { Name: "name", Value: "Ann" },
  ]);
});
