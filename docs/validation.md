# Validation record

Build date: October 10, 2026. Tested application tree: `449ab040a61f884e507c648d030ea6938679c3f4`; initial pushed runtime commit: `844ad092b6c24ed052f9897cd4477e98f57f5e41`. Later documentation commits do not change the tested runtime.

- Pinned component provenance: 57 copied files checked against exact upstream Git blob hashes; the practice test bank-fixture path is the only copied-file adjustment.
- Final automated acceptance: `npm test` passed 91/91 checks on Node 24.19.0, including real HTTP bootstrap, no-key deterministic study mode, encoded IDs, and logout cancellation.
- Pinned automated engines: 3 practice, 9 review, and 33 Conversation Agent checks passed during source materialization.
- Host access and SQLite baseline: passed (private APIs, origin checks, cookie attributes, static exposure, login throttling, settings, schema version, and transaction action identity).
- Typed chat control flow: passed, including duplicate/retry identity, cancellation, partial/interrupted outcomes, malformed streams, bounded history, and imported metadata.
- Practice/review/backup integration: passed, including canonical grading, due scheduling, action deduplication, validated atomic restore, legacy import on a temporary copy, and imported-history distrust.
- Reference directory policy: passed, including missing/malformed catalogue, unknown IDs, lazy metadata search, and unavailable consultation.
- Local browser workflows: passed in Chromium 153 at 390 px. Sign-in, one-call typed stream without reference/audio requests, reload, Stop, practice resume, review, card creation, reference search, preferences, backup download/restore, microphone denial with typed fallback, and progress labels passed with zero page errors. Provider responses were deterministic test fixtures; see browser-results.json.
- Actual-model fixtures: pending. A server-only reference to the existing Railway provider credential is staged for the new service. No API key was fetched or copied into the local workspace. The eight-fixture evaluator is qa/model-smoke.mjs.
- Hosted Railway checks: pending. New isolated service and HTTPS domain created; new volume, owner access, model configuration, and source commit staged. Applying the staged deployment was rejected by the Railway approval step: "the user did not approve this action." No build or deployment started; no hosted-model or restart claims are made.
- Physical-phone voice: not run; no physical device is attached.

Mocked provider checks establish application behavior, not medical accuracy or model resistance to prompt injection. The approved eight small actual-model fixtures are greeting, study plan, general medical concept, unsupported current recommendation, nonexistent paper, unavailable source, ambiguous question, and hostile instructions inside quoted source text. No expanded medical benchmark, storage-failure campaign, or daily AI quotas are included.

Official integration references checked: [Responses streaming](https://developers.openai.com/api/docs/guides/streaming-responses), [streaming event definitions](https://developers.openai.com/api/reference/resources/responses/streaming-events), [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini), [transcription](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create), and [speech](https://developers.openai.com/api/reference/resources/audio/subresources/speech/methods/create). Railway references are listed in deployment instructions.
