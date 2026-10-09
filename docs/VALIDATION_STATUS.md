# Validation and debugging ledger

Updated October 9, 2026 (America/New_York). This is the record to consult before
testing again. A passed check is repeated only for an affected code path, a new
failure, changed deployment/configuration, or an unresolved concern. A new
scenario is not a repeat of an older scenario. Mocked checks never establish
live provider access or clinical accuracy.

## Version and scope

- Current hosted release: `1853f6e0dbd2aa0105f5c9240dfa98947919b992`,
  tree `cbcd230fe24575e616072e60f59541b974367489`.
- Voice, dictation, pan and telemetry implementation: `45077ce7d2a0f400e8548322cbfcd2a52c8c0982`,
  tree `390ecb02fd9fdd34ed71c4f53c7daf88440ebae8`. The later release adds privacy disclosures and live evidence; functional source is unchanged.
- Previous published baseline: `4cbf673ca36d3254a336a7f11527e96afb02e43c`.
- Earlier secure sign-in, review/restore fixes and owner OpenAI model controls
  are deployed. Newly checked changes add continuous personal voice, dictation
  reconciliation, mobile zoom/pan and a durable metadata-only Ingenium feed.
- Voice uses the fixed `gpt-realtime-2.1-mini` model, is personal-only, starts
  only through an explicit action and has a ten-minute session limit. Text model
  selection does not change the voice model.
- Active provider: OpenAI. Claude support is retained but inactive. Astra is
  rejected during configuration, catalog filtering, selection, restored
  provenance and returned-model validation. No Astra inference was performed.
- Store submission remains on hold. Ingenium has a verified project-admin
  application organization and hashed key; its authenticated receiver is active,
  and a genuine OpenAI request event was delivered and verified in Supabase.
  The app still calls OpenAI directly; Ingenium observes metadata without
  selecting or routing models automatically.

## Completed checks

