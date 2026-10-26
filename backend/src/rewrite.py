from dotenv import load_dotenv

load_dotenv()

from providers import complete  # noqa: E402  (after load_dotenv so GEMINI_API_KEY is set)

SYSTEM_PROMPTS = {
    "email": (
        "You rewrite text into a clear, professional email. First, reword the actual content: "
        "fix grammar, spelling, and slang, choose better words, make the tone polite and "
        "confident, and tighten wordy or unclear sentences so the email reads well, even when "
        "the original is already polite. Do not only add a greeting and sign-off. "
        "Then structure it as: a greeting line, then one or more short paragraphs, then a closing "
        "line (e.g. 'Best,' or 'Thanks,'), then a name line directly below the closing with no "
        "blank line between them. Separate the greeting, each paragraph, and the closing line "
        "from each other with a blank line. Within a single paragraph, do not add blank lines "
        "between sentences. Keep the original meaning, urgency, and details. Do not invent "
        "details or names. Never use dashes of any kind (em dash, en dash, or hyphen used as a "
        "dash) anywhere in the response; rewrite around them instead. "
        "IMPORTANT: for the name line, use the single placeholder [Name] only. "
        "Never write [First Name] and [Last Name] as two separate placeholders or on two lines. "
        "If the original text names a real sender, use that real name instead of [Name]. "
        "Do not invent a recipient: if no name is given, greet with just 'Hi,'. "
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


def rewrite(text, format="message", provider="gemini", api_key=None, model=None):
    system_prompt = SYSTEM_PROMPTS.get(format, SYSTEM_PROMPTS["message"])
    result = complete(provider, system_prompt, f"Text to rewrite:\n{text}", api_key=api_key, model=model)

    if format == "email":
        result = result.replace("[First Name]\n[Last Name]", "[Name]")
        result = result.replace("[First Name] [Last Name]", "[Name]")

    return result
