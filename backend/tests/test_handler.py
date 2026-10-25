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
            "consume_burst": mock.Mock(),
            "consume_total_ceiling": mock.Mock(),
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
            "consume_burst": mock.Mock(),
            "consume_total_ceiling": mock.Mock(),
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
            "consume_burst": mock.Mock(),
            "consume_total_ceiling": mock.Mock(),
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
            "consume_burst": mock.Mock(),
            "consume_total_ceiling": mock.Mock(),
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
            "consume_burst": mock.Mock(),
            "consume_total_ceiling": mock.Mock(),
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
        self.assertEqual([c for c in table.update_item.call_args_list if "apiKeyEnc" in c.kwargs.get("UpdateExpression", "")], [])

    def test_save_explains_each_failure_without_saving(self):
        for kind, code, status, fragment in [
            ("KEY_INVALID", "CUSTOM_KEY_INVALID", 400, "Anthropic key doesn't seem to work"),
            ("QUOTA", "CUSTOM_KEY_QUOTA", 400, "no usage available"),
            ("OTHER", "KEY_CHECK_FAILED", 502, "Try again"),
        ]:
            error, table, _ = self.save({"provider": "anthropic", "apiKey": "k"}, check_error=ProviderError(kind))
            self.assertEqual((error.code, error.status), (code, status))
            self.assertIn(fragment, error.message)
            saved = [c for c in table.update_item.call_args_list if "apiKeyEnc" in c.kwargs.get("UpdateExpression", "")]
            self.assertEqual(saved, [], "a key that failed its check must not be saved")

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


class VersionTests(unittest.TestCase):
    def test_versions_are_read_and_compared_as_numbers(self):
        self.assertEqual(handler.parse_version("1.2.3"), (1, 2, 3, 0))
        self.assertEqual(handler.parse_version("0.1.0"), (0, 1, 0, 0))
        self.assertEqual(handler.parse_version("2"), (2, 0, 0, 0))
        self.assertLess(handler.parse_version("0.9.0"), handler.parse_version("0.10.0"))
        self.assertLess(handler.parse_version("1.9.9"), handler.parse_version("1.10.0"))
        for bad in (None, "", "abc", "1.2.x", "1..2", "1.2.3.4.5", 5, {"v": 1}, "9" * 40):
            self.assertIsNone(handler.parse_version(bad), repr(bad))

    def test_old_apps_are_turned_away_with_a_clear_message(self):
        with mock.patch.object(handler, "MIN_APP_VERSION", "0.2.0"):
            with self.assertRaises(handler.ApiError) as ctx:
                handler.require_current_app({"appVersion": "0.1.9"})
        self.assertEqual((ctx.exception.status, ctx.exception.code), (426, "UPDATE_REQUIRED"))
        self.assertIn("Download the latest version", ctx.exception.message)

    def test_current_missing_and_garbled_versions_are_allowed(self):
        with mock.patch.object(handler, "MIN_APP_VERSION", "0.2.0"):
            for body in ({"appVersion": "0.2.0"}, {"appVersion": "3.0.0"}, {}, {"appVersion": None}, {"appVersion": "junk"}):
                handler.require_current_app(body)  # must not raise

    def test_an_out_of_date_app_is_refused_before_anything_else_happens(self):
        patches = {
            "consume_burst": mock.Mock(),
            "consume_total_ceiling": mock.Mock(),
            "load_user": mock.Mock(),
            "consume_user_quota": mock.Mock(),
            "rewrite": mock.Mock(),
        }
        with mock.patch.multiple(handler, **patches), mock.patch.object(handler, "MIN_APP_VERSION", "0.2.0"):
            with self.assertRaises(handler.ApiError) as ctx:
                handler.handle_rewrite("u1", {"text": "hi", "appVersion": "0.1.0"})
        self.assertEqual(ctx.exception.code, "UPDATE_REQUIRED")
        for name in ("consume_burst", "load_user", "consume_user_quota", "rewrite"):
            patches[name].assert_not_called()

    def test_settings_tell_the_app_which_versions_exist(self):
        with mock.patch.object(handler, "load_user", return_value={}), \
             mock.patch.object(handler, "MIN_APP_VERSION", "0.2.0"), mock.patch.object(handler, "LATEST_APP_VERSION", "0.3.1"):
            data = json.loads(handler.handle_get_settings("u1", {})["body"])
        self.assertEqual((data["minAppVersion"], data["latestAppVersion"]), ("0.2.0", "0.3.1"))


