"""Checks that every protection against a surprise bill is in place and working. Read-only.

  backend/.venv/bin/python backend/scripts/check_protections.py

Prints a tick or a cross for each guard, then the worst case if everything else failed.
(Gemini can't be checked from here: open https://aistudio.google.com/billing and make sure it
says "No billing account". With no billing account Google cannot charge you.)
"""
import boto3

R = "us-east-1"
ACCOUNT = "423479236096"
lam = boto3.client("lambda", region_name=R)
cw = boto3.client("cloudwatch", region_name=R)
ddb = boto3.client("dynamodb", region_name=R)
cognito = boto3.client("cognito-idp", region_name=R)
sns = boto3.client("sns", region_name=R)
budgets = boto3.client("budgets", region_name=R)
logs = boto3.client("logs", region_name=R)

problems = []


def show(ok, text, detail=""):
    print(f"  [{'OK' if ok else 'FIX'}] {text}" + (f"   ({detail})" if detail else ""))
    if not ok:
        problems.append(text)


print("PolishAI backend")
config = lam.get_function_configuration(FunctionName="polishai-rewrite")
env = config["Environment"]["Variables"]
try:
    reserved = lam.get_function_concurrency(FunctionName="polishai-rewrite").get("ReservedConcurrentExecutions")
except Exception:
    reserved = None
show(reserved != 0, "backend is switched ON" if reserved != 0 else "backend is switched OFF (kill switch fired)",
     "to switch on: aws lambda delete-function-concurrency --function-name polishai-rewrite" if reserved == 0 else "")
limit = lam.get_account_settings()["AccountLimit"]["ConcurrentExecutions"]
show(limit <= 100, "only a few rewrites can run at the same instant (caps AWS compute cost)", f"{limit} at once")
show(config["Timeout"] <= 30 and config["MemorySize"] <= 256, "each request is short and small", f"{config['Timeout']}s, {config['MemorySize']} MB")
total = int(env.get("TOTAL_DAILY_LIMIT", "3000"))
show(total <= 20000, "all rewrites together are capped per day, whatever key people use", f"{total} a day")
show("DEFAULT_DAILY_LIMIT" in env and "GLOBAL_DAILY_LIMIT" in env, "per-person and shared-key daily limits are set",
     f"{env.get('DEFAULT_DAILY_LIMIT')} each, {env.get('GLOBAL_DAILY_LIMIT')} shared")
groups = logs.describe_log_groups(logGroupNamePrefix="/aws/lambda/polishai-rewrite")["logGroups"]
show(bool(groups) and groups[0].get("retentionInDays", 9999) <= 90, "old logs are deleted automatically", f"{groups[0].get('retentionInDays')} days" if groups else "")

print("\nDatabase")
for table in ("polishai-usage", "polishai-users"):
    t = ddb.describe_table(TableName=table)["Table"]
    cap = t.get("OnDemandThroughput") or {}
    show(bool(cap.get("MaxWriteRequestUnits")) and bool(cap.get("MaxReadRequestUnits")),
         f"{table}: speed is capped", f"{cap.get('MaxReadRequestUnits')} reads/s, {cap.get('MaxWriteRequestUnits')} writes/s")
    show(t.get("DeletionProtectionEnabled", False), f"{table}: can't be deleted by accident")

print("\nSign-ups")
pool = cognito.describe_user_pool(UserPoolId="us-east-1_betXW17AO")["UserPool"]
pre = pool.get("LambdaConfig", {}).get("PreSignUp", "")
show(pre.endswith("polishai-presignup"), "new accounts are limited per day")
if pre:
    su = lam.get_function_configuration(FunctionName="polishai-presignup")["Environment"]["Variables"].get("MAX_SIGNUPS_PER_DAY")
    show(su is not None and int(su) <= 1000, "the daily sign-up limit is set", f"{su} a day")
show(pool["UserPoolTier"] in ("ESSENTIALS", "LITE"), "login plan is the cheap one (free up to 10,000 active users)", pool["UserPoolTier"])

print("\nAutomatic stops and warnings")
try:
    lam.get_function(FunctionName="polishai-killswitch")
    show(True, "the kill switch function exists")
except Exception:
    show(False, "the kill switch function exists")
alarms = {a["AlarmName"]: a for a in cw.describe_alarms(AlarmNamePrefix="polishai-")["MetricAlarms"]}
kill_topic = f"arn:aws:sns:{R}:{ACCOUNT}:polishai-killswitch"
for name, what in (("polishai-flood-stop", "a flood of requests stops PolishAI automatically"),
                   ("polishai-bill-stop", "the AWS bill reaching $9 stops PolishAI automatically")):
    a = alarms.get(name)
    show(bool(a) and kill_topic in a["AlarmActions"], what, f"trips at {a['Threshold']:g}" if a else "")
for name, what in (("polishai-unhandled-errors", "an unexpected error sends an alert"),
                   ("polishai-lambda-errors", "a crash sends an alert"),
                   ("polishai-lambda-throttles", "running out of capacity sends an alert"),
                   ("polishai-billing-alarm", "the bill passing $5 sends an alert")):
    show(name in alarms, what, alarms[name]["StateValue"] if name in alarms else "")
b = [x for x in budgets.describe_budgets(AccountId=ACCOUNT)["Budgets"] if x["BudgetName"] == "polishai-monthly-10usd"]
show(bool(b), "a $10 monthly budget alert exists")

print("\nDo the alerts actually reach you? (an email link must be clicked once)")
subs = sns.list_subscriptions_by_topic(TopicArn=f"arn:aws:sns:{R}:{ACCOUNT}:polishai-alerts")["Subscriptions"]
email = [s for s in subs if s["Protocol"] == "email"]
confirmed = [s for s in email if s["SubscriptionArn"] != "PendingConfirmation"]
show(bool(confirmed), "your email is confirmed on the alert list", "not confirmed yet: open the email from AWS and click the link" if email and not confirmed else "")
# Every alarm that should reach a person must notify the confirmed list.
for name, alarm in alarms.items():
    if name in ("polishai-flood-stop", "polishai-bill-stop", "polishai-billing-alarm", "polishai-unhandled-errors", "polishai-lambda-errors", "polishai-lambda-throttles"):
        reaches = any(a.endswith(":polishai-alerts") for a in alarm["AlarmActions"])
        show(reaches, f"{name} emails you", "" if reaches else "it only notifies a list nobody is on")

print("\nWorst case if people try to run up the bill")
print(f"  - Gemini: $0. No billing account, so the free tier simply says 'busy' when it runs out.")
print(f"  - Sign-ups: at most {su if pre else '?'} new accounts a day; login is free up to 10,000 active users.")
print(f"  - A request flood: AWS is cut off after about 5 minutes (2,000+ requests), costing cents.")
print(f"  - Everything else failing: AWS is cut off when this month's bill reaches $9.")

print()
print("ALL PROTECTIONS IN PLACE" if not problems else f"{len(problems)} THING(S) TO FIX:\n  - " + "\n  - ".join(problems))
