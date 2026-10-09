# Source-linked educational RAG

The personal phone pilot now retrieves original teaching summaries for 105 curated common or high-yield family medicine conditions. 100 conditions have formal guideline or official recommendation evidence; BPPV, BPH, endometriosis, generalized anxiety disorder and B12 deficiency have clearly labeled official-reference gaps. Each condition has at least two original five-option questions, keyed explanations, distractor explanations and links to the supporting official sources. This is study use only, not medical advice, patient-care instructions, an official ABFM question bank or an accuracy certification. Independent clinician review remains pending.

## What is incorporated

The five files in `content/conditions/` contain original summaries and questions, not copied guideline documents. Source records identify the organization, edition, exact URL, section locator and actual check date. Unknown publication dates remain null. Formal guidelines, official recommendations and official clinical references have separate labels. Supplementary non-US guidance has an explicit jurisdiction and limitation; it is not presented as a US board standard. Inaccessible documents and prohibited app/AI sources are excluded from supporting evidence.

See [CONDITION_COVERAGE.md](CONDITION_COVERAGE.md) for the condition inventory, `content/curriculum-manifest.json` for counts and file hashes, and the reports in `docs/source-audit/` for source verification and gaps. This selection is not a scientifically established prevalence ranking, a full reproduction of each guideline or a complete, proportionally balanced examination syllabus.

## Text retrieval and answer constraints

`server/study-curriculum.js` builds a local BM25 index over condition names, aliases and original source-linked sections. A named condition, selected condition or supported recent follow-up supplies the retrieval context. There is no external vector service, embedding subscription or ingestion of protected full text. Source records must pass bounded schema/date/official-host checks; withdrawn, conflicted, blocked and expired records cannot supply current evidence.

The app supplies a bounded set of eligible snippets to the selected OpenAI text model. The model can select only known section or question IDs, or declare the question unsupported. The server renders the selected canonical teaching text and known source URLs. It rejects model-provided medical prose, invented references, extra response fields and invalid or expired IDs. A missing dose, unsupported topic or insufficient evidence produces a verification-needed response. Questions are graded against canonical answers without an AI request.

These constraints reduce invented clinical assertions; they do not prove that an authored summary is correct, complete or applicable to a population, or that a selected snippet answers the question. Automated source checking is distinct from independent clinical review. A citation is provenance, not a guarantee. The bank still needs an adjudicated clinical benchmark before a paid clinical accuracy claim.

## Phone study workflow

1. Open **Library → Guidelines & boards**, search for a condition and inspect its source editions, dates and limitations.
2. Read the short teaching sections. Answer an original board-style question, then inspect the keyed and distractor explanations.
3. Save the question to **Review** for spaced repetition. Repeated saves reuse the same canonical card; personal edits or imports become unverified notes. Saved cards keep check/expiry dates and are not silently rewritten by source updates.
4. Open the condition in **Coach** to ask source-supported follow-ups or request a question. Open the linked official source for details outside the incorporated summary.

Voice receives bounded references for the selected current condition but still produces model-generated speech. Spoken output is not validated by the canonical text renderer. Use cited text and the question explanations for clinical facts; unsupported spoken details must be checked. This distinction appears in the app.

## Monthly maintenance and commercial separation

The enabled monthly task checks every condition-specific source, official replacement pages, published editions, addenda, withdrawals, safety notices, conflicts and reuse restrictions. A successful fetch alone does not refresh a check date. The task may update original source-supported material in the personal study pilot after affected checks; uncertain or blocked material is quarantined and reported. It must preserve the pending-clinician-review label and source-specific limitations. The initial checks expire November 9, 2026; if maintenance fails, current retrieval fails closed instead of pretending that content remains up to date.

`content/guidelines.json` remains the separate, empty commercial clinician-approved corpus. Its rights, named reviewer, review-expiry and exact-body integrity requirements are unchanged. The personal corpus does not grant commercial/AI rights or activate a paid guideline release. App-store submission still requires the owner's explicit permission.

Run only the relevant new or changed scopes. Full corpus integrity command:

```sh
node scripts/validate-study-curriculum.js
```

Use `--write-manifest` after a completed source/content revision to regenerate coverage and hashes. This validates software/data integrity, not medical correctness.
