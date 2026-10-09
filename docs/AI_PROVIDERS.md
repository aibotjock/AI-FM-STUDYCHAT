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

An ordinary successful generated turn requires two paid text-model completions using the same selected model: one to write the draft, capped at 800 billed output tokens, and a separate review request capped at 600. The reviewer independently identifies each externally factual claim, including medical, exam-rule, statistics and learning-effectiveness assertions, then quotes the claim exactly and selects the supporting current study chunk and immutable span ID. It does not recopy or rewrite the source excerpt. The server checks the chunk/span pairing and supplies the exact canonical excerpt, validates paragraph coverage and approval/flags, then supplies the citation links. The model still judges whether every fact was identified and whether those excerpts entail it. A selected span ID is not an accuracy proof. A separate request is an automated review, not independent clinician review or an accuracy guarantee. Generated replies remain `sourceVerified:false` and `humanReview:false`, with a distinct passed-review record.

Fresh provider reviews must use protocol version 2 for both native-schema and validated-JSON models. The server compiles accepted reviews into the stored `groundingReview.version:1` representation, adding `sourceSpanBindings` that hash each used study section's key and complete text. Current replay rejects any change to a bound section, including an appended qualifier. This is a binding to the incorporated study text, not a hash of the full official guideline document. Older stored reviews without the binding marker retain their earlier compatibility checks; they do not retroactively gain the new whole-section change protection. No source corpus or clinician-review requirement is changed by this protocol correction.

For the documented GPT-4.1 family, including the active `gpt-4.1-mini`, both generation and review use native strict Structured Outputs with request-specific schemas. Other supported models retain JSON output with the same server-side validation; native schema enforcement is not asserted for them. Schema conformance alone cannot establish factual support. A rejected draft is withheld and produces an explicit source-check failure with a bounded diagnostic code; no automatic regeneration, retry or model fallback occurs. An invalid draft can stop before the second call, while completed provider work can still be charged. Accepted paragraph text and claim/excerpt review records are stored in the study workspace; rejected raw output is not used as the reply.

Direct canonical quiz requests and deliberate A–E grading remain local and do not need a model call. A pending quiz survives nonfactual conversation; new factual hints or answer disclosure are rejected until the learner answers or explicitly requests a reveal. Written clinical reasoning is not independently graded. The tutor cannot claim that an app action occurred merely because it proposed one. Unsupported facts require a natural acknowledgment of the source gap, without inventing an explanation or citation.

Commercial source checks, cost reservations and durable request deduplication remain separate from the personal model selector. The approved commercial clinical corpus is empty, so commercial clinical answers abstain; this natural tutor does not open that commercial gate. Personal notes remain unverified. A successful connection or automated review establishes neither guideline accuracy nor a cheapest clinically viable model. See [GUIDELINE_RAG.md](GUIDELINE_RAG.md).

Ingenium Applicatum's registered metadata feed is **connected and verified** for successful text completions. OpenAI transport remains direct; there is no hosted Ingenium model-routing gateway or automatic cheapest-model substitution. Exported results and observed metadata support later comparison, subject to source validation, cost controls, request identity and the absolute Astra prohibition. See [INGENIUM_INTEGRATION.md](INGENIUM_INTEGRATION.md).

## Premium spoken study

The private app's premium voice catalog offers **Marin** (default), **Cedar**, **Coral**, **Sage** and **Ash**. The catalog and one fixed Marin preview passed live on October 9, 2026 at 18:56:18.314 UTC: one uncached speech request returned approximately 96 kB of audio. Speech usage and cost remained null. The other four voices were not separately auditioned through paid calls. The fixed speech model is `gpt-4o-mini-tts`; choosing a chat model does not change it. **Coach voice** selects the voice, **Preview voice** requests a fixed sample, and **Talk with Coach** handles the spoken conversation. Per-message **Read aloud** uses the same selected voice. This audio is AI-generated, not a human recording. Actual phone playback, pronunciation, correspondence with the visible text and owner judgment of voice quality remain to check; a successful preview response is not proof of those outcomes.