| ID | Scope and evidence | Result | Why run / repeat |
| --- | --- | --- | --- |
| BASE-01 | Earlier full Node suite, before provider additions; hosted CI run `37882126889` | 57 passed, 1 skipped | Original baseline; unchanged scheduler, billing and content checks retained |
| BASE-02 | Provider addition: 5 adapter/personal tests, 3 commercial-provider tests, 2 affected existing OpenAI cases | 10 passed with mocks | Shared provider adapter was introduced |
| UI-01 | `qa/frontend-extended-qa.mjs`: preferences, dialogs, imports, filters, suspend/delete, backup, reflection, history, retry, clipboard/audio errors, offline draft, keyboard review | 12 passed; queue defect discovered | Previously uncovered controls; defect verified under UI-02 |
| UI-02 | `qa/frontend-regressions-qa.mjs`: edited/selective AI card acceptance, mocked dictation/permission failure, suspended/deleted active review head, 10–16 MiB backup restore | 4 passed | New scenarios and specific discovered defects |
| CAT-01 | `tests/openai-models.test.js`: prohibited IDs, endpoint/rates profiles, account intersection, bounded catalog/cache, fallback, shutdowns | 8 unique cases passed | New catalog; only affected profile/shutdown cases repeated after edits |
| API-01 | First 9 cases in `tests/model-selection.test.js`: auth, owner-only controls, persistence/cache, export, locking, provenance, Responses, atomic restore, forbidden returned model, trimmed secure login | 9 unique cases passed | New API; one pricing regression failed first and passed after its fix |
| ADAPT-01 | Existing `tests/ai-provider.test.js` and `tests/commercial-providers.test.js` | 8 passed | Adapter request/response implementation changed; synthetic Claude fixtures do not activate Claude |
| SERVER-01 | 10 affected `tests/server.test.js` cases: auth, CSRF, atomic restore, offline, message bounds, provider failure/retry, locks, slow uploads, AI draft sanitization, bounded workspace growth | 10 passed | Chat return shape and restored provenance changed; settings-only and throttle checks not repeated |
| COMM-01 | `tests/commercial.test.js`: approved-source grounding and deletion during an in-flight reply | 2 passed | Shared adapter/index integration changed; unrelated commercial/billing checks not repeated |
| PROTO-01 | `tests/openai-protocol.test.js`: legacy/modern token parameters, context preflight, Responses and refusal/incomplete handling, exact model-family identity, snapshot rules, usage/unknown costs | 8 passed | New protocol coverage; includes discovered prefix-matching defect |
| UI-03 | `qa/model-login-mobile-results.json`: secure sign-in/session/logout, catalog/selection errors, selected-model chat metadata, passed connection reuse, export, Responses Pro, recovery and layout | 11 passed at 360×800; 0 JS errors/overflow | New sign-in/model controls; previous 16 passing groups not repeated |
| API-02 | Last 3 cases in `tests/model-selection.test.js`: retired saved model recovery, catalog-await selection race, failed READY retry with same-ID idempotency | 3 passed | New review findings; earlier 9 cases not repeated |
| UI-04 | `qa/model-dialog-lifecycle-results.json`: dismissed/replaced dialogs during late success/error, closed model test, unsaved text preservation, retired-model warning | 6 passed; 0 JS errors | New lifecycle findings; previous 27 passing groups not repeated |
| CAT-02 | Only fallback and stale-catalog cases from CAT-01 | 2 passed | Selection now requires a confirmed non-stale account list; documented fallback is read-only |
| ING-01 | `tests/ingenium-telemetry.test.js`: metadata whitelist, fixed HTTPS receiver, server-only key, unknown usage, prohibited IDs, sanitized failures | 7 passed with mocks | New observer; no content or credentials transmitted |
| ING-02 | `tests/ingenium-hook.test.js`: adapter hooks, app wiring, selected-model provenance, receiver failure, restart/idempotent outbox delivery, 500-event cap | 9 unique cases passed with mocks | New integration; receiver delivery retries do not repeat inference |
| ING-03 | `tests/ingenium-check.test.js`: inactive/other-model skip, loopback-only credential use, durable READY request, safe summary/logout, failure without retry | 4 passed with mocks | New operator-enabled one-time bootstrap path; subsequent genuine run is recorded separately under LIVE-02 |
| VOICE-01 | `tests/voice.test.js`: fixed-model signaling, owner scope, SDP/URL bounds, creation failures, stop/grace/expiry, untrusted transcripts | 8 passed with mocks | New helper; no paid call or real microphone |
| VOICE-02 | `tests/voice-routes.test.js`: auth, locks, atomic/idempotent captions, imports, workspace ownership, disabled modes, prohibited model, limits, failure, logout/setup race, shutdown/setup race | 11 unique cases passed with mocks | New HTTP integration; logout race failed first, fixed and only that failing case repeated |
| UI-05 | `qa/voice-browser-combined-results.json`: 10 controller, 7 UI and 7 dictation groups at 360×800 | 24 unique groups passed; 0 JS errors; 0 paid calls | New continuous voice/dictation checks; only two failing groups repeated after fixes, with two new pending-setup groups added |
| ZOOM-01 | `qa/phone-zoom-results.json`: accessible viewport, gesture containment, scroll chaining, native twofold horizontal/vertical pan, reachable composer/navigation after reset | 5 passed; 0 JS errors; 0 paid calls | New mobile zoom cases; boundary probe corrected to wait for smooth scrolling before assessing containment |
| MAT-01 | New one-off inventory/HTTPS/status consistency checks for `content/source-checks.json`: 12 cases, 12 cards, 6 competencies, 0 approved teaching records; audit documented in `docs/STUDY_MATERIAL.md` and `docs/CLINICAL_CONTENT.md` | 13 groups passed, reported by the source-audit agent; no checked-in runner | New dated source manifest; existing content tests were not repeated; this does not establish clinical approval |
| LIVE-01 | Railway deployment `ecf8246b-a6f2-432d-ae07-02ee8f28e172`, deployed status and voice assets | Terminal SUCCESS at `2026-10-09T05:46:08.403Z`; `/api/status` 200; shell v4; voice module 200 with SHA-256 bytes matching local source | Changed implementation required deployment verification; no inference or phone audio in this check |
| LIVE-02 | Operator-enabled local bootstrap: authenticate, send durable bounded READY check, flush registered metadata feed, read back the genuine Supabase event | Authentication and READY instruction passed; uncached `gpt-4.1-mini-2025-04-14` response; 20 input/1 output tokens; delivered 1, pending 0 | First genuine OpenAI request and Ingenium receipt; estimated cost `$0.0000096`, not an invoice measurement or medical accuracy test |
| LIVE-03 | Processor-disclosure release `1853f6e0dbd2aa0105f5c9240dfa98947919b992`, deployment `bcc4534e-28dc-4143-9e96-7d05ab3ed3c4` | Terminal SUCCESS at `2026-10-09T05:56:16.585Z`; changed privacy HTML parsed and served HTTP 200 with OpenAI-only, voice and Ingenium disclosures; new startup logs show UID/GID 1000 and no bootstrap run | Changed public disclosure required publication verification; no model, voice or previously passed functional suite repeated |
| PUB-01 | Native GitHub tree readback after publication | All 98 StudyChat and 240 Ingenium tracked blob hashes/modes match their staged local sources; Ingenium head `0b8b8a367cfa63f48de652bc99570853f07d3e1f` | Confirms published bytes rather than repeating functionality |



