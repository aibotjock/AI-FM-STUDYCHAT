# Source-linked educational RAG

The personal phone pilot retrieves original teaching summaries for 105 curated common or high-yield family medicine conditions. At the initial October 9, 2026 source check, 100 conditions have formal guideline or official recommendation evidence; BPPV, BPH, endometriosis, generalized anxiety disorder and B12 deficiency have clearly labeled official-reference gaps. Each condition has at least two original five-option questions, keyed explanations, distractor explanations and links to the supporting official sources. This is a family medicine board study tool only, not medical advice, a tool for clinical use, an official ABFM question bank or an accuracy certification. Independent clinician review remains pending. Current eligibility and quarantine counts appear in the generated manifest and coverage inventory; historical counts do not guarantee current source checks.

## What is incorporated

The five files in `content/conditions/` contain original summaries and questions, not copied guideline documents. Source records identify the organization, edition, exact URL, section locator and actual check date. Unknown publication dates remain null. Formal guidelines, official recommendations and official clinical references have separate labels. Supplementary non-US guidance has an explicit jurisdiction and limitation; it is not presented as a US board standard. Inaccessible documents and prohibited app/AI sources are excluded from supporting evidence.

See [CONDITION_COVERAGE.md](CONDITION_COVERAGE.md) for the condition inventory, `content/curriculum-manifest.json` for counts and file hashes, and the reports in `docs/source-audit/` for source verification and gaps. This disease-reference selection is not a scientifically established prevalence ranking, a full reproduction of each guideline or a complete examination syllabus by itself. The separate board-practice question pool incorporates source-linked foundational study topics; it does not change the 105-condition inventory or imply that ABFM's official items were reproduced. Practice scores describe the attempted questions, not an official exam score or a passing prediction.

## Text retrieval and answer constraints

`server/study-curriculum.js` builds a local BM25 index over condition names, aliases and original source-linked sections. A named condition, selected condition or supported recent follow-up supplies the retrieval context. There is no external vector service, embedding subscription or ingestion of protected full text. Source records must pass bounded schema/date/official-host checks; withdrawn, conflicted, blocked and expired records cannot supply current evidence.

The app supplies a bounded set of eligible snippets to the selected OpenAI text model. The model can select only known section or question IDs, or declare the question unsupported. The server renders the selected canonical teaching text and known source URLs. It rejects model-provided medical prose, invented references, extra response fields and invalid or expired IDs. A missing dose, unsupported topic or insufficient evidence produces a verification-needed response. Questions are graded against canonical answers without an AI request, including A–E answers inside Coach. Foundations of Care uses a separate validated bank, included in chat/practice without inflating the disease count. General navigation/reflection uses fixed nonfactual prompts; no free-model factual coaching fallback is exposed.

These constraints reduce invented clinical assertions; they do not prove that an authored summary is correct, complete or applicable to a population, or that a selected snippet answers the question. Automated source checking is distinct from independent clinical review. A citation is provenance, not a guarantee. The bank still needs an adjudicated clinical benchmark before a paid clinical accuracy claim.

## Phone study workflow

1. Open **Library → Guidelines & boards**, search for a condition and inspect its source editions, dates and limitations.
2. Read the short teaching sections. Answer an original board-style question, then inspect the keyed and distractor explanations.
3. Save the question to **Review** for spaced repetition. Repeated saves reuse the same canonical card; personal edits or imports become unverified notes. Saved cards keep check/expiry dates and are not silently rewritten by source updates.
4. Open the condition in **Coach** to ask source-supported follow-ups or request a question. Open the linked official source for details outside the incorporated summary.

Spoken study uses browser recognition to submit text to the same authenticated canonical chat route, then browser speech synthesis reads the exact accepted answer. The backend disables unchecked Realtime sessions and transcript ingestion. Source-gap/navigation messages are fixed scripts without factual teaching; imported or historical generated replies are not source-trusted. Browser/device compatibility and audible phone playback remain separate checks.

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
