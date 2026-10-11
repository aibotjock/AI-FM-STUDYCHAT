# Antibiotic treatment-depth gap expansion

Checked: **2026-10-10**. Independent family medicine board-study material only. Original questions and explanatory summaries; no patient-care use, ABFM affiliation, clinician review, commercial clinical activation or guaranteed accuracy is asserted.

## Contribution and preservation

- Added **18 original five-choice application questions**: five each for chlamydia, gonorrhea and acute epididymitis; three for confirmed GAS pharyngitis. These four conditions now have **34 questions** in total.
- Added **17 teaching sections** and **6 dated source records**. Four disease documents already have exact-document public-domain allowances. Two additional exact documents, an MMWR erratum and an FDA news release, are proposed in `content/source-reuse-policy.json` for the repository-owned policy merge.
- Existing question/source/section IDs, existing factual bodies, legacy check dates and file envelope dates are retained. The epididymitis overview now accurately includes the new adult dosing scope while retaining excluded pediatric, renal-adjustment and chronic-pain material. New source checks do not renew older condition review/expiry dates.
- All affected records retain `humanReviewed:false`. New source rights checks are dated 2026-10-10 and retain `commercialClinicalApproval:false`. New dates are source verification, not publication dates or clinical certification.
- No app code, AI model, voice component, retrieval/whole-reply approval boundary, stored learner data, release configuration or deployment is changed by this contribution.

## Exact documents used