class BurstLimitTests(unittest.TestCase):
    def test_a_request_inside_the_limit_is_counted_in_this_minute_only(self):
        table = mock.Mock()
        with mock.patch.object(handler, "users_table", table), mock.patch.object(handler.time, "time", return_value=6000.0):
            handler.consume_burst("user-1", "rewrite")
        call = table.update_item.call_args.kwargs
        self.assertEqual(call["Key"], {"userId": "RL#user-1#rewrite#100"})
        self.assertEqual(call["ExpressionAttributeValues"][":lim"], 12)
        self.assertEqual(call["ExpressionAttributeValues"][":exp"], 6120)  # clears itself after two windows

    def test_the_next_minute_uses_a_fresh_counter(self):
        table = mock.Mock()
        with mock.patch.object(handler, "users_table", table):
            with mock.patch.object(handler.time, "time", return_value=6059.0):
                handler.consume_burst("u", "rewrite")
            with mock.patch.object(handler.time, "time", return_value=6060.0):
                handler.consume_burst("u", "rewrite")
        keys = [c.kwargs["Key"]["userId"] for c in table.update_item.call_args_list]
        self.assertEqual(keys, ["RL#u#rewrite#100", "RL#u#rewrite#101"])

    def test_going_over_the_limit_asks_the_user_to_slow_down(self):
        table = mock.Mock()
        table.update_item.side_effect = conditional_failure()
        with mock.patch.object(handler, "users_table", table):
            with self.assertRaises(handler.ApiError) as ctx:
                handler.consume_burst("u", "rewrite")
        self.assertEqual((ctx.exception.status, ctx.exception.code), (429, "SLOW_DOWN"))

    def test_other_database_errors_are_not_disguised_as_slow_down(self):
        table = mock.Mock()
        table.update_item.side_effect = ClientError({"Error": {"Code": "ProvisionedThroughputExceededException"}}, "UpdateItem")
        with mock.patch.object(handler, "users_table", table):
            with self.assertRaises(ClientError):
                handler.consume_burst("u", "rewrite")

    def test_users_are_counted_separately(self):
        table = mock.Mock()
        with mock.patch.object(handler, "users_table", table), mock.patch.object(handler.time, "time", return_value=6000.0):
            handler.consume_burst("alice", "rewrite")
            handler.consume_burst("bob", "rewrite")
        keys = {c.kwargs["Key"]["userId"] for c in table.update_item.call_args_list}
        self.assertEqual(len(keys), 2)

    def test_a_flood_of_rewrites_is_stopped_before_it_reaches_the_ai_provider(self):
        patches = {
            "consume_burst": mock.Mock(side_effect=handler.ApiError(429, "SLOW_DOWN", "slow")),
            "load_user": mock.Mock(),
            "rewrite": mock.Mock(),
        }
        with mock.patch.multiple(handler, **patches):
            with self.assertRaises(handler.ApiError):
                handler.handle_rewrite("u1", {"text": "hi"})
        patches["load_user"].assert_not_called()
        patches["rewrite"].assert_not_called()

    def test_saving_keys_is_limited_too_since_each_save_calls_an_outside_service(self):
        check = mock.Mock()
        with mock.patch.multiple(handler, consume_burst=mock.Mock(side_effect=handler.ApiError(429, "SLOW_DOWN", "slow")), check_key=check):
            with self.assertRaises(handler.ApiError) as ctx:
                handler.handle_save_api_key("u1", {"provider": "gemini", "apiKey": "k"})
        self.assertEqual(ctx.exception.code, "SLOW_DOWN")
        check.assert_not_called()


