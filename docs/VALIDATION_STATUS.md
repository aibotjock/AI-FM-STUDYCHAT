# Validation and debugging ledger

Updated October 9, 2026 (America/New_York). This is the record to consult before
testing again. A passed check is repeated only for an affected code path, a new
failure, changed deployment/configuration, or an unresolved concern. A new
scenario is not a repeat of an older scenario. Mocked checks never establish
live provider access or clinical accuracy.

## Current conversational release disposition

Conversation correction code is published on `release/google-play-preparation` at `b3174d38e6b89d4f17c3a9d893350ecb31ee8580`, tree `4268af66bfdcc9fa319b7c6d1073bebbdf876de6`. All **160** published blob hashes/modes match the staged snapshot. Local new/affected conversational, source, quiz and mock phone checks pass as detailed below.

The final correction is **not live yet**. Railway private-test has exactly one staged, nondestructive change: the phone-test service commit moves from `241809016d512dd74d433cd895e1198fecd3e062` to `b3174d38e6b89d4f17c3a9d893350ecb31ee8580` (patch `81c8cce0-8cfc-4d8a-9277-0f62c5a64c8b`). Automatic review rejected the initial service-wide source command because it could affect other environments. The safer private-environment staging succeeded, but Railway `accept-deploy` reported “Cancelled — the user did not approve this action. No changes were made.” The user subsequently explicitly approved the private deployment and live check. Railway’s separate confirmation still returned the same cancellation; no patch was applied. Connector confirmation remains blocked despite user authorization. No workaround or further deployment retry was attempted after that result.

The live pilot remains at strict-schema commit `241809016d512dd74d433cd895e1198fecd3e062`; its cited conversational follow-up failed runtime validation. The later dual-selection correction has local proof only. `STUDY_INITIAL_CONVERSATION_CHECK` was blanked with deploys skipped. After private-deployment approval, explicitly arm `dialogue-v3`, apply only the reviewed patch, observe terminal SUCCESS and check the new failed follow-up once while reusing the saved successful plan. Then blank the flag again. Store submission remains on hold.

## Historical baseline references

- Earlier hosted source-linked curriculum release: `c42e8f6b923b2aaa7225931cb0cda95eea1ac550`,
  tree `c965d315bebc16bf6e37953e11a078f1b67308d6`.
- Voice, dictation, pan and telemetry implementation: `45077ce7d2a0f400e8548322cbfcd2a52c8c0982`,
  tree `390ecb02fd9fdd34ed71c4f53c7daf88440ebae8`. That disclosure release added privacy/live evidence; later releases added educational source retrieval, original board questions and study-only notices.
- Previous published baseline: `4cbf673ca36d3254a336a7f11527e96afb02e43c`.
- Earlier secure sign-in, review/restore fixes and owner OpenAI model controls
  are deployed. Newly checked changes add continuous personal voice, dictation
  reconciliation, mobile zoom/pan and a durable metadata-only Ingenium feed.
- The earlier voice workflow used `gpt-realtime-2.1-mini`. It is now disabled;
  current spoken study uses browser recognition and trusted chat readout, with
  no audio model. See the later board/conversation release observations below.
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
| LIVE-01 | Railway deployment `ecf8246b-a6f2-432d-ae07-02ee8f28e172`, deployed status and voice assets | Terminal SUCCESS at `2026-10-09T05:46:08.403Z`; `/api/status` 200; shell v 4; voice module 200 with SHA-256 bytes matching local source | Changed implementation required deployment verification; no inference or phone audio in this check |
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
| Updated deployment | Latest disclosure deployment `bcc4534e-28dc-4143-9e96-7d05ab3ed3c4` observed terminal SUCCESS at `2026-10-09T05:56:16.585Z`; changed privacy page returned 200. Original implementation deployment `ecf8246b-a6f2-432d-ae07-02ee8f28e172` reached SUCCESS at `2026-10-09T05:46:08.403Z`; its shell v 4 and voice module were checked, with module SHA-256 bytes matching the local source. Functional source is unchanged in the disclosure deployment. |
| Correct live sign-in and inference | Owner confirmed successful phone sign-in at approximately 01:20 America/New_York on October 9. The operator bootstrap subsequently authenticated and passed one live READY instruction with `gpt-4.1-mini-2025-04-14`, uncached. This verifies backend provider connectivity, not clinical answer quality. `OPENAI_API_KEY` remains separate. |
| Actual account model catalog and every eligible model | Only the selected `gpt-4.1-mini` READY request is verified live. Account catalog coverage and every other eligible model remain untested. Owner controls select only supported, account-confirmed text models. Connection checks are paid, capped and cached; they do not grade medicine. Media/embedding/fine-tuned models and unverified aliases are outside the study-chat contract. |
| Current spoken study | The former unchecked Realtime workflow is disabled in the new implementation. Sourced browser recognition → canonical chat → exact speech synthesis has new local controller/UI checks below. Physical phone recognition/playback remains unverified. |
| Physical phone microphone/audio/install | Repeated dictation and continuous voice fixes passed local checks. Actual phone microphone permission, audible conversation, echo cancellation, interruption, background behavior and install remain owner checks on the now-deployed update. |
| Android build, device and Play purchases/trial | Unverified native build/device/license-test flow. Store submission remains on hold. |
| Clinical guideline accuracy | No validated benchmark or populated approved commercial corpus. Canonical source-linked personal study material has actual source checks with independent clinician review pending. Personal/imported notes remain unverified. Official-source audit dated October 9 is recorded in `content/source-checks.json` and `docs/STUDY_MATERIAL.md`; unavailable/conflicting sources are flagged. No total-accuracy claim is supported. |
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


