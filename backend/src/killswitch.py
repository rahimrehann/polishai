"""The emergency stop. An alarm (a flood of requests, or spending past the trip-wire) calls this,
and it stops the rewrite function from running at all, so nothing more can be billed.
To switch PolishAI back on:  aws lambda delete-function-concurrency --function-name polishai-rewrite
"""
import boto3

TARGET = "polishai-rewrite"
lambda_client = boto3.client("lambda")


def lambda_handler(event, context):
    lambda_client.put_function_concurrency(FunctionName=TARGET, ReservedConcurrentExecutions=0)
    print(f"KILL SWITCH: {TARGET} stopped")
    return {"stopped": TARGET}
