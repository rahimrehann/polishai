import base64
import json
import os
import secrets
import time
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal
from zoneinfo import ZoneInfo

import boto3
from boto3.dynamodb.conditions import Key
from botocore.exceptions import ClientError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from jose import jwt

from providers import PROVIDERS, PROVIDER_NAMES, ProviderError, check_key
from rewrite import rewrite

USER_POOL_ID = "us-east-1_betXW17AO"
CLIENT_ID = "15fipvbne122u6ng7diesu55tr"
REGION = "us-east-1"
ISSUER = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}"

# Daily caps on the shared default Gemini key. Change them in the Lambda
# environment variables, no code deploy needed. Google's free tier for
# gemini-3.5-flash-lite is 500 requests/day for the whole project.
DEFAULT_DAILY_LIMIT = int(os.environ.get("DEFAULT_DAILY_LIMIT", "20"))
GLOBAL_DAILY_LIMIT = int(os.environ.get("GLOBAL_DAILY_LIMIT", "450"))

# Old copies of the desktop app: below MIN_APP_VERSION, rewrites are refused with
# a clear "please update" message. Raise it (Lambda environment) when a backend
# change would break older apps. Missing or unreadable versions are allowed, so
# the Chrome extension, which sends none, keeps working.
MIN_APP_VERSION = os.environ.get("MIN_APP_VERSION", "0.1.0")
LATEST_APP_VERSION = os.environ.get("LATEST_APP_VERSION", "0.1.0")

# The most rewrites PolishAI will do for ALL users together in a day, whichever key they use.
# This is the bill's hard ceiling: it caps the AWS work that every rewrite causes, even for
# people using their own AI key. Raise it (Lambda environment) only when you mean to grow.
TOTAL_DAILY_LIMIT = int(os.environ.get("TOTAL_DAILY_LIMIT", "3000"))

# (most requests, per how many seconds) for each user, whichever key they use.
BURST_LIMITS = {"rewrite": (12, 60), "save_api_key": (6, 60)}

MAX_TEXT_CHARS = 5000
FORMATS = ("message", "email")
SOURCES = ("desktop", "extension")

dynamodb = boto3.resource("dynamodb")
users_table = dynamodb.Table("polishai-users")
usage_table = dynamodb.Table("polishai-usage")

# polishai-usage layout, one partition per user (userId = Cognito sub):
#   R#<iso time>#<rand>   one row per rewrite (metadata only, never the text)
#   D#<YYYY-MM-DD>        daily totals, date in the user's own time zone
#   A#<app name>          per-app totals
#   TOTALS                lifetime totals
# Every read and write below uses the userId from the verified token,
# never a userId sent by the client.


class ApiError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message


def decimal_to_number(obj):
    if isinstance(obj, Decimal):
        return int(obj) if obj % 1 == 0 else float(obj)
    raise TypeError(f"Object of type {type(obj)} is not JSON serializable")


def make_response(status_code, data):
    return {
        "statusCode": status_code,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(data, default=decimal_to_number),
    }


def log_error(label, error):
    # Never log request text, keys or tokens.
    print(label, type(error).__name__, str(error)[:200])


# ---------- Auth ----------

_jwks_cache = {"keys": None, "fetched": 0.0}


def get_jwks(force=False):
    now = time.time()
    stale = now - _jwks_cache["fetched"] > 300
    if _jwks_cache["keys"] is None or (force and stale):
        url = f"{ISSUER}/.well-known/jwks.json"
        with urllib.request.urlopen(url, timeout=3) as response:
            _jwks_cache["keys"] = json.loads(response.read())["keys"]
        _jwks_cache["fetched"] = now
    return _jwks_cache["keys"]


def find_key(kid, force=False):
    return next((k for k in get_jwks(force) if k["kid"] == kid), None)


def verify_token(token):
    kid = jwt.get_unverified_header(token)["kid"]
    key = find_key(kid) or find_key(kid, force=True)
    if key is None:
        raise ValueError("Public key not found in JWKS")

    # Checks signature, expiry and issuer. Cognito access tokens have no aud.
    claims = jwt.decode(
        token,
        key,
        algorithms=["RS256"],
        issuer=ISSUER,
        options={"verify_aud": False, "verify_at_hash": False},
    )

    if claims.get("token_use") != "access":
        raise ValueError("Not an access token")
    if claims.get("client_id") != CLIENT_ID:
        raise ValueError("Token was not issued for this app")
    return claims