Recognized speech follows the same authenticated `/api/chat` route as typed study. The server accepts only an eligible stored assistant reply for speech: an accepted generated reply with a passed automated review, or a current canonical study answer through its separate source guard. It sends that checked reply text to OpenAI for speech synthesis; the speech request does not generate another conversational answer. Citations remain visible, and generated text retains its automated-review label rather than becoming verified canonical or clinician-approved teaching. Historical generated captions, imported replies, imported review metadata and rejected drafts do not qualify. The preview uses fixed server-owned sample text, not arbitrary client-supplied speech text.

Recognition is paused during speech generation and playback. Mute, Interrupt and Stop are available, with background/pagehide shutdown and a ten-minute local conversation limit. Browser recognition may use a browser/vendor service under its settings; the app does not send microphone audio to OpenAI Realtime. Typed chat or keyboard dictation can be combined with premium **Read aloud** when browser recognition is unavailable. There is no automatic fallback to a device voice. If autoplay is blocked, **Play audio** resumes the already fetched audio rather than making another provider request. Changing voices cancels current playback.

Generated chat normally incurs two text-model calls, then speech synthesis incurs an additional paid request for each uncached audio chunk. Previewing a voice is also a speech request. `/api/voice/speech` accepts saved conversation/message identities, a supported voice and a chunk index; `/api/voice/preview` uses fixed server sample text. Replies are bounded to eight chunks of at most 4,096 characters and 24,000 characters overall; splits prefer sentence or whitespace boundaries while preserving the text, and oversized replies are refused rather than silently clipped. An authenticated `/api/voice/check/{requestId}` receipt exposes bounded speech-request metadata, not audio or input text.

The server caches at most 16 audio entries within a 16 MiB memory budget for five minutes; individual MP3 responses are limited to 3 MiB. Audio is not durably stored in app data or exported backups. A separate durable request ledger stores fingerprints, status and bounded technical metadata to prevent automatic repeats. An uncertain request is not repeated; replay of completed audio after its memory cache expires requires an explicit new speech request. The service permits one speech request at a time with a 45-second provider timeout. These controls do not prevent a stopped or timed-out provider request from incurring charges.

OpenAI's provider retention remains separate from this temporary app cache. Binary speech responses do not supply verified token/cost usage here; those values remain unknown rather than being invented. Ingenium's current receiver accepts text Chat Completions/Responses events only, so premium speech usage is not claimed as ingested telemetry. No automatic retry or speech/model fallback is performed.

Unchecked Realtime session creation and transcript ingestion are disabled by the backend even when an OpenAI key is configured. The old module remains development history and is not an active app capability. Local controller/integration checks are distinct from actual phone microphone, speech recognition and audible playback tests.

Official references:

- https://developers.openai.com/api/reference/resources/models/methods/list
- https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create
- https://developers.openai.com/api/reference/resources/responses/methods/create
- https://developers.openai.com/api/docs/guides/reasoning
- https://developers.openai.com/api/docs/guides/conversation-state
- https://developers.openai.com/api/docs/guides/structured-outputs
- https://developers.openai.com/api/docs/guides/text-to-speech
- https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create

## Genuine sourced selector observation

On October 9, 2026, a separate new synthetic board-study request passed exact current canonical-text/citation validation and selected the required AF risk and anticoagulant sections. Returned model: `gpt-4.1-mini-2025-04-14`; observed usage: 817 input / 39 output tokens; provider latency 2,195 ms; configured-rate estimated cost USD 0.0003892. Ingenium event `fd1493d1-f323-45ef-96f7-6f6284db23ca` was independently read back. The initial source preflight found an alias collision before any paid call; only the corrected request incurred inference, once.

This is one narrow source-selection result, not a total-accuracy, exam-readiness or cheapest-model conclusion. The operator check is now disabled, and its durable identity prevents a paid repeat. Clinical quality adjudication and a multi-model benchmark remain separate work.

## Archived bounded-plan feature check

