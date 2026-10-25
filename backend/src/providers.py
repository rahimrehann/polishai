"""Talks to the three AI providers. OpenAI and Anthropic use plain HTTPS
(no extra packages in the Lambda); Gemini uses Google's SDK."""
import json
import os
import urllib.error
import urllib.request

from google import genai
from google.genai import errors, types

PROVIDERS = ("gemini", "openai", "anthropic")
PROVIDER_NAMES = {"gemini": "Gemini", "openai": "OpenAI", "anthropic": "Anthropic"}

TIMEOUT_SECONDS = 20
GEMINI_MODEL = "gemini-3.5-flash-lite"
ANTHROPIC_MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-5-5")
ANTHROPIC_VERSION = "2023-06-01"

# Cheapest and fastest first. At save time we use the first one the user's
# key can actually reach, so a renamed or retired model doesn't break rewrites.
OPENAI_PREFERRED = [
    "gpt-6-luna",
    "gpt-5.6-luna",
    "gpt-5.4-nano",
    "gpt-5.4-mini",
    "gpt-4.1-mini",
    "gpt-4o-mini",
]


class ProviderError(Exception):
    """kind is KEY_INVALID, QUOTA or OTHER."""

    def __init__(self, kind, detail=""):
        super().__init__(kind)
        self.kind = kind
        self.detail = detail


def _http_kind(status):
    if status in (401, 403):
        return "KEY_INVALID"
    if status == 429:
        return "QUOTA"
    return "OTHER"


def _http_json(url, payload=None, headers=None):
    data = json.dumps(payload).encode() if payload is not None else None
    request = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST" if payload is not None else "GET",
    )
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS) as response:
            return json.loads(response.read())
    except urllib.error.HTTPError as e:
        # Never keep the response body: it can echo request details.
        raise ProviderError(_http_kind(e.code), f"HTTP {e.code}") from e
    except Exception as e:
        raise ProviderError("OTHER", type(e).__name__) from e


# ---------- Gemini ----------

def make_gemini_client(api_key):
    return genai.Client(api_key=api_key, http_options=types.HttpOptions(timeout=TIMEOUT_SECONDS * 1000))


default_gemini_client = make_gemini_client(os.environ["GEMINI_API_KEY"])


def _gemini_kind(error):
    code = getattr(error, "code", None)
    if code in (400, 401, 403):  # Gemini answers 400 for an invalid key
        return "KEY_INVALID"
    if code == 429:
        return "QUOTA"
    return "OTHER"


def _gemini_complete(client, system, user):
    try:
        response = client.models.generate_content(model=GEMINI_MODEL, contents=f"{system}\n\n{user}")
    except errors.APIError as e:
        raise ProviderError(_gemini_kind(e), f"{type(e).__name__} {getattr(e, 'code', '')}") from e
    except Exception as e:
        raise ProviderError("OTHER", type(e).__name__) from e
    if not response.text:
        raise ProviderError("OTHER", "empty response")
    return response.text


# ---------- OpenAI ----------

def _openai_headers(api_key):
    return {"Authorization": f"Bearer {api_key}"}


def _openai_complete(api_key, model, system, user):
    data = _http_json(
        "https://api.openai.com/v1/chat/completions",
        {"model": model, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]},
        _openai_headers(api_key),
    )
    try:
        text = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError):
        raise ProviderError("OTHER", "unexpected response shape")
    if not text:
        raise ProviderError("OTHER", "empty response")
    return text


def _openai_pick_model(api_key):
    listing = _http_json("https://api.openai.com/v1/models", headers=_openai_headers(api_key))
    available = {m.get("id") for m in listing.get("data", [])}
    for model in OPENAI_PREFERRED:
        if model not in available:
            continue
        try:
            _openai_complete(api_key, model, "Reply with one word.", "hi")
            return model
        except ProviderError as e:
            if e.kind != "OTHER":
                raise
    raise ProviderError("OTHER", "no compatible model on this key")


# ---------- Anthropic ----------

def _anthropic_complete(api_key, model, system, user, max_tokens=2048):
    data = _http_json(
        "https://api.anthropic.com/v1/messages",
        {"model": model, "max_tokens": max_tokens, "system": system, "messages": [{"role": "user", "content": user}]},
        {"x-api-key": api_key, "anthropic-version": ANTHROPIC_VERSION},
    )
    try:
        text = "".join(block.get("text", "") for block in data["content"] if block.get("type") == "text")
    except (KeyError, TypeError):
        raise ProviderError("OTHER", "unexpected response shape")
    if not text:
        raise ProviderError("OTHER", "empty response")
    return text


# ---------- What the rest of the app uses ----------

def check_key(provider, api_key):
    """Proves the key works and returns the model to use with it."""
    if provider == "gemini":
        _gemini_complete(make_gemini_client(api_key), "Reply with one word.", "hi")
        return GEMINI_MODEL
    if provider == "openai":
        return _openai_pick_model(api_key)
    if provider == "anthropic":
        _anthropic_complete(api_key, ANTHROPIC_MODEL, "Reply with one word.", "hi", max_tokens=16)
        return ANTHROPIC_MODEL
    raise ProviderError("OTHER", "unknown provider")


def complete(provider, system, user, api_key=None, model=None):
    """One rewrite. With no key, uses PolishAI's shared Gemini key."""
    if api_key is None:
        return _gemini_complete(default_gemini_client, system, user)
    if provider == "gemini":
        return _gemini_complete(make_gemini_client(api_key), system, user)
    if provider == "openai":
        return _openai_complete(api_key, model, system, user)
    if provider == "anthropic":
        return _anthropic_complete(api_key, model or ANTHROPIC_MODEL, system, user)
    raise ProviderError("OTHER", "unknown provider")
