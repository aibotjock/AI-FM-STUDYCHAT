# Geriatric falls and musculoskeletal treatment expansion

Checked **2026-10-10 UTC**. This is an exact-document source and original-question authoring audit, not qualified clinical review, a legal opinion, commercial activation approval or an ABFM endorsement. All new source rights objects retain `commercialClinicalApproval:false`; the new study-topic record retains `humanReviewed:false` and expires November 10, 2026.

## Scope and preservation

- **Osteoarthritis:** six new original questions, `osteoarthritis-q5` through `q10`, and six new sections addressing structured physical therapy, medication-risk selection, conditional duloxetine use for knee OA, image-guided hip injection, the pre-replacement injection interval, and escalation/referral.
- **Acute low back pain:** six new original questions, `acute-low-back-pain-q5` through `q10`, and five new sections covering NSAID suitability, the current muscle-relaxant evidence category, systemic steroid scope, new infection/fracture red flags and transition to chronic-pain study planning.
- **Older adult falls and medication review:** one new `recordType:"study-topic"` record, five source-linked sections and six original questions. This is an educational topic, not an additional distinct disease counted toward disease coverage. It covers modifiable risk assessment, targeted prevention, medication reconciliation/optimization and algorithmic follow-up.

**Total additions: 18 questions, 16 sections, four exact source records, one study topic.** No other condition was changed. All preexisting questions, selected source objects, selected sections and parent review dates in the two existing records remain byte-equivalent as JSON values. In particular, these additions do not renew the October 9 checks or November 9 expiry of the older records. Their earlier record currency continues to bound the mixed-date records until an independently authorized full refresh. Existing question fingerprints have no change from these additive edits.

The existing OA record already used the June 2026 provider summary. Initial catalog research identified a 2026 replacement for the historic 2020 edition, but examination of the actual app showed that replacement was already incorporated. The new full-guideline source adds depth; it is not presented as a correction of a nonexistent old-edition answer.

## Exact documents inspected

