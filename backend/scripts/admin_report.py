"""A read-only report on how PolishAI is being used. Counts only: no emails, no text.

  backend/.venv/bin/python backend/scripts/admin_report.py            # anonymous
  backend/.venv/bin/python backend/scripts/admin_report.py --emails   # also list who signed up recently

Needs AWS access (the same login the other scripts use). It only reads.
"""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

import boto3

POOL = "us-east-1_betXW17AO"
GLOBAL_DAILY_LIMIT = 450
PER_USER_DAILY_LIMIT = 20

cognito = boto3.client("cognito-idp", region_name="us-east-1")
dynamo = boto3.resource("dynamodb", region_name="us-east-1")
usage, users = dynamo.Table("polishai-usage"), dynamo.Table("polishai-users")


def scan(table, **kwargs):
    items = []
    while True:
        page = table.scan(**kwargs)
        items += page["Items"]
        if "LastEvaluatedKey" not in page:
            return items
        kwargs["ExclusiveStartKey"] = page["LastEvaluatedKey"]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--emails", action="store_true", help="list recent sign-ups with their email")
    args = parser.parse_args()
    today = datetime.now(timezone.utc).astimezone().date()

    # ---- accounts ----
    accounts = []
    for page in cognito.get_paginator("list_users").paginate(UserPoolId=POOL):
        accounts += page["Users"]
    status = Counter(a["UserStatus"] for a in accounts)
    print(f"ACCOUNTS: {len(accounts)} total")
    print(f"  confirmed (can log in): {status.get('CONFIRMED', 0)}")
    print(f"  not confirmed yet:      {status.get('UNCONFIRMED', 0)}")

    signups = Counter(a["UserCreateDate"].astimezone().date() for a in accounts)
    print("  sign-ups, last 14 days: " + (", ".join(
        f"{d.strftime('%b %d')}: {signups[d]}" for d in sorted(signups) if (today - d).days < 14) or "none"))
    if args.emails:
        recent = sorted(accounts, key=lambda a: a["UserCreateDate"], reverse=True)[:10]
        print("  newest accounts:")
        for a in recent:
            email = next((x["Value"] for x in a["Attributes"] if x["Name"] == "email"), "?")
            print(f"    {a['UserCreateDate'].astimezone().strftime('%b %d %H:%M')}  {a['UserStatus']:<12} {email}")

    # ---- use ----
    rows = scan(usage, FilterExpression="begins_with(#t, :d) OR #t = :totals",
                ExpressionAttributeNames={"#t": "timestamp"},
                ExpressionAttributeValues={":d": "D#", ":totals": "TOTALS"})
    totals = {r["userId"]: r for r in rows if r["timestamp"] == "TOTALS"}
    days_by_user = defaultdict(dict)
    for r in rows:
        if r["timestamp"].startswith("D#"):
            days_by_user[r["userId"]][r["timestamp"][2:]] = int(r.get("rewrites", 0))

    def active_since(days):
        cutoff = (today - timedelta(days=days - 1)).isoformat()
        return sum(1 for d in days_by_user.values() if any(date >= cutoff and n > 0 for date, n in d.items()))

    all_rewrites = sum(int(t.get("rewrites", 0)) for t in totals.values())
    all_words = sum(int(t.get("inputWords", 0)) for t in totals.values())
    print(f"\nUSE")
    print(f"  people who have made a rewrite: {len(totals)} of {len(accounts)} accounts")
    print(f"  active today / last 7 days / last 30 days: {active_since(1)} / {active_since(7)} / {active_since(30)}")
    print(f"  rewrites ever: {all_rewrites:,}   words polished ever: {all_words:,}")
    per_day = Counter()
    for d in days_by_user.values():
        for date, n in d.items():
            per_day[date] += n
    last7 = [(today - timedelta(days=i)).isoformat() for i in range(6, -1, -1)]
    print("  rewrites per day, last 7 days: " + ", ".join(f"{d[5:]}: {per_day.get(d, 0)}" for d in last7))
    sizes = sorted((int(t.get("rewrites", 0)) for t in totals.values()), reverse=True)
    if sizes:
        print(f"  heaviest users (rewrites ever, anonymous): {sizes[:5]}")

    # ---- the shared key ----
    pacific_day = datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat()
    row = users.get_item(Key={"userId": f"GLOBAL#{pacific_day}"}).get("Item")
    used = int(row["gCount"]) if row else 0
    print(f"\nSHARED GEMINI KEY (resets at midnight Pacific)")
    print(f"  used today: {used} of {GLOBAL_DAILY_LIMIT}  ({used * 100 // GLOBAL_DAILY_LIMIT}%)")
    print(f"  per-person limit: {PER_USER_DAILY_LIMIT} a day -> the pool covers about {GLOBAL_DAILY_LIMIT // PER_USER_DAILY_LIMIT} people at full use")

    settings = [i for i in scan(users) if not i["userId"].startswith(("GLOBAL#", "RL#"))]
    providers = Counter(i["apiProvider"] for i in settings if i.get("apiKeyEnc"))
    own = sum(providers.values())
    print(f"  people using their OWN key (not the shared pool): {own}" + (
        "  (" + ", ".join(f"{p}: {n}" for p, n in providers.items()) + ")" if own else ""))

    # ---- leftovers: data for accounts that no longer exist (it only reports, it never deletes) ----
    live = {next(x["Value"] for x in a["Attributes"] if x["Name"] == "sub") for a in accounts}
    stored = {r["userId"] for r in scan(usage, ProjectionExpression="userId")}
    stored |= {i["userId"] for i in scan(users, ProjectionExpression="userId") if not i["userId"].startswith(("GLOBAL#", "RL#"))}
    orphans = sorted(stored - live)
    print(f"\nLEFTOVER DATA from accounts that no longer exist: {len(orphans)} (should be 0)")
    for uid in orphans:
        print(f"  account {uid[:8]}...")

    # ---- mix ----
    fmt, src = Counter(), Counter()
    for t in totals.values():
        fmt["message"] += int(t.get("fmt_message", 0)); fmt["email"] += int(t.get("fmt_email", 0))
        src["desktop app"] += int(t.get("src_desktop", 0)); src["chrome extension"] += int(t.get("src_extension", 0))
    print(f"\nMIX  messages: {fmt['message']}, emails: {fmt['email']}  |  from the desktop app: {src['desktop app']}, from the Chrome extension: {src['chrome extension']}")


if __name__ == "__main__":
    main()
