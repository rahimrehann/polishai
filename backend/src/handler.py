import json
import time
import boto3
from jose import jwk, jwt
from jose.utils import base64url_decode
import urllib.request
from rewrite import rewrite

USER_POOL_ID = "us-east-1_betXW17AO"
CLIENT_ID = "15fipvbne122u6ng7diesu55tr"
REGION = "us-east-1"

dynamodb = boto3.resource("dynamodb")
users_table = dynamodb.Table("polishai-users")
usage_table = dynamodb.Table("polishai-usage")

_jwks_cache = None


def get_jwks():
    global _jwks_cache
    if _jwks_cache is None:
        url = f"https://cognito-idp.{REGION}.amazonaws.com/{USER_POOL_ID}/.well-known/jwks.json"
        with urllib.request.urlopen(url) as response:
            _jwks_cache = json.loads(response.read())["keys"]
    return _jwks_cache


def verify_token(token):
    headers = jwt.get_unverified_headers(token)
    kid = headers["kid"]

    keys = get_jwks()
    key = next((k for k in keys if k["kid"] == kid), None)
    if key is None:
        raise ValueError("Public key not found in JWKS")

    public_key = jwk.construct(key)
    message, encoded_signature = token.rsplit(".", 1)
    decoded_signature = base64url_decode(encoded_signature.encode("utf-8"))

    if not public_key.verify(message.encode("utf-8"), decoded_signature):
        raise ValueError("Signature verification failed")

    claims = jwt.get_unverified_claims(token)

    if time.time() > claims["exp"]:
        raise ValueError("Token expired")

    if claims.get("client_id") != CLIENT_ID and claims.get("aud") != CLIENT_ID:
        raise ValueError("Token was not issued for this app")

    return claims


def make_response(status_code, data):
    return {
        "statusCode": status_code,
        "body": json.dumps(data),
    }


def lambda_handler(event, context):
    headers = event.get("headers", {}) or {}
    auth_header = headers.get("authorization") or headers.get("Authorization")

    if not auth_header or not auth_header.startswith("Bearer "):
        return make_response(401, {"error": "Missing or invalid Authorization header"})

    token = auth_header.split(" ", 1)[1]

    try:
        claims = verify_token(token)
    except Exception as e:
        print("TOKEN VERIFICATION ERROR:", repr(e))
        return make_response(401, {"error": "Invalid or expired token"})

    user_id = claims["sub"]

    try:
        body = json.loads(event["body"])
    except (KeyError, TypeError, json.JSONDecodeError):
        return make_response(400, {"error": "Request body must be valid JSON"})

    text = body.get("text", "").strip()
    if not text:
        return make_response(400, {"error": "Please provide some text to rewrite"})

    format = body.get("format", "message")

    api_key = None
    try:
        user_item = users_table.get_item(Key={"userId": user_id}).get("Item")
        if user_item:
            api_key = user_item.get("geminiApiKey")
    except Exception as e:
        print("USER LOOKUP ERROR:", repr(e))

    try:
        result = rewrite(text, format, api_key=api_key)
    except Exception as e:
        print("REWRITE ERROR:", repr(e))
        return make_response(500, {"error": "Rewrite failed. Please try again."})

    try:
        word_count = len(text.split())
        usage_table.put_item(Item={
            "userId": user_id,
            "timestamp": str(int(time.time() * 1000)),
            "originalText": text,
            "wordCount": word_count,
            "format": format,
        })
    except Exception as e:
        print("USAGE LOG ERROR:", repr(e))

    return make_response(200, {"result": result})