| Document and edition | Verified locator | Imported study scope | Rights evidence |
|---|---|---|---|
| [CDC Chlamydial Infections](https://www.cdc.gov/std/treatment-guidelines/chlamydia.htm), STI Guidelines 2021; chapter reviewed July 22, 2021 | Adolescent/adult Treatment and alternatives; Other Management Considerations; Follow-Up; Management of Sex Partners; Pregnancy | Recommended versus alternative regimens; pregnancy-specific doses; adherence and rectal-efficacy qualification; 7-day single-dose abstinence plus partner treatment; most-recent-partner exception; early NAAT interpretation | Individually assessed agency-authored recommendation text. [CDC agency-material policy](https://www.cdc.gov/other/agencymaterials.html); existing exact-document allowance. |
| [CDC Gonococcal Infections Among Adolescents and Adults](https://www.cdc.gov/std/treatment-guidelines/gonorrhea-adults.htm), STI Guidelines 2021; chapter reviewed September 21, 2022 | Uncomplicated cervix/urethra/rectum regimens and weight footnote; Alternatives; Pharynx; Follow-Up; Pregnancy | Inclusive 150-kg dose threshold; unexcluded chlamydia outside pregnancy; availability versus allergy alternatives; severe pharyngeal allergy consultation; positive day-7 pharyngeal NAAT follow-up | Individually assessed agency-authored text. CDC agency-material policy; existing exact-document allowance. |
| [CDC Epididymitis](https://www.cdc.gov/std/treatment-guidelines/epididymitis.htm), STI Guidelines 2021; chapter reviewed July 22, 2021 | Treatment: three Recommended Regimens, weight footnote and monotherapy qualification; Follow-Up; Drug Allergy | STI versus combined STI/enteric versus enteric-only regimens; 10-day duration; weight threshold; source-specified gonorrhea exclusion; culture/susceptibility guidance; allergy consultation; persistent postcourse swelling | Individually assessed agency-authored text. CDC agency-material policy; existing exact-document allowance. |
| [CDC Clinical Guidance for GAS Pharyngitis](https://www.cdc.gov/group-a-strep/hcp/clinical-guidance/strep-throat.html), November 18, 2025 | Recommended antibiotics: oral penicillin V, oral amoxicillin and IM benzathine penicillin G | Adult oral penicillin duration; pediatric amoxicillin dose cap; benzathine formulation, route and 27-kg threshold | Individually assessed CDC-authored dose summary. CDC agency-material policy; existing exact-document allowance. The separately attributed AAP Red Book footnote and linked society publications are excluded. |
| [MMWR Erratum: Vol. 70, No. RR-4](https://www.cdc.gov/mmwr/volumes/72/wr/mm7204a5.htm), January 27, 2023 | Correction to page 73: availability versus cephalosporin-allergy alternative regimen boxes | Cross-check of the corrected cefixime versus gentamicin/azithromycin categories | [MMWR public-domain notice](https://www.cdc.gov/mmwr/about.html). Added as a separate exact document, not a publisher-wide or agency-wide allowance. |
| [FDA Approves Two Oral Therapies to Treat Gonorrhea](https://www.fda.gov/news-events/press-announcements/fda-approves-two-oral-therapies-treat-gonorrhea), December 12, 2025 | Opening approval paragraphs and uncomplicated-urogenital indication heading | Bounded approval-status teaching for zoliflodacin and gepotidacin, including press-release age/weight and restricted gepotidacin eligibility; no claim of CDC first-line status | FDA-authored regulatory news text; no separate copyright statement observed. [FDA website policies](https://www.fda.gov/about-fda/about-website/website-policies), Linking to or Copying Information, distinguishes public-domain agency text from otherwise-noted material. No manufacturer label, trial report or imagery is imported. |

No full text, tables, dose-chart layout, logos, photographs, publication PDFs, linked journal articles or contractor works were stored. Summaries preserve the substantive recommendations and link to freely available originals. Attribution does not imply CDC, HHS, FDA or U.S. Government endorsement. The reuse assessment concerns selected U.S. agency-authored text, not international rights or a commercial clinical release.

## Currency and correction checks

The [CDC STI guidance index](https://www.cdc.gov/std/treatment-guidelines/default.htm) continues to identify its **2021** recommendations as current guidance on the check date. A freshly read chapter is still a 2021 edition; it is not relabeled a 2026 guideline. The [CDC gonorrhea clinical-care page](https://www.cdc.gov/gonorrhea/hcp/clinical-care/index.html), July 11, 2024, continues to link the 2021 regimens. The exact disease chapters provide the weight and population qualifications omitted from its short overview.

The January 2023 erratum was read and the corrected availability/allergy alternatives were cross-checked against the current HTML chapter. The new questions do not use the uncorrected alternative boxes in an old PDF. No new contradiction was observed among these selected CDC recommendations; absence of an observed contradiction is not exhaustive clinical review.

The [STI product availability notice](https://www.cdc.gov/sti/hcp/clinical-guidance/availability-of-products.html), updated September 21, 2026, currently discusses Bicillin L-A supply, importation and shelf-life issues. It does not provide a replacement regimen for the three selected STI chapters. It does not establish that all antibiotics or formulations are available in every jurisdiction. The STI Bicillin notice is not generalized to IM penicillin treatment of GAS pharyngitis or used as a rationale to replace that regimen.

FDA's December 2025 oral gonorrhea approvals are an important newer regulatory development. The added section prevents an inaccurate inference that no approved oral therapies exist. FDA approval and CDC treatment priority are distinct evidence questions. Full current labeling, pharmacologic precautions and future guideline incorporation are not inferred from a press release.

## Question-to-evidence inventory

| Condition | New questions | Distinctions |
|---|---|---|
| Chlamydia | `chlamydia-q5` through `chlamydia-q9` | Pregnancy recommended versus alternative treatment; adherence alternative with rectal-efficacy caveat; partner lookback exception; abstinence and partner conditions; early NAAT limitation |
| Gonorrhea | `gonorrhea-q5` through `gonorrhea-q9` | Inclusive weight threshold; cefixime availability alternative; pharyngeal severe allergy; positive early pharyngeal NAAT and culture; unexcluded chlamydia outside pregnancy |
| Acute epididymitis | `epididymitis-q5` through `epididymitis-q9` | STI combination and 10-day duration; qualified enteric monotherapy; combined-risk/weight/duration; unstudied allergy alternatives; persistent postcourse swelling |
| GAS pharyngitis | `streptococcal-pharyngitis-q5` through `streptococcal-pharyngitis-q7` | Adult oral penicillin schedule; pediatric amoxicillin dose maximum; IM benzathine formulation/route/weight threshold |

Vignettes are hypothetical and original. Distractor explanations address the supplied source's regimen, interval or eligibility rather than inventing adverse effects, resistance mechanisms or universal drug contraindications. Correct answer positions vary. Exact disease source IDs are retained on every new section and question, with the gonorrhea availability question also citing the checked correction.

## Remaining gaps and required review

- These selected modules do **not** provide a complete antibiotic handbook. Renal/hepatic dose adjustment, drug interactions, full adverse-effect counseling, neonatal infection, complicated infection, uncommon etiologies and local resistance/availability remain explicit gaps.
- The new oral gonorrhea agents need exact current label and qualified clinical review before adding doses, comprehensive contraindications, treatment ranking or claims about pharyngeal/disseminated efficacy. The restricted gepotidacin approval is not generalized to all patients.
- Detailed adult sinusitis, AOM, CAP, pyelonephritis and skin-infection regimens require further condition-specific source/permission review. The CDC adult outpatient summary does not by itself justify all doses or durations; imported society tables must not be inferred from links.
- Pregnancy chlamydia treatment is provided, but no complete pregnancy antimicrobial reference or renal-adjustment algorithm is implied. Gonorrhea dose questions explicitly use nonpregnant or chlamydia-excluded contexts; allergy alternatives are not generalized to pregnancy.
- Independent clinician/pharmacist review of new dose, route, maximum, duration and special-population distinctions remains required. The commercial approved corpus stays unchanged.
- Root integration must merge the two exact-document policy proposals, validate the affected condition/bank contracts and source budgets, and record evidence in the validation ledger. This worker ran no tests, Git operations, paid model calls, deployment or live clinical request.

Integration: exact-document entries have been merged into the canonical `content/source-reuse-policy.json`; intermediate fragments were removed. Strict corpus and board-bank validation passed. Root integration does not confer qualified clinical or commercial approval.
