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

The implemented confidence layer records an optional low/medium/high choice before board feedback. Submission replay preserves the original choice and confidence. Confidence remains distinct from correctness and the existing Again/Hard/Good/Easy scheduling ratings; the scheduler has not been replaced or represented as a validated retention model.

## Learning diagnostics and correction

Authenticated `/api/learning-plan` derives bounded topic priorities from current canonical questions and the last 32 trusted completed practice sessions. It regrades actual choices instead of trusting stored score summaries. Imported, malformed, duplicate/conflicted, future, invalidated, stale and active-session evidence cannot establish a learning gap. Finished skipped questions count as exposure because review shows their answers, but skips are not knowledge errors. “First” and “fresh” mean no recorded exposure in retained current history, not lifetime novelty.

| Learning signal | Interpretation | Teaching response |
|---|---|---|
| No first-exposure evidence | Unassessed, not mastered | Offer a blueprint-based mixed block; the learner chooses size and feedback timing. |
| One first-exposure miss | Provisional topic signal | Review the exact cited rationale and decisive clue; ask whether recall, interpretation or the next step was difficult. |
| Two or more distinct first-exposure misses | Repeated errors on the sampled topic, not a validated deficiency | Prioritize focused source review and a different supported case. |
| Wrong with high confidence | Possible calibration problem | Make the correction explicit and compare the chosen alternative only with source support. |
| Correct with low confidence | Reinforce recall, not an error | Ask for optional teach-back and later recall; actual errors retain priority. |
| Correct repeat after seeing an answer | Recognition may contribute | Keep repeated performance separate from first exposure. |
| Correct later fresh same-topic response | A limited encouraging follow-up | Revisit after a delay; it is not proof of durable learning or same-concept transfer. |

The correction loop is **commit → cited feedback → different same-topic case → spaced recall → later mixed practice**. Today, Progress and completed practice display priorities with honest evidence labels. A one-question targeted session selects a server-known current item without recorded exposure, keeps normal grading/history, and refuses to overwrite an unfinished session. Exhaustion is visible; it does not trigger invented questions or paid retries. Existing sourced-card saving and the spaced scheduler remain available. The learner chooses whether to save or review; the app does not silently schedule every mistake.

The conversational tutor invites a committed answer and reasoning, then addresses the decisive clue and supported alternatives one question at a time. It offers source-supported variations and neutral teach-back without forcing exercises in ordinary chat. Self-reported recall, interpretation and next-step difficulties can guide the conversation, but are not automatically or independently diagnosed. All medical premises in a new scenario need current evidence and the unchanged whole-reply review. Pending canonical questions retain their answer-leak protection.

The immediate implementation prioritizes topics, not independently validated subskill or concept mastery. No free-text reasoning rubric, observed clinical-performance assessment, pass probability, percentile, lifetime exposure record or official ABFM score is produced. Independent educator review of task tags, distractors and concept mappings is the next step before claiming finer diagnostics. Learning-plan derivation adds no model calls or provider telemetry; learner confidence and answer bodies are not sent to Ingenium.

Educational evidence informs this design, while outcomes remain unverified for this app. A medical-education randomized trial of repeated key-feature questions reported higher retained item performance than repeated case narratives; it did not evaluate this product, U.S. ABFM outcomes or professional competence. [Primary study abstract](https://pubmed.ncbi.nlm.nih.gov/27295475/). A randomized spaced-learning trial assessed medical students' knowledge retention; using its result as an app-design rationale is an inference, not proof of the scheduler or score improvement. [Primary trial abstract](https://pubmed.ncbi.nlm.nih.gov/17209889/). These links support design research only; no protected article content enters the clinical RAG.

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
