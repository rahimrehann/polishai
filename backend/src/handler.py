"""
Polish backend - AWS Lambda handler.

Responsibilities (planned):
- Receive a rewrite request from the Chrome extension or desktop app
- If the user has no custom API key configured, call Groq (Llama 3.1 8B)
  using our default key (stored as a Lambda environment variable, never
  committed to source control)
- If the user has their own API key on file, use that provider instead
- Log a usage event (word count, time saved estimate) to DynamoDB
- Return the rewritten text to the caller
"""


def lambda_handler(event, context):
    # TODO: parse request body (selected text, user id, options)
    # TODO: look up user's provider preference in DynamoDB
    # TODO: call the appropriate LLM provider
    # TODO: write a usage event to DynamoDB
    # TODO: return the rewritten text
    raise NotImplementedError("Not built yet")
