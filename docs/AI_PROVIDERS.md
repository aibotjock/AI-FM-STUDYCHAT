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

Commercial source checks, cost reservations, and durable request deduplication remain separate from the personal model selector. The approved commercial clinical corpus is empty, so commercial clinical answers abstain. The personal text Coach now uses the separate source-linked educational RAG: OpenAI selects known section/question IDs and the server renders canonical teaching text and citations. Source checking does not constitute independent clinician review; personal notes remain unverified. General coaching and case worksheets use fixed nonfactual prompts; the personal app does not expose free-model factual prose. A successful connection check establishes neither guideline accuracy nor a cheapest clinically viable model. See [GUIDELINE_RAG.md](GUIDELINE_RAG.md).

Ingenium Applicatum's registered metadata feed is **connected and verified** for successful text completions. OpenAI transport remains direct; there is no hosted Ingenium model-routing gateway or automatic cheapest-model substitution. Exported results and observed metadata support later comparison, subject to source validation, cost controls, request identity and the absolute Astra prohibition. See [INGENIUM_INTEGRATION.md](INGENIUM_INTEGRATION.md).

## Sourced spoken study

In Coach, choose **Start voice**, grant browser speech-recognition permission and request a cited study topic or quiz. Recognized text follows the same authenticated `/api/chat` route as typed study. Browser speech synthesis reads the exact accepted canonical reply; it does not call an additional audio model or generate extra medical statements. Citations remain visible in the chat. Fixed source-gap/navigation messages can also be spoken. Historical generated captions and imported replies are not treated as sourced answers.

Recognition is stopped during spoken playback. Mute, Interrupt and Stop are available, with background/pagehide shutdown and a ten-minute local session limit. Device/browser support varies; keyboard dictation and typed chat remain alternatives. Browser recognition can use a browser/vendor service, according to that browser's behavior and settings; audio is not sent by this app to OpenAI Realtime. Text requests still use the selected OpenAI text model for constrained evidence selection when necessary. The app records no audio files.

Unchecked Realtime session creation and transcript ingestion are disabled by the backend even when an OpenAI key is configured. The old module remains development history and is not an active app capability. Local controller/integration checks are distinct from actual phone microphone, speech recognition and audible playback tests.

Official references:

- https://developers.openai.com/api/reference/resources/models/methods/list
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://developers.openai.com/api/docs/guides/reasoning

## Genuine sourced selector observation

On October 9, 2026, a separate new synthetic board-study request passed exact current canonical-text/citation validation and selected the required AF risk and anticoagulant sections. Returned model: `gpt-4.1-mini-2025-04-14`; observed usage: 817 input / 39 output tokens; provider latency 2,195 ms; configured-rate estimated cost USD 0.0003892. Ingenium event `fd1493d1-f323-45ef-96f7-6f6284db23ca` was independently read back. The initial source preflight found an alias collision before any paid call; only the corrected request incurred inference, once.

This is one narrow source-selection result, not a total-accuracy, exam-readiness or cheapest-model conclusion. The operator check is now disabled, and its durable identity prevents a paid repeat. Clinical quality adjudication and a multi-model benchmark remain separate work.
