"""Seeds ~100 days of fake activity for one user. Prints the expected dashboard numbers as JSON."""
import json, sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
import boto3

user_id = sys.argv[1]
table = boto3.resource("dynamodb", region_name="us-east-1").Table("polishai-usage")
today = datetime.now().astimezone().date()

def active(i):
    if i <= 8: return True          # a 9 day streak ending today
    if i in (9, 10): return False   # the gap
    return i % 7 not in (5, 6)      # weekdays before that

days, totals, formats, sources = {}, defaultdict(int), defaultdict(int), defaultdict(int)
for i in range(0, 100):
    if not active(i): continue
    date = (today - timedelta(days=i)).isoformat()
    count = (i * 7) % 9 + 1
    msg = (count + 1) // 2
    email = count - msg
    days[date] = count
    row = {"userId": user_id, "timestamp": f"D#{date}", "rewrites": count, "inputWords": count * 14,
           "outputWords": count * 15, "fmt_message": msg, "fmt_email": email, "src_desktop": count}
    table.put_item(Item={k: v for k, v in row.items() if v != 0 or k in ("rewrites", "inputWords", "outputWords")})
    totals["rewrites"] += count; totals["inputWords"] += count * 14; totals["outputWords"] += count * 15
    formats["fmt_message"] += msg; formats["fmt_email"] += email; sources["src_desktop"] += count

first = min(days)
table.put_item(Item={"userId": user_id, "timestamp": "TOTALS", "firstDate": first,
                     **{k: v for k, v in totals.items()}, **{k: v for k, v in formats.items() if v}, **{k: v for k, v in sources.items()}})

apps = {"Slack": 0.42, "Gmail": 0.3, "Notes": 0.18, "Chrome": 0.1}
total_r = totals["rewrites"]
app_counts = {}
for name, share in apps.items():
    n = int(total_r * share)
    app_counts[name] = n
    table.put_item(Item={"userId": user_id, "timestamp": f"A#{name.lower()}", "appName": name, "rewrites": n, "inputWords": n * 14})

now = datetime.now(timezone.utc)
names = list(apps)
for k in range(12):
    t = now - timedelta(minutes=37 * k + 3)
    iso = t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"
    table.put_item(Item={"userId": user_id, "timestamp": f"R#{iso}#{k:04x}", "localDate": today.isoformat(),
                         "format": "email" if k % 3 == 0 else "message", "source": "desktop", "app": names[k % 4],
                         "inputWords": 8 + k * 3, "outputWords": 9 + k * 3, "inputChars": 50, "outputChars": 55,
                         "keySource": "default", "latencyMs": 900})

window_start = today - timedelta(days=today.weekday() + 1 if today.weekday() != 6 else 0) - timedelta(days=7 * 19)
in_window = {d: c for d, c in days.items() if datetime.fromisoformat(d).date() >= window_start}
print(json.dumps({
    "rewrites": total_r, "words": totals["inputWords"], "streak": 9,
    "windowActive": len(in_window), "topApp": "Slack", "appCounts": app_counts,
    "message": formats["fmt_message"], "email": formats["fmt_email"], "weekRewrites": sum(days.get((today - timedelta(days=i)).isoformat(), 0) for i in range(7)),
}))
