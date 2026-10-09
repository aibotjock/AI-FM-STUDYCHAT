# Additional common family medicine conditions source audit

Checked 2026-10-09. Dataset: `content/conditions/common_additions.json`.

This supplement contains five distinct conditions, 15 sourced sections and ten original hypothetical five-choice application questions. It adds tobacco use disorder, acute epididymitis, scabies, pediculosis capitis and tinea corporis. These are educational topics rather than a numerical prevalence ranking or official ABFM questions. All records remain `humanReviewed: false` and expire on 2026-11-09. Automated source verification and structural integrity do not establish clinician approval or guaranteed accuracy.

## Actual primary-source reads

| Condition | Official source | Actual-read evidence and locators | Incorporated scope |
| --- | --- | --- | --- |
| Tobacco use disorder | [CDC clinical interventions for adults](https://www.cdc.gov/tobacco/hcp/patient-care-settings/clinical.html) | `turn209view0`, lines 29–53 and 75–79: nonpregnant combined treatments, pregnancy counseling and follow-up | Combined adult cigarette-smoking cessation treatment, pregnancy-first behavioral support and repeated-attempt follow-up. This is an official clinician recommendation page, not a new formal guideline edition. |
| Acute epididymitis | [CDC STI Treatment Guidelines chapter](https://www.cdc.gov/std/treatment-guidelines/epididymitis.htm), 2021; reviewed July 22, 2021 | `turn210view0`, Diagnostic Considerations lines 29–38; Treatment line 40; Follow-Up line 66 | Urgent torsion referral, chlamydia/gonorrhea NAAT and bacterial culture, risk-based treatment selection and three-day nonresponse reassessment. Exact antibiotic regimens are outside this module. |
| Scabies | [CDC Clinical Care of Scabies](https://www.cdc.gov/scabies/hcp/clinical-care/index.html), December 18, 2023 | `turn209view1`, classic first-line medications lines 38–43 and crusted-scabies treatment lines 53–57 | Permethrin option and age boundary; oral ivermectin approval/safety limits; combined oral/topical treatment for crusted disease. Exact application schedules and outbreak protocols are outside this module. |
| Pediculosis capitis | [CDC Clinical Care of Head Lice](https://www.cdc.gov/lice/hcp/clinical-care/index.html), January 31, 2025 | `turn209view2`, permethrin lines 41–46; persistent infestation line 49; malathion line 63; precautions lines 84–88 | Nonovicidal treatment and possible day-nine retreatment, persistent live-lice reassessment, malathion ignition precautions. School policies and diagnostic nit interpretation are outside this module. |
| Tinea corporis | [CDC clinician ringworm overview](https://www.cdc.gov/ringworm/hcp/clinical-overview/index.html), July 15, 2024; [CDC clinician antifungal treatment](https://www.cdc.gov/fungal/hcp/clinical-care/index.html), published November 15, 2024 and updated/reviewed July 28, 2026 | `turn209view3`, clinical features lines 119–126 and testing lines 133–138; `turn210view1`, appropriate use lines 75–79 | Ringworm pattern with diagnostic uncertainty, testing before prescribing when feasible and avoidance of corticosteroid-containing antifungal combinations. These pages contain explicit clinician recommendations and are labeled `official-recommendation`; they are not mislabeled formal clinical guidelines. |

The tobacco page displays May 15, 2024 near its heading and May 14, 2024 near its footer. Its record reports that discrepancy in the edition and leaves `publishedDate` null. The ringworm page's 2026 image-download dates are not treated as a new clinical-recommendation publication date. No unobserved source dates were invented.

## Source use and boundaries

All six CDC pages were actually opened and read. Search results only located the sources. No blocked or restricted source was used, and no source PDF, page full text, diagram, photograph or table is retained in the app. Summaries, fictional cases and rationales are original. CDC links to external publications were not copied or treated as separately read evidence.

Five records contain explicit official clinical recommendations or a formal guideline chapter. There are six source records: one `clinical-guideline` and five `official-recommendation`. Recommendation pages are not presented as new comprehensive formal guidelines. Narrow incorporated scopes are stated in each overview so retrieval can distinguish supported study facts from unverified dosing, special-population or resistant-infection questions.

The author-local per-URL derived-fact budget includes sourced sections, canonical correct choices and all five answer rationales; fictional vignette setup is original. Counts are: tobacco 135 words, epididymitis 124, scabies 140, head lice 128, ringworm overview 65 and antifungal clinician treatment 73. Every URL remains below 200 words. Any reuse of these URLs elsewhere in the corpus must be counted together by the combined-corpus audit.

## New-supplement integrity check

One targeted check of this newly added supplement verified the exact five IDs; 15 nonempty sourced sections; ten unique five-option application questions; one keyed answer and four corresponding distractor explanations each; source/section reference integrity; allowed domains and source kinds; CDC HTTPS URLs; unchanged honest review/expiry metadata; and per-URL budgets. Correct-answer positions are A=2, B=2, C=2, D=2, E=2.

Result: **PASS**, 2026-10-09. Keyed answers were compared with the actual source locators while authoring. This is automated editorial verification, not independent clinician validation. Existing app checks and previously completed condition-file checks were not rerun.
