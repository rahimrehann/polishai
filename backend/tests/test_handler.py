"""Run from backend/:  python -m unittest discover -s tests -v"""
import base64
import json
import os
import sys
import unittest
from datetime import datetime, timezone
from unittest import mock

os.environ.setdefault("GEMINI_API_KEY", "test-default-key")
os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
os.environ["KEY_ENC_SECRET"] = base64.b64encode(b"k" * 32).decode()
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import handler  # noqa: E402
from botocore.exceptions import ClientError  # noqa: E402
from rewrite import GeminiError  # noqa: E402


def conditional_failure():
    return ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")


class EncryptionTests(unittest.TestCase):
    def test_roundtrip(self):
        blob = handler.encrypt_key("user-1", "AIza-secret")
        self.assertNotIn("AIza", blob)
        self.assertEqual(handler.decrypt_key("user-1", blob), "AIza-secret")

    def test_key_is_bound_to_user(self):
        blob = handler.encrypt_key("user-1", "AIza-secret")
        with self.assertRaises(Exception):
            handler.decrypt_key("user-2", blob)

    def test_tampering_detected(self):
        raw = bytearray(base64.b64decode(handler.encrypt_key("user-1", "AIza-secret")))
        raw[-1] ^= 1
        with self.assertRaises(Exception):
            handler.decrypt_key("user-1", base64.b64encode(bytes(raw)).decode())


class HelperTests(unittest.TestCase):
    def test_local_date_uses_user_zone(self):
        moment = datetime(2026, 10, 26, 2, 30, tzinfo=timezone.utc)  # 10:30pm Oct 25 in Toronto
        self.assertEqual(handler.local_date("America/Toronto", moment), "2026-10-25")
        self.assertEqual(handler.local_date("UTC", moment), "2026-10-26")

    def test_bad_zone_falls_back_to_utc(self):
        moment = datetime(2026, 10, 26, 2, 30, tzinfo=timezone.utc)
        self.assertEqual(handler.local_date("Not/AZone", moment), "2026-10-26")
        self.assertEqual(handler.local_date("", moment), "2026-10-26")

    def test_clean_app(self):
        self.assertEqual(handler.clean_app("  Slack\n"), "Slack")
        self.assertIsNone(handler.clean_app("   "))
        self.assertIsNone(handler.clean_app(123))
        self.assertEqual(len(handler.clean_app("x" * 200)), 64)


class CursorTests(unittest.TestCase):
    def cursor_for(self, user_id, sort_key):
        return handler.encode_cursor({"userId": user_id, "timestamp": sort_key})

    def test_roundtrip(self):
        cursor = self.cursor_for("u1", "R#2026-10-25T10:00:00.000Z#ab12")
        self.assertEqual(
            handler.decode_cursor(cursor, "u1"),
            {"userId": "u1", "timestamp": "R#2026-10-25T10:00:00.000Z#ab12"},
        )

    def test_other_users_cursor_rejected(self):
        cursor = self.cursor_for("u2", "R#2026-10-25T10:00:00.000Z#ab12")
        with self.assertRaises(handler.ApiError):
            handler.decode_cursor(cursor, "u1")

    def test_non_rewrite_row_rejected(self):
        with self.assertRaises(handler.ApiError):
            handler.decode_cursor(self.cursor_for("u1", "TOTALS"), "u1")

    def test_garbage_rejected(self):
        with self.assertRaises(handler.ApiError):
            handler.decode_cursor("not-a-cursor", "u1")


class QuotaTests(unittest.TestCase):
    def test_first_rewrite_of_day(self):
        table = mock.Mock()
        table.update_item.side_effect = [conditional_failure(), {}]
        with mock.patch.object(handler, "users_table", table):
            self.assertEqual(handler.consume_user_quota("u1", "2026-10-25"), 1)

    def test_increments_within_day(self):
        table = mock.Mock()
        table.update_item.return_value = {"Attributes": {"dqCount": 7}}
        with mock.patch.object(handler, "users_table", table):
            self.assertEqual(handler.consume_user_quota("u1", "2026-10-25"), 7)

    def test_limit_reached(self):
        table = mock.Mock()
        table.update_item.side_effect = [conditional_failure(), conditional_failure()]
        with mock.patch.object(handler, "users_table", table):
            with self.assertRaises(handler.ApiError) as ctx:
                handler.consume_user_quota("u1", "2026-10-25")
        self.assertEqual((ctx.exception.status, ctx.exception.code), (429, "RATE_LIMITED"))

    def test_global_limit_reached(self):
        table = mock.Mock()
        table.update_item.side_effect = conditional_failure()
        with mock.patch.object(handler, "users_table", table):
            with self.assertRaises(handler.ApiError) as ctx:
                handler.consume_global_quota()
        self.assertEqual(ctx.exception.code, "BUSY")


