"""Runs just before Cognito creates an account. Refuses new sign-ups once the day's limit is
reached, so nobody can create thousands of accounts. Raise MAX_SIGNUPS_PER_DAY (this function's
environment) when you want more people to be able to join.
"""
import os
import time

import boto3
from botocore.exceptions import ClientError

TABLE_NAME = "polishai-users"
MAX_SIGNUPS_PER_DAY = int(os.environ.get("MAX_SIGNUPS_PER_DAY", "100"))
FULL_MESSAGE = "Sign-ups are full for today. Please try again tomorrow."

table = boto3.resource("dynamodb").Table(TABLE_NAME)


def lambda_handler(event, context):
    now = int(time.time())
    day = time.strftime("%Y-%m-%d", time.gmtime(now))
    try:
        table.update_item(
            Key={"userId": f"SIGNUPS#{day}"},
            UpdateExpression="ADD nCount :one SET expiresAt = :exp",
            ConditionExpression="attribute_not_exists(nCount) OR nCount < :lim",
            ExpressionAttributeValues={":one": 1, ":exp": now + 3 * 86400, ":lim": MAX_SIGNUPS_PER_DAY},
        )
    except ClientError as e:
        if e.response["Error"]["Code"] == "ConditionalCheckFailedException":
            raise Exception(FULL_MESSAGE)
        raise
    return event  # Cognito needs the event handed back to carry on
