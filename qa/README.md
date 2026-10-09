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
responses are browser fakes. Backend caption durability is covered separately
by `tests/voice-routes.test.js`; actual phone audio remains an owner check.
# Source-linked curriculum checks

The curriculum addition has its own recorded scopes: `curriculum-browser-results.json` (16 fixture-based mobile groups), `curriculum-safety-results.json` (8 independent retrieval/dispatch safety groups), and `curriculum-production-data-results.json` (7 new real-100-condition mobile groups). These use real local app routes, synthetic provider responses where needed and zero paid calls. They do not establish medical accuracy. The production-data report preserves the exact file hashes tested; subsequent text-only source-budget condensation is documented in the validation ledger.

Use `qa/curriculum-browser-qa.mjs` with `QA_SCOPES` to select only newly affected or failed groups. `qa/curriculum-production-data-qa.mjs` checks actual corpus dimensions and extreme content sizes. `node scripts/validate-study-curriculum.js` checks full dataset integrity, canonical grading/card bounds, source dates and concise per-source factual budgets. Keep passed unrelated login, model, voice, dictation and zoom suites unchanged unless a relevant defect/change justifies repeating them.

