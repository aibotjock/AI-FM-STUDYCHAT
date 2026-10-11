# CDC treatment expansion: clinical authoring pilot

Checked **2026-10-10**. File: `content/conditions/treatment_expansion.json`. Source check expires **2026-11-09**. This addition contains two new conditions, 20 original sourced study sections and eight original hypothetical five-choice questions. It does not change existing condition records or claim to complete the entire treatment curriculum.

Every record remains `humanReviewed: false`. Source verification, public-domain reuse status and independent clinical/commercial approval are different decisions. These records are study content, not medical advice, clinical software, official ABFM questions or an ABFM endorsement. No clinician identity or clinical approval is invented. `commercialClinicalApproval: false` is explicit. No content was added to the separate commercial clinical corpus.

## Sources actually read

1. CDC, [Antimicrobial Treatment and Prophylaxis of Plague: Recommendations for Naturally Acquired Infections and Bioterrorism Response](https://www.cdc.gov/mmwr/volumes/70/rr/rr7003a1.htm), MMWR Recommendations and Reports, July 16, 2021; 70(3):1–27. Primary article text and relevant table categories were read directly on 2026-10-10.
2. CDC, [Tularemia Antimicrobial Treatment and Prophylaxis: CDC Recommendations for Naturally Acquired Infections and Bioterrorism Response — United States, 2025](https://www.cdc.gov/mmwr/volumes/74/rr/rr7402a1.htm), MMWR Recommendations and Reports, October 2, 2025; 74(2):1–33. Primary article recommendations, Box summary and relevant table categories were read directly on 2026-10-10.

These are CDC clinical guidelines, not third-party commercial summaries. Rights metadata records the source-specific [MMWR public-domain policy](https://www.cdc.gov/mmwr/about.html); it is not an organization-wide permission claim for linked journal articles. Original summaries and original questions are retained. No source PDF, full text, copied table, logo, figure, third-party passage or ABFM question was imported. Originals remain freely available at the cited CDC URLs. CDC does not endorse this app or its content.

## Claim-to-locator ledger

The JSON also carries a `sourceLocator` for each section. Source URLs are exact canonical MMWR URLs, source IDs bind every section/question, and question `sectionIds` bind the supporting study passages.

| Condition / section | Exact official locator | Supported teaching boundary |
| --- | --- | --- |
| Plague / `recognition` | Introduction — Plague Pathogenesis and Clinical Manifestations; transmission, bubonic and pneumonic paragraphs | Organism, exposure routes, bubo, pulmonary symptoms and urgent treatment rationale; no diagnostic protocol or unsourced probability estimate. |
| Plague / `pneumonic-first-line` | Recommendations — Antimicrobial Treatment of Adults and Children; Table 1, Adults aged ≥18 years, First-line | Ciprofloxacin, levofloxacin, moxifloxacin, gentamicin and streptomycin are first-line adult options; no universally best drug or pregnancy/neonatal extrapolation. |
| Plague / `doxycycline-form-boundary` | Pneumonic and Septicemic Plague, doxycycline discussion; Bubonic and Pharyngeal Plague, opening/final paragraphs; Tables 1 and 2 | Doxycycline alternative in pneumonic/septicemic versus first-line in bubonic/pharyngeal; stable primary naturally acquired disease and progression modifiers. |
| Plague / `severe-dual-therapy` | Pneumonic and Septicemic Plague; mild-to-moderate naturally occurring and severe-disease paragraphs | Single-agent consideration in clearly naturally acquired mild-to-moderate disease; two distinct classes initially for severe disease; narrowing after improvement. |
| Plague / `uncertain-pneumonia` | Pneumonic and Septicemic Plague; uncertain diagnosis and levofloxacin/moxifloxacin paragraphs | Include community-acquired pneumonia coverage while diagnostic results are pending; no claim that every pneumonia is plague. |
| Plague / `duration-route` | Antimicrobial Treatment of Adults and Children, final route/duration paragraphs | General 10–14-day total course with possible extension, secondary-meningitis additional-course exception, severity/tolerance-based route and improvement-based oral transition; no doses. |
| Plague / `meningeal-exception` | Meningeal Plague; Table 3 and dual-therapy footnote | Chloramphenicol plus moxifloxacin/levofloxacin when possible; qualified source substitution if unavailable; no routine-bubonic extrapolation. |
| Plague / `transmission-precautions` | Introduction — Person-to-Person Transmission of Plague, opening paragraph | Pneumonic person-to-person spread through large droplets and droplet precautions; reported absence of evidence for measles-like airborne spread. |
| Plague / `postexposure-prophylaxis` | Antimicrobial Pre- and Postexposure Prophylaxis; close sustained contact, 7-day duration and protected-personnel paragraphs; Table 4 | Inadequately protected close sustained contact and specified other exposures; prevention versus symptomatic treatment; no blanket contact prophylaxis. |
| Plague / `pregnancy-boundary` | Special Populations — Pregnant Women, opening effectiveness/safety/evidence paragraphs; Table 5 | Indicated effective treatment should not be delayed solely by fetal safety concerns; limited evidence and pregnancy-specific selection retained. |
| Tularemia / `recognition` | Introduction, organism/exposure/clinical-manifestation paragraphs | Arthropod or tissue exposure, route-associated forms, systemic typhoidal disease; associations do not confirm infection. |
| Tularemia / `first-line-age-scope` | Box, Treatment recommendation for adults and children; Table 1 population categories | Four adult/≥1-month options; separate neonatal ≤28-day options; no extrapolation across age-boundary gap. |
| Tularemia / `forms-and-inactive-drugs` | Introduction, ineffective-class paragraph; Clinical Considerations, opening paragraph | Recommended options across common forms with meningitis exception; explicitly ineffective classes; no invented susceptibility-guided beta-lactam substitution. |
| Tularemia / `severe-infection` | Clinical Considerations, severe-infection and combination-evidence paragraphs | Consider initial aminoglycoside in severe disease; combination may be considered; evidence for improved outcomes is minimal, not established superiority. |
| Tularemia / `delayed-treatment` | Box delayed-treatment bullet; Clinical Considerations, delay discussion and Spain-outbreak conclusion | Delayed-treatment preference over doxycycline; >2-week bactericidal consideration; not a claim that doxycycline is universally ineffective. |
| Tularemia / `duration-transition` | Box duration bullet; Table 1 transition footnotes; persistent-fever and Neuroinvasive sections | General 10-day versus 14–21-day courses, extension caveat and improvement/defervescence-based transition; separate neuroinvasive duration. |
| Tularemia / `pregnancy` | Box, Treatment recommendation for pregnant women and PEP recommendation; Tables 2 and 3 | Pregnancy-specific first-line treatment and separate prophylaxis options; ordinary adult doxycycline category not transferred. |
| Tularemia / `neuroinvasive-exception` | Neuroinvasive Tularemia, final treatment paragraphs | Gentamicin plus ciprofloxacin/levofloxacin; qualified gentamicin/doxycycline alternative; observed ≥10-day aminoglycoside treatment and recommended 21-day total. |
| Tularemia / `updated-alternative-rank` | Changes and Updates to Previous Recommendations, items 3–5 | Current first-line additions and streptomycin's third-tier rank with stated reasons; no claim that third-tier means ineffective. |
| Tularemia / `postexposure-prophylaxis` | Box, Postexposure prophylaxis recommendation; Tables 2 and 3 | Pregnancy/age-scoped prevention options and agent-dependent duration; no blanket prophylaxis for every bite. |

## Original questions and supporting passages

| Question | Tested decision | Supporting section IDs |
| --- | --- | --- |
| `plague-q1` | Adult first-line pneumonic-plague category versus doxycycline alternative | `pneumonic-first-line`, `doxycycline-form-boundary`, `severe-dual-therapy` |
| `plague-q2` | Severe pneumonic-plague dual-class strategy and improvement-based narrowing | `severe-dual-therapy`, `doxycycline-form-boundary`, `postexposure-prophylaxis` |
| `plague-q3` | Unprotected sustained exposure: prophylaxis, not severe-infection treatment | `postexposure-prophylaxis`, `severe-dual-therapy` |
| `plague-q4` | Clinical-form-specific doxycycline rank | `doxycycline-form-boundary` |
| `tularemia-q1` | 2025 first-line set versus historical streptomycin framing | `first-line-age-scope`, `updated-alternative-rank`, `forms-and-inactive-drugs` |
| `tularemia-q2` | Delayed effective treatment changes drug preference | `delayed-treatment`, `first-line-age-scope`, `forms-and-inactive-drugs` |
| `tularemia-q3` | Severe-disease aminoglycoside consideration with honest combination-evidence limits | `severe-infection`, `forms-and-inactive-drugs`, `postexposure-prophylaxis` |
| `tularemia-q4` | Pregnancy-specific first-line treatment set | `pregnancy`, `forms-and-inactive-drugs` |

Each question has five original choices, one keyed answer, four distractor explanations and exact source/section bindings. Incorrect choices are teaching distractors, not approved instructions. Explanations avoid unsupported claims about absent drugs by saying they are not in the relevant first-line list when that is the sourced distinction.

## Currency, uncertainty and deferred approval

- Source article text and table categories were read on 2026-10-10. Targeted CDC searches for each exact MMWR report identifier plus “erratum” did not locate a correction notice. This bounded search is not proof that no correction can exist; recheck the live articles, CDC errata and clinical companion pages during monthly maintenance.
- The 2021 plague guideline is retained as the specific guideline read; checking it in 2026 does not change its publication year. Tularemia uses the 2025 update rather than the older 2001 recommendations. No newer edition is invented.
- Plague's pregnancy-prophylaxis narrative includes an apparent internal table-number cross-reference mismatch. No pregnancy-prophylaxis drug ranking was extracted from that ambiguous cross-reference. This pilot's pregnancy section uses the explicit treatment/effectiveness paragraphs and Table 5 boundary only.
- The tularemia Box defines one group as ≥1 month and neonates as ≤28 days. This pilot does not silently assign an unaddressed day-of-life boundary to either regimen. Use a source-confirmed age-specific recommendation before adding finer neonatal prescribing material.
- No doses, therapeutic-drug-monitoring protocol, patient-specific allergy substitution, full pregnancy/neonatal prescribing protocol, clinical diagnostic laboratory procedure or microbiological handling instruction is supplied. The study retrieval must withhold unsupported answers rather than extrapolate these gaps.
- Clinical fact authoring is not independent clinician validation. Independent fact review, structural/load checks, retrieval/reply checks and release verification are owned by the integrating engineer; this author did not run app tests or claim a pass.
- No earlier passed test was rerun, no runtime or paid model call was made, and existing condition files were left unchanged. The source-specific public-domain editorial allowance does not confer commercial clinical approval or permission for other documents hosted on the same organization domain.

Integration review: severe initial-management questions `plague-q2` and `tularemia-q3` are mapped to emergent/urgent care because the vignettes require time-sensitive severe-illness decisions. This is our primary-domain classification, not ABFM adjudication. The general plague-duration passage retains the separate secondary-meningitis additional-course exception.

Editorial budgets are bounded authoring checks, not copyright clearance or clinical review. The two exact public-domain MMWR reports allow up to 2,000 words of charged sections and full question text (stems, options and rationales) per URL. Existing concise-reference budgets retain their earlier section/correct-option/rationale accounting; they do not claim to measure every factual premise or grant commercial rights. When a passage cites multiple sources its entire counted text is charged to each URL, using the strictest budget associated with a repeated URL.