## Source-linked study curriculum — October 9, 2026

This addition is educational, not medical advice or a clinician-approved commercial release. The source bank is distinct from the still-empty commercial approved corpus. OpenAI remains active, Claude inactive, and Astra prohibited. App-store publication remains on hold.

| ID | New or affected scope | Result and limits |
| --- | --- | --- |
| RAG-01 | `tests/study-curriculum.test.js`: schema/dates, official hosts, exact CDN exception, relevance/aliases/subtypes, stale evidence, canonical rendering/quiz/card, citation bounds and fixed loader names | 16 unique new groups passed. New host cases added as real dataset sources arrived; broad Wiley/CDN trust remains denied. No paid calls. |
| RAG-02 | `tests/study-routes.test.js`: auth, CSRF, hidden answers, canonical grading/card idempotency/provenance, backup links, unsupported questions, source drafts, commercial isolation, switching/replay and public count status | 14 unique new groups passed. Initial provider-prompt assertion corrected and only that failed scope repeated. No paid calls. |
| RAG-03 | `tests/study-curriculum-safety.test.js`; `qa/curriculum-safety-results.json` | 8 independent new safety groups passed after actual unknown-topic dispatch, old-topic follow-up, dosing-synonym, acronym/resemblance and post-abstention defects were fixed. No paid calls. |
| RAG-04 | Only affected existing server/commercial checks | 10 unique checks passed: 7 server and 3 commercial. Selective reruns were justified by chat dispatch/context and card/backup integration changes. Original full provider, voice, auth, billing and scheduler suites were not repeated. |
| VOICE-STUDY-01 | `tests/voice-study-context.test.js`: selected current bounded references, stale/unsourced/unsupported-origin omission and unchanged fixed voice model | 2 new groups passed with mocks. Speech remains model-generated and unverified; no real voice or paid call. |
| UI-STUDY-01 | `qa/curriculum-browser-results.json`: catalog/search, source dates/gaps, quiz feedback, recall cards, late/error/retry paths, Coach citations and mobile controls | 16 unique fixture-based mobile groups passed at 360×800. Only failed scopes repeated after corrections. New notices pushed Send under navigation; corrected mobile layout and the affected/new paths passed. Zero JS errors, overflow or paid calls. |
| UI-STUDY-02 | `qa/curriculum-production-data-results.json`: actual original 100-condition/200-question catalog and extreme content sizes | 7 new groups passed at 360×800, zero JS errors/overflow/provider dispatch. Report preserves tested file hashes. Later bronchitis/sinusitis/insomnia/OSA text was shortened for shared-source budgets, with choices/keys and UI structure unchanged; affected content checks passed, unrelated UI scenarios not repeated. |
| CONTENT-01 | Author checks plus independent cross-file editorial review | Original 100 conditions/200 questions checked for source/reference/key consistency. Independent read covered all questions; corrected endometriosis suppression/contraception wording and strengthened the tension-headache vignette. No detected duplicate stems/choices or other obvious keyed-answer contradiction. This is automated editorial work, not clinician approval. |
| CONTENT-02 | `scripts/validate-study-curriculum.js`, canonical question/card evaluation and manifest generation | Original 100-condition dataset passed: 100 current, 200 questions, 308 sections, 130 source URLs. Initial integration found omitted official hosts and a validator null-reporting defect; fixed. Shared per-source factual budgets condensed and checked. Supplemental five-condition validation is recorded below after completion. |
| MAINT-02 | Existing monthly automation prompt expanded to condition corpus | Update succeeded; enabled schedule preserved: first day monthly 08:00 America/New_York, starting November 1, 2026. Actual permitted-source checks required; verified personal study refreshes allowed, uncertain records quarantined, commercial/store approval separate. No future execution claimed. |

