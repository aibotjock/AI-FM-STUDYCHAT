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

For the documented GPT-4.1 family, including the active `gpt-4.1-mini`, conversational plans use native strict Structured Outputs with a request-specific schema of known evidence/question IDs and allowed dialogue acts. Other supported models retain JSON output with the same server-side plan validation; native schema enforcement is not asserted for them. A cited-point-plus-recall request sets the quiz `questionId` to null and asks a recall prompt after the cited point. Where a valid plan selects both a teaching point and an original quiz, the server renders both canonical bodies with their source union; repeated eligible section IDs are deduplicated. The server still checks current evidence and exact learner quotations, then generates trusted spoken text. Strict schema conformance does not establish medical accuracy.

A rejected response records a bounded `invalid_json` or `invalid_dialogue_plan` code, a fixed numeric reason identifier and a sanitized plan projection. That projection contains only recognized public source/question IDs, allowed dialogue enums, bounded numbers and booleans; it excludes learner prose, arbitrary identifiers and the raw rejected model body. These diagnostics help distinguish plan failures without storing private rejected text.

Commercial source checks, cost reservations, and durable request deduplication remain separate from the personal model selector. The approved commercial clinical corpus is empty, so commercial clinical answers abstain. The personal text Coach combines conversation with the separate source-linked educational RAG. A bounded OpenAI JSON dialogue plan uses recent conversation history and saved learning preferences to select conversational acts and known evidence/question IDs. The server validates that plan and renders coaching wording, canonical teaching text and citations. Any quoted learner statement must match the supplied learner text and is labeled unverified; it is not a medical teaching claim. Model-written clinical answer bodies and invented references are not accepted. Source checking does not constitute independent clinician review; personal notes remain unverified. The wording is constrained, and written clinical reasoning is not independently graded. A successful connection check establishes neither guideline accuracy nor a cheapest clinically viable model. See [GUIDELINE_RAG.md](GUIDELINE_RAG.md).

For ordinary conversational turns, one bounded text-model request produces the dialogue plan. Direct canonical quiz requests and deliberate answer grading remain local and do not need a model call. Conversation can plan a session, ask a follow-up, revisit a cited point or request another question. A hint preserves the pending quiz so the learner can still answer it. Missing evidence remains a visible source gap rather than a generated medical explanation.

Ingenium Applicatum's registered metadata feed is **connected and verified** for successful text completions. OpenAI transport remains direct; there is no hosted Ingenium model-routing gateway or automatic cheapest-model substitution. Exported results and observed metadata support later comparison, subject to source validation, cost controls, request identity and the absolute Astra prohibition. See [INGENIUM_INTEGRATION.md](INGENIUM_INTEGRATION.md).

## Sourced spoken study

In Coach, choose **Talk with Coach**, grant browser speech-recognition permission and discuss your study plan, a cited topic or a quiz. Recognized text follows the same authenticated `/api/chat` route as typed study. Browser speech synthesis reads the server-rendered trusted spoken text, containing conversational prompts and eligible canonical teaching; it excludes quoted learner statements. It does not call an additional audio model or generate extra medical statements. Citations and any unverified learner quotation remain visible in chat. Historical generated captions and imported replies are not treated as sourced answers.

Recognition is stopped during spoken playback. Mute, Interrupt and Stop are available, with background/pagehide shutdown and a ten-minute local session limit. Device/browser support varies; keyboard dictation and typed chat remain alternatives. Browser recognition can use a browser/vendor service, according to that browser's behavior and settings; audio is not sent by this app to OpenAI Realtime. Text requests still use the selected OpenAI text model for constrained dialogue planning when necessary. The app records no audio files.

Unchecked Realtime session creation and transcript ingestion are disabled by the backend even when an OpenAI key is configured. The old module remains development history and is not an active app capability. Local controller/integration checks are distinct from actual phone microphone, speech recognition and audible playback tests.

Official references:

- https://developers.openai.com/api/reference/resources/models/methods/list
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/guides/conversation-state
- https://developers.openai.com/api/docs/guides/structured-outputs

## Genuine sourced selector observation

On October 9, 2026, a separate new synthetic board-study request passed exact current canonical-text/citation validation and selected the required AF risk and anticoagulant sections. Returned model: `gpt-4.1-mini-2025-04-14`; observed usage: 817 input / 39 output tokens; provider latency 2,195 ms; configured-rate estimated cost USD 0.0003892. Ingenium event `fd1493d1-f323-45ef-96f7-6f6284db23ca` was independently read back. The initial source preflight found an alias collision before any paid call; only the corrected request incurred inference, once.

This is one narrow source-selection result, not a total-accuracy, exam-readiness or cheapest-model conclusion. The operator check is now disabled, and its durable identity prevents a paid repeat. Clinical quality adjudication and a multi-model benchmark remain separate work.

## Bounded conversational feature check

`STUDY_INITIAL_CONVERSATION_CHECK` is blank by default. The current explicit operator revision is `dialogue-v3`: it validates the original saved 15-minute planning turn and submits only one new corrected cited atrial-fibrillation follow-up when that request has not already been attempted. Each model turn is capped at 512 billed output tokens and uses a fixed durable request identity. The original planning turn passed. Both earlier follow-ups remain in history: the original reply and the native-schema `dialogue-v2` reply were safely rejected by runtime validation, with the latter reporting `invalid_dialogue_plan`. Their raw parsed responses were not retained, so the exact causes of those hosted rejections are unknown. An actual-corpus local reproduction found a valid dual teaching-point/quiz selection was rejected; canonical source-union rendering, eligible-ID deduplication and the point-plus-recall schema were corrected before the new revision. This check runs only against the local listener in the personal OpenAI pilot with `gpt-4.1-mini` active. Credentials stay inside the server; logged receipts contain bounded status and usage metadata, not secrets or study transcripts.

Completed replies are validated from saved history instead of incurring another inference. An uncertain or conflicting saved request stops the check without an automatic retry. Leave the flag blank after the check. It does not re-enable the previously completed `READY` or source-selector checks, and does not establish clinical accuracy or physical-phone speech support. Current outcomes belong in [VALIDATION_STATUS.md](VALIDATION_STATUS.md).
