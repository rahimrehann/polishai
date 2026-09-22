import json
from rewrite import rewrite


def make_response(status_code, data):
    return {
        "statusCode": status_code,
        "body": json.dumps(data),
    }


def lambda_handler(event, context):
    try:
        body = json.loads(event["body"])
    except (KeyError, TypeError, json.JSONDecodeError):
        return make_response(400, {"error": "Request body must be valid JSON"})

    text = body.get("text", "").strip()
    if not text:
        return make_response(400, {"error": "Please provide some text to rewrite"})

    format = body.get("format", "message")

    try:
        result = rewrite(text, format)
    except Exception as e:
        print("REWRITE ERROR:", repr(e))
        return make_response(500, {"error": "Rewrite failed. Please try again."})

    return make_response(200, {"result": result})