The new retrieval uses local BM 25 and constrained OpenAI ID selection. Canonical text prevents arbitrary model-written clinical prose, but does not establish source completeness, semantic relevance or medical accuracy. The bank is a curated high-yield selection, not a prevalence ranking or complete/proportionally balanced ABFM syllabus. Source review expires November 9, 2026 unless actually refreshed; clinical accuracy benchmarking and independent clinician review remain outstanding. All prior genuine Ingenium/READY evidence remains valid and was not repeated.


Final expanded-corpus result: **PASS**, 105 accepted/current conditions, 210 questions, 323 sections and 136 distinct source URLs. Exactly 100 conditions have formal guideline or official recommendation evidence; five have visible official-reference-only gaps (BPPV, BPH, endometriosis, GAD and B 12 deficiency). Correct-key counts are A 41/B 42/C 42/D 43/E 42. The added five conditions/ten questions passed their own new-source integrity check; one new fixed-loader case passed. The final whole-corpus integrity/manifest run was justified by the new file, aggregate source budgets and changed coverage counts. Canonical answers/cards are bounded, answer keys hidden before grading, check dates current and all human-review flags false. No paid provider call or unchanged functional suite was repeated.

The monthly task uses wildcard condition/audit paths and thus includes all five files. Official recommendation coverage is selected teaching-point coverage, not five full guidelines or complete pharmacologic protocols. Source-based facts still require independent clinical review before a paid accuracy claim. Current publication/deployment evidence will be appended after the private pilot rollout succeeds.


| ID | New publication/live scope | Verified result |
| --- | --- | --- |
| PUB-RAG-01 | GitHub commit `c42e8f6b923b2aaa7225931cb0cda95eea1ac550`, tree `c965d315bebc16bf6e37953e11a078f1b67308d6`, release-branch lease from `92b4a8a89d7e69432d88f6a9c94c6e68f33e4456` | All 124 published tracked blob hashes/modes match staged source. Only 44 changed text files uploaded; unchanged assets retained. `[skip ci]` avoids redundant full CI after scoped checks. |
| LIVE-RAG-01 | Pinned Railway deployment `8e417145-ad99-4443-8935-2554160522fc` | Terminal SUCCESS at `2026-10-09T09:53:57.176Z`; normal app startup and UID/GID 1000, no repeated bootstrap. |
| LIVE-RAG-02 | New release public status/protected curriculum/changed shell assets | `/api/status` 200 confirms 105 conditions/210 questions/105 current/100 formal or recommendation topics, OpenAI configured/access required. `/api/curriculum` 401 without sign-in. `/app.js` 200 SHA 256 `3c6c857eaec7271636886bc7aef42f0867451cef5c52cf13162b19d4434f2c61`, `/sw.js` 200 SHA 256 `d6c9987fae1dc4757fb5c58f415f98eb738ee8973b4a76d42d14c45b3d23699a`, both byte-identical to published source; shell v 5. No inference or private content fetched. |

New source-linked educational library is ready for the owner's phone study test. Refreshed mobile page loads the new catalog; an in-memory session can expire on this server restart. All previously verified sign-in/READY/Ingenium evidence remains historical and was not retested. Real provider semantic selection for clinical queries, human medical adjudication and comprehensive ABFM preparation quality are not certified by these checks. That deployment used generated Realtime speech; the board-study release below replaces it with canonical browser speech and disables the unchecked routes. No app store was published.


## Board study and strict source boundaries — October 9, 2026

The current implementation is an independent **family medicine board-exam study tool only**, not medical advice or for clinical use. It contains 105 conditions/210 questions plus six separate nondisease foundations topics/12 questions: **222 original questions**. The raw question pool is acute 74/chronic 98/emergent 22/preventive 16/foundations 12. Weighted mixed sessions are available in 10/20/40/80/100 question lengths. A 10 question block rounds to 4/3/2/1/0; matching weights does not establish complete syllabus coverage. Independent clinician review, policy/legal content expansion and exam-prediction validation remain unfinished. See [BOARD_STUDY.md](BOARD_STUDY.md).

