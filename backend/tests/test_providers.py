import io
import json
import os
import sys
import unittest
import urllib.error
from unittest import mock

os.environ.setdefault("GEMINI_API_KEY", "test-default-key")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

import providers  # noqa: E402
import rewrite as rewrite_module  # noqa: E402
from providers import ProviderError  # noqa: E402


class FakeResponse:
    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False


def http_error(code):
    return urllib.error.HTTPError("https://x", code, "err", {}, io.BytesIO(b'{"error":"secret detail"}'))


class Network:
    """Replaces urlopen: routes by URL, records every request."""

    def __init__(self, routes):
        self.routes = routes
        self.requests = []

    def __call__(self, request, timeout=None):
        body = json.loads(request.data) if request.data else None
        self.requests.append({"url": request.full_url, "method": request.get_method(), "headers": dict(request.header_items()), "body": body})
        reply = self.routes[request.full_url]
        if callable(reply):
            reply = reply(body)
        if isinstance(reply, Exception):
            raise reply
        return FakeResponse(reply)

    def patch(self):
        return mock.patch("providers.urllib.request.urlopen", self)


OPENAI_MODELS = "https://api.openai.com/v1/models"
OPENAI_CHAT = "https://api.openai.com/v1/chat/completions"
ANTHROPIC = "https://api.anthropic.com/v1/messages"


def openai_reply(text="ok"):
    return {"choices": [{"message": {"content": text}}]}


def models(*ids):
    return {"data": [{"id": i} for i in ids]}


class OpenAITests(unittest.TestCase):
    def test_picks_the_first_preferred_model_the_key_can_use_and_tests_it(self):
        net = Network({OPENAI_MODELS: models("gpt-4.1-mini", "gpt-5.4-nano", "other"), OPENAI_CHAT: openai_reply()})
        with net.patch():
            self.assertEqual(providers.check_key("openai", "sk-1"), "gpt-5.4-nano")
        self.assertEqual(net.requests[0]["headers"]["Authorization"], "Bearer sk-1")
        self.assertEqual(net.requests[1]["body"]["model"], "gpt-5.4-nano")

    def test_skips_a_listed_model_that_will_not_complete(self):
        def chat(body):
            return http_error(404) if body["model"] == "gpt-6-luna" else openai_reply()
        net = Network({OPENAI_MODELS: models("gpt-6-luna", "gpt-5.4-mini"), OPENAI_CHAT: chat})
        # 404 maps to OTHER, so the next candidate is tried
        with net.patch():
            self.assertEqual(providers.check_key("openai", "sk-1"), "gpt-5.4-mini")

    def test_bad_key_is_reported_not_skipped(self):
        net = Network({OPENAI_MODELS: http_error(401)})
        with net.patch(), self.assertRaises(ProviderError) as ctx:
            providers.check_key("openai", "bad")
        self.assertEqual(ctx.exception.kind, "KEY_INVALID")

    def test_no_usable_model_is_an_other_error(self):
        net = Network({OPENAI_MODELS: models("whisper-1")})
        with net.patch(), self.assertRaises(ProviderError) as ctx:
            providers.check_key("openai", "sk-1")
        self.assertEqual(ctx.exception.kind, "OTHER")

    def test_rewrite_request_shape(self):
        net = Network({OPENAI_CHAT: openai_reply("Polished text")})
        with net.patch():
            out = providers.complete("openai", "SYSTEM", "USER", api_key="sk-1", model="gpt-5.4-nano")
        self.assertEqual(out, "Polished text")
        body = net.requests[0]["body"]
        self.assertEqual(body["messages"], [{"role": "system", "content": "SYSTEM"}, {"role": "user", "content": "USER"}])
        self.assertNotIn("temperature", body)

    def test_odd_responses_become_errors_not_crashes(self):
        for reply in ({}, {"choices": []}, openai_reply("")):
            net = Network({OPENAI_CHAT: reply})
            with net.patch(), self.assertRaises(ProviderError):
                providers.complete("openai", "s", "u", api_key="k", model="m")


