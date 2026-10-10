# Eye and ankle-sprain study expansion

Checked **2026-10-10**, expiring **2026-11-10**. Candidate corpus: `content/conditions/eye_sports_expansion.json`. Proposed exact-document reuse entries: `content/source-reuse-policy.json`.

This addition contains **five new diagnosis records, 25 original teaching sections and 20 original five-choice questions**: retinal detachment, primary open-angle glaucoma, acute angle-closure glaucoma, cataract and ankle sprain. Open-angle disease and acute angle closure have separate disease mechanisms, urgency, course and learning objectives; there is no additional generic-glaucoma record counted as a third condition. The new question key distribution is four each for A, B, C, D and E. Every question is an original hypothetical study item, not an ABFM item or a claim that this addition reproduces ABFM content.

All seven sources are **official clinical references**, not formal professional-society guidelines. Source verification and exact-text reuse assessment are not human clinical review. All records remain `humanReviewed:false`; all rights objects remain `commercialClinicalApproval:false`. No approval, clinician identity, source endorsement, commercial activation or complete specialty coverage is asserted.

## Primary sources actually read

| Exact document | Document date displayed | Evidence used | Original-text reuse policy |
| --- | --- | --- | --- |
| [NEI Retinal Detachment](https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/retinal-detachment) | Last updated November 5, 2025 | Sudden floaters/flashes/curtain, emergency evaluation, risk factors, dilated examination and supplemental imaging, small tear versus larger detachment repair | [NEI copyright policy](https://eyegene.nih.gov/about/policies/copyright) |
| [NEI Glaucoma](https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/glaucoma) | Last updated August 19, 2026 | Silent early disease, peripheral loss, field assessment, pressure caveat, preservation of remaining vision, broad drops/laser/surgery options and follow-up | NEI copyright policy |
| [NEI Types of Glaucoma](https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/glaucoma/types-glaucoma) | Last updated December 5, 2024 | Open-angle and normal-tension subtypes; acute angle-closure symptoms, iris obstruction, medicine/laser scope, fellow-eye prevention possibility, separate chronic angle closure | NEI copyright policy |
| [NEI Get a Dilated Eye Exam](https://www.nei.nih.gov/eye-health-information/healthy-vision/finding-eye-doctor/get-dilated-eye-exam) | Last updated November 26, 2025 | Explicit purposes of visual-acuity, visual-field, eye-muscle, pupil-response and pressure testing; used to make diagnostic alternatives comparable | NEI copyright policy |
| [NEI Cataracts](https://www.nei.nih.gov/eye-health-information/eye-conditions-and-diseases/cataracts) | Last updated August 19, 2026 | Lens clouding, symptoms and risks, dilated examination, early adaptations, daily-function rationale for discussing surgery and artificial lens replacement | NEI copyright policy |
| [NIAMS Sports Injuries](https://www.niams.nih.gov/health-topics/sports-injuries) | Last reviewed September 2024 | Sprain versus strain, awkward ankle roll/twist, serious-injury signs and variation in severity | [NIAMS disclaimer](https://www.niams.nih.gov/disclaimer) |
| [NIAMS Sports Injuries: Diagnosis, Treatment, and Steps to Take](https://www.niams.nih.gov/health-topics/sports-injuries/diagnosis-treatment-and-steps-to-take) | Last reviewed September 2024 | Injury history and examination; possible imaging; serious-injury assessment; minor-injury support; stopping painful activity and rehabilitation | NIAMS disclaimer |

A page-update/review date is recorded in `edition`; **original publication dates are unknown**, so `publishedDate:null` is deliberate. The automated check date is not represented as a newly published guideline edition. The old `/sprains-and-strains` URL redirected to the canonical NIAMS sports-injuries overview; the canonical URL is retained. The obsolete NIAMS privacy URL failed and the NIH FAQ was blocked; neither is used as a permissions basis. The primary NEI copyright policy and NIAMS disclaimer were read successfully.

The NEI policy says its government-prepared text is generally public domain, with exceptions for protected documents and privately licensed material. The selected page text has no credited third-party-text notice in the passages used. NIAMS explicitly places its website text in the public domain. Exact-page text-only assessment supports the proposed U.S. editorial reuse allowance; it is not an institution-wide import permission or a global legal determination. Both policies distinguish media and linked works. **No photographs, illustrations, logos, external articles, source full text or copied tables are imported.** NEI's suggested courtesy attribution and NIAMS source attribution are preserved in source metadata. Originals remain available at their agency URLs; no agency endorsement is implied.

## Claim-to-locator ledger

Each JSON section retains its own `sourceLocator`, and each question binds both supporting section IDs and source IDs.

| Record | Section IDs | Primary locator and bounded objective |
| --- | --- | --- |
| Retinal detachment | `recognition`, `urgent-evaluation` | NEI definition and Symptoms; recognize a sudden warning pattern and immediate evaluation rather than a delayed routine visit. |
| Retinal detachment | `risk-context` | NEI Am I at risk; injury, previous surgery/detachment and listed eye disorders modify suspicion, not confirm diagnosis. |
| Retinal detachment | `diagnostic-assessment` | NEI How will my eye doctor check; dilated examination and ultrasound/OCT if additional information is needed. |
| Retinal detachment | `treatment-extent` | NEI treatment; small tear sealing versus larger-detachment surgery, without choosing a universal operation. |
| Primary open-angle glaucoma | `course`, `assessment` | NEI Glaucoma definition, symptoms, risk and examination; Types of Glaucoma open-angle/normal-tension headings; silent early disease, field assessment and pressure caveat. |
| Primary open-angle glaucoma | `treatment-goal`, `treatment-options`, `follow-up` | NEI Glaucoma causes and treatment paragraphs; preserve remaining vision, broad treatment options, prescribed-medicine adherence and follow-up without a drug-ranking protocol. |
| Acute angle-closure glaucoma | `acute-pattern`, `mechanism` | NEI Types, Angle-closure glaucoma symptom and mechanism paragraphs; sudden painful visual symptoms and rapid pressure rise are an emergency. |
| Acute angle-closure glaucoma | `treatment-scope`, `other-eye`, `acute-chronic-boundary` | NEI Types, Angle-closure treatment/fellow-eye/final chronic paragraph; broad medicine/laser scope, possible prevention in both eyes, distinct chronic presentation. |
| Cataract | `recognition`, `assessment`, `risk` | NEI definition, symptoms, risk and examination; lens clouding is assessed by eye examination rather than inferred from age or symptoms alone. |
| Cataract | `early-support`, `surgery-function` | NEI treatment, home support, new glasses and Surgery; functional support differs from cataract removal, and surgery is discussed when everyday activities are affected. |
| Ankle sprain | `mechanism` | NIAMS overview, Sprain/Strain and Ankle Injuries; ligament injury differs from muscle/tendon strain. |
| Ankle sprain | `severity-assessment`, `evaluation` | NIAMS treatment page, serious-injury signs and Diagnosis; assess warning findings and use history/examination with imaging considered, without inventing an ankle-specific rule. |
| Ankle sprain | `initial-support`, `rehabilitation` | NIAMS treatment, minor-injury support and Rehabilitation; broad supportive care and recovery goals, without a loading schedule or return-to-sport clearance. |

Question distractors are explained within these supported distinctions. Numerical drug doses, imaging cutoffs, risk scores, operative intervals and performance estimates were deliberately not authored because the selected passages do not establish them.

## Remaining holes

- **Eye professional guidelines:** These references improve basic recognition, urgent evaluation and broad treatment concepts. They do not close the AAO-level diagnostic/management gap. Verified commercial permissions for appropriate professional guidelines remain necessary before protected text can be incorporated.
- **Acute angle closure:** No approved emergency drug sequence, dose, contraindication or gonioscopy protocol is supplied. Fellow-eye treatment remains a possible specialist decision, not an automatic identical-treatment mandate.
- **Glaucoma:** First-line drug-class selection, target pressure, drug contraindications, detailed escalation and monitoring intervals need a suitable professional source and review. The normal-tension caveat is not converted into a universal population screening recommendation.
- **Retinal detachment:** Macula-on versus macula-off timing, operative selection, bedside examination performance and detailed prognosis remain unsupported. The warning-symptom question is urgent hypothetical recognition, not a real-patient triage service.
- **Cataract:** Perioperative planning, complications, surgical-acuity criteria and complex differential diagnosis remain outside the imported educational text. No guaranteed outcome percentage is imported.
- **Ankle sprain:** Ottawa ankle rules, radiograph views, ligament-specific stability grading, early-loading progression, specific rehabilitation dosing, syndesmotic injury, fracture/dislocation algorithms and return-to-sport testing remain open. The 2024 NIAMS support measures are identified as general education, not represented as a complete contemporary sports-medicine guideline.
- **Broader eye/sports curriculum:** Uveitis, keratitis, chemical injury, vascular occlusions, macular disease and additional sports diagnoses are not established by these five records.
- **Independent clinical review:** None has occurred. Four questions per diagnosis provide limited practice depth; source/structure checks do not certify medical accuracy, board scores or clinician competence.

## Validation handoff

Only the three owned content/audit files were authored. No loader, global policy, manifest, test, repository ref, deploy configuration, clinical-release gate or paid provider call was changed. Integration must explicitly admit the new corpus file, merge the seven exact-document policy candidates, update reference-only-gap reporting and run the affected corpus/bank checks. Passed unrelated behavior should not be retested without an affected change or unresolved concern.

## Targeted editorial revision

After an independent question-quality review, six authored items were revised: `retinal-detachment-q2`, `retinal-detachment-q3`, `retinal-detachment-q4`, `primary-open-angle-glaucoma-q3`, `acute-angle-closure-glaucoma-q2` and `cataract-q1`. Retinal q2 now compares five eye assessments according to their source-stated purposes; the linked NEI exam page was read directly and recorded as a seventh exact-document candidate. Repair and glaucoma escalation items compare ocular procedures by treatment target. Retinal q4 now tests examination despite symptom absence after injury instead of repeating the emergency-warning item. Cataract options are all diagnoses. Acute angle-closure options are all sourced glaucoma drainage mechanisms. Supporting sections and source IDs were updated for cross-condition explanations. These editorial improvements do not establish clinical review, calibrated difficulty or validated psychometric performance. No tests were run during this targeted revision.

Integration: exact-document entries have been merged into the canonical `content/source-reuse-policy.json`; intermediate fragments were removed. Strict corpus and board-bank validation passed. Root integration does not confer qualified clinical or commercial approval.