| ID | New or actually affected scope | Result and limits |
| --- | --- | --- |
| FOUND-01 | Separate `content/board-foundations.json`; primary CDC/AHRQ author check and independent read-only content review |6 topics/18 sections/12 original questions accepted. Arithmetic and source locators checked;13 URLs, conservative source budgets 26–179 words/URL, none duplicates disease URLs. No new disease-count inflation, clinician approval or exhaustive objective claim. Previously checked source URLs were not fetched again for independent review. |
| BOARD-01 | `tests/board-practice.test.js` |14 new engine groups passed: blueprint allocation, unique items, hidden keys, current fingerprint grading, durable timer/resume, idempotence, results/skips/domain accuracy, missed/weak practice, bounded/untrusted imports and source expiry. No AI calls. |
| BOARD-02 | `tests/board-routes.test.js` |8 new API groups passed; authenticated/source-protected practice, bounded state/export, hidden keys, persisted results/restart and source-expiry behavior. Two affected integration scopes checked again after merged foundations and source-only markers changed. No paid calls. |
| CHAT-QUIZ-01 | `tests/conversational-quiz.test.js` |14 unique new groups pass: deliberate A–E/voice option parsing, canonical quiz/grade, wrong options/rationales, stale fingerprints, server restart versus untrusted imports, topic switching, source-only scripted navigation/cards, foundation chat, canonical safe process text and clear actual-care redirects. The changed strict dispatch/provenance paths justified focused follow-up checks; no unrestricted personal AI prose remains. Free-text clinical reasoning is not graded. |
| REG-BOARD-01 | Only actually changed existing server/curriculum/study-route/commercial scopes |19 unique affected groups passed:8 server +2 curriculum render/quiz +6 study-route provenance/linking/selection/draft/switching +3 commercial ownership/approved-grounding/deletion. The JSON-mode guard changed a mock prompt-position assumption; only that failing scope repeated. No unrelated full suites or paid calls. |
| MAINT-03 | `tests/curriculum-maintenance.test.js` |7 new fixture groups pass. Explicit quarantine maintenance reports partial current coverage without relaxing runtime/source/schema/rights/date guards; default remains strict. Only failing cases repeated after the quarantined-count fix. No repeated real-source fetches. |
| CONTENT-03 | Changed validator `--write-manifest` on actual corpus |PASS 105 current conditions/210 condition questions/323 sections/136 URLs;100 formal or recommendation topics,5 visible reference-only gaps,0 quarantined, maximum 190 attributed factual words/URL. One regeneration justified by new validator fields. Foundations remain separate. |
| VOICE-CANON-01 | `tests/sourced-voice.test.js`; `qa/sourced-voice-results.json` |3 new helper tests and 13 new mock-browser lifecycle groups pass. Exact text chunks, recognition-index replacement, no listening during playback, cancellation/late suppression, mute/interrupt/stop, background/pagehide/10 minute limit and failure fallbacks. Previously passing controller groups retained while only two additional unchecked scopes ran later. No physical-phone or paid-audio claim. |
| VOICE-CANON-02 | Replacement `tests/voice-routes.test.js` |4 new groups passed once: unchecked Realtime routes denied in personal/commercial mode even with keys, authentication intact, no upstream/transcript state writes, logout and imported-caption provenance. The former 11 Realtime HTTP cases were intentionally retired with the old workflow, not reported as new failed regressions. Historical dormant voice-unit tests were not repeated. |
| UI-BOARD-01 | `qa/board-practice-browser-results.json` |9 unique new mobile groups pass at 360×800. Catalog, canonical grading/save, resume, results/skips/missed sources, weak-domain setup, end feedback, optional timer, Coach A–E quiz/card and entry points. Initial missing shared-module route and harness reload assumption corrected; only failed scopes repeated. Initial failure report preserved. Zero JS errors/overflow/provider calls. |
| UI-VOICE-CANON-01 | `qa/sourced-voice-app-results.json` |3 new app-integration groups pass: actual local canonical chat/citations/exact TTS, no Realtime request, logout stop, and rejection of old/imported/expired/free AI readout. Browser speech APIs mocked; no real phone audio. |
| UI-BOARD-02 | `qa/board-practice-production-data-results.json` |2 new actual-bank mobile groups pass:222 current questions/five domains and 100 question start/canonical graded source feedback. Exact file hashes recorded. Existing 210 condition flows and all-five-size engine allocation checks were not repeated. |
| SOURCE-PROBE-01 | `tests/study-check.test.js` |12 unique new mock groups pass for inactive-by-default operator hook, loopback/credential/provider/model guard, exact current canonical text/citations, required AF risk+drug section relevance, completed-cache reuse, uncertain-state no retry and safe metadata/logout/telemetry behavior. One new relevance group and four affected fixtures ran after adding the required-section guard; six unaffected scopes retained. No actual model call locally. |
| PWA-06 | Changed shell and install-label integrity |Shellv 6 contains 12 unique existing assets including `/shared/blueprint.js` and `/sourced-voice.js`; API responses remain uncached. Install label says Family Medicine Board Study and explicitly excludes medical advice/clinical use. Syntax checked; no unrelated gesture/install tests repeated. Android label changed only; native build remains unverified. |
| MAINT-04 | Enabled monthly automation prompt |Updated to include the separate foundation bank, source-only spoken/text output, strict versus quarantine reports and no-repeat source/READY checks. Existing first-of-month 08:00 America/New_York schedule preserved. Future source review is scheduled, not claimed already executed. |