# ---------- Small helpers ----------

def safe_zone(name):
    try:
        return ZoneInfo(name)
    except Exception:
        return timezone.utc


def local_date(tz_name, moment=None):
    moment = moment or datetime.now(timezone.utc)
    return moment.astimezone(safe_zone(tz_name)).strftime("%Y-%m-%d")


def clean_app(value):
    if not isinstance(value, str):
        return None
    cleaned = "".join(ch for ch in value if ch.isprintable()).strip()[:64]
    return cleaned or None


def word_count(text):
    return len(text.split())


def query_all(**kwargs):
    items = []
    while True:
        response = usage_table.query(**kwargs)
        items.extend(response.get("Items", []))
        last_key = response.get("LastEvaluatedKey")
        if not last_key:
            return items
        kwargs["ExclusiveStartKey"] = last_key


# ---------- Gemini key encryption ----------
# Keys are encrypted with AES-GCM using a master secret kept in the Lambda
# environment. The userId is bound in, so a stored key can't be moved to
# another user. Free, and the database never holds a readable key.

_key_cache = {}
KEY_CACHE_SECONDS = 300


def master_key():
    return base64.b64decode(os.environ["KEY_ENC_SECRET"])


def encrypt_key(user_id, api_key):
    nonce = os.urandom(12)
    ciphertext = AESGCM(master_key()).encrypt(nonce, api_key.encode(), user_id.encode())
    return base64.b64encode(nonce + ciphertext).decode()


def decrypt_key(user_id, blob):
    raw = base64.b64decode(blob)
    return AESGCM(master_key()).decrypt(raw[:12], raw[12:], user_id.encode()).decode()


def load_user(user_id):
    try:
        return users_table.get_item(Key={"userId": user_id}).get("Item") or {}
    except Exception as e:
        log_error("USER LOOKUP ERROR:", e)
        return {}


def resolve_credentials(user_id, item):
    """The user's own (provider, key, model), or None to use the shared key."""
    cached = _key_cache.get(user_id)
    if cached and cached[1] > time.time():
        return cached[0]

    credentials = None
    if item.get("apiKeyEnc") and item.get("apiProvider") in PROVIDERS:
        try:
            api_key = decrypt_key(user_id, item["apiKeyEnc"])
            credentials = (item["apiProvider"], api_key, item.get("apiModel"))
        except Exception as e:
            log_error("KEY DECRYPT ERROR:", e)

    if credentials:
        _key_cache[user_id] = (credentials, time.time() + KEY_CACHE_SECONDS)
    return credentials


# ---------- App version ----------

def parse_version(text):
    """"1.2.3" becomes (1, 2, 3). Anything else becomes None."""
    if not isinstance(text, str):
        return None
    parts = text.strip().split(".")
    if not 1 <= len(parts) <= 4 or not all(p.isdigit() and len(p) <= 6 for p in parts):
        return None
    return tuple(int(p) for p in parts) + (0,) * (4 - len(parts))


def require_current_app(body):
    sent = parse_version(body.get("appVersion"))
    minimum = parse_version(MIN_APP_VERSION)
    if sent is not None and minimum is not None and sent < minimum:
        raise ApiError(
            426,
            "UPDATE_REQUIRED",
            "This version of PolishAI is out of date. Download the latest version to keep rewriting.",
        )


# ---------- Per-minute limit for everyone ----------

def consume_burst(user_id, action):
    """Stops one account from hammering the server, whichever Gemini/OpenAI/Anthropic key it uses."""
    limit, window = BURST_LIMITS[action]
    now = int(time.time())
    try:
        users_table.update_item(
            Key={"userId": f"RL#{user_id}#{action}#{now // window}"},
            UpdateExpression="ADD rlCount :one SET expiresAt = :exp",
            ConditionExpression="attribute_not_exists(rlCount) OR rlCount < :lim",
            ExpressionAttributeValues={":one": 1, ":exp": now + 2 * window, ":lim": limit},
        )
    except ClientError as e:
        if not is_conditional_failure(e):
            raise
        raise ApiError(429, "SLOW_DOWN", "You're going a little fast. Wait a few seconds and try again.")


