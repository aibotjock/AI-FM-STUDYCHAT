# Clinical content preparation

**The checked-in guideline corpus is empty. No guideline license, reviewed clinical question bank, clinical validation, ABFM endorsement, or accuracy guarantee is supplied. A production guideline-based coaching release must remain blocked until its actual content and validation are approved.** The source registry is metadata and rights triage, not a content license. A successful software test or a source link does not establish medical accuracy.

The app is for education using hypothetical cases, not real-time patient care. User-authored notes and flashcards remain personal drafts. A learner marking a card verified is not the publisher's clinician review, official assessment, or publication approval.

## Curriculum

ABFM's blueprint structures examination topics; it does not supply a complete clinical guideline corpus. The current 2026 booklet, printed page 36, and dedicated blueprint page agree on these domains:

| Domain ID | Curriculum domain | Mixed-practice weight | Proposed initial benchmark cases |
| --- | --- | ---: | ---: |
| acute | Acute Care and Diagnosis | 35% | 70 |
| chronic | Chronic Care Management | 25% | 50 |
| emergent | Emergent and Urgent Care | 20% | 40 |
| preventive | Preventive Care | 15% | 30 |
| foundations | Foundations of Care | 5% | 10 |

`shared/blueprint.js` contains independent factual weights and a stable largest-remainder allocation. Mixed examinations follow the weights; daily adaptive recall can concentrate on weak or due items. These weights do not predict passing scores, and 200 cases are a proposed initial validation set, not an ABFM requirement. Add age, organ system, pregnancy, care setting, and clinical complexity as separate editorial tags.

Official references, checked October 9, 2026:

- <https://www.theabfm.org/family-medicine-exam-blueprint/>
- <https://www.theabfm.org/app/uploads/2025/10/2026-FMCE-Examination-Information-Booklet-v.1.0.pdf>

Use an original product name such as **Family Medicine Study Coach**. Do not use protected logos or present the app as official, endorsed, ABFM-approved, or a source of actual exam items. ABFM's trademark policy restricts marks and misleading affiliation: <https://www.theabfm.org/trademark-use/>.

## Rights before ingestion

Publicly readable does not mean commercially redistributable, embeddable, or permitted for third-party AI processing. Do not scrape protected examination material or subscription question banks. Citation does not replace permission. Original teaching text must be independently authored without copying protected wording, tables, algorithms, or questions. Facts may inform original teaching, but an original label does not cure a derivative work or override site access terms; resolve source-specific uncertainty before approval.

| Source | Operational treatment |
| --- | --- |
| ABFM | Use factual blueprint metadata to plan original curriculum. Site content commercial reuse and scraping require written permission. Do not ingest protected questions or rationales. |
| AAFP | Request permission or long-term licensing before reproducing journal or nonjournal clinical material. Verify permissions for derivative summaries and AI processing separately. Distinguish endorsed, affirmation-of-value, and not-endorsed guidelines. |
| USPSTF/AHRQ | Express written permission is required for incorporating USPSTF work into a profit-making venture. API access needs prior approval; its vendor guidance requires verbatim recommendation text with attribution. API access alone is not blanket commercial/AI rights clearance. |
| CDC | Review each specific item. Most CDC information is public domain but third-party/contractor content, images, logos, and international use can differ. Follow attribution, nonendorsement, unchanged substantive reproduction, free-at-source notice, and update requirements. |
| ACGME | Reproduction/adaptation in a paid app requires appropriate license. Use original skill exercises, not copied rubrics or purported official milestone scores. |

Primary rights references:

- <https://www.theabfm.org/terms-of-use/>
- <https://www.aafp.org/about-site/using-aafp-content/permissions>
- <https://www.uspreventiveservicestaskforce.org/uspstf/recommendation-topics/copyright-notice>
- <https://www.uspreventiveservicestaskforce.org/apps/api.jsp>
- <https://www.cdc.gov/other/agencymaterials.html>
- <https://www.acgme.org/about/legal/publication-document-usage/>

Keep license evidence outside a public repository if it contains private terms or contact information; the corpus can contain a nonsecret evidence reference. Do not contact organizations, pay license fees, accept agreements, or upload protected texts as part of this preparation without the user's authorization.

## Publication records and editorial pipeline

`content/guidelines.json` uses `{ "version": "release-id", "records": [] }`. Each eventual teaching record must contain:

| Field | Meaning |
| --- | --- |
| `id`, `title`, `body` | Stable ID and original reviewed teaching text or a licensed excerpt; body maximum 1,800 characters. Split larger content into independently reviewed claims. |
| `domain` | One of `acute`, `chronic`, `emergent`, `preventive`, `foundations`. |
| `status`, `contentType` | `published` and `original-teaching` or `licensed-excerpt`. Drafts are never retrieved. |
| `source` | HTTPS `url`, `title`, `organization`, `edition`, `effectiveDate`, and `contentSha256`. |
| `review` | Named qualified clinician `reviewer`, `reviewedAt`, and `nextReviewAt`. Credentials and approval evidence must be audited editorially; software cannot establish that a name is a real clinician. |
| `rights` | `status: "cleared"`, `commercialUse: true`, `aiProcessing: true`, and a nonempty `evidence` reference to actual rights review/permission. Declare either `perpetual: true` or a valid `expiresAt`; optional `effectiveAt` is also validated. These are operator attestations, not automatic legal determinations. |
| `supersededBy`, `withdrawnAt` | Optional controls that make a record ineligible. Preserve the prior version in history. |