class RewriteActionTests(unittest.TestCase):
    def run_rewrite(self, body, api_key=None, rewrite_result="Hey there", rewrite_error=None):
        patches = {
            "load_user": mock.Mock(return_value={}),
            "resolve_api_key": mock.Mock(return_value=api_key),
            "consume_user_quota": mock.Mock(return_value=3),
            "consume_global_quota": mock.Mock(),
            "refund_user_quota": mock.Mock(),
            "log_usage": mock.Mock(),
            "rewrite": mock.Mock(return_value=rewrite_result, side_effect=rewrite_error),
        }
        with mock.patch.multiple(handler, **patches):
            try:
                response = handler.handle_rewrite("u1", body)
            except handler.ApiError as e:
                return e, patches
        return response, patches

    def test_default_key_success(self):
        response, p = self.run_rewrite({"text": "hi", "format": "email", "source": "desktop"})
        data = json.loads(response["body"])
        self.assertEqual(data["result"], "Hey there")
        self.assertEqual(data["keySource"], "default")
        self.assertEqual((data["usedToday"], data["dailyLimit"]), (3, handler.DEFAULT_DAILY_LIMIT))
        p["log_usage"].assert_called_once()

    def test_custom_key_skips_limits(self):
        response, p = self.run_rewrite({"text": "hi"}, api_key="user-key")
        data = json.loads(response["body"])
        self.assertEqual(data["keySource"], "custom")
        self.assertNotIn("usedToday", data)
        p["consume_user_quota"].assert_not_called()
        p["consume_global_quota"].assert_not_called()

    def test_validation(self):
        for body, code in [
            ({"text": "   "}, "EMPTY_TEXT"),
            ({"text": "x" * (handler.MAX_TEXT_CHARS + 1)}, "TEXT_TOO_LONG"),
            ({"text": "hi", "format": "poem"}, "BAD_FORMAT"),
            ({"text": "hi", "source": "toaster"}, "BAD_SOURCE"),
        ]:
            error, _ = self.run_rewrite(body)
            self.assertEqual(error.code, code)
            self.assertEqual(error.status, 400)

    def test_gemini_busy_refunds_default_user(self):
        error, p = self.run_rewrite({"text": "hi"}, rewrite_error=GeminiError("QUOTA"))
        self.assertEqual((error.status, error.code), (429, "BUSY"))
        p["refund_user_quota"].assert_called_once()

    def test_custom_key_rejected(self):
        error, p = self.run_rewrite({"text": "hi"}, api_key="bad", rewrite_error=GeminiError("KEY_INVALID"))
        self.assertEqual(error.code, "CUSTOM_KEY_INVALID")
        p["refund_user_quota"].assert_not_called()

    def test_global_limit_refunds_user(self):
        patches = {
            "load_user": mock.Mock(return_value={}),
            "resolve_api_key": mock.Mock(return_value=None),
            "consume_user_quota": mock.Mock(return_value=1),
            "consume_global_quota": mock.Mock(side_effect=handler.ApiError(429, "BUSY", "x")),
            "refund_user_quota": mock.Mock(),
        }
        with mock.patch.multiple(handler, **patches):
            with self.assertRaises(handler.ApiError):
                handler.handle_rewrite("u1", {"text": "hi"})
        patches["refund_user_quota"].assert_called_once()


class LambdaHandlerTests(unittest.TestCase):
    def event(self, body, token="Bearer abc"):
        headers = {"authorization": token} if token else {}
        return {"headers": headers, "body": body if isinstance(body, str) else json.dumps(body)}

    def call(self, event):
        with mock.patch.object(handler, "verify_token", return_value={"sub": "u1"}):
            response = handler.lambda_handler(event, None)
        return response["statusCode"], json.loads(response["body"])

    def test_missing_auth(self):
        response = handler.lambda_handler(self.event({}, token=None), None)
        self.assertEqual(response["statusCode"], 401)

    def test_bad_token(self):
        with mock.patch.object(handler, "verify_token", side_effect=ValueError("bad")):
            response = handler.lambda_handler(self.event({}), None)
        self.assertEqual(response["statusCode"], 401)

    def test_bad_json(self):
        self.assertEqual(self.call(self.event("not json"))[0], 400)
        self.assertEqual(self.call(self.event("[1, 2]"))[0], 400)

    def test_unknown_action(self):
        status, data = self.call(self.event({"action": "drop_tables"}))
        self.assertEqual((status, data["code"]), (400, "BAD_ACTION"))

    def test_user_id_comes_from_token_not_body(self):
        seen = {}

        def fake(user_id, body):
            seen["user_id"] = user_id
            return handler.make_response(200, {})

        with mock.patch.dict(handler.ACTIONS, {"get_stats": fake}):
            self.call(self.event({"action": "get_stats", "userId": "someone-else"}))
        self.assertEqual(seen["user_id"], "u1")

    def test_unexpected_error_hidden(self):
        def boom(user_id, body):
            raise RuntimeError("secret internal detail")

        with mock.patch.dict(handler.ACTIONS, {"get_stats": boom}):
            status, data = self.call(self.event({"action": "get_stats"}))
        self.assertEqual((status, data["code"]), (500, "INTERNAL"))
        self.assertNotIn("secret", data["error"])


if __name__ == "__main__":
    unittest.main()