def consume_total_ceiling():
    """One count per rewrite for everybody together. Past the ceiling, PolishAI is "full" until tomorrow."""
    now = int(time.time())
    day = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        users_table.update_item(
            Key={"userId": f"TOTAL#{day}"},
            UpdateExpression="ADD tCount :one SET expiresAt = :exp",
            ConditionExpression="attribute_not_exists(tCount) OR tCount < :lim",
            ExpressionAttributeValues={":one": 1, ":exp": now + 3 * 86400, ":lim": TOTAL_DAILY_LIMIT},
        )
    except ClientError as e:
        if not is_conditional_failure(e):
            raise
        raise ApiError(503, "AT_CAPACITY", "PolishAI is at its limit for today. Please try again tomorrow.")


# ---------- Daily limits on the default key ----------

def is_conditional_failure(error):
    return error.response["Error"]["Code"] == "ConditionalCheckFailedException"


def consume_user_quota(user_id, today):
    """Counts one default-key rewrite. Returns the new count for today."""
    key = {"userId": user_id}
    try:
        response = users_table.update_item(
            Key=key,
            UpdateExpression="ADD dqCount :one SET dqDate = :d",
            ConditionExpression="dqDate = :d AND dqCount < :lim",
            ExpressionAttributeValues={":one": 1, ":d": today, ":lim": DEFAULT_DAILY_LIMIT},
            ReturnValues="UPDATED_NEW",
        )
        return int(response["Attributes"]["dqCount"])
    except ClientError as e:
        if not is_conditional_failure(e):
            raise

    # First rewrite of a new day (or first ever).
    try:
        users_table.update_item(
            Key=key,
            UpdateExpression="SET dqDate = :d, dqCount = :one",
            ConditionExpression="attribute_not_exists(dqDate) OR dqDate <> :d",
            ExpressionAttributeValues={":d": today, ":one": 1},
        )
        return 1
    except ClientError as e:
        if not is_conditional_failure(e):
            raise
        raise ApiError(
            429,
            "RATE_LIMITED",
            f"You've used all {DEFAULT_DAILY_LIMIT} free rewrites for today. "
            "Add your own Gemini key in Settings for more.",
        )


def consume_global_quota():
    # Google's daily quota resets at midnight Pacific time.
    day = local_date("America/Los_Angeles")
    expires = int(time.time()) + 3 * 86400
    try:
        users_table.update_item(
            Key={"userId": f"GLOBAL#{day}"},
            UpdateExpression="ADD gCount :one SET expiresAt = :exp",
            ConditionExpression="attribute_not_exists(gCount) OR gCount < :lim",
            ExpressionAttributeValues={":one": 1, ":exp": expires, ":lim": GLOBAL_DAILY_LIMIT},
        )
    except ClientError as e:
        if not is_conditional_failure(e):
            raise
        raise ApiError(
            429,
            "BUSY",
            "PolishAI's shared key is at its daily limit. Try again tomorrow, "
            "or add your own Gemini key in Settings.",
        )


def refund_user_quota(user_id, today):
    try:
        users_table.update_item(
            Key={"userId": user_id},
            UpdateExpression="ADD dqCount :minus",
            ConditionExpression="dqDate = :d AND dqCount > :zero",
            ExpressionAttributeValues={":minus": -1, ":d": today, ":zero": 0},
        )
    except Exception as e:
        log_error("QUOTA REFUND ERROR:", e)


# ---------- Usage logging ----------

def bump(user_id, sort_key, counters, extra_set=None):
    names = {}
    values = {}
    adds = []
    for i, (attr, amount) in enumerate(counters.items()):
        names[f"#c{i}"] = attr
        values[f":c{i}"] = amount
        adds.append(f"#c{i} :c{i}")
    expression = "ADD " + ", ".join(adds)

    if extra_set:
        sets = []
        for i, (attr, value) in enumerate(extra_set.items()):
            names[f"#s{i}"] = attr
            values[f":s{i}"] = value
            sets.append(f"#s{i} = if_not_exists(#s{i}, :s{i})")
        expression += " SET " + ", ".join(sets)

    usage_table.update_item(
        Key={"userId": user_id, "timestamp": sort_key},
        UpdateExpression=expression,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )


