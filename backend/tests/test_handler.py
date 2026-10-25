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
from providers import ProviderError  # noqa: E402


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
    def run_rewrite(self, body, api_key=None, rewrite_result="Hey there", rewrite_error=None, provider="gemini"):
        patches = {
            "load_user": mock.Mock(return_value={}),
            "resolve_credentials": mock.Mock(return_value=(provider, api_key, "m-1") if api_key else None),
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
        error, p = self.run_rewrite({"text": "hi"}, rewrite_error=ProviderError("QUOTA"))
        self.assertEqual((error.status, error.code), (429, "BUSY"))
        p["refund_user_quota"].assert_called_once()

    def test_custom_key_rejected(self):
        error, p = self.run_rewrite({"text": "hi"}, api_key="bad", rewrite_error=ProviderError("KEY_INVALID"))
        self.assertEqual(error.code, "CUSTOM_KEY_INVALID")
        p["refund_user_quota"].assert_not_called()

    def test_global_limit_refunds_user(self):
        patches = {
            "load_user": mock.Mock(return_value={}),
            "resolve_credentials": mock.Mock(return_value=None),
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


class ProviderChoiceTests(unittest.TestCase):
    def test_rewrite_uses_the_users_own_provider_and_model(self):
        rewrite = mock.Mock(return_value="Done")
        patches = {
            "load_user": mock.Mock(return_value={}),
            "resolve_credentials": mock.Mock(return_value=("anthropic", "sk-ant-x", "claude-haiku-5-5")),
            "log_usage": mock.Mock(),
            "rewrite": rewrite,
        }
        with mock.patch.multiple(handler, **patches):
            response = handler.handle_rewrite("u1", {"text": "hi", "format": "email"})
        rewrite.assert_called_once_with("hi", "email", provider="anthropic", api_key="sk-ant-x", model="claude-haiku-5-5")
        data = json.loads(response["body"])
        self.assertEqual((data["keySource"], data["provider"]), ("custom", "anthropic"))
        self.assertEqual(patches["log_usage"].call_args.args[7], "anthropic")

    def test_shared_key_is_gemini_with_no_user_key(self):
        rewrite = mock.Mock(return_value="Done")
        patches = {
            "load_user": mock.Mock(return_value={}),
            "resolve_credentials": mock.Mock(return_value=None),
            "consume_user_quota": mock.Mock(return_value=2),
            "consume_global_quota": mock.Mock(),
            "log_usage": mock.Mock(),
            "rewrite": rewrite,
        }
        with mock.patch.multiple(handler, **patches):
            handler.handle_rewrite("u1", {"text": "hi"})
        rewrite.assert_called_once_with("hi", "message", provider="gemini", api_key=None, model=None)

    def test_error_names_the_users_provider(self):
        patches = {
            "load_user": mock.Mock(return_value={}),
            "resolve_credentials": mock.Mock(return_value=("openai", "bad", "m")),
            "rewrite": mock.Mock(side_effect=ProviderError("KEY_INVALID")),
        }
        with mock.patch.multiple(handler, **patches):
            with self.assertRaises(handler.ApiError) as ctx:
                handler.handle_rewrite("u1", {"text": "hi"})
        self.assertIn("OpenAI", ctx.exception.message)

    def save(self, body, check=None, check_error=None):
        table = mock.Mock()
        patches = {
            "users_table": table,
            "check_key": mock.Mock(return_value=check, side_effect=check_error),
        }
        with mock.patch.multiple(handler, **patches):
            try:
                return handler.handle_save_api_key("u1", body), table, patches["check_key"]
            except handler.ApiError as e:
                return e, table, patches["check_key"]

    def test_save_stores_provider_model_and_an_encrypted_key(self):
        response, table, check = self.save({"provider": "openai", "apiKey": " sk-test-abcd "}, check="gpt-5.4-nano")
        check.assert_called_once_with("openai", "sk-test-abcd")
        values = table.update_item.call_args.kwargs["ExpressionAttributeValues"]
        self.assertEqual((values[":provider"], values[":model"], values[":last4"]), ("openai", "gpt-5.4-nano", "abcd"))
        self.assertNotIn("sk-test", values[":enc"])
        self.assertEqual(handler.decrypt_key("u1", values[":enc"]), "sk-test-abcd")
        self.assertEqual(json.loads(response["body"])["provider"], "openai")

    def test_save_rejects_unknown_provider_and_missing_key(self):
        error, table, check = self.save({"provider": "mystery", "apiKey": "k"})
        self.assertEqual(error.code, "BAD_PROVIDER")
        error, _, _ = self.save({"provider": "gemini", "apiKey": "  "})
        self.assertEqual(error.code, "BAD_KEY")
        check.assert_not_called()
        table.update_item.assert_not_called()

    def test_save_explains_each_failure_without_saving(self):
        for kind, code, status, fragment in [
            ("KEY_INVALID", "CUSTOM_KEY_INVALID", 400, "Anthropic key doesn't seem to work"),
            ("QUOTA", "CUSTOM_KEY_QUOTA", 400, "no usage available"),
            ("OTHER", "KEY_CHECK_FAILED", 502, "Try again"),
        ]:
            error, table, _ = self.save({"provider": "anthropic", "apiKey": "k"}, check_error=ProviderError(kind))
            self.assertEqual((error.code, error.status), (code, status))
            self.assertIn(fragment, error.message)
            table.update_item.assert_not_called()

    def test_settings_report_the_provider_and_last4(self):
        item = {"apiKeyEnc": "x", "apiProvider": "anthropic", "apiKeyLast4": "9z9z", "dqDate": "2026-10-25", "dqCount": 3}
        with mock.patch.object(handler, "load_user", return_value=item):
            data = json.loads(handler.handle_get_settings("u1", {"tz": "UTC"})["body"])
        self.assertEqual((data["hasCustomKey"], data["provider"], data["keyLast4"]), (True, "anthropic", "9z9z"))
        with mock.patch.object(handler, "load_user", return_value={}):
            data = json.loads(handler.handle_get_settings("u1", {})["body"])
        self.assertEqual((data["hasCustomKey"], data["provider"], data["keyLast4"]), (False, None, None))

    def test_credentials_round_trip_and_bad_ciphertext_falls_back_to_shared(self):
        blob = handler.encrypt_key("u1", "sk-live")
        item = {"apiKeyEnc": blob, "apiProvider": "openai", "apiModel": "gpt-5.4-nano"}
        handler._key_cache.clear()
        self.assertEqual(handler.resolve_credentials("u1", item), ("openai", "sk-live", "gpt-5.4-nano"))
        handler._key_cache.clear()
        self.assertIsNone(handler.resolve_credentials("u2", item))  # bound to u1, so u2 can't use it
        handler._key_cache.clear()
        self.assertIsNone(handler.resolve_credentials("u1", {"apiKeyEnc": blob, "apiProvider": "nope"}))
        handler._key_cache.clear()

    def test_delete_removes_every_key_field(self):
        table = mock.Mock()
        with mock.patch.object(handler, "users_table", table):
            handler.handle_delete_api_key("u1", {})
        expression = table.update_item.call_args.kwargs["UpdateExpression"]
        for field in ("apiProvider", "apiKeyEnc", "apiKeyLast4", "apiModel"):
            self.assertIn(field, expression)


if __name__ == "__main__":
    unittest.main()
