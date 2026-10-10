# MedlinePlus breadth: exact summary-text reuse audit

Checked: **2026-10-10**. Scope: **U.S. commercial study-product text reuse**, separate from clinical review, licensing of other publishers, regulatory status, endorsement, or app-store release.

## What was imported

- **93 existing disease-condition records** receive supplementary reference passages; no duplicate disease records or new questions are created.
- **406 bounded sections** from **89 distinct MedlinePlus health-topic summary documents**. Maximum section size: **1,544 characters**; maximum addition per condition: **9 sections**.
- **11 conditions already using the same MedlinePlus topic URL** are deliberately omitted from this expansion.
- **11 other conditions** do not receive excerpts after matching/source checks; they are listed below rather than filled from an unrelated topic, questionable paragraph or licensed encyclopedia.
- Selected health-topic summary text only, with tags removed and whitespace normalized. The stored text is an exact public-domain excerpt, labeled `public-domain-text-excerpt`; it is not falsely labeled an original paraphrase.
- No A.D.A.M. encyclopedia article, ASHP medication monograph, linked external clinical article, image, video, logo, RSS feed, or complete XML dataset is included.

## Primary-source permission and attribution

[MedlinePlus content-use policy](https://medlineplus.gov/about/using/usingcontent/) explicitly identifies summaries on health-topic pages, medical-test information and genetics summaries as public-domain information under U.S. law. It permits reproduction and redistribution and requests attribution. It separately identifies A.D.A.M., ASHP and most images as copyrighted. This expansion uses only the first category.

Every selected source stores **Source: MedlinePlus, National Library of Medicine.** The application must display this attribution with the relevant source citation. It must not imply NLM endorsement, copy NLM branding or frame MedlinePlus pages under the application domain. No third-party material is authorized by this audit.

[XML download documentation](https://medlineplus.gov/xml.html) documents downloadable health-topic records, including the full summary. [XML element definitions](https://medlineplus.gov/xmldescription.html) distinguish `full-summary` from linked `site` records. [Web-service documentation](https://medlineplus.gov/about/developers/webservices/) states that the service is free and requires no registration or licensing; it requires attribution and limits requests to 85 per minute per IP. A single compressed download was used here, avoiding repeated condition-level requests.

## Snapshot and exact passage provenance

| Field | Value |
|---|---|
| Source XML | [https://medlineplus.gov/xml/mplus_topics_2026-10-09.xml](https://medlineplus.gov/xml/mplus_topics_2026-10-09.xml) |
| Compressed download | [https://medlineplus.gov/xml/mplus_topics_compressed_2026-10-09.zip](https://medlineplus.gov/xml/mplus_topics_compressed_2026-10-09.zip) |
| Feed generation date/time | `2026-10-09T02:30:36`; NLM provides no timezone |
| Retrieval/policy check | `2026-10-10` |
| English topics in downloaded snapshot | `1017` |
| Uncompressed dataset SHA-256 | `67d0603b2cf72783b95c8784f2771cd9040dabb769e071e1998c71081b2842d2` |
| Imported XML element | `health-topic/full-summary` only |
| Publication/revision date | Not supplied by the feed; `publishedDate` and `summaryRevisionDate` remain null |
| Topic creation date | Preserved as `topicCreatedAt`; never treated as the date of medical revision |

Each source records its NLM topic ID, topic creation date, snapshot URL and full-summary HTML SHA-256. Each section records exact zero-based normalized paragraph/list block indices and its excerpt SHA-256. Formatting normalization adds list bullets and paragraph breaks but does not write new medical claims. Complete paragraphs/lists remain intact; an oversized block is omitted instead of truncating its qualifiers. Tables are excluded because flattening columns can change threshold meaning.

New-source `checkedAt` does not advance an existing condition review date, expiry, question text, rationale, source binding or question fingerprint. The host adapter must preserve those existing identities. A reference-module refresh must invalidate or rebind only the affected excerpt versions and must not silently renew old reviews.

## Clinical limits and exclusions

MedlinePlus summaries add explanatory breadth and relevant supported passages. They are **official clinical references, not formal clinical-practice guidelines**. The source metadata explicitly forbids inferring first-line drug choice, dose, current immunization criteria, a complete diagnostic algorithm or subtype-specific management from an undifferentiated treatment list. No medical-expert review or complete factual-accuracy guarantee has been performed. Whole-reply independent source checks remain required.

Specific source wording with unresolved, overly broad, or potentially misleading clinical implications was excluded before incorporation:

| Topic ID | Topic/exclusion |
|---|---|
| 1656 | Entire brief plague summary excluded: low-value historical framing, overspecific rat-bite transmission and an unresolved bubonic-organ description add no needed depth over current CDC plague guidance. |
| 6417 | NLM single-dose trichomoniasis treatment wording conflicts with current CDC women's 7-day regimen. The entire treatment subsection is excluded; CDC remains regimen authority. |
| 3101 | Do not import age/product-specific RSV prevention wording; the summary's vaccine/antibody framing is not used as a current schedule. |
| 34 | Exclude the blood-pressure category/crisis table; its crisis conjunction can be misread. Diagnosis thresholds/emergency criteria must come from the dedicated current guideline. |
| 273 | Exclude the categorical tension-headache tight-muscle causal explanation. Keep general headache warning and differentiation background only. |
| 404 | Exclude conversion-to-bacterial and undifferentiated antibiotic/imaging wording. CDC remains authority for bacterial diagnostic criteria and antibiotic selection. |
| 421 | Exclude the broad group-A spontaneous-resolution wording; do not weaken CDC treatment recommendations for confirmed GAS pharyngitis. |
| 214 | Exclude broad probiotic/antibiotic language; detailed selection and uncomplicated-disease management need the disease-specific guideline. |
| 3 | The source covers all breast cancer; do not imply that generic surgery/prevention text establishes metastatic treatment choices or a current screening schedule. |
| 6248 | Exclude broad blood-thinner wording that does not establish reperfusion eligibility, timing or antithrombotic selection. |
| 2 | Generic daily-controller and thermoplasty wording is not a current step-treatment algorithm; NHLBI guideline passages remain the treatment authority. |
| 363 | Broad bacterial/fungal antibiotic wording is not used for regimen selection; dedicated pneumonia guideline remains the treatment authority. |
| 6175 | Exclude nonspecific imaging/radioiodine-uptake diagnostic list, which does not establish appropriate routine hypothyroidism evaluation. |
| 6177 | Exclude treatment block with categorical radioiodine other-tissue safety wording and incomplete special-population contraindications. |
| 90 | Do not use broad antiviral-PHN-prevention or vaccination wording as a current treatment/schedule rule; dedicated CDC/source guidance remains authority. |
| 272 | Do not treat unspecified school exclusion policies as evidence-based no-nit rules. Current CDC guidance remains authority for school return. |
| 4964 | General procedures do not establish risk-specific anticoagulation, pacemaker indications or prophylactic antiarrhythmic use. Dedicated guideline remains authority. |

These exclusions are passage exclusions, not a claim that NLM has withdrawn a topic. Source hierarchy still matters: a current detailed CDC or other verified formal guideline supplies regimen, eligibility, dose, timing and special-population distinctions. The application must never complete missing facts from an unsourced model response.

Some mapped topics are deliberately broader than the host condition (for example RSV for bronchiolitis, general UTI for pediatric UTI/cystitis/pyelonephritis, glaucoma for its subtypes, and hyperglycemia for DKA). Their source-specific `limitations` restrict applicability. A passage about one subtype or population cannot establish another subtype's treatment.

## Condition-to-document mapping

"Scoped background" means the topic is broader than the host condition and its narrower applicability is recorded explicitly. A direct topic match still does not establish full guideline coverage.

| Existing condition ID | NLM topic ID | Summary document | Added sections | Match scope |
|---|---|---|---:|---|
| `abnormal-uterine-bleeding` | `4875` | [Vaginal Bleeding](https://medlineplus.gov/vaginalbleeding.html) | 1 | Scoped background |
| `polycystic-ovary-syndrome` | `5912` | [Polycystic Ovary Syndrome](https://medlineplus.gov/polycysticovarysyndrome.html) | 5 | Direct condition/topic |
| `endometriosis` | `243` | [Endometriosis](https://medlineplus.gov/endometriosis.html) | 5 | Direct condition/topic |
| `pelvic-inflammatory-disease` | `3044` | [Pelvic Inflammatory Disease](https://medlineplus.gov/pelvicinflammatorydisease.html) | 5 | Direct condition/topic |
| `preeclampsia` | `1508` | [High Blood Pressure in Pregnancy](https://medlineplus.gov/highbloodpressureinpregnancy.html) | 6 | Direct condition/topic |
| `vulvovaginal-candidiasis` | `6417` | [Vaginitis](https://medlineplus.gov/vaginitis.html) | 6 | Scoped background |
| `bacterial-vaginosis` | `6417` | [Vaginitis](https://medlineplus.gov/vaginitis.html) | 6 | Scoped background |
| `trichomoniasis` | `4325` | [Trichomoniasis](https://medlineplus.gov/trichomoniasis.html) | 1 | Direct condition/topic |
| `syphilis` | `3017` | [Syphilis](https://medlineplus.gov/syphilis.html) | 1 | Direct condition/topic |
| `genital-herpes` | `5863` | [Genital Herpes](https://medlineplus.gov/genitalherpes.html) | 1 | Direct condition/topic |
| `attention-deficit-hyperactivity-disorder` | `152` | [Attention Deficit Hyperactivity Disorder](https://medlineplus.gov/attentiondeficithyperactivitydisorder.html) | 6 | Direct condition/topic |
| `bronchiolitis` | `3101` | [Respiratory Syncytial Virus Infections](https://medlineplus.gov/respiratorysyncytialvirusinfections.html) | 6 | Scoped background |
| `croup` | `6292` | [Croup](https://medlineplus.gov/croup.html) | 1 | Direct condition/topic |
| `pediatric-urinary-tract-infection` | `448` | [Urinary Tract Infections](https://medlineplus.gov/urinarytractinfections.html) | 1 | Scoped background |
| `iron-deficiency-anemia` | `139` | [Anemia](https://medlineplus.gov/anemia.html) | 1 | Scoped background |
| `anaphylaxis` | `6257` | [Anaphylaxis](https://medlineplus.gov/anaphylaxis.html) | 1 | Direct condition/topic |
| `syncope` | `1481` | [Fainting](https://medlineplus.gov/fainting.html) | 1 | Direct condition/topic |
| `thermal-burns` | `176` | [Burns](https://medlineplus.gov/burns.html) | 1 | Scoped background |
| `herpes-zoster` | `90` | [Shingles](https://medlineplus.gov/shingles.html) | 5 | Direct condition/topic |
| `tobacco-use-disorder` | `1359` | [Quitting Smoking](https://medlineplus.gov/quittingsmoking.html) | 3 | Direct condition/topic |
| `scabies` | `1254` | [Scabies](https://medlineplus.gov/scabies.html) | 1 | Direct condition/topic |
| `pediculosis-capitis` | `272` | [Head Lice](https://medlineplus.gov/headlice.html) | 5 | Direct condition/topic |
| `tinea-corporis` | `1228` | [Tinea Infections](https://medlineplus.gov/tineainfections.html) | 1 | Scoped background |
| `asthma` | `2` | [Asthma](https://medlineplus.gov/asthma.html) | 5 | Direct condition/topic |
| `copd` | `27` | [COPD](https://medlineplus.gov/copd.html) | 8 | Direct condition/topic |
| `community-acquired-pneumonia` | `363` | [Pneumonia](https://medlineplus.gov/pneumonia.html) | 7 | Scoped background |
| `acute-bronchitis` | `5755` | [Acute Bronchitis](https://medlineplus.gov/acutebronchitis.html) | 1 | Direct condition/topic |
| `bacterial-rhinosinusitis` | `404` | [Sinusitis](https://medlineplus.gov/sinusitis.html) | 1 | Scoped background |
| `streptococcal-pharyngitis` | `421` | [Streptococcal Infections](https://medlineplus.gov/streptococcalinfections.html) | 6 | Scoped background |
| `influenza` | `299` | [Flu](https://medlineplus.gov/flu.html) | 7 | Direct condition/topic |
| `allergic-rhinitis` | `4746` | [Hay Fever](https://medlineplus.gov/hayfever.html) | 1 | Direct condition/topic |
| `tuberculosis` | `41` | [Tuberculosis](https://medlineplus.gov/tuberculosis.html) | 7 | Direct condition/topic |
| `acute-otitis-media` | `115` | [Ear Infections](https://medlineplus.gov/earinfections.html) | 1 | Direct condition/topic |
| `gastroesophageal-reflux-disease` | `512` | [GERD](https://medlineplus.gov/gerd.html) | 6 | Direct condition/topic |
| `peptic-ulcer-h-pylori` | `6078` | [Helicobacter pylori Infections](https://medlineplus.gov/helicobacterpyloriinfections.html) | 1 | Direct condition/topic |
| `irritable-bowel-syndrome` | `614` | [Irritable Bowel Syndrome](https://medlineplus.gov/irritablebowelsyndrome.html) | 1 | Direct condition/topic |
| `chronic-constipation` | `200` | [Constipation](https://medlineplus.gov/constipation.html) | 1 | Scoped background |
| `acute-gastroenteritis` | `3056` | [Gastroenteritis](https://medlineplus.gov/gastroenteritis.html) | 7 | Direct condition/topic |
| `acute-diverticulitis` | `214` | [Diverticulosis and Diverticulitis](https://medlineplus.gov/diverticulosisanddiverticulitis.html) | 9 | Direct condition/topic |
| `appendicitis` | `1223` | [Appendicitis](https://medlineplus.gov/appendicitis.html) | 1 | Direct condition/topic |
| `hepatitis-c` | `1286` | [Hepatitis C](https://medlineplus.gov/hepatitisc.html) | 7 | Direct condition/topic |
| `hepatitis-b` | `1687` | [Hepatitis B](https://medlineplus.gov/hepatitisb.html) | 9 | Direct condition/topic |
| `hiv` | `1` | [HIV](https://medlineplus.gov/hiv.html) | 7 | Direct condition/topic |
| `chlamydia` | `1307` | [Chlamydia Infections](https://medlineplus.gov/chlamydiainfections.html) | 8 | Direct condition/topic |
| `gonorrhea` | `3019` | [Gonorrhea](https://medlineplus.gov/gonorrhea.html) | 1 | Direct condition/topic |
| `migraine` | `3157` | [Migraine](https://medlineplus.gov/migraine.html) | 6 | Direct condition/topic |
| `tension-headache` | `273` | [Headache](https://medlineplus.gov/headache.html) | 1 | Scoped background |
| `ischemic-stroke` | `6248` | [Ischemic Stroke](https://medlineplus.gov/ischemicstroke.html) | 5 | Direct condition/topic |
| `benign-positional-vertigo` | `216` | [Dizziness and Vertigo](https://medlineplus.gov/dizzinessandvertigo.html) | 4 | Scoped background |
| `major-depression` | `113` | [Depression](https://medlineplus.gov/depression.html) | 7 | Direct condition/topic |
| `generalized-anxiety-disorder` | `144` | [Anxiety](https://medlineplus.gov/anxiety.html) | 8 | Scoped background |
| `bipolar-disorder` | `600` | [Bipolar Disorder](https://medlineplus.gov/bipolardisorder.html) | 8 | Direct condition/topic |
| `post-traumatic-stress-disorder` | `367` | [Post-Traumatic Stress Disorder](https://medlineplus.gov/posttraumaticstressdisorder.html) | 8 | Direct condition/topic |
| `opioid-use-disorder` | `6431` | [Opioids and Opioid Use Disorder (OUD)](https://medlineplus.gov/opioidsandopioidusedisorderoud.html) | 5 | Direct condition/topic |
| `chronic-insomnia` | `6055` | [Insomnia](https://medlineplus.gov/insomnia.html) | 6 | Direct condition/topic |
| `obstructive-sleep-apnea` | `2784` | [Sleep Apnea](https://medlineplus.gov/sleepapnea.html) | 1 | Direct condition/topic |
| `acute-low-back-pain` | `157` | [Back Pain](https://medlineplus.gov/backpain.html) | 1 | Scoped background |
| `osteoarthritis` | `1250` | [Osteoarthritis](https://medlineplus.gov/osteoarthritis.html) | 6 | Direct condition/topic |
| `osteoporosis` | `37` | [Osteoporosis](https://medlineplus.gov/osteoporosis.html) | 7 | Direct condition/topic |
| `rheumatoid-arthritis` | `1232` | [Rheumatoid Arthritis](https://medlineplus.gov/rheumatoidarthritis.html) | 6 | Direct condition/topic |
| `acne-vulgaris` | `124` | [Acne](https://medlineplus.gov/acne.html) | 1 | Direct condition/topic |
| `atopic-dermatitis` | `1215` | [Eczema](https://medlineplus.gov/eczema.html) | 1 | Direct condition/topic |
| `psoriasis` | `373` | [Psoriasis](https://medlineplus.gov/psoriasis.html) | 1 | Direct condition/topic |
| `osteomyelitis` | `5739` | [Bone Infections](https://medlineplus.gov/boneinfections.html) | 1 | Direct condition/topic |
| `infective-endocarditis` | `4316` | [Endocarditis](https://medlineplus.gov/endocarditis.html) | 8 | Direct condition/topic |
| `metastatic-breast-cancer` | `3` | [Breast Cancer](https://medlineplus.gov/breastcancer.html) | 7 | Scoped background |
| `retinal-detachment` | `6141` | [Retinal Detachment](https://medlineplus.gov/retinaldetachment.html) | 1 | Direct condition/topic |
| `primary-open-angle-glaucoma` | `42` | [Glaucoma](https://medlineplus.gov/glaucoma.html) | 6 | Scoped background |
| `acute-angle-closure-glaucoma` | `42` | [Glaucoma](https://medlineplus.gov/glaucoma.html) | 6 | Scoped background |
| `cataract` | `116` | [Cataract](https://medlineplus.gov/cataract.html) | 7 | Direct condition/topic |
| `ankle-sprain` | `417` | [Sprains and Strains](https://medlineplus.gov/sprainsandstrains.html) | 1 | Scoped background |
| `hypertension` | `34` | [High Blood Pressure](https://medlineplus.gov/highbloodpressure.html) | 5 | Direct condition/topic |
| `dyslipidemia` | `26` | [Cholesterol](https://medlineplus.gov/cholesterol.html) | 7 | Direct condition/topic |
| `type-2-diabetes` | `5930` | [Diabetes Type 2](https://medlineplus.gov/diabetestype2.html) | 7 | Direct condition/topic |
| `prediabetes` | `5784` | [Prediabetes](https://medlineplus.gov/prediabetes.html) | 6 | Direct condition/topic |
| `type-1-diabetes` | `1339` | [Diabetes Type 1](https://medlineplus.gov/diabetestype1.html) | 7 | Direct condition/topic |
| `hypoglycemia` | `1264` | [Hypoglycemia](https://medlineplus.gov/hypoglycemia.html) | 7 | Direct condition/topic |
| `diabetic-ketoacidosis` | `6125` | [Hyperglycemia](https://medlineplus.gov/hyperglycemia.html) | 8 | Scoped background |
| `hypothyroidism` | `6175` | [Hypothyroidism](https://medlineplus.gov/hypothyroidism.html) | 6 | Direct condition/topic |
| `hyperthyroidism` | `6177` | [Hyperthyroidism](https://medlineplus.gov/hyperthyroidism.html) | 6 | Direct condition/topic |
| `thyroid-nodule` | `439` | [Thyroid Diseases](https://medlineplus.gov/thyroiddiseases.html) | 1 | Scoped background |
| `obesity` | `61` | [Obesity](https://medlineplus.gov/obesity.html) | 5 | Direct condition/topic |
| `stable-coronary-artery-disease` | `1276` | [Coronary Artery Disease](https://medlineplus.gov/coronaryarterydisease.html) | 9 | Scoped background |
| `heart-failure` | `199` | [Heart Failure](https://medlineplus.gov/heartfailure.html) | 8 | Direct condition/topic |
| `atrial-fibrillation` | `4964` | [Atrial Fibrillation](https://medlineplus.gov/atrialfibrillation.html) | 6 | Direct condition/topic |
| `deep-vein-thrombosis` | `1683` | [Deep Vein Thrombosis](https://medlineplus.gov/deepveinthrombosis.html) | 1 | Direct condition/topic |
| `pulmonary-embolism` | `377` | [Pulmonary Embolism](https://medlineplus.gov/pulmonaryembolism.html) | 7 | Direct condition/topic |
| `chronic-kidney-disease` | `5987` | [Chronic Kidney Disease](https://medlineplus.gov/chronickidneydisease.html) | 1 | Direct condition/topic |
| `nephrolithiasis` | `1224` | [Kidney Stones](https://medlineplus.gov/kidneystones.html) | 1 | Direct condition/topic |
| `uncomplicated-cystitis` | `448` | [Urinary Tract Infections](https://medlineplus.gov/urinarytractinfections.html) | 1 | Scoped background |
| `pyelonephritis` | `448` | [Urinary Tract Infections](https://medlineplus.gov/urinarytractinfections.html) | 1 | Scoped background |
| `benign-prostatic-hyperplasia` | `6196` | [Enlarged Prostate (BPH)](https://medlineplus.gov/enlargedprostatebph.html) | 9 | Direct condition/topic |
| `gout` | `264` | [Gout](https://medlineplus.gov/gout.html) | 6 | Direct condition/topic |

## Deliberately omitted conditions

| Existing condition ID | Reason |
|---|---|
| `plague` | No eligible complete bounded paragraphs remained after exclusions. |
| `tularemia` | No conservative, condition-specific match selected from the English health-topic full-summary feed. |
| `menopausal-symptoms` | This exact MedlinePlus topic URL already exists in the condition corpus; duplicate expansion omitted. |
| `cervical-dysplasia` | No conservative, condition-specific match selected from the English health-topic full-summary feed. |
| `gestational-diabetes` | This exact MedlinePlus topic URL already exists in the condition corpus; duplicate expansion omitted. |
| `ectopic-pregnancy` | This exact MedlinePlus topic URL already exists in the condition corpus; duplicate expansion omitted. |
| `vitamin-b12-deficiency` | No conservative, condition-specific match selected from the English health-topic full-summary feed. |
| `pressure-injury` | This exact MedlinePlus topic URL already exists in the condition corpus; duplicate expansion omitted. |
| `epididymitis` | No conservative, condition-specific match selected from the English health-topic full-summary feed. |
| `covid-19` | The matching current feed record contains no full-summary; external linked material was not substituted. |
| `otitis-externa` | No conservative, condition-specific match selected from the English health-topic full-summary feed. |
| `acute-cholecystitis` | No conservative, condition-specific match selected from the English health-topic full-summary feed. |
| `transient-ischemic-attack` | This exact MedlinePlus topic URL already exists in the condition corpus; duplicate expansion omitted. |
| `epilepsy` | This exact MedlinePlus topic URL already exists in the condition corpus; duplicate expansion omitted. |
| `alzheimer-dementia` | This exact MedlinePlus topic URL already exists in the condition corpus; duplicate expansion omitted. |
| `delirium` | This exact MedlinePlus topic URL already exists in the condition corpus; duplicate expansion omitted. |
| `alcohol-use-disorder` | This exact MedlinePlus topic URL already exists in the condition corpus; duplicate expansion omitted. |
| `carpal-tunnel-syndrome` | This exact MedlinePlus topic URL already exists in the condition corpus; duplicate expansion omitted. |
| `cellulitis` | This exact MedlinePlus topic URL already exists in the condition corpus; duplicate expansion omitted. |
| `hypertensive-emergency` | No conservative, condition-specific match selected from the English health-topic full-summary feed. |
| `acute-coronary-syndrome` | No conservative, condition-specific match selected from the English health-topic full-summary feed. |
| `acute-kidney-injury` | No conservative, condition-specific match selected from the English health-topic full-summary feed. |

## Maintenance and commercialization boundary

On each monthly maintenance run, discover the latest file through the official XML landing page, download one compressed snapshot, select these exact topic IDs and only `full-summary`, recheck the use policy, compare summary hashes, and review changed or newly conflicting passages before activation. Missing summaries, failed retrieval, changed rights or unresolved conflicts must fail closed. A new feed timestamp establishes retrieval provenance, not a medical update date or expert validation.

The runtime should load only selected excerpts and retrieve relevant chunks; the full dataset and intermediate extraction files stay outside the repository. The immutable rights registry uses an exact document URL, explicit organization/kind, the NLM policy URL and a 5,000-word budget per topic. That budget is a conservative application bound, not a copyright restriction on the public-domain text.

This audit allows U.S. reuse of the selected NLM-authored text and supports continued commercial development. It does not authorize commercial reuse of the rest of the legacy corpus, grant international rights, establish medical-product regulatory compliance, approve clinical use, or certify exam content. StudyChat remains an independent family-medicine board-study tool, not medical advice or clinical software.

## Independent editorial exclusions before integration (2026-10-10)

An engineering editorial review compared all 420 candidate summary passages with current primary guidance. It excluded source-original conflicting statements, incomplete lists and poorly matched subtype content. This is not physician approval. Exact retained paragraphs are not rewritten; original summary hashes remain unchanged and selected block indices/excerpt hashes record omissions. The final module contains 406 sections.

| Condition | Section | Action |
|---|---|---|
| `polycystic-ovary-syndrome` | `medlineplus-5912-6` | section omitted |
| `endometriosis` | `medlineplus-243-5` | section omitted |
| `pelvic-inflammatory-disease` | `medlineplus-3044-6` | section omitted |
| `preeclampsia` | `medlineplus-1508-2` | section omitted |
| `herpes-zoster` | `medlineplus-90-2` | section omitted |
| `pediculosis-capitis` | `medlineplus-272-5` | section omitted |
| `copd` | `medlineplus-27-7` | complete blocks omitted: 16 |
| `acute-bronchitis` | `medlineplus-5755-1` | complete blocks omitted: 4 |
| `peptic-ulcer-h-pylori` | `medlineplus-6078-1` | complete blocks omitted: 4,5 |
| `peptic-ulcer-h-pylori` | `medlineplus-6078-2` | section omitted |
| `hepatitis-c` | `medlineplus-1286-7` | section omitted |
| `hepatitis-b` | `medlineplus-1687-5` | complete blocks omitted: 9 |
| `hiv` | `medlineplus-1-8` | section omitted |
| `chlamydia` | `medlineplus-1307-6` | section omitted |
| `migraine` | `medlineplus-3157-7` | section omitted |
| `major-depression` | `medlineplus-113-2` | section omitted |
| `chronic-insomnia` | `medlineplus-6055-2` | section omitted |
| `prediabetes` | `medlineplus-5784-5` | section omitted |
| `gout` | `medlineplus-264-2` | complete blocks omitted: 4 |

Reasons: acute HCV treatment deferral; incomplete chlamydia/PID and HBV screening qualifiers; PrEP formulation restriction; acute-bronchitis antibiotic implication; shingles transmission omission; lice diagnosis ambiguity; endometriosis surgery-only diagnosis; butterbur safety; one-month chronic-insomnia definition; incorrect A1c inequality; incorrect pseudogout crystal; broad depression taxonomy applied to MDD; orphaned PCOS/preeclampsia/COPD/H. pylori lists; H. pylori therapy generalized to all ulcers; chronic glaucoma care mapped to an acute emergency.

Primary verification: [CDC HCV](https://www.cdc.gov/hepatitis-c/hcp/clinical-care/index.html), [CDC STI screening](https://www.cdc.gov/std/treatment-guidelines/screening-recommendations.htm), [CDC HBV 2023](https://www.cdc.gov/mmwr/volumes/72/rr/rr7201a1.htm), [CDC PrEP](https://www.cdc.gov/hivnexus/hcp/prep/index.html), [CDC bronchitis](https://www.cdc.gov/acute-bronchitis/about/index.html), [CDC shingles](https://www.cdc.gov/shingles/about/index.html), [CDC lice](https://www.cdc.gov/lice/about/head-lice.html), [ACOG endometriosis 2026 announcement](https://www.acog.org/news/news-releases/2026/02/acog-publishes-new-endometriosis-clinical-guidance-aiming-shorten-time-diagnosis-improve-access-care), [NCCIH headaches](https://www.nccih.nih.gov/health/headaches-what-you-need-to-know), [NHLBI insomnia](https://www.nhlbi.nih.gov/health/insomnia), [NIDDK A1c](https://www.niddk.nih.gov/health-information/diagnostic-tests/a1c-test), [NLM MeSH pseudogout](https://www.ncbi.nlm.nih.gov/mesh/D002805), [NIDDK ulcer treatment](https://www.niddk.nih.gov/health-information/digestive-diseases/peptic-ulcers-stomach-ulcers/treatment). These checks do not authorize importing protected guideline text from the verification pages.