def log_usage(user_id, text, result, fmt, source, app, key_source, provider, latency_ms, tz):
    now = datetime.now(timezone.utc)
    iso = now.strftime("%Y-%m-%dT%H:%M:%S.") + f"{now.microsecond // 1000:03d}Z"
    day = local_date(tz, now)
    input_words, output_words = word_count(text), word_count(result)

    item = {
        "userId": user_id,
        "timestamp": f"R#{iso}#{secrets.token_hex(2)}",
        "localDate": day,
        "format": fmt,
        "source": source,
        "inputWords": input_words,
        "outputWords": output_words,
        "inputChars": len(text),
        "outputChars": len(result),
        "keySource": key_source,
        "provider": provider,
        "latencyMs": latency_ms,
    }
    if app:
        item["app"] = app

    usage_table.put_item(
        Item=item,
        ConditionExpression="attribute_not_exists(#t)",
        ExpressionAttributeNames={"#t": "timestamp"},
    )

    counters = {
        "rewrites": 1,
        "inputWords": input_words,
        "outputWords": output_words,
        f"fmt_{fmt}": 1,
        f"src_{source}": 1,
    }
    for sort_key, extra in ((f"D#{day}", None), ("TOTALS", {"firstDate": day})):
        try:
            bump(user_id, sort_key, counters, extra)
        except Exception as e:
            log_error("AGGREGATE ERROR:", e)

    if app:
        try:
            bump(
                user_id,
                f"A#{app.lower()}",
                {"rewrites": 1, "inputWords": input_words},
                {"appName": app},
            )
        except Exception as e:
            log_error("APP AGGREGATE ERROR:", e)


# ---------- Actions ----------

def handle_rewrite(user_id, body):
    require_current_app(body)
    text = body.get("text")
    text = text.strip() if isinstance(text, str) else ""
    if not text:
        raise ApiError(400, "EMPTY_TEXT", "Please provide some text to rewrite.")
    if len(text) > MAX_TEXT_CHARS:
        raise ApiError(400, "TEXT_TOO_LONG", f"Text is too long. The limit is {MAX_TEXT_CHARS} characters.")

    fmt = body.get("format", "message")
    if fmt not in FORMATS:
        raise ApiError(400, "BAD_FORMAT", "Format must be message or email.")

    source = body.get("source", "extension")
    if source not in SOURCES:
        raise ApiError(400, "BAD_SOURCE", "Unknown source.")

    app = clean_app(body.get("app"))
    tz = body.get("tz") if isinstance(body.get("tz"), str) else "UTC"

    consume_burst(user_id, "rewrite")
    consume_total_ceiling()

    item = load_user(user_id)
    credentials = resolve_credentials(user_id, item)
    key_source = "custom" if credentials else "default"
    provider, api_key, model = credentials if credentials else ("gemini", None, None)

    today = local_date(tz)
    used_today = None
    if key_source == "default":
        used_today = consume_user_quota(user_id, today)
        try:
            consume_global_quota()
        except ApiError:
            refund_user_quota(user_id, today)
            raise

    started = time.time()
    try:
        result = rewrite(text, fmt, provider=provider, api_key=api_key, model=model)
    except ProviderError as e:
        log_error("REWRITE ERROR:", e)
        if key_source == "default":
            refund_user_quota(user_id, today)
        if key_source == "custom" and e.kind == "KEY_INVALID":
            raise ApiError(400, "CUSTOM_KEY_INVALID", f"Your {PROVIDER_NAMES[provider]} API key was rejected. Check it in Settings.")
        if e.kind == "QUOTA":
            if key_source == "custom":
                raise ApiError(429, "CUSTOM_KEY_QUOTA", f"Your {PROVIDER_NAMES[provider]} API key hit its usage limit. Try again later.")
            raise ApiError(429, "BUSY", "PolishAI is busy right now. Try again in a few seconds.")
        raise ApiError(502, "REWRITE_FAILED", "Rewrite failed. Please try again.")
    latency_ms = int((time.time() - started) * 1000)

    try:
        log_usage(user_id, text, result, fmt, source, app, key_source, provider, latency_ms, tz)
    except Exception as e:
        log_error("USAGE LOG ERROR:", e)

    response = {
        "result": result,
        "outputWords": word_count(result),
        "keySource": key_source,
        "provider": provider,
    }
    if key_source == "default":
        response["usedToday"] = used_today
        response["dailyLimit"] = DEFAULT_DAILY_LIMIT
    return make_response(200, response)


