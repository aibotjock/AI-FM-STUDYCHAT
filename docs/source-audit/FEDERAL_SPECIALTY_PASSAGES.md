# Federal specialty passages: exact-document assessment

Checked 2026-10-10. This audit supports `content/reference-expansion/federal-specialty-passages.json`; it does not approve the app for medical practice, commercial activation or app-store publication. No existing questions, question fingerprints or old condition review dates were changed.

## Imported: NCI text excerpts with exact-summary permission

| Existing study condition | Original source, with its full title | Source update shown on the retrieved page | Passages |
| --- | --- | --- | ---: |
| `metastatic-breast-cancer` | [Breast Cancer Treatment (PDQ®)–Health Professional Version](https://www.cancer.gov/types/breast/hp/breast-treatment-pdq) | 2025-04-25 | 11 |
| `tobacco-use-disorder` | [Cigarette Smoking: Health Risks and How to Quit (PDQ®)–Health Professional Version](https://www.cancer.gov/about-cancer/causes-prevention/risk/tobacco/quit-smoking-hp-pdq) | 2025-02-21 | 7 |
| `cervical-dysplasia` | [Cervical Cancer Prevention (PDQ®)–Health Professional Version](https://www.cancer.gov/types/cervical/hp/cervical-prevention-pdq) | 2025-04-18 | 4 |

The [NCI reuse policy](https://www.cancer.gov/policies/copyright-reuse), reviewed March 12, 2025, permits reuse of NCI text unless otherwise indicated, requires credit, and asks digital reproductions to link the original product using its original title. The **Permission to Use This Summary** section of each of the three exact documents independently permits free use of its text. It permits ordinary attributed excerpts, while reserving identification as an NCI PDQ cancer information summary to the entire, regularly updated work.

Accordingly, these are small text excerpts in an independent study app. The original full title is a source citation, not the name or branding of the app's excerpt. The source object includes NCI attribution, original URL/title, original update date, access date, limitations and the exact reuse basis. Section titles identify the material as source excerpts. No images, logos, proprietary source articles, complete copied summary or implied NCI endorsement are included. The excerpt designation is `public-domain-text-excerpt`; the source kind is `official-clinical-reference`, not `clinical-guideline`.

The corpus has 22 bounded excerpts across 3 existing conditions and 3 documents. Total excerpt words per document are 491, 413 and 165 respectively, under each document's 2,000-word editorial budget. The longest passage is 600 characters. Full sentences and the relevant consecutive paragraph or indication list are retained; source reference numbers are rendered as plain bracketed numbers, list bullets and whitespace are normalized, and locator text records the original heading and any qualifications. No inserted explanation is represented as part of the quoted source text.

## What the passages support

- **Metastatic breast cancer:** palliative intent and quality-of-life goals; obtaining metastatic pathology and ER/PR/HER2 testing where possible; considering liquid biopsy if tissue documentation is not possible; clinical-trial candidacy; the defined HER2-negative hormone-receptor-positive setting for CDK4/6 plus endocrine therapy; selected use of endocrine monotherapy; cytotoxic treatment candidates; visceral-crisis and rapid-progression qualifiers; selected surgical indications; symptomatic radiation-palliation indications; consideration of bone-modifying therapy for skeletal morbidity. The summary's own statement that it is not a formal practice guideline is included as a passage.
- **Tobacco use disorder:** individualized medication selection; behavioral modalities; NRT's purpose and the adjacent special-population precautions; varenicline's mechanism and commonly reported adverse effects; the evidence's uncertainty in comparing varenicline with dual NRT; combined fast-acting and patch NRT; the pregnancy distinction in the evidence summarized by NCI. The pregnancy passage includes both consecutive paragraphs so the pharmacotherapy insufficiency qualifier travels with the adult benefit statement.
- **Cervical dysplasia:** carcinogenic HPV causation; LSIL/HSIL/CIN terminology and qualified natural history; HPV-naive prevention evidence, retaining the original extrapolation wording.

These passages do **not** supply a comprehensive breast-cancer regimen, detailed breast-cancer drug dosing or contraindications, a universal first-line regimen, a complete smoking-cessation label/renal adjustment, an ASCCP risk-based colposcopy/excision algorithm, current screening intervals or a vaccination schedule. The app must not generate these missing facts from the presence of a reputable citation. The source pages were retrieved on October 10, 2026; their 2025 update dates remain unchanged. A successful access check is not proof of a new clinical recommendation, a clinician review or a 2026 revision.

## Deferred: SAMHSA and current Clinicalinfo content

### SAMHSA

Publication-specific permission controls admission. Some SAMHSA TIP publications contain public-domain wording but also explicitly restrict reproduction/distribution for a fee without written authorization. A paid subscription RAG has not been treated as authorized by the public-domain phrase alone. TIP 63, TIP 26 and TIP 39 are excluded from this expansion pending appropriate permission. The [Buprenorphine Quick Start Guide](https://www.samhsa.gov/sites/default/files/quick-start-guide.pdf) could not be retrieved directly during this audit; indexed free access and an external catalog's public-domain label do not establish the exact publication's commercial terms. No Quick Start passages are imported.

### HHS Clinicalinfo HIV guidelines

The [current Clinicalinfo disclaimer](https://clinicalinfo.hiv.gov/en/disclaimers) was retrieved. Its photograph copyright statement does not itself give affirmative broad commercial text-reuse permission. An older official Bookshelf edition can have a public-domain notice, but that is not permission for current guideline text with unverified work/version identity. No new current Clinicalinfo HIV paragraphs were imported. Existing HIV content was left intact; this audit does not add a new blanket license to it.

### Colon and prostate cancer

The initial existing-condition excerpt module leaves colon/prostate text out rather than attaching it to unrelated conditions. A separately authorized follow-up now supplies correctly classified new disease records in `content/conditions/oncology_reference_expansion.json`, as described below. Benign prostatic hyperplasia remains separate from prostate cancer.

## Validation scope

Local construction checked JSON parsing, mapped IDs, unique IDs, source references, complete nonempty locators, distinct source/update and access dates, passage length bounds, document word budgets, source kinds, excluded media and permission metadata. Parent integration must run the actual loader's acceptance and source-span tests after merging these files. No live medical model response, clinician/pharmacist review, paid API call or deployment was performed by this contribution.


## Follow-up expansion: new colorectal and prostate study records

The expanded-condition request authorizes two appropriately named disease records rather than treating these treatment sources as absent indefinitely. `content/conditions/oncology_reference_expansion.json` adds **2 disease records, 4 exact documents, 18 source excerpts and 8 original questions** (4 per record). The earlier 22-excerpt existing-condition module is unchanged.

| New disease record | Exact source | Original page update retained | Source classification |
| --- | --- | --- | --- |
| `colorectal-cancer` | [Colon Cancer Treatment (PDQ®)–Health Professional Version](https://www.cancer.gov/types/colorectal/hp/colon-treatment-pdq) | 2025-02-12 | Official health-professional evidence reference |
| `colorectal-cancer` | [Rectal Cancer Treatment (PDQ®)–Health Professional Version](https://www.cancer.gov/types/colorectal/hp/rectal-treatment-pdq) | 2025-02-12 | Official health-professional evidence reference |
| `colorectal-cancer` | [Colon Cancer Treatment (PDQ®)–Patient Version](https://www.cancer.gov/types/colorectal/patient/colon-treatment-pdq) | 2025-05-16 | Official patient educational evidence reference |
| `prostate-cancer` | [Prostate Cancer Treatment (PDQ®)–Health Professional Version](https://www.cancer.gov/types/prostate/hp/prostate-treatment-pdq) | 2025-05-14 | Official health-professional evidence reference |

The current official pages, their **Latest Updates**, **Purpose of This Summary**, and **Permission to Use This Summary** sections were inspected on 2026-10-10. The colon update describes statistics and an added fruquintinib subsection, the rectal update similarly describes statistics and fruquintinib, and the prostate update describes editorial changes. These are the page dates shown; they were not replaced by the access date or called 2026 clinical revisions. No separate correction notice was presented in the retrieved update sections. The selected passages do not depend on the unimported new-drug details.

All four documents permit attributed free-text excerpts under the same NCI policy and whole-summary identity restrictions discussed above. Their exact URLs and source organization/kind are represented in `/workspace/scratch/6a873f63b964/gap-work/federal-oncology-rights.json` for the parent to merge into the canonical document policy. No complete summary, media, proprietary source article, borrowed examination item or endorsement is imported.

### Content and question boundaries

**Colorectal** has 10 excerpts, with site and stage in the title/locator. An auxiliary patient-summary excerpt covers stage 0 mucosal scope, and another preserves the stage-IV metastatic distinction. Health-professional colon excerpts cover limited excision with clear margins; stage III nodal involvement, wide surgical resection and postoperative adjuvant-treatment options; and the absence of a standard routine adjuvant-radiation role after curative resection while preserving the residual-disease exception. Rectal excerpts separately cover tumor location/stage/high-risk features in surgical choice and total neoadjuvant therapy for **most locally advanced patients without distant metastases**. The record does not extend colon treatment conclusions to rectal disease. Its 4 original questions assess an adjuvant discussion for stage III colon disease, correction of universal post-curative radiation claims, site-specific locally advanced rectal sequencing, and an appropriately selected stage 0 local-removal option.

**Prostate** has 8 excerpts. They preserve selection by age, concomitant illness, expected survival and preference; the limits of noncontrolled selected-series survival observations; the possible observation option for asymptomatic older/comorbid patients; watchful-waiting palliative intent versus active surveillance's retained future curative intent; selection for surgery; and possible urinary/sexual morbidity. Its 4 original questions assess that surveillance distinction, the individualized observation discussion, shared treatment choice without claimed equivalence, and recognition of possible postoperative urinary/sexual effects without an individual causal diagnosis.

Every question supplies five choices, one keyed answer, original explanatory text, a rationale for every distractor, explicit section IDs and source IDs covering both the correct answer and distractor reasoning. Explanations rebut unsupported categorical choices by the cited section's scope rather than inventing alternate medical facts. These are original educational application questions, not released ABFM questions, calibrated board difficulty, a validated competency measure or clinician approval.

### Remaining limits and evidence

The new records are `official-clinical-reference` only and add **no formal-guideline disease count**. They do not make the oncology curriculum complete. Missing areas include full colorectal diagnosis and staging, screening and survivorship schedules, regimen selection/dosing and biomarker-specific advanced therapy; full prostate staging/grade groups, screening/biopsy criteria, surveillance intervals, individualized risk models and advanced-disease therapy. Broad first-line claims remain unsupported outside the imported scope.

The longest new oncology source excerpt is 673 characters. Local structural validation checked schema parsing, unique question/section IDs, bounds, source/section integrity, five choices, valid keyed answers, all four distractor rationales and complete citation coverage. Parent loader/bank tests and independent editorial/clinical review remain necessary. No existing question or date was mutated and no paid model, provider, deployment or store operation was performed.


### Source conflict excluded instead of silently resolved

The health-professional colon summary’s stage 0 introductory prose says there is no lamina-propria invasion, while its separately credited/reprinted AJCC staging table describes Tis with lamina-propria involvement. The contradictory introduction and the copyrighted AJCC table were **not imported**. The basic mucosal description instead comes from the separately permission-checked NCI Patient Version, updated 2025-05-16. The question states stage 0 as the supplied classification and tests the unambiguous limited-surgery option; it does not test the disputed histological wording. A separate patient-summary passage distinguishes metastatic disease as stage IV, and the stage III vignette explicitly includes no distant metastases. This keeps the simplified node-positive sentence from being treated as a complete staging algorithm.