`source.contentSha256` is the SHA-256 of the **exact UTF-8 teaching body** supplied to the model, not a claim that the upstream document was fetched or authenticated. Keep the upstream document version/hash and license/reviewer evidence in the editorial archive separately. Generate the body hash with `contentSha256(body)` from `server/guidelines.js`. Recompute it only after the edited body has been reviewed again.

Date-only fields use UTC; `nextReviewAt` and `rights.expiresAt` expire at the start of the stated date. Alternatively supply an explicit UTC timestamp. Invalid dates, future effective/review dates, expired reviews or permissions, ambiguous IDs, body/hash mismatch, learner verification flags, rights uncertainty, withdrawal, or supersession fail eligibility. Rights duration cannot be omitted: explicitly attest genuine perpetual permission or supply its expiration date. A perpetual declaration combined with an expiration date is contradictory and rejected. An optional rights effective date cannot be future and must precede its expiration. Evidence ingestion, retrieval, prompt construction, and response validation each check eligibility so a license can expire before the next clinical review without remaining usable.

The publication workflow is: original draft or licensed material → rights review → qualified clinical review → independent higher-risk review where needed → adjudicated benchmark → release manifest → publication. A reviewer must verify the population, recommendation strength, exceptions, dose/unit if present, contraindications, source currency, and conflicts. An additional model can help flag inconsistencies but cannot replace clinician accountability. AAFP's AI-in-CME best practices support this principle, although this app is not claiming CME accreditation: <https://www.aafp.org/cme-and-events-credit-system/ai-cme-best-practices>.

## Grounded coaching implementation and its limits

`loadGuidelineCorpus(path, { now })` synchronously validates the envelope and records, returning `{ version, records, rejected, ready, loadedAt }`. `ready` means at least one record passed technical metadata/rights-attestation checks, **not** clinical launch approval. Empty content must not become a fallback to an ungrounded medical model in commercial mode.

`retrieveEvidence(query, { corpus, now, maxChunks: 3 })` rechecks eligibility and returns up to three records using transparent lexical overlap. Titles are weighted more than bodies; no matches means no evidence. This is a small-corpus preparation implementation. Synonyms, abbreviations, negation, partial matches, and questions with several clinical contexts can have poor recall or relevance. Benchmark retrieval separately before launch and do not claim complete guideline coverage.

`buildEvidencePrompt(evidence, { now })` rechecks eligibility, bounds the authorized teaching context, and requests `{ answer, citationIds, unsupported }`. Source material is data, never trusted instructions. `validateGroundedResponse(parsed, evidence, { now })` returns `{ answer, citations, unsupported }` with source URLs supplied only by the server. Unknown/duplicate IDs fail validation. Supported text must reproduce selected evidence bodies exactly, in citation order, separated by two newlines, optionally followed by one of the fixed nonclinical recall prompts. Arbitrary clinical paraphrases, diagnoses, numeric recommendations, or interpolated advice are rejected even if they cite a real ID. Unsupported responses are replaced with a fixed honest verification-needed message.

This extractive constraint reduces invented assertions but cannot prove that the retrieved material answers the question, is internally correct, or applies to its population. A source citation is evidence provenance, not semantic validation. The benchmark must include incorrect retrievals, incomplete cases, conflicting recommendations, irrelevant but high-overlap snippets, and appropriate abstention. These controls deliberately limit clinical generation until broader reviewed response validation is demonstrated.

## Currency and conflicts

Store organization, edition, effective date, review date, and source/version hashes. Do not choose a recommendation solely by publication year or authority label. At the current source check CDC's immunization landing page lists July 2, 2025 schedules while AAFP publishes 2026 schedules and notes differences. This illustrates why a physician editor must adjudicate rather than silently merge sources:

- <https://www.cdc.gov/vaccines/hcp/imz-schedules/index.html>
- <https://www.aafp.org/clinical-insights/immunizations-and-vaccines/immunizations-schedules-resources/childhood-vaccine-schedules>
- <https://www.aafp.org/clinical-insights/immunizations-and-vaccines/respiratory-virus-vaccines>

Proposed operating cadence: weekly permitted source-change checks, monthly editorial triage, and urgent review of material safety updates. These are app operating choices, not organization-mandated intervals. Quarantine affected facts/cards while a clinically significant update is unresolved. Keep learner review history when revising a card, and make the revision/withdrawal visible.

## Launch evidence required

Before a paid guideline-based release, obtain the corpus rights evidence, actual qualified reviewer approvals, tested release manifest, and an independently adjudicated benchmark across all five domains. Include pregnancy, age limits, kidney dysfunction, contraindications, red flags, conflicting sources, stale sources, unsupported questions, and prompt injection. Record substantive correctness, critical errors, citation support, retrieval relevance/coverage, appropriate abstention, and confidence intervals. Investigate every critical error; do not equate zero errors in a small sample with zero future risk.

Run regression checks whenever the model, prompt, retrieval, or content changes. Clinical accuracy claims must describe what was measured, against which edition, and for which question types. Never guarantee perfect accuracy, board passage, clinical competence, or an artificial failure probability. Provide source/edition/review dates and an in-app report-an-error action with an editorial correction process.

Commands:

```sh
node --test tests/guidelines.test.js
node scripts/validate-guidelines.js
node scripts/validate-guidelines.js --require-ready
```

The ordinary validator accepts the intentionally empty preparation corpus and states `ready: false`; `--require-ready` exits unsuccessfully until eligible records exist. That check still does not replace the independent clinical launch decision. No Play Store upload or publication is authorized by passing it.
