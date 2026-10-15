# Library-first answers with one model call — October 15, 2026

The owner requested removal of the second model call that reviewed the complete
answer, and asked that the model consult and know the app reference library.
This branch implements that change for `aibotjock/AI-FM-STUDYCHAT` and the
`family-medicine-phone-test` app. It builds on the isolated prompt/timing cleanup
at `5898830993d55cbd959d55455f2b449025bb8104`, whose base is the restored
`feature/conversation-agent` revision
`f4b20414d337230f4d90a3c8a14656c3922f5ff1`.

## Answer behavior

- Relevant current library passages are retrieved locally before generating an
  answer. The primary prompt says to consult those passages first, cite their
  supplied IDs, and state specific coverage gaps instead of filling them from
  model memory.
- The model also receives a compact catalogue of every loaded study topic and
  its current availability, plus the separate reference directory. Topic names
  and reference links are metadata, not passage evidence. The inventory includes
  no quiz stems, choices, answer keys, or full external documents.
  At this revision it describes 130 current study records and 75 reference links
  in 14,473 UTF-8 bytes, using column-labelled compact rows.
- Selecting a topic then saying “start” now retrieves that selected topic's
  current passages. Unknown topics, stale records and absent dose support retain
  their existing boundaries.
  A generic follow-up to an uncited reply cannot revive an older selected topic;
  a live canonical quiz retains its scope across a planning turn.
- A generated reply uses one completion with the existing selected model and
  800-token output cap. There is no second review request, retry, or new JEV call.
  Canonical quiz questions and grading remain server owned and need no model
  call. Normal request replay returns the saved result without another inference.
- Server code validates output structure, allowed source IDs, current source
  revisions and citation bindings. Common prohibited generated medical questions,
  unbound medical prose and pending-question hints have deterministic guards.
  These checks do not assess factual entailment or guarantee correctness.
- New answers carry `libraryGrounding` provenance, not a fabricated
  `groundingReview`, `aiReview`, or independent-review approval. The active
  evidence policy is version 2 and discloses the single-call behavior.
- The entire answer still finishes before it is returned or authorized for
  speech. Speech rechecks the saved answer, source hashes, citations, currentness
  and conversation identity. The audio controller, transcription, synthesis,
  interruption handling and playback recovery are unchanged.
- The UI describes library-based answers without claiming independent model or
  clinician review, and shows only the measured writing time for new answers.
  Historical reviewed messages retain their existing readout path and timing.
  Imports do not inherit trusted source or speech authority.

## Verification and limits

Tests cover one model call per generated turn, complete-answer gating, replay,
library inventory without answer-key leakage, selected-topic retrieval, exact
source binding, changed/expired sources, honest metadata, speech eligibility,
pending canonical quizzes, import restrictions, interruption and recovery.
The full Node suite reports **524 tests: 523 passed, 1 existing skip, 0 failures**.
`npm run check` and whitespace checks pass. Tests use local synthetic provider
responses; no new live inference was needed.

The observed phone build used `gpt-4o-mini-2024-07-18`. Its recent `/api/chat`
HTTP requests lasted 2,588–9,688 ms with both author and review calls. Removing
the second sequential inference eliminates that call's latency, but no live
before/after measurement or phone microphone test has been performed. The
catalogue adds input tokens, so the total speed gain remains to be measured.
No provider credentials, learner transcripts or new paid inference were used
for the code tests. JEV remains separate from this app path.

This branch removes independent semantic review as explicitly requested.
Source-binding checks establish provenance and freshness, not whether generated
statements follow from their citations. Existing corpus checks do not establish
clinical readiness. No deployment has been performed; the restored build
remains the rollback target for a later phone comparison.
