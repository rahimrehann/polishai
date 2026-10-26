"""Public download sign-up for the website. Separate from the main backend on purpose: it has no
login, so a flood here must never be able to slow down or switch off rewrites.

POST {name?, email, chip: arm64|x64|unsure, updates?: bool, company?: honeypot}
Saves one row per email in `polishai-downloads` (a repeat just raises its download count).
Emails, names and IP addresses are never logged.
"""
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone

import boto3
from botocore.exceptions import ClientError

TABLE_NAME = os.environ.get("TABLE_NAME", "polishai-downloads")
DAILY_CAP = int(os.environ.get("MAX_SIGNUPS_PER_DAY", "500"))
PER_VISITOR_PER_HOUR = int(os.environ.get("MAX_PER_VISITOR_PER_HOUR", "5"))
IP_SALT = os.environ.get("IP_SALT", "polishai")

CHIPS = {"arm64", "x64", "unsure"}
EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$")

table = boto3.resource("dynamodb").Table(TABLE_NAME)


class SignupError(Exception):
    def __init__(self, status, code, message):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def respond(status, data):
    return {
        "statusCode": status,
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps(data),
    }


def is_conditional_failure(error):
    return error.response["Error"]["Code"] == "ConditionalCheckFailedException"


def clean(body):
    """Returns (email, name, chip, updates), or raises SignupError for anything off."""
    email = body.get("email")
    if not isinstance(email, str) or len(email.strip()) > 254 or not EMAIL_RE.match(email.strip()):
        raise SignupError(400, "BAD_EMAIL", "Enter a valid email address.")
    name = body.get("name", "")
    if name is None:
        name = ""
    if not isinstance(name, str):
        raise SignupError(400, "BAD_NAME", "Enter your name as text.")
    name = " ".join(name.split())[:80]
    chip = body.get("chip", "unsure")
    if chip not in CHIPS:
        raise SignupError(400, "BAD_CHIP", "Pick Apple Silicon or Intel.")
    return email.strip().lower(), name, chip, body.get("updates") is True


def count_once(pk, limit, expires_at, error):
    try:
        table.update_item(
            Key={"pk": pk},
            UpdateExpression="ADD n :one SET expiresAt = :exp",
            ConditionExpression="attribute_not_exists(n) OR n < :lim",
            ExpressionAttributeValues={":one": 1, ":exp": expires_at, ":lim": limit},
        )
    except ClientError as e:
        if not is_conditional_failure(e):
            raise
        raise error


def visitor_hash(event):
    ip = ((event.get("requestContext") or {}).get("http") or {}).get("sourceIp", "unknown")
    return hashlib.sha256(f"{IP_SALT}:{ip}".encode()).hexdigest()[:20]


def save(email, name, chip, updates, now):
    iso = datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    # A repeat visit without a name keeps the name saved earlier.
    set_name = "#n = :name, " if name else ""
    values = {":chip": chip, ":updates": updates, ":now": iso, ":one": 1}
    if name:
        values[":name"] = name
    table.update_item(
        Key={"pk": f"E#{email}"},
        UpdateExpression=(
            f"SET {set_name}chip = :chip, updates = :updates, lastAt = :now, "
            "firstAt = if_not_exists(firstAt, :now) ADD downloads :one"
        ),
        **({"ExpressionAttributeNames": {"#n": "name"}} if name else {}),
        ExpressionAttributeValues=values,
    )


def lambda_handler(event, context):
    try:
        body = json.loads(event.get("body") or "")
        if not isinstance(body, dict):
            raise ValueError
    except (TypeError, ValueError):
        return respond(400, {"error": "Something was wrong with that request.", "code": "BAD_REQUEST"})

    # Bots fill in the hidden field; people never see it. Pretend it worked.
    if body.get("company"):
        return respond(200, {"ok": True})

    try:
        email, name, chip, updates = clean(body)
        now = int(time.time())
        day = time.strftime("%Y-%m-%d", time.gmtime(now))
        count_once(
            f"IP#{visitor_hash(event)}#{now // 3600}", PER_VISITOR_PER_HOUR, now + 2 * 3600,
            SignupError(429, "SLOW_DOWN", "Too many tries. Please wait a little and try again."),
        )
        count_once(
            f"DAY#{day}", DAILY_CAP, now + 3 * 86400,
            SignupError(503, "FULL_TODAY", "Downloads are busy right now. Please try again tomorrow."),
        )
        save(email, name, chip, updates, now)
    except SignupError as e:
        return respond(e.status, {"error": e.message, "code": e.code})
    except Exception as e:
        print("SIGNUP ERROR:", type(e).__name__)  # the type only, never the request
        return respond(500, {"error": "Something went wrong. Please try again.", "code": "INTERNAL"})
    return respond(200, {"ok": True})