The local provider/catalog, Ingenium and voice checks used synthetic responses
and made zero paid calls. LIVE-02 separately records one genuine, uncached
OpenAI READY request; no real voice call has been tested. The earlier 94-case provider baseline
was not rerun as a redundant batch; new cases above are recorded separately.
The container privilege-capability check
was skipped in the original scratch kernel; prior Railway logs independently
confirmed the deployed application UID/GID is 1000.

## Defects and fixes

| ID | Finding | Fix and verification |
| --- | --- | --- |
| AUTH-01 | Incorrect token reported by owner; API key and study code confused; whitespace paste could fail | Separate labels/help, Show/Hide control, server/client trim; API-01/UI-03. Existing Railway token was neither exposed nor rotated. Owner subsequently confirmed successful live phone sign-in. |
| FRONT-01 | Suspended/deleted head remained in active review queue with stale revealed answer | Prune/recalculate active queue and hide next answer; UI-02 |
| FRONT-02 | Frontend rejected valid exported backups above 10 MiB while backend allowed 16 MiB | Align upload bounds; UI-02 |
| MODEL-01 | Saved selection reused original model price overrides after restart | Clear overrides on restore; focused failed pricing case rerun once, passed |
| MODEL-02 | Model-name prefix accepted another family, changing model/cost | Exact ID or explicit same-family documented snapshot only; PROTO-01 |
| MODEL-03 | Retired saved model could stop the entire app from starting | Keep study workspace available, disable retired inference, show warning and require explicit active selection; API-02/UI-04 |
| MODEL-04 | Model switched during awaited catalog validation | Reject stale captured provider with 409 before inference; API-02 |
| MODEL-05 | Late responses reopened dismissed dialogs or overwrote other unsaved forms | Dialog revision and connected-node checks; UI-04 |
| MODEL-06 | Failed READY instruction prevented a fresh explicit test | Cache successful READY checks across new IDs; retain same-ID idempotency for every completed request; API-02 |
| MODEL-07 | Unconfirmed documented fallback could be selected as if account-verified | Require account source and non-stale confirmation; CAT-02 |
| DICT-01 | Cumulative/revised speech-recognition results appended the same words repeatedly | Replace each result-index entry, preserve typed prefix/manual suffix, ignore callbacks from old sessions; UI-05 |
| DICT-02 | A removed trailing interim recognition segment remained visible | Prune result indices outside the current result list; reran only the failed removal group, passed under UI-05 |
| VOICE-03 | Rapid Start taps during conversation creation opened two conversations | Lock conversation creation and setup together; reran only the failed rapid-Start group, passed under UI-05 |
| VOICE-04 | A cancelled pending setup could overlap a new Start | Guard pending setup and show disabled Finishing voice setup state until the late call closes; two new focused UI-05 groups passed |
| VOICE-05 | Logout during awaited call creation could expose a connection offer after session invalidation | Recheck owner/session after upstream creation, close the late call and return no offer; only failed VOICE-02 case rerun, passed |
| ZOOM-02 | Mobile chat contained gestures and trapped scrolling at its boundary | Restore native touch/pan and page scroll chaining, remove the ancestor scroll trap; ZOOM-01 |


## Live and outstanding checks