The earlier `dialogue-v3` operator revision validated the original saved 15-minute planning turn and submitted one new corrected cited atrial-fibrillation follow-up. Each model turn was capped at 512 billed output tokens and used a fixed durable request identity. The original planning turn passed. Both earlier follow-ups remain in internal history: the original reply and the native-schema `dialogue-v2` reply were safely rejected by runtime validation, with the latter reporting `invalid_dialogue_plan`. Their raw parsed responses were not retained, so the exact causes of those hosted rejections are unknown. An actual-corpus local reproduction found a valid dual teaching-point/quiz selection was rejected; canonical source-union rendering, eligible-ID deduplication and the point-plus-recall schema were corrected before that revision. This was a local-listener check in the personal OpenAI pilot with `gpt-4.1-mini` active. Credentials stayed inside the server, and receipts contained bounded status and usage metadata.

Completed replies are validated from saved history instead of incurring another inference. An uncertain or conflicting saved request stops the check without an automatic retry. Leave the flag blank after the check. It does not re-enable the previously completed `READY` or source-selector checks, and does not establish clinical accuracy or physical-phone speech support. Current outcomes belong in [VALIDATION_STATUS.md](VALIDATION_STATUS.md).

The hosted `dialogue-v3` check passed on October 9, 2026. The original planning reply passed validation from saved history without another inference. One new cited atrial-fibrillation follow-up passed the bounded canonical study-conversation check with returned model `gpt-4.1-mini-2025-04-14`, 2,317 input / 66 output tokens and configured-rate estimated cost USD 0.0010324. Ingenium event `48eee2b9-975a-49d4-adb6-656208d1373e`, recorded at 17:15:34.127 UTC with 1,948 ms latency, was independently read back. Railway deployment `4535252d-b2c4-4cce-83d6-8aebc904f7b2` reached `SUCCESS` at 17:15:39 UTC. The operator flag is blank again; clearing it did not trigger another deployment or model call.

This archived result verifies the former bounded cited follow-up and reuse of its saved plan. It does not validate the new natural-generation/review path, a particular recall-prompt choice, broader conversation-history quality, clinical accuracy or actual phone microphone/readout behavior. Earlier rejected replies remain preserved internally.

## Natural-tutor operator check

`STUDY_INITIAL_CONVERSATION_CHECK` is blank by default. The first explicit revision, `natural-v1`, used three fixed synthetic turns to check natural conversation, use of recent context and a sourced study exchange, with at most six model calls: generation and review for each turn. Completed request identities are retained and reused; uncertain outcomes are not retried automatically. The local owner-only operator route keeps these probe conversations out of learner state, history, default conversation selection and exported backups while preserving the records for debugging and request deduplication. Learner imports cannot replace reserved operator records.

The first hosted `natural-v1` check reached the updated private deployment, which completed successfully on October 9, 2026 at 17:57:58 UTC. Its greeting and context-continuation turns passed using four model calls in total. The atrial-fibrillation study turn completed its two calls but was withheld by review validation with reason `302`. The rejected raw response was not retained, so its exact cause is unknown. The full natural-conversation study flow did **not** pass. The operator flag is blank again, and these retained request identities prevent repeating the already attempted turns.

The hosted `natural-v2` study-only correction was attempted on October 9, 2026 at 18:56:15.811 UTC. It reused both passed earlier conversation turns without inference and made only one new study turn with two text calls, but that reply was withheld by review validation with reason `305`. The rejected raw response was not retained, so its exact subcause is unknown. Ingenium readback verified the two new usage events; their existence does not make this a passed study answer. Both failed study replies remain preserved internally.

The new `natural-v3` check is pending after the immutable source-span protocol correction. It submits only one new affected study turn with two text calls and preserves the two earlier passes without repeating them. The `STUDY_INITIAL_PREMIUM_VOICE_CHECK=premium-v1` preview has already passed and is off; it is not being re-enabled or repeated for this source-review change. Both gates default to blank. Leave the conversation gate blank after the authorized check and keep prior `READY`, source-selector and bounded-plan probes disabled. Hosted receipts and current verification outcomes belong in [VALIDATION_STATUS.md](VALIDATION_STATUS.md). Neither a deployment success nor a connection result establishes conversational quality, clinical accuracy or speech fidelity. Physical-phone microphone, audible playback and owner judgment of voice quality remain separate.
