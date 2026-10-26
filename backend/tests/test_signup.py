import json
import os
import sys
import unittest
from unittest import mock

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import signup  # noqa: E402
from botocore.exceptions import ClientError  # noqa: E402


def conditional_failure():
    return ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")


def call(body, ip="1.2.3.4"):
    event = {"body": json.dumps(body) if not isinstance(body, str) else body,
             "requestContext": {"http": {"sourceIp": ip}}}
    return signup.lambda_handler(event, None)


def parsed(response):
    return response["statusCode"], json.loads(response["body"])


class SignupTests(unittest.TestCase):
    def setUp(self):
        self.table = mock.Mock()
        patcher = mock.patch.object(signup, "table", self.table)
        patcher.start()
        self.addCleanup(patcher.stop)

    def saved_row(self):
        for c in self.table.update_item.call_args_list:
            if c.kwargs["Key"]["pk"].startswith("E#"):
                return c.kwargs
        return None

    def test_a_good_signup_saves_one_lowercased_row(self):
        status, data = parsed(call({"email": "  Pat@Example.COM ", "name": "Pat  Lee", "chip": "arm64", "updates": True}))
        self.assertEqual((status, data), (200, {"ok": True}))
        row = self.saved_row()
        self.assertEqual(row["Key"], {"pk": "E#pat@example.com"})
        self.assertEqual(row["ExpressionAttributeValues"][":name"], "Pat Lee")
        self.assertEqual(row["ExpressionAttributeValues"][":chip"], "arm64")
        self.assertIs(row["ExpressionAttributeValues"][":updates"], True)
        self.assertIn("ADD downloads", row["UpdateExpression"])  # a repeat raises the count, never a second row

    def test_name_and_chip_are_optional(self):
        status, _ = parsed(call({"email": "a@b.co"}))
        self.assertEqual(status, 200)
        row = self.saved_row()
        values = row["ExpressionAttributeValues"]
        self.assertEqual((values[":chip"], values[":updates"]), ("unsure", False))
        self.assertNotIn(":name", values, "a blank name must not wipe the one saved earlier")
        self.assertNotIn("#n", row["UpdateExpression"])

    def test_bad_emails_are_refused_and_nothing_is_written(self):
        for bad in ["", "nope", "a@b", "a b@c.com", "@x.com", None, 5, "a@" + "x" * 300 + ".com"]:
            status, data = parsed(call({"email": bad}))
            self.assertEqual((status, data["code"]), (400, "BAD_EMAIL"), bad)
        self.table.update_item.assert_not_called()

    def test_bad_chip_and_name_are_refused(self):
        self.assertEqual(parsed(call({"email": "a@b.co", "chip": "ppc"}))[1]["code"], "BAD_CHIP")
        self.assertEqual(parsed(call({"email": "a@b.co", "name": ["x"]}))[1]["code"], "BAD_NAME")

    def test_a_long_name_is_cut_to_80_characters(self):
        call({"email": "a@b.co", "name": "x" * 500})
        self.assertEqual(len(self.saved_row()["ExpressionAttributeValues"][":name"]), 80)

    def test_a_filled_honeypot_looks_like_success_but_saves_nothing(self):
        status, data = parsed(call({"email": "bot@b.co", "company": "Acme"}))
        self.assertEqual((status, data), (200, {"ok": True}))
        self.table.update_item.assert_not_called()

    def test_garbage_bodies_are_a_plain_400(self):
        for body in ["not json", "[1]", "", "null"]:
            self.assertEqual(parsed(call(body))[0], 400, body)
        self.assertEqual(parsed(signup.lambda_handler({}, None))[0], 400)

    def test_one_visitor_trying_too_often_is_slowed_down(self):
        self.table.update_item.side_effect = [conditional_failure()]
        status, data = parsed(call({"email": "a@b.co"}))
        self.assertEqual((status, data["code"]), (429, "SLOW_DOWN"))

    def test_the_daily_cap_stops_new_signups(self):
        self.table.update_item.side_effect = [None, conditional_failure()]  # visitor ok, day full
        status, data = parsed(call({"email": "a@b.co"}))
        self.assertEqual((status, data["code"]), (503, "FULL_TODAY"))
        self.assertIsNone(self.saved_row())

    def test_a_database_failure_is_a_vague_500_that_never_echoes_the_request(self):
        self.table.update_item.side_effect = ClientError({"Error": {"Code": "InternalServerError"}}, "UpdateItem")
        with mock.patch("builtins.print") as printed:
            status, data = parsed(call({"email": "secret@person.com"}))
        self.assertEqual((status, data["code"]), (500, "INTERNAL"))
        self.assertNotIn("secret@person.com", json.dumps(printed.call_args_list))

    def test_the_visitor_is_stored_only_as_a_hash(self):
        call({"email": "a@b.co"}, ip="9.9.9.9")
        keys = [c.kwargs["Key"]["pk"] for c in self.table.update_item.call_args_list]
        self.assertTrue(any(k.startswith("IP#") for k in keys))
        self.assertFalse(any("9.9.9.9" in k for k in keys))


if __name__ == "__main__":
    unittest.main()