Canonical output restricts new factual teaching to stored source-linked text; it does not establish complete evidence, correct source interpretation or relevance for every question. Clear actual-care requests redirect before retrieval; intent recognition is not a medical triage service or a guarantee that every real-patient formulation is detected. Uncited starter exercises are explicitly optional original prompts, without medical answer keys. Existing learner notes remain preserved and unverified.

The original real READY/Ingenium receipt remains historical and was not rerun. A new operator source-selector check will provide separate live evidence after publication, without asserting total medical accuracy. Public app-store submission and paid release remain on hold.

Post-UI check: labels/help in `public/app.js` were corrected to describe saved study goals and fixed sourced replies without promising generative Socratic roleplay or clinical assessment. Syntax passed; actions/routes/layout were unchanged, so passed UI groups were not repeated. Recorded UI hashes correctly identify the pre-label-correction source they tested.

Additional legacy HTTP assumptions were updated for strict sourced dispatch:9 affected groups passed (1 AI-provider HTTP,3 model-selection,5 Ingenium-hook). Direct adapter/catalog/billing tests were unchanged and not rerun. Seven initial mock/query failures were corrected for the prepended JSON guard and indexed study query; only those failed cases repeated. Assertions still cover model provenance, prohibited returned models, selected-model failure/concurrency, metadata privacy, stable event IDs and delivery without additional inference. All responses/credentials in these tests are synthetic; no real Claude or other provider call occurred.


| ID | New publication/deployment scope | Observed result |
| --- | --- | --- |
| PUB-BOARD-01 | GitHub commit `15055caa02160373f72228dc0eb9896e88412c4c`, tree `086899530f80bfff7c17009f4818f33c395d5138` |145 published blobs/modes match the staged checked snapshot,52 changed text files uploaded. Release branch compare-and-swap lease succeeded. |
| LIVE-BOARD-01 | Pinned Railway deployment `12671bfc-0405-47a0-96d4-2dfde784cee9` |Terminal SUCCESS at`2026-10-09T10:58:39.672Z`. Runtime UID/GID 1000. Public status:105 current conditions/210 condition questions/100 formal or recommendationconditions,222 practice questions, all five supportedlengths available; canonical-browservoiceenabled and uncheckedRealtimefalse/modelnull. New board endpoint 401 without sign-in. |
| LIVE-BOARD-02 | Eight changed public shell/disclosure/content assets |All HTTP 200, bytes match published local snapshot. AppSHA 256`275e782d9f0ff84e84e2f3b2f97c56e2d45f6d74ac9397334f393ed08e23de8d`; sourcedvoiceSHA 256`7bedaae36825dd85956f51c9f10a21d0d1aea13b139c6690ec5d22e6a1212c63`; shellv 6 SHA 256`8d7b046402c1e7973fc30515ba434338f410e09cde25a1d95c10b19f3a2d06ab`. No private data or inference in this public check. |
| SOURCE-LIVE-PREFLIGHT-01 | First operator source-selector preflight |Stopped with`stage:current_references` before authentication/inference: generic`stroke`alias matched`stroke-risk assessment`inside an explicit AF study query, adding ischemic-stroke sections. This was a new detected retrieval defect, not a passed source/model check. No paid source call or new telemetry event occurred. Targeted alias correction and follow-up evidence are recorded below. |

SOURCE-COLLISION-01: Two new actual-corpus retrieval groups passed for the AF stroke-risk alias collision, general stroke-prevention requests and explicit stroke comparisons/switches. Three affected existing alias/subtype/switch module groups and one affected HTTP switch/replay group passed. The fix applies only the generic ischemic-stroke alias in explicit or selected AF context; explicit acute/ischemic/new/suspected stroke stays eligible. The original probe query now retrieves only AF risk, aspirin and drug sections. No content facts, frontend actions or provider adapter changed, so those passing scopes were not repeated. No paid inference occurred during debugging.


