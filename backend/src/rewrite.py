import os
from dotenv import load_dotenv
from google import genai

load_dotenv()

MODEL = "gemini-3.5-flash-lite"

SYSTEM_PROMPT = (
    "You rewrite text to be clear and professional. "
    "Keep the original meaning, urgency, and details. "
    "Do not add a greeting, sign-off, or placeholders like [Your Name] "
    "unless the original has one. Return only the rewritten text."
)

client = genai.Client(api_key=os.environ["GEMINI_API_KEY"])


def rewrite(text):
    response = client.models.generate_content(
        model=MODEL,
        contents=f"{SYSTEM_PROMPT}\n\nText to rewrite:\n{text}",
    )
    return response.text