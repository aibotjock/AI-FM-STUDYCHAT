# Commercial reference research and source registry

Checked **2026-10-10 UTC** (October 9, 2026 in America/New_York). This is a metadata and rights audit. It adds no clinical facts, source passages, questions, ingestion approvals, or executed licenses. The companion registry is `content/source-registry.json`.

## Decision and scope

Build breadth from individually reviewed federal documents and exact permissively licensed publications. Seek custom rights for protected professional-society guidance where it adds necessary diagnostic or treatment depth. Public access, society membership, institutional subscriptions, government hosting and a citation are not themselves commercial AI licenses.

All **47 registry records** retain `commercialCorpusUseApproved: false` and `aiProcessingApproved: false`. A permissive license or public-domain candidate identifies a route to review; it does not show that the app has already performed the document-level rights, corrections, clinical and source-integrity review needed for import. No source request has been sent and no fee or contract has been accepted.

Training a model and retrieving passages into a model context are different activities. A training restriction is recorded as such; it is not silently expanded into, or treated as permission for, RAG. Several publishers explicitly restrict AI input or response generation as well as conventional reproduction. A commercial RAG agreement should cover storage, chunking and embeddings, retrieval, processing by the selected external provider, permitted quotations and transformations, subscriber text/audio outputs, original study-question creation, territory, duration, monthly updates and deletion on termination. Logos, endorsement and third-party figures require separate consideration.

## Requested societies