def handle_get_settings(user_id, body):
    item = load_user(user_id)
    provider = item.get("apiProvider") if item.get("apiKeyEnc") else None
    tz = body.get("tz") if isinstance(body.get("tz"), str) else "UTC"
    used_today = int(item.get("dqCount", 0)) if item.get("dqDate") == local_date(tz) else 0
    return make_response(200, {
        "hasCustomKey": bool(provider),
        "provider": provider,
        "keyLast4": item.get("apiKeyLast4") if provider else None,
        "dailyLimit": DEFAULT_DAILY_LIMIT,
        "usedToday": used_today,
        "minAppVersion": MIN_APP_VERSION,
        "latestAppVersion": LATEST_APP_VERSION,
    })


def handle_save_api_key(user_id, body):
    provider = body.get("provider", "gemini")
    if provider not in PROVIDERS:
        raise ApiError(400, "BAD_PROVIDER", "Choose Gemini, OpenAI or Anthropic.")

    api_key = body.get("apiKey")
    api_key = api_key.strip() if isinstance(api_key, str) else ""
    if not api_key or len(api_key) > 300:
        raise ApiError(400, "BAD_KEY", "Please provide an API key.")

    consume_burst(user_id, "save_api_key")

    name = PROVIDER_NAMES[provider]
    try:
        model = check_key(provider, api_key)
    except ProviderError as e:
        log_error("API KEY VALIDATION ERROR:", e)
        if e.kind == "KEY_INVALID":
            raise ApiError(400, "CUSTOM_KEY_INVALID", f"This {name} key doesn't seem to work. Check it and try again.")
        if e.kind == "QUOTA":
            raise ApiError(400, "CUSTOM_KEY_QUOTA", f"This {name} key has no usage available right now. Check your plan or billing on {name}.")
        raise ApiError(502, "KEY_CHECK_FAILED", f"Couldn't check your {name} key right now. Try again in a moment.")

    users_table.update_item(
        Key={"userId": user_id},
        UpdateExpression=(
            "SET apiProvider = :provider, apiKeyEnc = :enc, apiKeyLast4 = :last4, apiModel = :model, keyUpdatedAt = :now "
            "REMOVE geminiKeyEnc, geminiKeyLast4, geminiApiKey"
        ),
        ExpressionAttributeValues={
            ":provider": provider,
            ":enc": encrypt_key(user_id, api_key),
            ":last4": api_key[-4:],
            ":model": model,
            ":now": int(time.time()),
        },
    )
    _key_cache.pop(user_id, None)
    return make_response(200, {"success": True, "provider": provider, "keyLast4": api_key[-4:]})


def handle_delete_api_key(user_id, body):
    users_table.update_item(
        Key={"userId": user_id},
        UpdateExpression="REMOVE apiProvider, apiKeyEnc, apiKeyLast4, apiModel, keyUpdatedAt, geminiKeyEnc, geminiKeyLast4, geminiApiKey",
    )
    _key_cache.pop(user_id, None)
    return make_response(200, {"success": True})


def encode_cursor(last_key):
    return base64.urlsafe_b64encode(json.dumps(last_key).encode()).decode()


def decode_cursor(cursor, user_id):
    """Returns an ExclusiveStartKey, only ever for this user's own rewrite rows."""
    try:
        data = json.loads(base64.urlsafe_b64decode(cursor.encode()))
        sort_key = data["timestamp"]
        if data["userId"] != user_id or not sort_key.startswith("R#"):
            raise ValueError("cursor mismatch")
        return {"userId": user_id, "timestamp": sort_key}
    except Exception:
        raise ApiError(400, "BAD_CURSOR", "Invalid cursor.")


