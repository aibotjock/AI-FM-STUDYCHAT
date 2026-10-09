# Condition study-corpus authoring contract

This is an independent US family medicine educational curriculum, not an official prevalence ranking or ABFM question bank. Include at least 100 distinct diagnoses/conditions commonly encountered or important to family medicine boards. Screening topics can be additional material but do not substitute for the 100 diagnoses. No ABFM endorsement, copied exam questions, patient-care advice, clinician approval or guaranteed accuracy is implied.

Each `content/conditions/*.json` file contains `{ "schemaVersion": 1, "checkedAt": "2026-10-09", "conditions": [...] }`.

Each condition record follows this structure:

```json
{
  "id": "type-2-diabetes",
  "name": "Type 2 diabetes mellitus",
  "aliases": ["T2DM", "type 2 diabetes"],
  "specialty": "Cardiometabolic and renal",
  "domain": "chronic",
  "keywords": ["glycemia", "A1c"],
  "overview": "A short original description of this condition's study scope.",
  "review": {"kind": "automated-source-check", "humanReviewed": false, "checkedAt": "2026-10-09", "expiresAt": "2026-11-09"},
  "sources": [{
    "id": "source-stable-slug",
    "title": "Exact official publication/page title",
    "organization": "Official publishing organization",
    "url": "https://official.example/guideline-specific-page",
    "kind": "clinical-guideline",
    "edition": "Displayed guideline edition or page version; unknown when not stated",
    "publishedDate": null,
    "checkedAt": "2026-10-09",
    "locator": "Relevant recommendation/section",
    "reuse": "original-summary-no-full-text"
  }],
  "sections": [{"id": "diagnosis", "title": "Diagnostic approach", "text": "An original concise teaching summary supported by the indicated official source.", "sourceIds": ["source-stable-slug"]}],
  "questions": [{
    "id": "type-2-diabetes-q1",
    "stem": "An original hypothetical single-best-answer clinical vignette and question.",
    "choices": [{"id": "A", "text": "Choice"}, {"id": "B", "text": "Choice"}, {"id": "C", "text": "Choice"}, {"id": "D", "text": "Choice"}, {"id": "E", "text": "Choice"}],
    "correctChoiceId": "B",
    "explanation": "A concise original explanation supported by the sections.",
    "distractorExplanations": {"A": "Why this is less appropriate in this vignette.", "C": "Reason", "D": "Reason", "E": "Reason"},
    "sectionIds": ["diagnosis"],
    "sourceIds": ["source-stable-slug"],
    "domain": "acute",
    "learningObjective": "One bounded diagnostic or management distinction.",
    "difficulty": "application"
  }]
}
```

Use blueprint domain IDs `acute`, `chronic`, `emergent`, `preventive`, `foundations`. Source kinds are `clinical-guideline`, `official-recommendation`, or `official-clinical-reference`; distinguish a formal guideline from an official informational reference. Each condition needs at least one condition-specific formal guideline or official recommendation where available. If no formal guideline is available, label the official reference honestly and record the gap. Never claim an official reference is a guideline.

Supply at least three brief, distinct sourced sections and two original application questions per condition. Do not fabricate numeric thresholds, doses, age ranges, publication dates, source status or clinician identities. Check the actual official page or guideline, rather than relying only on search snippets. Prefer US federal and professional society primary sources; if supplementary non-US guidance is necessary, identify its jurisdiction and do not silently replace US recommendations. Evidence must directly support every keyed answer. Avoid underspecified vignettes with several equally valid answers. Each distractor explanation must match the vignette and make no unsupported clinical claim.

Summaries should be concise original teaching. Do not copy or extensively paraphrase protected full text. Observe per-source quotation and summarization limits across reused pages; use condition-specific guideline sections and multiple independent sources when needed. Retain links and locators, not scraped source documents. No commercial licensing or human clinical review is asserted by automated source verification. The approved commercial corpus and public/store release gates remain separate.

Source changes, conflicts and blocked pages must be visible in editorial evidence. All material is for study only and is not medical advice. The server should reject stale, withdrawn, unresolved-conflict or malformed records for grounded answers, grading and sourced-card saving.

## Additional common conditions

`content/conditions/common_additions.json` adds tobacco-use-disorder, epididymitis, scabies, pediculosis-capitis and tinea-corporis with the same original-summary/question schema. These are actual distinct diagnoses, not screening-only substitutes. The additional five keep formal guideline/recommendation coverage at least 100 without disguising the five reference-only gaps in the original selection.
