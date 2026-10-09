# Server-side AI providers

Updated October 9, 2026. Claude Haiku 5.5 is the requested phone-pilot selection. OpenAI remains available. Provider support is implemented and tested with mocked responses; no live provider key or successful live AI conversation has been supplied here.

## Configure the private phone pilot

Open the Railway service dashboard linked in [HOSTING.md](HOSTING.md), then its **Variables** tab:

```dotenv
AI_PROVIDER=anthropic
CLAUDE_MODEL=claude-haiku-5-5
CLAUDE_API_KEY=<set privately in Railway>
```

Deploy the variable change. Open the phone app, unlock it with the existing `STUDY_ACCESS_TOKEN`, and check Study preferences for the connected provider/model. The owner must obtain an API key from their Anthropic API account. A consumer Claude subscription does not configure this backend or pay its API usage. Never send a key in chat, a query string, an app preference, a GitHub issue or an Android build setting.

To select OpenAI instead:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=<set privately in Railway>
OPENAI_MODEL=gpt-4.1-mini
COMMERCIAL_OPENAI_MODEL=gpt-5.4-mini-2026-03-17
```

`AI_PROVIDER` is a server setting, not a client entitlement or an end-user model selector. There is no automatic cross-provider fallback and no automatic paid retry. Only the selected provider's key is used. A missing key shows the offline worksheet path in personal mode; commercial AI stays unavailable.

## Protocol and cost boundaries

The shared adapter uses fixed HTTPS provider endpoints. Claude uses `/v1/messages`, a top-level system prompt, API version `2023-06-01`, adaptive thinking with low effort for Haiku 5.5, and text-block extraction. Thinking and signatures are never returned or saved as study content. Refusal, incomplete output and provider errors fail with bounded messages. OpenAI uses Chat Completions with `store:false`. Neither setting promises zero provider retention.

Commercial mode normalizes measured usage, including billed Claude thinking tokens, to the existing cost ledger. Defaults are $0.10 input/$0.50 output per million tokens for Haiku 5.5 within the short-request tier and $0.75/$4.50 for the pinned OpenAI commercial model. Leave `AI_INPUT_USD_PER_MILLION` and `AI_OUTPUT_USD_PER_MILLION` blank to use the selected built-in rates. A custom commercial model requires both verified prices explicitly. Model/provider identity is part of the durable request fingerprint, preventing replay across a configuration change.

Provider selection keeps subscription checks, cost reservations and reviewed-source validation in place. The reviewed clinical corpus is empty, so commercial clinical answers abstain. Personal-mode AI remains unverified educational assistance. A cheap model has not been established as clinically viable by transport tests.

## Targeted verification completed

- Five new adapter/personal-Claude tests passed: protocol, text-only persistence, errors, no fallback, configuration and personal chat/card drafting.
- Three new commercial-provider tests passed: approved-source validation, Claude cost reconciliation, pre-call budget enforcement, and request replay after a provider change.
- Two existing personal OpenAI tests were rerun because that code now uses the shared adapter; both passed.
- Syntax checks covered changed JavaScript. Previously passing unrelated suites were not rerun.

An Ingenium gateway connection and model benchmark are proposed next steps. This adapter currently calls providers directly; tenant registration alone does not change that transport. A future integration must preserve the app's source checks, cost reservations and request deduplication.

Official references:

- https://platform.claude.com/docs/en/models/haiku-5-5/migration-guide
- https://platform.claude.com/docs/en/api/messages/create
- https://www.anthropic.com/claude-haiku-5-5
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
