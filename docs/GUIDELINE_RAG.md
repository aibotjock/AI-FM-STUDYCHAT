# Source-linked educational RAG

The personal phone pilot retrieves original teaching summaries for 105 curated common or high-yield family medicine conditions. At the initial October 9, 2026 source check, 100 conditions have formal guideline or official recommendation evidence; BPPV, BPH, endometriosis, generalized anxiety disorder and B12 deficiency have clearly labeled official-reference gaps. Each condition has at least two original five-option questions, keyed explanations, distractor explanations and links to the supporting official sources. This is a family medicine board study tool only, not medical advice, a tool for clinical use, an official ABFM question bank or an accuracy certification. Independent clinician review remains pending. Current eligibility and quarantine counts appear in the generated manifest and coverage inventory; historical counts do not guarantee current source checks.

## What is incorporated

The five files in `content/conditions/` contain original summaries and questions, not copied guideline documents. Source records identify the organization, edition, exact URL, section locator and actual check date. Unknown publication dates remain null. Formal guidelines, official recommendations and official clinical references have separate labels. Supplementary non-US guidance has an explicit jurisdiction and limitation; it is not presented as a US board standard. Inaccessible documents and prohibited app/AI sources are excluded from supporting evidence.

See [CONDITION_COVERAGE.md](CONDITION_COVERAGE.md) for the condition inventory, `content/curriculum-manifest.json` for counts and file hashes, and the reports in `docs/source-audit/` for source verification and gaps. This disease-reference selection is not a scientifically established prevalence ranking, a full reproduction of each guideline or a complete examination syllabus by itself. The separate board-practice question pool incorporates source-linked foundational study topics; it does not change the 105-condition inventory or imply that ABFM's official items were reproduced. Practice scores describe the attempted questions, not an official exam score or a passing prediction.

## Text retrieval and answer constraints

`server/study-curriculum.js` builds a local BM25 index over condition names, aliases and original source-linked sections. A named condition, selected condition or supported recent follow-up supplies the retrieval context. There is no external vector service, embedding subscription or ingestion of protected full text. Source records must pass bounded schema/date/official-host checks; withdrawn, conflicted, blocked and expired records cannot supply current evidence.

The app supplies bounded eligible snippets, recent conversation history and saved learning preferences to the selected OpenAI text model. The natural tutor writes short paragraph segments in its own words, with current source IDs declared for factual teaching. A second request to the same selected model reviews the entire candidate, including ordinary conversational paragraphs. It identifies externally factual claims, quotes them exactly and supplies exact supporting excerpts from current source sections. The server validates known IDs, exact quotations/excerpts, paragraph coverage and a passed review with no failure flags, then supplies the citation links. Rejected drafts are withheld; there is no automatic retry, regeneration or provider fallback.

This layer supports ordinary conversation, session planning, pacing, follow-ups and reflection on the learner's stated difficulty. It can acknowledge an unsupported detail naturally without inventing a medical answer, dose or source. Greeting, subjective preferences and proposed study activities need no external citation; medical facts, exam rules, statistics and claims of learning effectiveness do. Learner statements and prior assistant text are context, not independent evidence. Generated replies carry an automated-review record with `sourceVerified:false` and `humanReview:false`; they are distinct from canonical source text and clinician review.

An accepted generated turn normally uses two paid text-model calls. Direct original quiz selection and deliberate A–E grading remain deterministic and require no inference. A pending quiz survives nonfactual conversation, but new factual hints or answer disclosure are blocked until the learner answers or explicitly asks for a reveal. Written clinical reasoning is not independently graded. Foundations of Care uses a separate validated bank, included in chat/practice without inflating the disease count. With no configured AI, the current canonical source text and safe fixed prompts remain available.

Exact quotation and excerpt matching checks traceability, while the reviewer model still judges whether every claim was found and whether the evidence directly supports it. Those judgments can be wrong. Neither model review nor source checking proves that a summary is correct, complete or applicable to a population. A citation is provenance, not an accuracy guarantee. Independent clinician review and an adjudicated clinical benchmark remain required before a paid clinical accuracy claim.

