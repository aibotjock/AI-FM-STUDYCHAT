# Focused browser checks

These scripts use temporary workspaces, synthetic credentials and local mocked
provider traffic. They make no paid API calls and delete their temporary data.
They require Node 24, Playwright and a Chromium installation. Set
`PLAYWRIGHT_MODULE` or `CHROMIUM_EXECUTABLE_PATH` when those are installed outside
the usual locations. Run a script from the repository root with `node qa/<name>`.

| Script | Scope | Last result |
| --- | --- | --- |
| `frontend-extended-qa.mjs` | Previously uncovered app controls and failure paths | 12 passed; review-queue defect corrected and verified below |
| `frontend-regressions-qa.mjs` | Draft acceptance, dictation, review queue, large backup | 4 passed |
| `model-login-mobile-qa.mjs` | Secure sign-in, model selection, chat provenance, tests/export | 11 passed; recorded JSON alongside script |
| `model-dialog-lifecycle-qa.mjs` | Late responses and retired model recovery | 6 passed; recorded JSON alongside script |
| `voice-browser-qa.mjs` | Continuous voice controller/UI and dictation result reconciliation | 24 unique groups passed: 10 controller, 7 UI, 7 dictation; cumulative historical evidence in `voice-browser-combined-results.json` |
| `phone-zoom-results.json` (recorded evidence) | Accessible zoom, scroll chaining, native touch pan and reset reachability | 5 passed in Chromium mobile emulation; physical phone confirmation pending |

The scripts were originally executed in the agent workspace. Their imports and
runtime locations were made portable when saved here; that path-only edit was
syntax checked, without repeating the passed browser scenarios. Results are
historical evidence, not a claim that a physical phone or live API was tested.
Consult [the validation ledger](../docs/VALIDATION_STATUS.md) before rerunning.

The voice script supports `QA_ONLY` (a check-name regular expression) and
`QA_SCOPE=ui` (UI/dictation groups) for targeted debugging. It writes the current
run to `voice-browser-results.json` or `voice-ui-browser-results.json`; it does
not overwrite the cumulative combined report. That report combines focused
runs without recounting passed scenarios as newly executed. Two failed groups
were repeated after their fixes; two additional pending-setup scenarios were
checked separately. Microphone, WebRTC, speaker autoplay and transcript route
responses are browser fakes. Historical Realtime caption checks are retired. `tests/voice-routes.test.js` now verifies those unchecked routes remain disabled; actual phone audio remains an owner check.
# Source-linked curriculum checks

The curriculum addition has its own recorded scopes: `curriculum-browser-results.json` (16 fixture-based mobile groups), `curriculum-safety-results.json` (8 independent retrieval/dispatch safety groups), and `curriculum-production-data-results.json` (7 new real-100-condition mobile groups). These use real local app routes, synthetic provider responses where needed and zero paid calls. They do not establish medical accuracy. The production-data report preserves the exact file hashes tested; subsequent text-only source-budget condensation is documented in the validation ledger.

Use `qa/curriculum-browser-qa.mjs` with `QA_SCOPES` to select only newly affected or failed groups. `qa/curriculum-production-data-qa.mjs` checks actual corpus dimensions and extreme content sizes. `node scripts/validate-study-curriculum.js` checks full dataset integrity, canonical grading/card bounds, source dates and concise per-source factual budgets. Keep passed unrelated login, model, voice, dictation and zoom suites unchanged unless a relevant defect/change justifies repeating them.


## Board practice and sourced voice

New scopes: `tests/board-practice.test.js` (14 engine groups), `tests/board-routes.test.js` (8 API groups), `tests/conversational-quiz.test.js`, `tests/curriculum-maintenance.test.js` (7 maintenance fixture groups), and `tests/sourced-voice.test.js` (3 helper groups). `qa/board-practice-browser-qa.mjs` checks only the newly added board/chat/voice UI. `qa/sourced-voice-qa.mjs` records 13 new mock-browser lifecycle checks; it supports `QA_ONLY` for affected failures/new scopes. Historical Realtime controller results describe the former implementation, which is no longer active. Four replacement HTTP checks prove unchecked Realtime routes are disabled; no real audio/model call is involved.

Keep combined reports; intermediate scope-only reports are scratch output and should not be published as independent full-suite passes.


## Natural conversation correction

`natural-conversation-browser-qa.mjs` covers five new mobile scopes with actual local authenticated routes and synthetic author/reviewer responses. `natural-conversation-browser-results.json` combines the four initially passed scopes with the corrected pending-quiz scope; the initial failure is retained. Only that failed scope was repeated. Generated readout uses its own automated-review marker and current citations for factual claims; it does not become canonical source text. No paid model calls or physical-phone audio checks occurred.

`conversation-browser-qa.mjs` and the Coach portions of `curriculum-browser-qa.mjs` target the archived fixed dialogue/selector protocols. Use the natural conversation script for the current Coach. Historical reports, older generic frontend mocks and the original100condition corpus snapshots retain their original scope and counts; they are not current natural-chat verification.

## Five premium voices

`premium-speech-player-qa.mjs` records seven new player/controller groups in `premium-speech-player-results.json`: all five choices and Marin default; complete eight-chunk playback; prepared-audio autoplay resume; stale/background cancellation; failure/auth/replay blocking; microphone exclusion; and continuous interruption. `premium-speech-browser-qa.mjs` records six new mobile UI groups in the compact combined `premium-speech-browser-results.json`: saved choices/previews, complete readout, continuous autoplay, rejected-message guards and cleanup, caption isolation, and catalog recovery after sign-in/network failure. Initial and failed-only reports preserve debugging history without recounting repeats as new checks. These use synthetic MP3 and media objects, with no paid calls. Neither mock MP3 nor mobile emulation establishes real audio quality or physical-phone recognition/playback.

The backend’s new `tests/premium-speech.test.js` and independent `tests/premium-speech-safety.test.js` cover source reconstruction, provenance, session changes, bounds, cancellation and durable no-retry request receipts. `tests/premium-voice-check.test.js` checks the one-time fixed Marin preview helper using mocks and actual local authenticated routes. Its deployed gate submits at most one new preview request and reuses a durable completed receipt; it does not audition all five voices automatically or report invented audio token/cost telemetry.

The two current mobile scripts above now use `family_medicine_natural_review_v2`, `version:2`, and exact server-provided `sourceSpans` IDs. `natural-review-fixture-v2-results.json` records one new isolated check of these migrated reviewer branches against the current schema/prompt/renderer, with zero paid calls. Accepted records remain groundingReview.version1 with canonical excerpts and sourceSpanBindings. Historical browser/player reports preserve their original protocol and are not new execution evidence for this correction; those passing scenarios were not rerun. The validation ledger records the scoped HTTP and new binding safety checks separately.