def handle_get_recent(user_id, body):
    try:
        limit = min(max(int(body.get("limit", 20)), 1), 50)
    except (TypeError, ValueError):
        limit = 20

    kwargs = {
        "KeyConditionExpression": Key("userId").eq(user_id) & Key("timestamp").begins_with("R#"),
        "ScanIndexForward": False,
        "Limit": limit,
    }
    if body.get("cursor"):
        kwargs["ExclusiveStartKey"] = decode_cursor(body["cursor"], user_id)

    response = usage_table.query(**kwargs)
    items = []
    for row in response.get("Items", []):
        row = dict(row)
        row.pop("userId", None)
        sort_key = row.pop("timestamp")
        row["id"] = sort_key
        row["at"] = sort_key.split("#")[1]
        items.append(row)

    result = {"items": items}
    if response.get("LastEvaluatedKey"):
        result["cursor"] = encode_cursor(response["LastEvaluatedKey"])
    return make_response(200, result)


def handle_get_stats(user_id, body):
    partition = Key("userId").eq(user_id)

    totals = usage_table.get_item(Key={"userId": user_id, "timestamp": "TOTALS"}).get("Item") or {}
    totals.pop("userId", None)
    totals.pop("timestamp", None)

    days = []
    for row in query_all(KeyConditionExpression=partition & Key("timestamp").begins_with("D#")):
        days.append({
            "date": row["timestamp"][2:],
            "rewrites": row.get("rewrites", 0),
            "inputWords": row.get("inputWords", 0),
            "outputWords": row.get("outputWords", 0),
            "message": row.get("fmt_message", 0),
            "email": row.get("fmt_email", 0),
        })

    apps = [
        {"name": row.get("appName", row["timestamp"][2:]), "rewrites": row.get("rewrites", 0)}
        for row in query_all(KeyConditionExpression=partition & Key("timestamp").begins_with("A#"))
    ]
    apps.sort(key=lambda a: a["rewrites"], reverse=True)

    return make_response(200, {"totals": totals, "days": days, "apps": apps[:8]})


def handle_delete_my_data(user_id, body):
    rows = query_all(
        KeyConditionExpression=Key("userId").eq(user_id),
        ProjectionExpression="userId, #t",
        ExpressionAttributeNames={"#t": "timestamp"},
    )
    with usage_table.batch_writer() as batch:
        for row in rows:
            batch.delete_item(Key={"userId": row["userId"], "timestamp": row["timestamp"]})
    users_table.delete_item(Key={"userId": user_id})
    _key_cache.pop(user_id, None)
    return make_response(200, {"deleted": len(rows)})


ACTIONS = {
    "rewrite": handle_rewrite,
    "get_settings": handle_get_settings,
    "save_api_key": handle_save_api_key,
    "delete_api_key": handle_delete_api_key,
    "get_stats": handle_get_stats,
    "get_recent": handle_get_recent,
    "get_usage": handle_get_recent,  # old name, remove once the old desktop build is gone
    "delete_my_data": handle_delete_my_data,
}


def lambda_handler(event, context):
    headers = event.get("headers", {}) or {}
    auth_header = headers.get("authorization") or headers.get("Authorization")

    if not auth_header or not auth_header.startswith("Bearer "):
        return make_response(401, {"error": "Missing or invalid Authorization header", "code": "UNAUTHORIZED"})

    try:
        claims = verify_token(auth_header.split(" ", 1)[1])
    except Exception as e:
        log_error("TOKEN VERIFICATION ERROR:", e)
        return make_response(401, {"error": "Invalid or expired token", "code": "UNAUTHORIZED"})

    user_id = claims["sub"]

    try:
        body = json.loads(event["body"])
        if not isinstance(body, dict):
            raise ValueError("body must be an object")
    except (KeyError, TypeError, ValueError):
        return make_response(400, {"error": "Request body must be valid JSON", "code": "BAD_REQUEST"})

    handler = ACTIONS.get(body.get("action", "rewrite"))
    if handler is None:
        return make_response(400, {"error": "Unknown action", "code": "BAD_ACTION"})

    try:
        return handler(user_id, body)
    except ApiError as e:
        return make_response(e.status, {"error": e.message, "code": e.code})
    except Exception as e:
        log_error("UNHANDLED ERROR:", e)
        return make_response(500, {"error": "Something went wrong. Please try again.", "code": "INTERNAL"})
