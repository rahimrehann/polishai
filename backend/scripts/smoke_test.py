"""Live end-to-end check of the deployed Lambda. Uses a temporary Cognito test
user (created and deleted here) and one or two real default-key rewrites.
Never prints tokens or the password.

  python scripts/smoke_test.py
"""
import json
import secrets
import string
import subprocess
import sys
import urllib.error
import urllib.request

POOL = "us-east-1_betXW17AO"
CLIENT = "15fipvbne122u6ng7diesu55tr"
URL = "https://zrixwg6huied4ttlcdhxuoa2mq0lnnkf.lambda-url.us-east-1.on.aws/"
EMAIL = f"polishai-smoke-{secrets.token_hex(3)}@example.com"

failures = []


def aws(*args):
    out = subprocess.run(
        ["aws", "--region", "us-east-1", *args], capture_output=True, text=True
    )
    if out.returncode != 0:
        raise RuntimeError(out.stderr.strip()[:300])
    return json.loads(out.stdout) if out.stdout.strip() else {}


def call(token, body, raw=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = raw if raw is not None else json.dumps(body).encode()
    request = urllib.request.Request(URL, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(request, timeout=40) as response:
            return response.status, json.loads(response.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def check(name, condition, detail=""):
    print(("PASS  " if condition else "FAIL  ") + name + (f"  [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)


def main():
    password = "Aa1!" + "".join(secrets.choice(string.ascii_letters + string.digits) for _ in range(16))
    aws("cognito-idp", "admin-create-user", "--user-pool-id", POOL, "--username", EMAIL,
        "--user-attributes", f"Name=email,Value={EMAIL}", "Name=email_verified,Value=true", "Name=name,Value=Smoke Test",
        "--message-action", "SUPPRESS")
    token = id_token = None
    try:
        aws("cognito-idp", "admin-set-user-password", "--user-pool-id", POOL, "--username", EMAIL,
            "--password", password, "--permanent")
        auth = aws("cognito-idp", "initiate-auth", "--auth-flow", "USER_PASSWORD_AUTH", "--client-id", CLIENT,
                   "--auth-parameters", f"USERNAME={EMAIL},PASSWORD={password}")["AuthenticationResult"]
        token, id_token = auth["AccessToken"], auth["IdToken"]

        status, _ = call(None, {"action": "get_settings"})
        check("no token -> 401", status == 401)
        status, _ = call("garbage.token.value", {"action": "get_settings"})
        check("garbage token -> 401", status == 401)
        status, _ = call(id_token, {"action": "get_settings"})
        check("ID token rejected (access token required) -> 401", status == 401)
        status, data = call(token, None, raw=b"not json")
        check("bad JSON -> 400", status == 400)
        status, data = call(token, {"action": "drop_tables"})
        check("unknown action -> 400 BAD_ACTION", status == 400 and data.get("code") == "BAD_ACTION")

        status, data = call(token, {"action": "get_settings", "tz": "America/Toronto"})
        check("get_settings: default key, 0 used", status == 200 and data.get("hasCustomKey") is False
              and data.get("usedToday") == 0 and data.get("dailyLimit") == 20, str(data))

        status, data = call(token, {"action": "save_api_key", "provider": "mystery", "apiKey": "k"})
        check("unknown provider -> 400 BAD_PROVIDER", status == 400 and data.get("code") == "BAD_PROVIDER", str(data))
        for provider, name in (("gemini", "Gemini"), ("openai", "OpenAI"), ("anthropic", "Anthropic")):
            status, data = call(token, {"action": "save_api_key", "provider": provider, "apiKey": "not-a-real-key-123456"})
            check(f"fake {name} key rejected by the real {name} service", status == 400 and data.get("code") == "CUSTOM_KEY_INVALID"
                  and name in data.get("error", ""), f"{status} {data}")
        status, data = call(token, {"action": "get_settings"})
        check("failed saves leave the user on the shared key", status == 200 and data.get("hasCustomKey") is False and data.get("provider") is None, str(data))
        status, data = call(token, {"action": "delete_api_key"})
        check("switching back to the free key works with nothing saved", status == 200 and data.get("success") is True, str(data))

        status, data = call(token, {"text": "x" * 5001})
        check("5001 chars -> 400 TEXT_TOO_LONG", status == 400 and data.get("code") == "TEXT_TOO_LONG")
        status, data = call(token, {"text": "hi", "format": "poem"})
        check("bad format -> 400", status == 400 and data.get("code") == "BAD_FORMAT")

        status, data = call(token, {"text": "hey can u send me the file when ur free, thx", "format": "message",
                                    "source": "desktop", "app": "Slack", "tz": "America/Toronto"})
        check("rewrite message (default key)", status == 200 and data.get("result") and data.get("keySource") == "default"
              and data.get("usedToday") == 1 and data.get("dailyLimit") == 20, str(data)[:200])
        print("      message ->", (data.get("result") or "")[:120].replace("\n", " "))

        status, data = call(token, {"text": "need the report by friday, its urgent", "format": "email",
                                    "source": "desktop", "app": "Gmail", "tz": "America/Toronto"})
        check("rewrite email (default key)", status == 200 and data.get("usedToday") == 2, str(data)[:200])
        print("      email   ->", (data.get("result") or "")[:120].replace("\n", " / "))

        status, data = call(token, {"action": "get_stats"})
        totals = data.get("totals", {})
        check("get_stats totals", status == 200 and totals.get("rewrites") == 2 and totals.get("fmt_message") == 1
              and totals.get("fmt_email") == 1 and totals.get("src_desktop") == 2, str(data)[:300])
        check("get_stats one day row, two apps", len(data.get("days", [])) == 1
              and {a["name"] for a in data.get("apps", [])} == {"Slack", "Gmail"}, str(data)[:300])

        status, data = call(token, {"action": "get_recent", "limit": 1})
        items = data.get("items", [])
        check("get_recent paging: 1 item + cursor", status == 200 and len(items) == 1 and data.get("cursor"))
        check("recent rows record the provider", items and items[0].get("provider") == "gemini", str(items)[:200])
        check("recent rows store NO rewrite text", items and not any(k in items[0] for k in ("originalText", "text", "result")), str(items)[:200])
        status, page2 = call(token, {"action": "get_recent", "limit": 1, "cursor": data.get("cursor")})
        check("get_recent page 2 has the other row", status == 200 and len(page2.get("items", [])) == 1
              and page2["items"][0]["id"] != items[0]["id"])
        status, _ = call(token, {"action": "get_recent", "cursor": "AAAA"})
        check("forged cursor -> 400", status == 400)

        status, data = call(token, {"action": "get_settings", "tz": "America/Toronto"})
        check("get_settings now shows 2 used", status == 200 and data.get("usedToday") == 2, str(data))
    finally:
        try:
            if token:
                status, data = call(token, {"action": "delete_my_data"})
                check("delete_my_data cleans up", status == 200 and data.get("deleted", 0) >= 5, str(data))
                status, data = call(token, {"action": "get_stats"})
                check("stats empty after delete", status == 200 and not data.get("days") and not data.get("totals"))
        finally:
            aws("cognito-idp", "admin-delete-user", "--user-pool-id", POOL, "--username", EMAIL)
            print("test user deleted")

    print("\nALL PASSED" if not failures else f"\n{len(failures)} FAILED: {failures}")
    sys.exit(1 if failures else 0)


if __name__ == "__main__":
    main()
