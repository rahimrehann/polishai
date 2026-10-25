import os
import sys
import unittest
from unittest import mock

os.environ.setdefault("AWS_DEFAULT_REGION", "us-east-1")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import killswitch  # noqa: E402
import presignup  # noqa: E402
from botocore.exceptions import ClientError  # noqa: E402


def conditional_failure():
    return ClientError({"Error": {"Code": "ConditionalCheckFailedException"}}, "UpdateItem")


class SignupLimitTests(unittest.TestCase):
    def test_a_signup_inside_the_limit_is_counted_for_today_and_allowed_through(self):
        table = mock.Mock()
        event = {"request": {"userAttributes": {"email": "a@x.com"}}}
        with mock.patch.object(presignup, "table", table), mock.patch.object(presignup, "MAX_SIGNUPS_PER_DAY", 100):
            result = presignup.lambda_handler(event, None)
        self.assertIs(result, event, "Cognito needs the event handed back")
        call = table.update_item.call_args.kwargs
        self.assertTrue(call["Key"]["userId"].startswith("SIGNUPS#"))
        self.assertEqual(call["ExpressionAttributeValues"][":lim"], 100)

    def test_past_the_limit_the_signup_is_refused_with_a_plain_message(self):
        table = mock.Mock()
        table.update_item.side_effect = conditional_failure()
        with mock.patch.object(presignup, "table", table):
            with self.assertRaises(Exception) as ctx:
                presignup.lambda_handler({}, None)
        self.assertEqual(str(ctx.exception), "Sign-ups are full for today. Please try again tomorrow.")

    def test_a_real_database_problem_is_not_dressed_up_as_full(self):
        table = mock.Mock()
        table.update_item.side_effect = ClientError({"Error": {"Code": "InternalServerError"}}, "UpdateItem")
        with mock.patch.object(presignup, "table", table):
            with self.assertRaises(ClientError):
                presignup.lambda_handler({}, None)

    def test_each_day_has_its_own_counter(self):
        table = mock.Mock()
        with mock.patch.object(presignup, "table", table):
            with mock.patch.object(presignup.time, "time", return_value=1_800_000_000):
                presignup.lambda_handler({}, None)
            with mock.patch.object(presignup.time, "time", return_value=1_800_000_000 + 86400):
                presignup.lambda_handler({}, None)
        keys = [c.kwargs["Key"]["userId"] for c in table.update_item.call_args_list]
        self.assertEqual(len(set(keys)), 2)

    def test_the_counter_cleans_itself_up(self):
        table = mock.Mock()
        with mock.patch.object(presignup, "table", table), mock.patch.object(presignup.time, "time", return_value=1_800_000_000):
            presignup.lambda_handler({}, None)
        self.assertEqual(table.update_item.call_args.kwargs["ExpressionAttributeValues"][":exp"], 1_800_000_000 + 3 * 86400)


class KillSwitchTests(unittest.TestCase):
    def test_it_stops_the_rewrite_function_and_nothing_else(self):
        client = mock.Mock()
        with mock.patch.object(killswitch, "lambda_client", client):
            result = killswitch.lambda_handler({"anything": "from the alarm"}, None)
        client.put_function_concurrency.assert_called_once_with(FunctionName="polishai-rewrite", ReservedConcurrentExecutions=0)
        self.assertEqual(result, {"stopped": "polishai-rewrite"})
        self.assertEqual(len(client.method_calls), 1)

    def test_it_stops_the_right_function(self):
        self.assertEqual(killswitch.TARGET, "polishai-rewrite")


if __name__ == "__main__":
    unittest.main()