| ID | Final live source path | Verified result |
| --- | --- | --- |
| PUB-COLLISION-01 | Follow-up commit `fe1eb7ba1906e3469daf4cdb6750c35f63048161`, tree `8774ed4a4538181d6cdaa655f2057fab3abd30a8` | All 145 published blob hashes/modes match the checked follow-up snapshot; four changed files uploaded with a release-branch lease. |
| LIVE-COLLISION-01 | Pinned Railway deployment `0f7af3b0-e3e3-45d6-911b-734646c4620f` | Terminal SUCCESS at `2026-10-09T11:05:58.800Z`, UID/GID 1000. Only server retrieval/tests/docs changed; previously verified public assets and passed UI groups were not repeated. |
| SOURCE-LIVE-01 | One new uncached, operator-enabled synthetic board-study source-selection request | Authenticated successfully; current canonical text, citations and validated selection marker match exactly. Both AF risk and drug sections are present. Provider OpenAI; returned `gpt-4.1-mini-2025-04-14`, 817 input / 39 output tokens; estimated cost USD 0.0003892. This is one narrow semantic selection check, not clinical accuracy certification or a cheapest-model benchmark. No paid retry or repeated READY request occurred. |
| INGENIUM-LIVE-02 | Independent registered-database readback | Event `fd1493d1-f323-45ef-96f7-6f6284db23ca`, organization `21bca727-553f-4df8-a2c6-e702f45e4ca2`, occurred `2026-10-09T11:05:56.147Z`; route `/v1/chat/completions`, status 200, provider latency 2,195 ms, model/tokens/cost match the source receipt. Pricing is `app_observed:configured_rate_estimate_cache_discounts_excluded`, not an invoice measurement. Two delivered metadata events and zero pending; no study prompt, answer, topic, identity or credential sent to Ingenium. |

`STUDY_INITIAL_SOURCE_CHECK` is blanked with `skipDeploys:true`; the historical READY flag remains inactive. The current source-probe request ID is durable, and uncertain attempts never trigger automatic paid retries. A restart can validate its saved response without repeating inference. Neither flag is a normal-user feature.

**Ready for the owner's phone study test:** refresh the HTTPS app, open Board practice or ask Coach to quiz a sourced topic, then try Start voice on a supported browser. Physical phone recognition, audible speech and interruption remain owner checks. The finite source-linked bank still lacks exhaustive syllabus coverage and independent clinician adjudication; total accuracy, a passing prediction, automatic cheapest-model routing and public-store readiness are not claimed. No store was submitted or published.

## Conversational tutoring update — October 9, 2026

The previous source selector received only the latest user question; coaching fell back to rotating navigation text. The personal Coach now supplies bounded recent dialogue and saved study preferences to one OpenAI JSON dialogue-plan request. A validated plan selects conversational acts, exact learner quotations and eligible source IDs. The server renders all coaching wording and canonical medical facts. It does not accept an arbitrary model answer body. Learner quotations are visibly unverified and excluded from `spokenText`; imports strip the new dialogue/speech trust markers. An unresolved quiz remains available through reflective or planning turns, without revealing its answer in a hint. A deliberate A–E answer is still graded without model inference. Cold unsupported factual questions still abstain without paying for a model call.

| ID | Changed or new scope | Result |
| --- | --- | --- |
| CONV-01 | Six new `tests/study-conversation.test.js` groups | Passed: unique required dialogue schema, history/preferences, canonical facts followed by one question, consecutive follow-up source IDs, time planning/replay/output cap, planning during a pending quiz then canonical grading. One failing new scope was corrected and repeated alone. |
| CONV-02 | Ten new independent `tests/conversation-safety.test.js` groups | Passed: arbitrary prose/invalid acts/invented quotes blocked; learner quote/speech separation; current-only evidence; imported/history trust; negated reveal and legacy selector spoiler protection; pacing; recovery after source gap; numeric study-time availability versus real-care clauses. New groups ran incrementally rather than repeating prior passes. |
| CONV-03 | Seven new `tests/conversation-check.test.js` groups plus one new authenticated route integration group | Passed with mocks: default-off/local/OpenAI-only operator gate, two fixed new turns, exact trusted render/citations, durable saved-result reuse, uncertain-request no-retry, model identity, safe usage-only receipt. Real local routes demonstrate the two queries reach the tutor, retain history and cap each completion at 512 output tokens. |
| CONV-UI-01 | Five new 360×800 mobile browser QA groups | Passed: natural greeting/planning/topic sequence, reload persistence, citations, all three quick actions, quiz controls after reflection, manual and continuous speech using safe `spokenText`, and forged/imported speech marker denial. Speech APIs are mocks; physical phone audio remains unverified. Initial failures and selective rerun reports are retained. |
| CONV-REG-01 | 40 unique affected existing HTTP regression cases | Passed: conversational quiz transitions, source routes/safety, inactive-Claude browser contract, selected-model provenance, Ingenium delivery, retry/locks/backup limits and card drafting. One pending unknown-topic quiz boundary failed initially; corrected and only that scope repeated. The existing real-care safeguard group was repeated once more after its detector changed, and passed. Unrelated catalog/provider/auth/billing/scheduler and general board/voice lifecycle suites were not repeated. |
| CONV-MAINT-01 | Existing monthly source automation | Prompt now preserves the contextual conversation layer, source-owned medical facts and learner quote/speech separation. Same monthly schedule; existing READY/source checks and the new conversational bootstrap must not be repeated. |

