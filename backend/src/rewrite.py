import os
from dotenv import load_dotenv
from google import genai
from google.genai import errors, types

load_dotenv()

MODEL = "gemini-3.5-flash-lite"
GEMINI_TIMEOUT_MS = 20000

SYSTEM_PROMPTS = {
    "email": (
        "You rewrite text into professional email format. "
        "Structure it as: a greeting line, then one or more short paragraphs, then a closing "
        "line (e.g. 'Best,' or 'Thanks,'), then a name line directly below the closing with no "
        "blank line between them. Separate the greeting, each paragraph, and the closing line "
        "from each other with a blank line. Within a single paragraph, do not add blank lines "
        "between sentences. Keep the original meaning, urgency, and details. Do not invent "
        "details or names. Never use dashes of any kind (em dash, en dash, or hyphen used as a "
        "dash) anywhere in the response; rewrite around them instead. "
        "IMPORTANT: for the name line, use the single placeholder [Name] only. "
        "Never write [First Name] and [Last Name] as two separate placeholders or on two lines. "
        "If the original text names a real sender, use that real name instead of [Name]. "
        "Return only the rewritten text."
    ),
    "message": (
    "You rewrite text to sound like a real person casually texting a friend or coworker, "
    "the way people actually talk in Slack or iMessage. Use natural contractions like "
    "I'm, you're, don't, and can't. Keep sentences varied in length, not uniform or robotic. "
    "Avoid stiff or corporate phrasing such as 'I would like to inform you' or 'please be advised'. "
    "Keep it as a single short paragraph or a couple of short sentences, whatever fits naturally. "
    "No greeting or sign-off unless the original had one. Keep the original meaning, urgency, "
    "and details exactly as given; do not add new information. "
    "Never use dashes of any kind (em dash, en dash, or hyphen used as a dash) anywhere in the "
    "response; rewrite the sentence structure to avoid needing one. "
    "Return only the rewritten text, nothing else."
    ),
}


class GeminiError(Exception):
    """kind is KEY_INVALID, QUOTA or OTHER."""

    def __init__(self, kind, detail=""):
        super().__init__(kind)
        self.kind = kind
        self.detail = detail


def _classify(error):
    code = getattr(error, "code", None)
    if code in (400, 401, 403):
        return "KEY_INVALID"
    if code == 429:
        return "QUOTA"
    return "OTHER"


def make_client(api_key):
    return genai.Client(
        api_key=api_key,
        http_options=types.HttpOptions(timeout=GEMINI_TIMEOUT_MS),
    )


default_client = make_client(os.environ["GEMINI_API_KEY"])


def _generate(client, contents):
    try:
        response = client.models.generate_content(model=MODEL, contents=contents)
    except errors.APIError as e:
        raise GeminiError(_classify(e), f"{type(e).__name__} {getattr(e, 'code', '')}") from e
    except Exception as e:
        raise GeminiError("OTHER", type(e).__name__) from e

    if not response.text:
        raise GeminiError("OTHER", "empty response")
    return response.text


def check_api_key(api_key):
    """Raises GeminiError if the key does not work."""
    _generate(make_client(api_key), "Say hi")


def rewrite(text, format="message", api_key=None):
    system_prompt = SYSTEM_PROMPTS.get(format, SYSTEM_PROMPTS["message"])

    client = make_client(api_key) if api_key else default_client

    result = _generate(client, f"{system_prompt}\n\nText to rewrite:\n{text}")

    if format == "email":
        result = result.replace("[First Name]\n[Last Name]", "[Name]")
        result = result.replace("[First Name] [Last Name]", "[Name]")

    return result
