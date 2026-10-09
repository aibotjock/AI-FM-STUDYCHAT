# Server-side AI and owner model checks

Updated October 9, 2026. The private phone pilot uses **OpenAI only**. Claude support remains inactive. The owner has configured `OPENAI_API_KEY` in Railway and confirmed phone sign-in. One genuine nonclinical connection/instruction check passed with returned model `gpt-4.1-mini-2025-04-14`; its usage event was read back from Ingenium. This is separate from conversational or clinical quality; see [VALIDATION_STATUS.md](VALIDATION_STATUS.md).

## Railway credentials

Open the service dashboard in [HOSTING.md](HOSTING.md), then **Variables**:

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=<already configured privately in Railway>
OPENAI_MODEL=gpt-4.1-mini
COMMERCIAL_OPENAI_MODEL=gpt-5.4-mini-2026-03-17
```

`OPENAI_API_KEY` authorizes the server's OpenAI requests. It never belongs in the app's sign-in form, client code, Android build, URL, or public repository. The phone's **Study access code** is the separate `STUDY_ACCESS_TOKEN` value from Railway. Deploy variable changes before using them. API usage is billed to the operator's OpenAI account; a ChatGPT subscription does not supply API access.

## Choose and compare models

In the owner's personal workspace, open **Study preferences → Choose or test a model**. Choose an OpenAI text model and press **Use selected model**, then use Coach or **Test model connection**. This control does not change the separately configured commercial model. Anyone holding the personal workspace's shared access code has these owner controls, so keep that code private.

The registry includes explicitly documented conversational models and verified snapshot IDs. Account-confirmed choices are the intersection with the server's OpenAI model list, excluding retired models. Audio, image, embedding, moderation, unknown aliases, and unsupported IDs are excluded. A documented fallback list is labeled as unconfirmed when account access cannot be fetched; an entry in the documentation does not establish account access or suitability for this app.

**Astra is prohibited at all times, with no exceptions.** It must never be configured, selected, requested, evaluated, or used as a fallback. Server checks reject Astra IDs and block prohibited or unexpected model identities returned by a provider.

Connection checks use a fixed nonclinical `READY` prompt capped at 512 billed output tokens. Each new check can incur API charges; completed checks are reused to avoid redundant calls. Reasoning can consume that output budget before any visible answer, and a timeout or incomplete result can still be charged. No automatic retry or fallback to another model is performed.

**Export model results** downloads versioned JSON with requested and returned model IDs, token usage, latency, estimated cost, and connection/instruction results. Coach replies and card drafts also record model metadata. Price estimates use documented/configured standard rates, exclude cache discounts, and remain unknown when a verified rate is unavailable. These results support later comparison; they are not a clinical benchmark.

## Transport and clinical limits

The adapter uses fixed HTTPS OpenAI endpoints, Chat Completions or Responses according to the documented model profile, bounded output, and `store:false`. That setting alone does not promise zero provider retention. The server extracts only assistant text and rejects refusal, incomplete, empty, or unexpected model output. Normalized billed output includes reasoning tokens; those tokens are not counted twice.

Commercial source checks, cost reservations, and durable request deduplication remain separate from the personal model selector. The reviewed clinical corpus is empty, so commercial clinical answers abstain. Personal AI answers and user-created cards are unverified educational assistance. A successful connection check establishes neither guideline accuracy nor a cheapest clinically viable model.

Ingenium Applicatum's registered metadata feed is **connected and verified** for successful text completions. OpenAI transport remains direct; there is no hosted Ingenium model-routing gateway or automatic cheapest-model substitution. Exported results and observed metadata support later comparison, subject to source validation, cost controls, request identity and the absolute Astra prohibition. See [INGENIUM_INTEGRATION.md](INGENIUM_INTEGRATION.md).

## Continuous voice pilot

In Coach, choose **Start voice**, allow microphone access, and speak naturally. Mute, Interrupt, Stop and an autoplay-recovery speaker action are available. The separate dictation microphone fills the composer; it does not send a message automatically.

Voice always starts with `gpt-realtime-2.1-mini`, independently of the owner's text-model selection. Signaling and call shutdown use the app server's OpenAI key; the phone receives no API credential. Microphone audio travels to OpenAI over WebRTC. Recent study context is included, and finalized captions are saved as client-reported, unverified conversation text. The app does not record audio files. Sessions have a ten-minute limit and stop when the page goes into the background.

Voice is enabled only in the personal pilot. It has no approved-guideline retrieval and no clinician-verified accuracy rating. Browser/client-reported usage is not trusted for billing and is not sent to the Ingenium text-event receiver. Server-verified voice metering and customer cost controls are required before paid voice deployment. Fixed initial configuration and normal-client controls are not a tamper-proof commercial spending ceiling. Local voice checks passed; actual phone permission, speaker, interruption and upstream model access remain to verify through the owner's first voice test.

Official references:

- https://developers.openai.com/api/reference/resources/models/methods/list
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://developers.openai.com/api/docs/guides/reasoning