| Item | Status and next concrete check |
| --- | --- |
| Railway HTTPS pilot | Hosted release `1853f6e0dbd2aa0105f5c9240dfa98947919b992` contains implementation `45077ce7d2a0f400e8548322cbfcd2a52c8c0982` and current processor disclosures. The implementation status check returned 200: private access required, OpenAI text model `gpt-4.1-mini`, model selection enabled, `voiceEnabled: true`, voice model `gpt-realtime-2.1-mini`. |
| Updated deployment | Latest disclosure deployment `bcc4534e-28dc-4143-9e96-7d05ab3ed3c4` observed terminal SUCCESS at `2026-10-09T05:56:16.585Z`; changed privacy page returned 200. Original implementation deployment `ecf8246b-a6f2-432d-ae07-02ee8f28e172` reached SUCCESS at `2026-10-09T05:46:08.403Z`; its shell v4 and voice module were checked, with module SHA-256 bytes matching the local source. Functional source is unchanged in the disclosure deployment. |
| Correct live sign-in and inference | Owner confirmed successful phone sign-in at approximately 01:20 America/New_York on October 9. The operator bootstrap subsequently authenticated and passed one live READY instruction with `gpt-4.1-mini-2025-04-14`, uncached. This verifies backend provider connectivity, not clinical answer quality. `OPENAI_API_KEY` remains separate. |
| Actual account model catalog and every eligible model | Only the selected `gpt-4.1-mini` READY request is verified live. Account catalog coverage and every other eligible model remain untested. Owner controls select only supported, account-confirmed text models. Connection checks are paid, capped and cached; they do not grade medicine. Media/embedding/fine-tuned models and unverified aliases are outside the study-chat contract. |
| Continuous voice deployment | Personal-only continuous voice code is deployed and enabled; mock/browser checks passed. No real OpenAI voice session or audible phone conversation has been verified. |
| Physical phone microphone/audio/install | Repeated dictation and continuous voice fixes passed local checks. Actual phone microphone permission, audible conversation, echo cancellation, interruption, background behavior and install remain owner checks on the now-deployed update. |
| Android build, device and Play purchases/trial | Unverified native build/device/license-test flow. Store submission remains on hold. |
| Clinical guideline accuracy | No validated benchmark or populated approved commercial corpus. Personal AI/starter examples remain unverified education. Official-source audit dated October 9 is recorded in `content/source-checks.json` and `docs/STUDY_MATERIAL.md`; unavailable/conflicting sources are flagged. No total-accuracy claim is supported. |
| Monthly source maintenance | Enabled task `6ac87ed8329c81918c3701660444bf86` begins November 1 and repeats on the first day monthly in the morning, America/New_York. It checks official sources and prepares GitHub review-branch corrections; clinician/rights approval precedes clinical activation. |
| Ingenium registration/data/routing | Supabase application organization `21bca727-553f-4df8-a2c6-e702f45e4ca2` named AI-FM-STUDYCHAT and one active hash-only key verified by readback. Authenticated Supabase Edge receiver is deployed ACTIVE; an unauthenticated request was rejected with 401. The app feed is active and one genuine event was read back: request `6c22b235-b38d-4285-8869-43beee64f0ce`, returned model `gpt-4.1-mini-2025-04-14`, route `/v1/chat/completions`, status 200, latency 1962 ms, input 20/output 1, occurred `2026-10-09T05:46:07.665Z`, estimated cost `$0.0000096`, pricing source `app_observed:configured_rate_estimate_cache_discounts_excluded`. This verifies receipt, not cost savings or clinical quality. This is operator application registration, not portal user/MFA registration; direct OpenAI routing remains active. Ingenium has no app-store release planned. |
| Phone pinch zoom and pan | Focused Chromium native-touch checks passed, including horizontal and vertical movement at twofold zoom. The layout fix is deployed; physical phone gesture confirmation remains pending. |

The one-time `INGENIUM_INITIAL_CONNECTION_CHECK` flag was blanked with
`skipDeploys: true` after successful receipt, so the next startup configuration
does not request another bootstrap. The durable READY request ID and successful
result cache also protect a restart of the currently running deployment from
repeating the paid inference. Metadata delivery retries use the same event UUID
and do not rerun OpenAI.

## How to continue efficiently

For a newly failing case, record the reproduction, affected files and fix here,
then run its focused test name with Node's `--test-name-pattern`. For an adapter
change, include the protocol/grounding paths it actually affects. For a UI
change, choose the relevant script in `qa/README.md`. Update this ledger and
recorded results after execution; do not turn a mock pass into a live or clinical
pass. Full `npm test` remains available when a broad change justifies it.