## Phone study workflow

1. Open **Library → Guidelines & boards**, search for a condition and inspect its source editions, dates and limitations.
2. Read the short teaching sections. Answer an original board-style question, then inspect the keyed and distractor explanations.
3. Save the question to **Review** for spaced repetition. Repeated saves reuse the same canonical card; personal edits or imports become unverified notes. Saved cards keep check/expiry dates and are not silently rewritten by source updates.
4. Open the condition in **Coach** to discuss your learning goal, ask source-supported follow-ups or request one question at a time. During a pending quiz, reflective questions can continue without revealing the answer; select an option or explicitly ask for a reveal when ready. Open the linked official source for details outside the incorporated summary.

Spoken study uses browser recognition to submit text to the same authenticated conversational chat route. Premium OpenAI speech synthesis receives checked stored reply text: generated paragraphs that pass the automated-review guard, or canonical answers through the separate current-source guard. The fixed speech model offers Marin, Cedar, Coral, Sage and Ash; the voice is AI-generated. Review eligibility does not confer verified canonical or clinician-reviewed status. Speech adds paid requests per uncached chunk, with temporary bounded audio caching and no durable app audio storage. There is no automatic device-voice fallback. The backend disables unchecked Realtime sessions and transcript ingestion. Imported review metadata and historical generated replies do not qualify. Audible phone quality, pronunciation and whether speech matches the visible checked reply remain separate checks.

## Monthly maintenance and commercial separation

The enabled monthly task checks every condition-specific source, official replacement pages, published editions, addenda, withdrawals, safety notices, conflicts and reuse restrictions, as well as the separate board-foundations sources. A successful fetch alone does not refresh a check date. The task may update original source-supported material in the personal study pilot after affected checks; uncertain or blocked material is quarantined and reported. It must preserve the pending-clinician-review label and source-specific limitations. The task runs on the first of each month at 8 a.m. America/New_York, beginning November 1, 2026. Record dates and expiry boundaries use UTC. The initial condition checks expire at November 9, 2026 00:00 UTC; if maintenance fails, current retrieval fails closed instead of pretending that content remains up to date.

`content/guidelines.json` remains the separate, empty commercial clinician-approved corpus. Its rights, named reviewer, review-expiry and exact-body integrity requirements are unchanged. The personal corpus does not grant commercial/AI rights or activate a paid guideline release. App-store submission still requires the owner's explicit permission.

Run only the relevant new or changed scopes. The default condition-corpus check remains strict: it requires every inventory condition to be structurally accepted and current, at least 100 conditions with formal guideline or official recommendation evidence, and canonical question/card integrity:

```sh
node scripts/validate-study-curriculum.js
```

Use `--write-manifest` after a completed source/content revision to regenerate coverage and hashes. This validates software/data integrity, not medical correctness. The condition checker does not count the separate board-foundations topics as diseases.

A monthly update can retain unaffected current material while quarantining an expired, withdrawn, superseded, blocked or conflicted condition. In that specific maintenance case, use the explicit mode:

```sh
node scripts/validate-study-curriculum.js --allow-quarantine --write-manifest
```

This mode checks known quarantine flags on a private validation copy only; it never changes persisted flags, check dates, source permissions or runtime eligibility. Invalid schema, duplicate IDs, corrupt reuse metadata, unknown statuses, unverified hosts and invalid or future dates still fail. The report separates total inventory, current and quarantined condition/question counts, current formal-guideline coverage, reference-only gaps and each quarantine reason. An `ok` maintenance result with `fullyCurrent: false` is not a current-readiness or medical-accuracy claim. Quarantined content cannot supply current retrieval evidence, canonical practice grading or current recall cards. Publication must describe partial current coverage honestly, preserve study-only labeling and keep the commercial approval gate closed.