| Source | Useful study coverage | Current commercial/AI finding | Verified policy and route |
| --- | --- | --- | --- |
| AAFP | Broad family medicine diagnosis, treatment, prevention, endorsement and disagreements | Written commercial reuse permission; unauthorized AI training expressly restricted | [Licensing](https://www.aafp.org/about-site/using-aafp-content/permissions), [terms](https://www.aafp.org/about-site/terms-of-use). Long-term/multiple use: `contentlicensing@aafp.org`; one-time: `copyrights@aafp.org`. |
| AAN | Neurologic diagnosis and treatment; clinician/patient tools | No blanket commercial AI grant | [Guideline permissions](https://www.aan.com/practice/what-are-clinical-practice-guidelines/): published guidelines to Neurology publisher; derivative tools to `guidelines@aan.com`. |
| AAOS | Musculoskeletal diagnosis, treatment, rehabilitation and referral | Written permission required; current 2025 rotator-cuff PDF explicitly covers retrieval storage | [Terms](https://www.aaos.org/about/meet-aaos/aaos-policies/organizational-policies/website-disclaimer/terms-of-use/), [2025 PDF](https://www.aaos.org/globalassets/quality-and-practice-resources/rotator-cuff/rotator-cuff-2025/rotator-cuff-cpg.pdf). `orthoguidelines@aaos.org`; wider commercial requests: `legal@aaos.org`. |
| AAP | Pediatric diagnosis, treatment, development and prevention | Custom integration rights needed; ordinary journal permissions do not grant portions of text and generally exclude full-text third-party reposting | [Licensing and permissions](https://publications.aap.org/pages/licensing-permissions): `permissions@aap.org`; ordinary journal reuse through CCC. Access subscriptions do not establish RAG rights. |
| ACC | Cardiovascular diagnosis, treatment and prevention | Commercial consent required; unapproved systematic database retrieval and automated crawlers restricted | [Terms](https://www.acc.org/footer-pages/terms-and-conditions): ACC Member Care. Joint ACC/AHA and third-party ownership reviewed separately. |
| ACOG | Obstetrics, gynecology, pregnancy and prevention | Explicitly restricts generative-AI training **and LLM response generation**; exclude from processing pending express authorization | [Terms](https://www.acog.org/legal/terms-of-use), [permissions](https://www.acog.org/legal/permissions-information). Direct fetch blocked; official indexed policy text reviewed. [WKH route](https://shop.lww.com/journal-permission): `publication@acog.org` for bulletins/statements/guidelines/opinions. |
| ACP | Adult diagnosis, treatment, screening and chronic disease | Commercial permission required unless an exact document license establishes an exception | [ACP permissions](https://www.acponline.org/clinical-information/journals-publications/reprints-e-prints-toll-free-links-and-permissions): Annals RightsLink or `permissions@acponline.org`. MKSAP access does not license question-bank copying. |
| ACS—College of Surgeons | Surgery, trauma and perioperative study | Express authorization required for third-party AI integration and revenue-generating/derivative content | [ACS content-use policy](https://www.facs.org/about-acs/content-use/): official request form. Accreditation-related internal-use exception does not cover this app. |
| ACS—Cancer Society | Cancer screening, prevention and survivorship | Ordinary permissions policy excludes commercial use, electronic formats and adaptations | [Content policy](https://www.cancer.org/about-us/policies/content-usage.html): `permissionrequest@cancer.org`. A separately suitable grant would be required; no approval presumed. |
| ADA—Diabetes Association | Diagnosis, treatment, monitoring, complications and special populations | Dedicated AI-content licensing policy; standard access insufficient | [AI licensing](https://diabetesjournals.org/journals/pages/ai_content_licensing_policy_and_terms), [reuse](https://diabetesjournals.org/journals/pages/license): `permissions@diabetes.org`. Direct AI-policy fetch blocked; official indexed metadata reviewed. |
| AHA/ASA | Cardiology, stroke, prevention and resuscitation | AHA permissions needed for guideline/scientific-statement reuse | [Permissions](https://www.heart.org/en/about-us/statements-and-policies/copyright-permission-guidelines), [copyright](https://www.heart.org/en/about-us/statements-and-policies/copyright), [journal rights](https://www.ahajournals.org/permissions-rights). General noncommercial presentation permission is insufficient. |
| APA—Psychiatric Association | Psychiatric diagnosis, treatment, monitoring and safety | Express written permission required to input APA content into generative AI or machine learning | [Resource-document notice](https://www.psychiatry.org/psychiatrists/search-directories-databases/resource-documents): `contracts@psych.org`. This is the Psychiatric Association, not the Psychological Association. |
| ASCO | Oncology treatment, supportive care and survivorship | General commercial permission route; only specific verified CC-BY documents are separate candidates below | [ASCO copyright](https://www.asco.org/about-asco/legal/copyright-permission), [publisher permissions](https://ascopubs.org/about/permissions): `permissions@asco.org` or article RightsLink. |
| CMSS | Evidence quality, guideline development and conflicts of interest | Rights unresolved; no umbrella license to member-society content | [Professional standards](https://cmss.org/programs-and-resources/professional-standards/), [contact](https://cmss.org/contact-us/). Methodology support, not condition-level treatment guidance. |
| IDSA | Infection diagnosis, treatment, antimicrobials and special populations | No blanket commercial grant; website terms restrict scraping/mining | [Guideline catalog](https://www.idsociety.org/practice-guideline/all-practice-guidelines/), [terms](https://www.idsociety.org/link/b2335d30fd854d2fa562016520dfc7cc.aspx). Review society and journal rights per document. |
| NCCN | Oncology diagnosis, screening, treatment and survivorship | Commercial AI licensing candidate; no rights granted to StudyChat | [Permissions](https://www.nccn.org/about/permissions/), [EULA](https://www.nccn.org/Store/EULA/Default.aspx) were observed but direct access failed/current full terms unverified. [JNCCN360 disclaimer](https://jnccn360.org/disclaimer/) explicitly requires written authorization for use/copy/distribution. |

## Federal and public-domain candidates

| Source | Recommended role | Exact rights boundary |
| --- | --- | --- |
| CDC clinical pages and MMWR | Infection diagnosis/treatment; vaccination; contraception; public-health recommendations | [MMWR about](https://www.cdc.gov/mmwr/about.html) identifies the series as public domain. [Agency materials policy](https://www.cdc.gov/other/agencymaterials.html) has attribution, nonendorsement, free-original, currency and substantive-reproduction conditions; third-party/international distinctions remain. Review exact items. |
| VA/DoD Clinical Practice Guidelines | Detailed chronic disease, mental health, sleep and musculoskeletal diagnosis/treatment/follow-up | [Catalog](https://www.healthquality.va.gov/guidelines/), [VA copyright policy](https://department.va.gov/copyright-policy/). Government-produced works may be public domain; assigned rights and third-party/joint content require exact PDF review. |
| NIDDK | Diabetes, endocrine, gastrointestinal, kidney and urologic explanations and selected professional material | [Copyright](https://www.niddk.nih.gov/copyright): individual page and credited-content review. Education pages are not comprehensive prescribing guidelines. |
| NIAMS | Rheumatology, musculoskeletal and skin background | [Disclaimer](https://www.niams.nih.gov/disclaimer): item-specific exceptions and attribution review. |
| NHLBI | Pulmonary, sleep, cardiovascular and hematology background and selected formal guidelines | [Reuse/branding policy](https://www.nhlbi.nih.gov/about/contact/trademark-branding-and-logo): text generally reusable after item review; marks and third-party materials are separate. |
| NLM MedlinePlus selected summaries | Broad explanations of diseases, medical tests and genetics | [Use policy](https://medlineplus.gov/about/using/usingcontent/): selected NLM summaries are public-domain candidates. Exclude A.D.A.M. encyclopedia, ASHP drug information, credited images, RSS and linked external content without their rights. |
| HHS Clinicalinfo HIV | Detailed HIV treatment, prophylaxis and special-population guidance | [Guidelines](https://clinicalinfo.hiv.gov/en/guidelines/): exact rights unresolved. Federal hosting does not establish blanket clearance. Adult opportunistic-infection October 1, 2026 update is a freshness lead. |
| NCI PDQ | Oncology health-professional evidence summaries | [Reuse policy](https://www.cancer.gov/policies/copyright-reuse): PDQ-specific quotation/attribution rules and third-party images need review. Evidence summaries must not be relabeled formal clinical practice guidelines. |
| PMC Open Access Subset | Individual primary studies, systematic reviews and eligible guidelines | [Copyright](https://pmc.ncbi.nlm.nih.gov/about/copyright/), [text-mining access](https://pmc.ncbi.nlm.nih.gov/tools/textmining/): repository availability is insufficient. Advance exact suitable CC-BY, CC0 or public-domain items, not NC/ND or manuscripts by default. |
| USPSTF/AHRQ | Screening, prevention and counseling | Existing registry restriction preserved: [copyright notice](https://www.uspreventiveservicestaskforce.org/uspstf/recommendation-topics/copyright-notice) requires express AHRQ permission for profit-making reuse. Government association is not blanket app clearance. |

## Exact permissive-license candidates

These are six **individual documents**, not six cleared corpora. Selected original teaching and eighteen questions were subsequently integrated after document-level license/correction checks; see [licensed-document expansion](LICENSED_GUIDELINE_EXPANSION.md). Cervical secondary prevention is limited to abstract-supported context, and UK/resource-constrained items remain comparative. This catalog contains links and rights metadata rather than source passages. Qualified clinical review, broader rights clearance and commercial activation remain pending.

| Exact document | License identified | Required scope/correction treatment |
| --- | --- | --- |
| [WikiGuidelines urinary tract infection consensus](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2825634) | CC-BY | Review linked corrections, including 2026; preserve population and setting scope. |
| [WikiGuidelines adult pyogenic osteomyelitis consensus](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2792124) | CC-BY | Adult scope and current corrections; not falsely identified as an IDSA guideline. |
| [WikiGuidelines infective endocarditis consensus](https://jamanetwork.com/journals/jamanetworkopen/fullarticle/2807791) | CC-BY | Incorporate October 2023 dosing-unit correction in any approved version. |
| [ASCO secondary prevention of cervical cancer update](https://ascopubs.org/doi/10.1200/GO.22.00217) | CC-BY 4.0 | Resource-stratified international guidance; preserve setting qualifiers. |
| [ASCO metastatic breast cancer resource-stratified guideline](https://ascopubs.org/doi/10.1200/GO.23.00285) | CC-BY 4.0 | Preserve resource strata; companion Q&A can be CC-BY-NC-ND and is excluded. |
| [2024 UK osteoporosis guideline, published September 8, 2025](https://link.springer.com/article/10.1007/s11657-025-01588-3) | CC-BY 4.0 | UK supplemental guidance; never silently default U.S. board recommendations. |

[CC-BY 4.0 terms](https://creativecommons.org/licenses/by/4.0/) do not grant trademarks or automatically clear third-party material. Specific document licenses should remain attached to their exact editions and corrected source spans.

## Additional specialty catalogs

| Catalog | Field | Rights stage |
| --- | --- | --- |
| [KDIGO](https://kdigo.org/guidelines/) | Nephrology | Case-by-case permission review; [FAQ](https://kdigo.org/faqs/). |
| [ATS](https://site.thoracic.org/clinicians-researchers/clinical-practice-guidelines-statements-reports) | Pulmonary | Exact guideline/society/publisher rights unresolved. |
| [CHEST](https://www.chestnet.org/guidelines-and-topic-collections/guidelines) | Pulmonary, thrombosis, critical care | Exact guideline/society/publisher rights unresolved. |
| [GINA](https://ginasthma.org/reports/) | Asthma | Express permission route; [legal policy](https://ginasthma.org/legal-policy/). |
| [GOLD](https://goldcopd.org/) | COPD | Express permission route; [legal policy](https://goldcopd.org/legal-policy/). |
| [ACG](https://gi.org/guidelines/) and [AGA](https://gastro.org/clinical-guidance/) | Gastroenterology | Catalog-only; each publication license still unresolved. |
| [Endocrine Society](https://www.endocrine.org/clinical-practice-guidelines) | Endocrinology | Guidelines explicitly offered among [licensable products](https://www.endocrine.org/products-and-services/licensing); no agreement executed. |
| [ACR—Rheumatology](https://rheumatology.org/clinical-practice-guidelines) | Rheumatology | Exact guideline/publisher rights unresolved; distinct from Radiology. |
| [ASCCP](https://www.asccp.org/management-guidelines/) | Cervical screening abnormalities | Commercial rights review required; [personal-use site terms](https://www.asccp.org/about/online-terms-and-conditions/). |

## Freshness and commercial integrity

An old official page can cite a retired recommendation. In particular, the CDC 2024 pediatric UTI summary cites retired 2011 AAP guidance; the [current AAP UTI guideline landing page](https://www.aap.org/en/patient-care/urinary-tract-infection-clinical-practice-guideline/) must be checked against any new pediatric UTI material. Do not substitute a historic formal guideline simply because its URL still works.

For each eventual condition, track separate diagnostic, treatment, monitoring, complication, prevention and special-population coverage. A large list of URLs does not establish that those questions are supported by retrieved source spans. Keep missing coverage explicit and prioritize the user questions that currently fail. Monthly maintenance must inspect replacements, corrections, withdrawals and changed licensing terms; scheduled checks alone do not prove that a source was actually updated.

## Schema compatibility and handoff

The original six source IDs and the top-level `sources` array are preserved. Existing `id`, `organization`, `title`, `url`, `role`, `rightsStatus`, approval booleans, `rightsUrl` and `notes` remain. New optional fields describe specialties, study coverage, record type, date, rights-review stage, additional policy URLs, corrections and applicability. `rightsUrl: null` is used only for new records with unresolved exact rights policies, avoiding invented URLs; such records remain unapproved. Existing string-valued rights URLs were not changed to null.

This audit did not change clinical datasets, runtime, prompts, tests, credentials, deployment or git. The parent integration task owns structural validation and publication. A metadata record can never be treated as server-authorized approval for text or speech.