Review identified and fixed a false care-intent match for “I have 20 minutes to study,” unsupported new-topic quiz boundaries, answer leakage through a legacy selector during hints, and user quotations being echoed into trusted assistant history. These are software and provenance checks, not clinical adjudication. All local feature and regression checks used synthetic credentials/responses and made zero paid calls. No unchanged source documents or content validators were rerun because no medical corpus facts changed. The old live READY and AF selector checks remain historical and inactive. A separately gated two-turn hosted feature check is the next publication verification; no live pass is claimed here yet.

App-store submission and paid release remain on hold. This is a study tool only, with independent clinician review and exhaustive board-syllabus coverage still unfinished.

### Hosted conversation verification and schema correction

Implementation commit `4e5d164fb400a0ad39fe0e54a5a8d8c12e9011f5` was published after 156 blob hashes/modes matched the staged snapshot. Deployment `ec3cc18a-4feb-4b8a-8db5-36b0ef29cff0` reached terminal SUCCESS at `2026-10-09T15:56:39.962Z`. The new operator check made two genuine bounded OpenAI calls: the 15-minute study plan passed; the next cited-point request was safely rejected by JSON/plan validation, displaying an evidence-gap reply. The raw rejected body was not retained, so the exact invalid field or parsing cause is unknown. Neither the successful planning call nor earlier source/READY calls were repeated.

Safe diagnostics commit `a87fc85be02376f58e4875204a013e25ab9f2d65`, deployment `828a840c-63ae-4a23-9eb4-54c1b9175e9a`, read the saved responses and submitted **zero** new model calls. It confirmed the failed reply had no dialogue, selection, quiz or citation marker. One new redaction test passed; diagnostic output contains only allowlisted enums/booleans/source IDs, never rejected prose or learner text. Six changed public assets returned HTTP 200 and matched the staged sources; app SHA-256 `37d4089093d9091dc5f3504f8aa38aa4df25af4fe43bbf44106c9f3f4632a135`, sourced-voice SHA-256 `52fbfc887a5a13c1d705caa150f577ebbb339de827cbb0b495045e3649d3914d`, shell v7 SHA-256 `d0bc2d6c2ee509f438f6490ae9b8f7d6fe5e2c6447234cf07028c2822f1e294f`. Public status retained private access, OpenAI `gpt-4.1-mini`, browser sourced voice and disabled Realtime. UI assets are unchanged in the schema correction, so these checks will not be repeated.

The correction adds optional native strict Structured Outputs for the verified GPT-4.1 family, with exact eligible source/question IDs and valid dialogue-act enums. Other selectable models retain validated JSON behavior. Runtime source eligibility, selection consistency and quote checks remain. Future rejections store only `invalid_json` or `invalid_dialogue_plan`, without raw rejected content. Compiled provider schemas contain public source IDs and numeric learner-message positions; private learner text remains ordinary bounded conversation input. The server resolves permitted positions to exact short learner statements and excludes them from speech.

Six new `tests/structured-study.test.js` groups and three independent `tests/conversation-schema-safety.test.js` groups passed. One schema/quote test was repeated because its private-text enum was replaced with numeric positions; unchanged native adapter groups were not repeated. One new operator migration group verifies a saved passed plan is reused, the original failed reply remains, and only the corrected follow-up is submitted. The actual authenticated route integration group was repeated after its schema transport and operator revision changed, and passed. All these checks used mocks with zero paid calls. The revised operator gate is `dialogue-v2`; its new follow-up identity is separate from the failed v1 request.