class AnthropicTests(unittest.TestCase):
    def test_request_shape_and_text_extraction(self):
        reply = {"content": [{"type": "text", "text": "Hello "}, {"type": "text", "text": "there"}]}
        net = Network({ANTHROPIC: reply})
        with net.patch():
            out = providers.complete("anthropic", "SYSTEM", "USER", api_key="sk-ant-1")
        self.assertEqual(out, "Hello there")
        request = net.requests[0]
        self.assertEqual(request["headers"]["X-api-key"], "sk-ant-1")
        self.assertEqual(request["headers"]["Anthropic-version"], "2023-06-01")
        self.assertEqual(request["body"]["model"], "claude-haiku-5-5")
        self.assertEqual(request["body"]["system"], "SYSTEM")
        self.assertEqual(request["body"]["messages"], [{"role": "user", "content": "USER"}])
        for banned in ("temperature", "top_p", "top_k"):
            self.assertNotIn(banned, request["body"])

    def test_check_key_returns_the_model(self):
        net = Network({ANTHROPIC: {"content": [{"type": "text", "text": "hi"}]}})
        with net.patch():
            self.assertEqual(providers.check_key("anthropic", "sk-ant-1"), "claude-haiku-5-5")
        self.assertEqual(net.requests[0]["body"]["max_tokens"], 16)

    def test_empty_content_is_an_error(self):
        net = Network({ANTHROPIC: {"content": []}})
        with net.patch(), self.assertRaises(ProviderError):
            providers.complete("anthropic", "s", "u", api_key="k")


class ErrorMappingTests(unittest.TestCase):
    def kind_for(self, failure):
        net = Network({ANTHROPIC: failure})
        with net.patch(), self.assertRaises(ProviderError) as ctx:
            providers.complete("anthropic", "s", "u", api_key="k")
        return ctx.exception

    def test_http_statuses(self):
        self.assertEqual(self.kind_for(http_error(401)).kind, "KEY_INVALID")
        self.assertEqual(self.kind_for(http_error(403)).kind, "KEY_INVALID")
        self.assertEqual(self.kind_for(http_error(429)).kind, "QUOTA")
        self.assertEqual(self.kind_for(http_error(500)).kind, "OTHER")
        self.assertEqual(self.kind_for(http_error(400)).kind, "OTHER")

    def test_timeouts_and_network_failures(self):
        self.assertEqual(self.kind_for(TimeoutError()).kind, "OTHER")
        self.assertEqual(self.kind_for(urllib.error.URLError("down")).kind, "OTHER")

    def test_response_bodies_never_leak_into_errors(self):
        error = self.kind_for(http_error(500))
        self.assertNotIn("secret detail", str(error.detail) + str(error))


class GeminiTests(unittest.TestCase):
    def test_shared_key_is_used_when_no_key_is_given(self):
        client = mock.Mock()
        client.models.generate_content.return_value = mock.Mock(text="Shared result")
        with mock.patch.object(providers, "default_gemini_client", client):
            self.assertEqual(providers.complete("gemini", "SYS", "USR"), "Shared result")
        self.assertEqual(client.models.generate_content.call_args.kwargs["contents"], "SYS\n\nUSR")

    def test_a_users_own_gemini_key_builds_its_own_client(self):
        client = mock.Mock()
        client.models.generate_content.return_value = mock.Mock(text="Mine")
        with mock.patch.object(providers, "make_gemini_client", return_value=client) as make:
            self.assertEqual(providers.complete("gemini", "s", "u", api_key="AIza-user"), "Mine")
        make.assert_called_once_with("AIza-user")

    def test_gemini_check_key_maps_errors(self):
        from google.genai import errors
        client = mock.Mock()
        client.models.generate_content.side_effect = errors.ClientError(400, {"error": {"message": "API key not valid"}})
        with mock.patch.object(providers, "make_gemini_client", return_value=client), self.assertRaises(ProviderError) as ctx:
            providers.check_key("gemini", "bad")
        self.assertEqual(ctx.exception.kind, "KEY_INVALID")


class RewriteTests(unittest.TestCase):
    def test_email_placeholder_cleanup_and_prompt_choice(self):
        with mock.patch.object(rewrite_module, "complete", return_value="Hi,\n\nThanks,\n[First Name]\n[Last Name]") as complete:
            out = rewrite_module.rewrite("hello", "email", provider="openai", api_key="k", model="m")
        self.assertTrue(out.endswith("[Name]"))
        args = complete.call_args
        self.assertEqual(args.args[0], "openai")
        self.assertIn("professional email", args.args[1])
        self.assertEqual(args.args[2], "Text to rewrite:\nhello")
        self.assertEqual((args.kwargs["api_key"], args.kwargs["model"]), ("k", "m"))

    def test_unknown_format_falls_back_to_message(self):
        with mock.patch.object(rewrite_module, "complete", return_value="x") as complete:
            rewrite_module.rewrite("hello", "poem")
        self.assertIn("texting a friend", complete.call_args.args[1])

    def test_unknown_provider_is_an_error(self):
        with self.assertRaises(ProviderError):
            providers.complete("mystery", "s", "u", api_key="k")


if __name__ == "__main__":
    unittest.main()