class TotalCeilingTests(unittest.TestCase):
    def test_every_rewrite_is_counted_in_one_shared_counter_for_the_day(self):
        table = mock.Mock()
        with mock.patch.object(handler, "users_table", table), mock.patch.object(handler, "TOTAL_DAILY_LIMIT", 3000):
            handler.consume_total_ceiling()
        call = table.update_item.call_args.kwargs
        self.assertTrue(call["Key"]["userId"].startswith("TOTAL#"))
        self.assertEqual(call["ExpressionAttributeValues"][":lim"], 3000)
        self.assertIn("attribute_not_exists(tCount) OR tCount < :lim", call["ConditionExpression"])

    def test_past_the_ceiling_everyone_is_told_to_come_back_tomorrow(self):
        table = mock.Mock()
        table.update_item.side_effect = conditional_failure()
        with mock.patch.object(handler, "users_table", table):
            with self.assertRaises(handler.ApiError) as ctx:
                handler.consume_total_ceiling()
        self.assertEqual((ctx.exception.status, ctx.exception.code), (503, "AT_CAPACITY"))
        self.assertIn("try again tomorrow", ctx.exception.message)

    def test_other_database_errors_are_not_disguised_as_full(self):
        table = mock.Mock()
        table.update_item.side_effect = ClientError({"Error": {"Code": "ProvisionedThroughputExceededException"}}, "UpdateItem")
        with mock.patch.object(handler, "users_table", table):
            with self.assertRaises(ClientError):
                handler.consume_total_ceiling()

    def test_when_the_ceiling_is_hit_nothing_expensive_happens(self):
        patches = {
            "consume_burst": mock.Mock(),
            "consume_total_ceiling": mock.Mock(side_effect=handler.ApiError(503, "AT_CAPACITY", "full")),
            "load_user": mock.Mock(),
            "consume_user_quota": mock.Mock(),
            "rewrite": mock.Mock(),
            "log_usage": mock.Mock(),
        }
        with mock.patch.multiple(handler, **patches):
            with self.assertRaises(handler.ApiError):
                handler.handle_rewrite("u1", {"text": "hi"})
        for name in ("load_user", "consume_user_quota", "rewrite", "log_usage"):
            patches[name].assert_not_called()

    def test_people_with_their_own_key_count_toward_the_ceiling_too(self):
        ceiling = mock.Mock()
        patches = {
            "consume_burst": mock.Mock(),
            "consume_total_ceiling": ceiling,
            "load_user": mock.Mock(return_value={}),
            "resolve_credentials": mock.Mock(return_value=("openai", "sk-own", "m")),
            "rewrite": mock.Mock(return_value="Done"),
            "log_usage": mock.Mock(),
        }
        with mock.patch.multiple(handler, **patches):
            handler.handle_rewrite("u1", {"text": "hi"})
        ceiling.assert_called_once()

    def test_the_ceiling_is_checked_after_the_per_minute_limit(self):
        order = []
        patches = {
            "consume_burst": mock.Mock(side_effect=lambda *a: order.append("burst")),
            "consume_total_ceiling": mock.Mock(side_effect=lambda: order.append("ceiling")),
            "load_user": mock.Mock(return_value={}),
            "resolve_credentials": mock.Mock(return_value=None),
            "consume_user_quota": mock.Mock(return_value=1),
            "consume_global_quota": mock.Mock(),
            "rewrite": mock.Mock(return_value="Done"),
            "log_usage": mock.Mock(),
        }
        with mock.patch.multiple(handler, **patches):
            handler.handle_rewrite("u1", {"text": "hi"})
        self.assertEqual(order, ["burst", "ceiling"])


if __name__ == "__main__":
    unittest.main()