Ingenium independently returned two genuine events from the initial hosted check: `d83c3d14-0fc9-454d-801c-32c8c33fc63c` at `2026-10-09T15:56:39.223Z` (780 input/67 output tokens, 2,496 ms, estimated USD 0.0004192) and `c5b34129-67d5-4830-9277-0d2826448e6a` at `2026-10-09T15:56:40.643Z` (1,500 input/79 output tokens, 1,400 ms, estimated USD 0.0007264). Both returned `gpt-4.1-mini-2025-04-14`, route `/v1/chat/completions`, status 200. Successful API transport is distinct from the failed response-validation result. The metadata feed carries no study prompts, answers, audio, learner identities or credentials.


### Conversation semantic correction and selective verification

Strict-schema commit `241809016d512dd74d433cd895e1198fecd3e062` deployed successfully as `fd7372bf-b923-4332-a755-3061f3412f45` at `2026-10-09T16:12:38.668Z`. Its check reused the passed first plan and submitted **one** new v2 follow-up (2,185 input/79 output tokens; estimated USD 0.0010004). Native JSON shape was valid, but runtime rejected its dialogue plan; no unvalidated medical answer was displayed. The original parsed plan was not retained, so the exact cause of that hosted failure remains unknown.

A local reproduction using the actual disease/foundations corpus found that every individually eligible AF section rendered successfully, whereas combined cited section plus original AF question raised `Invalid study selection.` This concrete defect is corrected by separately rendering both canonical bodies and merging their source references by ID plus URL. Both trusted markers and deterministic grading remain. Duplicate eligible chunk IDs are deduplicated; invented IDs, expired/unprovided questions, and unsupported-plus-evidence combinations remain rejected. For the explicit cited-point-then-recall request, the native schema limits `questionId` to null and the recall question follows the cited section. Rejection metadata now uses fixed numeric reason codes and public eligible IDs/enums/bounded numbers only, without raw model or learner prose.

| ID | New or affected scope | Result |
| --- | --- | --- |
| CONV-RELIABLE-01 | Six new `tests/study-dialogue-reliability.test.js` backend reliability groups | Passed: dual canonical response/grade/replay, eligible duplicate handling, unsupported coupling, point-recall native schema, safe rejection projection and exact numeric reasons. No external calls. |
| CONV-RELIABLE-02 | Three new independent `tests/conversation-reliability-safety.test.js` groups | Passed: two-source union despite colliding source IDs, unavailable/expired evidence rejection and diagnostic private-prose stripping. No earlier safety groups repeated. |
| CONV-RELIABLE-03 | New dual-response and rejection-receipt groups; affected operator migration and actual authenticated route groups | Passed: reconstruct actual question/source union, preserve both failed request identities, reuse the passed first plan, and log only bounded metadata. Migration/route repetition justified by changed operator revision and renderer contract. |
| CONV-RELIABLE-04 | Actual AF corpus failed dual-selection reproduction after correction | Passed once: exact selected canonical section and bank question, safe speech and source union. Point-recall schema excludes bank quiz. No source document fetches or model calls. |

The explicit next operator gate is `dialogue-v3`; it retains the original successful plan and both failed replies and submits only the new failed-turn identity. No final hosted pass is claimed yet. Unchanged UI assets, source checks, passing unrelated suites, and old READY/source/bootstrap checks were not repeated.

The affected malformed-output regression passed after its diagnostic contract changed, and again after the invalid-plan message was corrected to say the tutoring response could not be validated. A formatting/plan failure no longer implies that the source library lacks an answer. The cold unsupported-source response is unchanged. No other passing structured-output groups were repeated.

Ingenium independently confirms the v2 request metadata event `6a0f27c6-2249-49c8-b36a-4ff6bf162b87` at `2026-10-09T16:12:34.588Z`: OpenAI `gpt-4.1-mini-2025-04-14`, `/v1/chat/completions`, status 200, 1,828 ms, 2,185 input/79 output tokens, estimated USD 0.0010004. The single bounded read covered only this previously unchecked time window. API success is not dialogue acceptance; that reply was rejected. No v3 model call occurred because the private deployment was not approved.


### User-approved live-check attempt — connector confirmation still blocked

The user explicitly authorized the private deployment and live check. The staged patch was read again because time had passed: exactly one nondestructive private-test commit update, no other services/shared variables/data changes. The server-only `dialogue-v3` flag was armed with deploys skipped. `accept-deploy` again returned “Cancelled — the user did not approve this action. No changes were made.” No final correction deployment or new model call occurred. Read-back confirms the same pending patch and latest live deployment `fd7372bf-b923-4332-a755-3061f3412f45` at commit `241809016d512dd74d433cd895e1198fecd3e062`. The flag was blanked again with deploys skipped. No passed functionality tests were repeated. The user’s permission persists; a separate Railway connector/dashboard confirmation is needed to apply the pending patch.
