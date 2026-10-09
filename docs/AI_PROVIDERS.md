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

The personal tutor now generates natural paragraph text rather than selecting fixed conversational acts. `server/natural-tutor.js` bounds the draft to six segments and 7,000 text characters, with only current retrieved section IDs permitted as supporting references. The generator receives saved focus, coaching style and daily minutes plus recent conversation history: at most 16 messages and 16,000 text characters, with per-message limits. History and learner statements are context, not medical evidence. The tutor may discuss ordinary life, motivation and study preferences without forcing every exchange back to the guideline library.

An ordinary successful generated turn requires two paid text-model completions using the same selected model: one to write the draft, capped at 800 billed output tokens, and a separate review request capped at 600. The reviewer independently identifies each externally factual claim, including medical, exam-rule, statistics and learning-effectiveness assertions; it returns exact quotations from the draft and exact supporting excerpts from current source sections. The server validates paragraph coverage, approval/flags, known IDs and the exact quotation/excerpt matches before displaying the draft, and supplies the source links. The model still judges whether every fact was identified and whether the excerpts entail it. A separate request is an automated review, not independent clinician review or an accuracy guarantee. Generated replies remain `sourceVerified:false` and `humanReview:false`, with a distinct passed-review record.

For the documented GPT-4.1 family, including the active `gpt-4.1-mini`, both generation and review use native strict Structured Outputs with request-specific schemas. Other supported models retain JSON output with the same server-side validation; native schema enforcement is not asserted for them. Schema conformance alone cannot establish factual support. A rejected draft is withheld and produces an explicit source-check failure with a bounded diagnostic code; no automatic regeneration, retry or model fallback occurs. An invalid draft can stop before the second call, while completed provider work can still be charged. Accepted paragraph text and claim/excerpt review records are stored in the study workspace; rejected raw output is not used as the reply.

Direct canonical quiz requests and deliberate A–E grading remain local and do not need a model call. A pending quiz survives nonfactual conversation; new factual hints or answer disclosure are rejected until the learner answers or explicitly requests a reveal. Written clinical reasoning is not independently graded. The tutor cannot claim that an app action occurred merely because it proposed one. Unsupported facts require a natural acknowledgment of the source gap, without inventing an explanation or citation.

Commercial source checks, cost reservations and durable request deduplication remain separate from the personal model selector. The approved commercial clinical corpus is empty, so commercial clinical answers abstain; this natural tutor does not open that commercial gate. Personal notes remain unverified. A successful connection or automated review establishes neither guideline accuracy nor a cheapest clinically viable model. See [GUIDELINE_RAG.md](GUIDELINE_RAG.md).

Ingenium Applicatum's registered metadata feed is **connected and verified** for successful text completions. OpenAI transport remains direct; there is no hosted Ingenium model-routing gateway or automatic cheapest-model substitution. Exported results and observed metadata support later comparison, subject to source validation, cost controls, request identity and the absolute Astra prohibition. See [INGENIUM_INTEGRATION.md](INGENIUM_INTEGRATION.md).

## Sourced spoken study

In Coach, choose **Talk with Coach**, grant browser speech-recognition permission and chat naturally about your day, study plan, a cited topic or a quiz. Recognized text follows the same authenticated `/api/chat` route as typed study. Browser speech synthesis can read generated paragraphs only when their automated-review record passes the readout guard; canonical study answers use a separate current-source guard. Generated text is labeled as automatically reviewed, not verified canonical teaching or clinician-approved content. Citations remain visible. The tutor is instructed and reviewed not to echo clinical misinformation, even as a learner quotation. Historical generated captions, imported replies and imported review metadata do not qualify for reviewed readout. No additional audio model is called.

Recognition is stopped during spoken playback. Mute, Interrupt and Stop are available, with background/pagehide shutdown and a ten-minute local session limit. Device/browser support varies; keyboard dictation and typed chat remain alternatives. Browser recognition can use a browser/vendor service, according to that browser's behavior and settings; audio is not sent by this app to OpenAI Realtime. Generated text still incurs the selected model's generation and review calls. The app records no audio files.

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

## Archived bounded-plan feature check

The earlier `dialogue-v3` operator revision validated the original saved 15-minute planning turn and submitted one new corrected cited atrial-fibrillation follow-up. Each model turn was capped at 512 billed output tokens and used a fixed durable request identity. The original planning turn passed. Both earlier follow-ups remain in internal history: the original reply and the native-schema `dialogue-v2` reply were safely rejected by runtime validation, with the latter reporting `invalid_dialogue_plan`. Their raw parsed responses were not retained, so the exact causes of those hosted rejections are unknown. An actual-corpus local reproduction found a valid dual teaching-point/quiz selection was rejected; canonical source-union rendering, eligible-ID deduplication and the point-plus-recall schema were corrected before that revision. This was a local-listener check in the personal OpenAI pilot with `gpt-4.1-mini` active. Credentials stayed inside the server, and receipts contained bounded status and usage metadata.

Completed replies are validated from saved history instead of incurring another inference. An uncertain or conflicting saved request stops the check without an automatic retry. Leave the flag blank after the check. It does not re-enable the previously completed `READY` or source-selector checks, and does not establish clinical accuracy or physical-phone speech support. Current outcomes belong in [VALIDATION_STATUS.md](VALIDATION_STATUS.md).

The hosted `dialogue-v3` check passed on October 9, 2026. The original planning reply passed validation from saved history without another inference. One new cited atrial-fibrillation follow-up passed the bounded canonical study-conversation check with returned model `gpt-4.1-mini-2025-04-14`, 2,317 input / 66 output tokens and configured-rate estimated cost USD 0.0010324. Ingenium event `48eee2b9-975a-49d4-adb6-656208d1373e`, recorded at 17:15:34.127 UTC with 1,948 ms latency, was independently read back. Railway deployment `4535252d-b2c4-4cce-83d6-8aebc904f7b2` reached `SUCCESS` at 17:15:39 UTC. The operator flag is blank again; clearing it did not trigger another deployment or model call.

This archived result verifies the former bounded cited follow-up and reuse of its saved plan. It does not validate the new natural-generation/review path, a particular recall-prompt choice, broader conversation-history quality, clinical accuracy or actual phone microphone/readout behavior. Earlier rejected replies remain preserved internally.

## Natural-tutor operator check

`STUDY_INITIAL_CONVERSATION_CHECK` is blank by default. The new explicit revision, `natural-v1`, uses three fixed synthetic turns to check natural conversation, use of recent context and a sourced study exchange. At most six model calls are involved: generation and review for each turn. Completed request identities are retained and reused; uncertain outcomes are not retried automatically. The local owner-only operator route keeps these probe conversations out of learner state, history, default conversation selection and exported backups while preserving the records for debugging and request deduplication. Learner imports cannot replace reserved operator records.

The new live natural-tutor check is pending. Leave the flag blank after an authorized check, and keep prior `READY`, source-selector and bounded-plan probes disabled. Hosted receipts and current verification outcomes belong in [VALIDATION_STATUS.md](VALIDATION_STATUS.md); no conversational or clinical accuracy claim follows from a connection result alone. Physical-phone microphone and audible playback testing remains separate.
