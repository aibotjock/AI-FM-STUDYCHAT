# Validation and debugging ledger

Updated October 9, 2026 (America/New_York). This is the record to consult before
testing again. A passed check is repeated only for an affected code path, a new
failure, changed deployment/configuration, or an unresolved concern. A new
scenario is not a repeat of an older scenario. Mocked checks never establish
live provider access or clinical accuracy.

## Version and scope

- Previous published baseline: release branch `b673565a74d326d8e456bf393e0bd152f9a7e799`.
- Current change: clearer secure access-code sign-in, review/restore fixes,
  owner OpenAI model controls, model-aware protocols, provenance and test cache.
- Active provider: OpenAI. Claude support is retained but inactive. Astra is
  rejected during configuration, catalog filtering, selection, restored
  provenance and returned-model validation. No Astra inference was performed.
- Store submission remains on hold. Ingenium integration testing/data work is
  in progress separately; the app still calls OpenAI directly.

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

All current provider/catalog integration checks used synthetic local responses,
with zero paid calls. The existing suite now contains 94 test cases; they were
not all rerun as one redundant batch. The container privilege-capability check
was skipped in the original scratch kernel; prior Railway logs independently
confirmed the deployed application UID/GID is 1000.

## Defects and fixes

| ID | Finding | Fix and verification |
| --- | --- | --- |
| AUTH-01 | Incorrect token reported by owner; API key and study code confused; whitespace paste could fail | Separate labels/help, Show/Hide control, server/client trim; API-01/UI-03. Existing Railway token was neither exposed nor rotated. Correct live credential still required. |
| FRONT-01 | Suspended/deleted head remained in active review queue with stale revealed answer | Prune/recalculate active queue and hide next answer; UI-02 |
| FRONT-02 | Frontend rejected valid exported backups above 10 MiB while backend allowed 16 MiB | Align upload bounds; UI-02 |
| MODEL-01 | Saved selection reused original model price overrides after restart | Clear overrides on restore; focused failed pricing case rerun once, passed |
| MODEL-02 | Model-name prefix accepted another family, changing model/cost | Exact ID or explicit same-family documented snapshot only; PROTO-01 |
| MODEL-03 | Retired saved model could stop the entire app from starting | Keep study workspace available, disable retired inference, show warning and require explicit active selection; API-02/UI-04 |
| MODEL-04 | Model switched during awaited catalog validation | Reject stale captured provider with 409 before inference; API-02 |
| MODEL-05 | Late responses reopened dismissed dialogs or overwrote other unsaved forms | Dialog revision and connected-node checks; UI-04 |
| MODEL-06 | Failed READY instruction prevented a fresh explicit test | Cache successful READY checks across new IDs; retain same-ID idempotency for every completed request; API-02 |
| MODEL-07 | Unconfirmed documented fallback could be selected as if account-verified | Require account source and non-stale confirmation; CAT-02 |

## Live and outstanding checks

| Item | Status and next concrete check |
| --- | --- |
| Existing Railway HTTPS pilot | HTTP 200; access required; OpenAI configured. Existing version predates the current fixes. |
| Updated deployment | Pending publication and terminal Railway SUCCESS; verify updated shell/API status afterward. |
| Correct live sign-in and inference | Not verified. Owner copies `STUDY_ACCESS_TOKEN` value from service Variables; no live secret is available in this test workspace. `OPENAI_API_KEY` is separate. |
| Actual account model catalog and every eligible model | Not yet exercised live. Owner controls select only supported, account-confirmed text models. Connection checks are paid, capped and cached; they do not grade medicine. Media/embedding/fine-tuned models and unverified aliases are outside the study-chat contract. |
| Physical phone microphone/audio/install | Browser wiring and failure paths tested with mocks; actual device permissions, voice and install remain to test. |
| Android build, device and Play purchases/trial | Unverified native build/device/license-test flow. Store submission remains on hold. |
| Clinical guideline accuracy | No validated benchmark or populated approved commercial corpus. Personal AI/starter examples remain unverified education. No total-accuracy claim is supported. |
| Ingenium registration/data/routing | Separate isolated integration validation work underway; direct StudyChat production routing is unchanged until verified integration is ready. |

## How to continue efficiently

For a newly failing case, record the reproduction, affected files and fix here,
then run its focused test name with Node's `--test-name-pattern`. For an adapter
change, include the protocol/grounding paths it actually affects. For a UI
change, choose the relevant script in `qa/README.md`. Update this ledger and
recorded results after execution; do not turn a mock pass into a live or clinical
pass. Full `npm test` remains available when a broad change justifies it.