| Document | Direct source | Selected locator and purpose |
| --- | --- | --- |
| VA/DoD hip/knee osteoarthritis CPG, version 3.0, May 2026; evidence through July 31, 2025 | [Full guideline](https://healthquality.va.gov/HEALTHQUALITY/guidelines/CD/OA/Osteoarthritis-CPG_2026-Guideline_final_20260618.pdf) | Recommendations 5–6, 12–13, 14–18; Sidebars 1–3; Module A alternative algorithm text; Appendix K. |
| VA/DoD diagnosis/treatment of low back pain, version 3.0, February 2022; evidence through February 1, 2021 | [Full guideline](https://www.healthquality.va.gov/HEALTHQUALITY/guidelines/Pain/lbp/VADODLBPCPGFinal508.pdf) | Recommendations 1–3, 8–9, 12, 14, 19, 23–24, 28–29; Sidebar 1; NSAID discussion; 2017-to-2022 comparison appendix. |
| CDC STEADI algorithm, 2019 displayed on PDF | [Original PDF](https://www.cdc.gov/steadi/media/pdfs/steadi-algorithm-508.pdf) | Page 2, assessment, individual risk-matched interventions and final follow-up step. Community-dwelling adults aged 65 or older. |
| CDC STEADI SAFE Medication Review Framework, 2017 displayed on PDF | [Original PDF](https://www.cdc.gov/steadi/media/pdfs/steadi-factsheet-safemedreview-508.pdf) | Page 2, general medication-review and education narrative; footnotes 1–3. Underlying outside pharmacist tools are not reproduced. |

Displayed publication months/years are recorded as editions. No unsupported day-level publication date was invented. Every new source check is October 10, 2026. A current check does not change the underlying age of the evidence review or demonstrate that every current therapeutic question is covered.

The [2026 OA provider summary](https://healthquality.va.gov/HEALTHQUALITY/guidelines/CD/OA/Osteoarthritis-CPG_2026-Provider-Summary_final_20260618.pdf) was also inspected to reconcile the existing June 2026 source with the May 2026 full guideline. Both contain the applicable core recommendations; the distinct displayed dates are retained.

## Rights assessment and exclusions

[VA copyright policy](https://department.va.gov/copyright-policy/) states that government-produced materials on VA sites are not copyright protected, while recognizing that the government may hold assigned copyrights. The selected CPGs identify VA and DoD as their issuing agencies. The additions summarize the agencies' original recommendation and explanatory text. They do not reproduce credited outside research, tables copied from another publication, images, questionnaires, proprietary outcome instruments, logos or the contents of cited journal articles. An external citation in a government guideline does not grant permission to ingest that external publication.

[CDC agency-materials policy](https://www.cdc.gov/other/agencymaterials.html) permits use of its public-domain materials while distinguishing contractors, grantees, licensed material and international rights. It requires attribution, nonendorsement, substantive integrity, identification of the freely available original and maintenance of currency. New CDC source records include explicit source attribution, a free-original notice, nonendorsement and an original-study-summary notice. No CDC logo, illustration, copied screening questionnaire, balance-test instructions or Beers Criteria list is included.

The SAFE PDF says its framework was adapted from existing pharmacist medication-management tools. This audit covers only the general narrative published and attributed to CDC in this exact PDF; it does **not** claim that the underlying pharmacist tools, any separately credited resource, or third-party forms are public domain. The dataset contains original educational paraphrases of the general medication-history, assessment, monitoring and education principles, not a copied version of an outside tool. This is a bounded U.S. original-text reuse assessment, not a blanket agency or worldwide grant. If later document-level investigation identifies protected contributions in the selected material, the source must be quarantined or permissions obtained rather than treating this audit as irrevocable clearance.

`content/source-reuse-policy.json` proposes four exact-document allowlist entries for parent integration. Proposed editorial allowances are 2,500 words for the OA full CPG and 2,000 words for each other document. These are conservative software budgets, not copyright safe-harbor calculations or medical-accuracy approval. No global allowlist, loader, manifest or deployment was changed by this authoring task.

## Recommendation qualifiers and conflict audit

- **OA physical therapy:** a structured program is suggested; a particular type/delivery mode is not established as universally superior.
- **OA pharmacotherapy:** oral NSAIDs or acetaminophen are suggested when appropriate; the renal-risk footnote explicitly includes COX-2 agents. The eGFR threshold is reproduced as a source-defined study fact, with units and scope intact. A PPI does not erase the renal restriction.
- **OA duloxetine:** applies to selected knee-OA patients based on characteristics/preferences. It is not asserted to be a mandatory next drug or a universally preferred treatment for hip OA.
- **OA injections:** the hip corticosteroid recommendation requires image guidance; the pre-replacement three-month constraint remains visible. No cure or superiority promise is made.
- **OA surgical referral:** the algorithm and Appendix K support reassessment and consultation for substantial persistent impairment. Appendix K explicitly explains that its referral/radiograph discussion was placed in an appendix because sufficient high-quality evidence for a new GRADE recommendation was not found. The teaching preserves this distinction and does not relabel practice guidance as high-certainty evidence or order surgery for every patient.
- **LBP medication uncertainty:** the 2022 short-term acute non-benzodiazepine muscle-relaxant statement replaces a 2017 suggestion in favor with insufficient evidence for or against. No current stored answer contradicted this change. Insufficient evidence is not encoded as either demonstrated ineffectiveness or universal permission.
- **LBP steroids:** the suggestion against systemic treatment covers low back pain with or without radicular symptoms and oral/intramuscular routes. It is not extended to every possible spinal procedure.
- **LBP imaging:** new infection/fracture red flags change an initially uncomplicated pathway; absence of bowel/bladder deficits alone does not remove other red flags. Suspected infection and possible fracture receive their respective diagnostic pathways.
- **LBP duration:** the one chronic-transition question is labeled `domain:"chronic"`; acute-only evidence is not extrapolated into that question.
- **Falls:** the CDC setting is community-dwelling adults aged 65 or older. The 30–90-day interval is post-intervention follow-up, not a rule to defer acute injury or new symptoms. Medication changes are individualized, monitored and may require gradual reduction. No specific drug taper, dosing table, validated scale or comprehensive geriatric prescribing algorithm is claimed.

**No genuinely superseded stored answer or unresolved contradiction was found in the selected old OA/LBP items.** No old question was changed, retired or silently rekeyed. This finding is bounded to these items and sources, not a global clinical certification.

## Remaining holes

This expansion does not fill the complete sports-injury curriculum, frailty/dementia/palliative-care depth, acute syncope/injury evaluation, drug-by-drug Beers or STOPP/START criteria, specific deprescribing tapers, every analgesic dose, hand OA or all imaging/procedural scenarios. The source-backed topic is intentionally narrower than comprehensive physician training. Any additional society material requires its own current rights and clinical-source review.

The parent task owns schema/source-budget validation, independent question review, policy merging, crosswalk updates and publication. No tests, paid AI calls, GitHub publication, deployment or permission requests were performed here.

## Independent review corrections before integration

An independent source-packet review found two omissions in the selected teaching, despite the underlying guideline facts being verified. The new LBP chronic-transition section now explicitly includes Recommendation 24 against chronic non-benzodiazepine muscle-relaxant use. A single shared new OA section binds Recommendation 14 against starting opioids, including tramadol, to the new full-guideline source; new questions q7, q8 and q10 select it so their opioid distractor explanations have complete local evidence. This consolidates the fact rather than duplicating it in three sections. These are corrections to new, unpublished question packets, not changes to the eight previously stored questions. No answer keys changed and no test was run for this authoring correction.

Integration: exact-document entries have been merged into the canonical `content/source-reuse-policy.json`; intermediate fragments were removed. Strict corpus and board-bank validation passed. Root integration does not confer qualified clinical or commercial approval.
