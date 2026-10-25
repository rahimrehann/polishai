"""Moves old usage rows and plaintext Gemini keys to the v2 layout.

Dry run by default. Pass --apply to write. Safe to run more than once.
Needs AWS credentials, and KEY_ENC_SECRET (the same value as the Lambda) in
the environment when there are plaintext keys to encrypt.

  python scripts/migrate_v2.py             # shows what would change
  python scripts/migrate_v2.py --apply
"""
import argparse
import base64
import hashlib
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

import boto3
from botocore.exceptions import ClientError
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

OLD_ROWS_TIME_ZONE = "America/Toronto"

dynamodb = boto3.resource("dynamodb", region_name="us-east-1")
usage = dynamodb.Table("polishai-usage")
users = dynamodb.Table("polishai-users")


def scan_all(table):
    items, kwargs = [], {}
    while True:
        response = table.scan(**kwargs)
        items.extend(response["Items"])
        if "LastEvaluatedKey" not in response:
            return items
        kwargs["ExclusiveStartKey"] = response["LastEvaluatedKey"]


def convert_old_rows(apply):
    old_rows = [r for r in scan_all(usage) if r["timestamp"].isdigit()]
    print(f"old usage rows to convert: {len(old_rows)}")
    zone = ZoneInfo(OLD_ROWS_TIME_ZONE)

    for row in old_rows:
        moment = datetime.fromtimestamp(int(row["timestamp"]) / 1000, tz=timezone.utc)
        iso = moment.strftime("%Y-%m-%dT%H:%M:%S.") + f"{moment.microsecond // 1000:03d}Z"
        suffix = hashlib.sha1(f"{row['userId']}{row['timestamp']}".encode()).hexdigest()[:4]
        text = row.get("originalText", "")
        new_row = {
            "userId": row["userId"],
            "timestamp": f"R#{iso}#{suffix}",
            "localDate": moment.astimezone(zone).strftime("%Y-%m-%d"),
            "format": row.get("format", "message"),
            "source": "extension",
            "inputWords": int(row.get("wordCount", len(text.split()))),
            "outputWords": 0,
            "inputChars": len(text),
            "outputChars": 0,
            "keySource": "unknown",
            "latencyMs": 0,
        }
        if not apply:
            continue
        try:
            usage.put_item(
                Item=new_row,
                ConditionExpression="attribute_not_exists(#t)",
                ExpressionAttributeNames={"#t": "timestamp"},
            )
        except ClientError as e:
            if e.response["Error"]["Code"] != "ConditionalCheckFailedException":
                raise
        usage.delete_item(Key={"userId": row["userId"], "timestamp": row["timestamp"]})


def rebuild_aggregates(apply):
    """Recomputes D#, A# and TOTALS from the R# rows (SET, so reruns are safe)."""
    rows_by_user = defaultdict(list)
    for row in scan_all(usage):
        if row["timestamp"].startswith("R#"):
            rows_by_user[row["userId"]].append(row)

    for user_id, rows in rows_by_user.items():
        days, apps = defaultdict(lambda: defaultdict(int)), defaultdict(lambda: defaultdict(int))
        totals = defaultdict(int)
        first_date = min(r["localDate"] for r in rows)

        for r in rows:
            counters = {
                "rewrites": 1,
                "inputWords": int(r.get("inputWords", 0)),
                "outputWords": int(r.get("outputWords", 0)),
                f"fmt_{r.get('format', 'message')}": 1,
                f"src_{r.get('source', 'extension')}": 1,
            }
            for name, amount in counters.items():
                days[r["localDate"]][name] += amount
                totals[name] += amount
            if r.get("app"):
                apps[r["app"]]["rewrites"] += 1
                apps[r["app"]]["inputWords"] += int(r.get("inputWords", 0))

        print(f"user {user_id[:8]}...: {len(rows)} rewrites, {len(days)} days, {len(apps)} apps")
        if not apply:
            continue

        for day, counters in days.items():
            usage.put_item(Item={"userId": user_id, "timestamp": f"D#{day}", **counters})
        for app, counters in apps.items():
            usage.put_item(Item={
                "userId": user_id, "timestamp": f"A#{app.lower()}", "appName": app, **counters,
            })
        usage.put_item(Item={
            "userId": user_id, "timestamp": "TOTALS", "firstDate": first_date, **totals,
        })


def encrypt_plaintext_keys(apply):
    rows = [r for r in scan_all(users) if r.get("geminiApiKey")]
    print(f"plaintext Gemini keys to encrypt: {len(rows)}")
    if not rows or not apply:
        return

    master = base64.b64decode(os.environ["KEY_ENC_SECRET"])
    for row in rows:
        api_key = row["geminiApiKey"]
        nonce = os.urandom(12)
        blob = base64.b64encode(
            nonce + AESGCM(master).encrypt(nonce, api_key.encode(), row["userId"].encode())
        ).decode()
        users.update_item(
            Key={"userId": row["userId"]},
            UpdateExpression="SET geminiKeyEnc = :enc, geminiKeyLast4 = :last4, keyUpdatedAt = :now REMOVE geminiApiKey",
            ExpressionAttributeValues={":enc": blob, ":last4": api_key[-4:], ":now": int(time.time())},
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="write changes (default is a dry run)")
    args = parser.parse_args()

    print("APPLYING CHANGES" if args.apply else "DRY RUN (nothing is written)")
    convert_old_rows(args.apply)
    rebuild_aggregates(args.apply)
    encrypt_plaintext_keys(args.apply)
