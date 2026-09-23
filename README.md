# Polish – AI Text Rewriting Extension

🚧 **Actively in development** — this project is being built incrementally. Check the commit history for current progress.

Polish is a Chrome extension (with a companion desktop app) that lets you rewrite selected text anywhere on the web — Gmail, Slack, Teams, or any text field — without copying and pasting into a separate AI chat window.

## How it works

1. Highlight text on any website
2. Click the floating "Reword" button that appears
3. The text is rewritten in place by an AI model

By default, requests go through a hosted Groq (Llama 3.1) endpoint so it works instantly with no setup. Users can optionally add their own API key (Claude, OpenAI, Gemini) in settings for higher-quality output.

## Architecture

- **`extension/`** — Chrome extension (Manifest V3) that detects text selection and handles in-page text replacement
- **`backend/`** — Python backend running on AWS Lambda; handles the default AI provider, stores user settings, and syncs data between the extension and desktop app
- **`desktop-app/`** — Electron desktop app with a usage dashboard (words rewritten, time saved) and a settings page for managing API keys

## Tech stack

JavaScript, Python, AWS Lambda, DynamoDB, Electron, Chrome Extension API, Groq API
