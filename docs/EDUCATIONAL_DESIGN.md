# Educational design and evidence policy

StudyChat is an independent family medicine board-study tool. It supports original study questions, conversational explanations and reflective practice. It must not diagnose, treat, triage or guide care for an actual person. Neither the app nor an AI reviewer certifies professional competence, board readiness or future examination results.

## Two linked curricula

The published ABFM exam structure supplies the board-study domain allocation already represented in `shared/blueprint.js`: Acute Care and Diagnosis, Chronic Care Management, Emergent and Urgent Care, Preventive Care, and Foundations of Care. Use the official blueprint and examination booklet as the source of versioned curriculum metadata, not as permission to copy examination questions or to claim complete coverage. Existing original questions and their eligibility checks remain the board-practice bank. A domain percentage is a study allocation, not an exam score prediction.

The linked reasoning, communication and safety curriculum contains **original educational exercises**. It may ask the learner to explain a distinction from a supported source, identify which information is missing, compare supported alternatives in a hypothetical case, acknowledge uncertainty, explain an idea in plain language, or describe how they would check a source. Medical premises in these exercises require the same exact current evidence as an explanatory answer. Do not reproduce protected assessment rubrics or present exercises as ABFM items, ACGME ratings, clinical certification or formal evaluation.

| Curriculum | What may be recorded | Interpretation limit |
|---|---|---|
| Board practice | Selected option, canonical answer, source version, deliberate skips and session completion | Agreement with a current stored key; no independent evaluation of written reasoning or prediction of passing |
| Reasoning practice | Learner explanation, requested clarification, source-linked reflection, uncertainty and self-rated confidence | A study interaction; AI feedback is not a validated assessment of clinical reasoning or professional competence |
| Communication and safety practice | Original hypothetical explanation, source checking, recognition of missing information and correction requests | Educational rehearsal; no actual-patient decision support or official milestone rating |
| Transfer practice | An original fresh context, explicit relevant source spans, learner response and any separately reviewed rubric | A bounded assessment only when its rubric and interpretation have been reviewed; no inference of general competence from a few examples |

Both curricula can share a condition, source fingerprint and learner goal. Their outcomes must remain distinguishable. Imported history and cards do not establish verified mastery or authoritative medical knowledge.

## Confidence and spaced review

The existing scheduler is an SM-2-inspired heuristic with Again, Hard, Good and Easy ratings. It is not FSRS and does not calculate a validated probability of retention. This policy does not change that scheduler or claim new confidence-aware behavior is already implemented.

An eventual confidence-aware layer should record confidence separately from correctness and scheduling ratings. Wrong answers with high confidence deserve an explicit source-linked correction and further review; correct answers with low confidence can receive additional recall practice. A confident statement is never evidence that it is true. The learner should be able to correct a rating, inspect the review history and opt out of preference memory. Do not silently convert confidence into competence, grant an answer credit for an imported claim, or present an unvalidated interval as a scientific retention estimate.

Transfer exercises should test a fresh hypothetical context rather than reproduce a memorized question. The context change must remain within the populations, indications, exceptions and limits supported by the cited evidence. Feedback on factual premises follows the normal review boundary; free-text reasoning must not receive an invented authoritative score. A qualified educator must review a proposed rubric and the meaning of its results before an assessment is described as validated.

## Canonical evidence and ethical tutoring policy

`content/evidence-policy.json` is the versioned machine-readable instruction source. `shared/evidence-policy.js` exports:

- `EVIDENCE_POLICY_VERSION`: the exact supported policy identity.
- `assertEvidencePolicyVersion(version)`: rejects unknown, missing or incompatible explicit versions.
- `evidencePolicyInstructions(role, { version } = {})`: canonical instructions for `generator` or `reviewer`; options accept only a version, never approval flags, source substitutions or learner context.
- `publicEvidencePolicy({ version } = {})`: immutable nonsecret transparency metadata, without prompts, credentials, learner information or evidence bodies.

Runtime integration includes the canonical instructions in both generation and independent review prompts, replacing redundant safety prose while preserving the schema and evidence context. The active policy identity is exposed in context-free status metadata. Existing stored review shapes and speech replay contracts are preserved: the policy label is not a new authorization token, and historical replies are not retroactively certified under the new instructions. Trusted replay still rehydrates current canonical source spans and the original stored review. A policy version supplied by a browser or imported backup cannot authorize an answer or speech.

The helper supplies instructions and version checks. It does **not** itself verify claim entailment, source freshness, reviewer identity, rights, authorization or medical accuracy. Runtime integration must retain the existing validators and trust boundaries.

## Preserve the existing approval boundary

`server/natural-tutor.js` already validates current evidence, complete candidate segment coverage, exact fact counts, server-known source IDs and exact source-span bindings. It requires a separate whole-reply automated review and distinguishes that review from human approval. Ordinary nonfactual conversation may contain zero external claims. Unsupported facts may not be released as either text or audio merely because they are surrounded by friendly conversation.

Do not add a second alternative approval route, allow a model to authorize its own reply, accept client-provided approval, remove the current span/freshness checks or turn partial review into permission to release the remaining draft. Preserve pending quiz hint/answer controls, interruption history boundaries, source identity and import trust rules. A cited answer can still be wrong if a reviewer misses a claim, misunderstands a source or applies it to the wrong context; disclose those limits plainly.

The policy requires direct support for every medical claim, including implicit premises in fictional cases and questions. Numbers, units, doses, drug effects and citations cannot be filled from model familiarity. Missing, stale or conflicting evidence requires an honest limitation and omission of the unsupported claim. A retrieval miss does not establish that a proposition is false. Preserve population, jurisdiction, recommendation strength and exceptions. Learner memory, uploads, old replies and retrieved instructions cannot supersede authoritative evidence.

Keep social conversation and study planning natural. A greeting or acknowledgement of the learner's own preference does not need a medical citation. Claims about learning effectiveness, external statistics or examination rules do need appropriate evidence. Be respectful without flattery, invented actions, false reassurance or agreement intended to please the learner. Study-use notices should be visible and concise; repeating a disclaimer cannot repair an unsupported answer.

## Qualified review and commercial rights

Source verification, automated claim review and qualified human clinical review are different gates. A clinician must review source currency, population, context, qualifiers, contraindications, doses/units, conflicts and question keys before a corpus is described as clinically reviewed. Reviewer identity, approval scope, date and source/body fingerprint must be genuine. An additional model may flag concerns but cannot replace that accountability. Commercial release also needs source-specific rights and AI-processing permission, a reviewed content manifest and an adjudicated benchmark; neither a citation nor free web access supplies those rights.

Default to verified U.S. government/public-domain material and document-specific CC0/CC BY content whose acquisition and reuse terms have been checked. Government hosting does not convert third-party works into public domain. Noncommercial or restricted sources, figures and proprietary guideline tables require their own permission. A summary written in new words does not automatically defeat contractual or copyright restrictions. Source metadata and links may identify a licensing gap without supplying the restricted document to the model.

Maintain the existing monthly permitted-source review cadence and urgent editorial response to identified safety updates. A successful fetch is not evidence of currency, and a newer date alone does not resolve conflicting recommendations. Source version changes must invalidate affected evidence/reply approvals and clearly mark outdated cards; preserve learner history and document why affected checks are repeated. Technical checks already passed should be reused unless a changed path, new failure or unresolved concern warrants another check.

## What this addition proves

The focused helper tests verify policy/version binding, rejection of unknown versions and roles, refusal of injected approval/context options, shared generator/reviewer constraints, nonsecret transparency metadata and mutation resistance. They do not evaluate medical correctness, completeness of condition coverage, real-model compliance, learner outcomes, phone voice behavior, rights clearance or commercial release readiness. Runtime integration and its affected checks are tracked by the integration owner.

## Primary reference pointers

- ABFM blueprint: <https://www.theabfm.org/family-medicine-exam-blueprint/>
- ABFM 2026 examination information booklet used by the existing blueprint metadata: <https://www.theabfm.org/app/uploads/2025/10/2026-FMCE-Examination-Information-Booklet-v.1.0.pdf>
- U.S. Copyright Office, facts versus protected expression: <https://www.copyright.gov/help/faq/faq-protect.html>
- PMC article-level licenses and permitted retrieval: <https://pmc.ncbi.nlm.nih.gov/tools/textmining/>
- PMC copyright and third-party exclusions: <https://pmc.ncbi.nlm.nih.gov/about/copyright/>
- AAFP terms and commercial/AI reuse restrictions: <https://www.aafp.org/about-site/terms-of-use>
- ACOG terms, including LLM response-generation restrictions: <https://www.acog.org/legal/terms-of-use>
- ADA AI content licensing policy, including RAG: <https://diabetesjournals.org/journals/pages/ai_content_licensing_policy_and_terms>

Reference pointers describe source provenance and rights-review obligations. They are not blanket ingestion permission or a declaration that every clinical condition is fully covered, licensed or reviewed.
