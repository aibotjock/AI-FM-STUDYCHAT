# Incorporated study material

Inventory and official-source currency check: **October 9, 2026**. This describes the checked-in material supplied to a new study space; personal cards, restored backups, and subsequent coaching conversations can add to it.

The current phone pilot contains **105 curated family medicine conditions, 210 original board-style questions, 12 fictional cases, 12 starter recall cards, and six skill-reflection areas**. The new condition library uses original short teaching summaries linked to actually checked official sources. Each question has five choices, a canonical answer, an explanation, explanations for the other four choices and supporting sources. These are original educational items, not official ABFM questions. Source checks are automated editorial work; independent clinician review and a clinical accuracy benchmark remain pending.

Open **Library → Guidelines & boards** to search conditions, read sections, inspect source editions/check dates/jurisdictions and answer questions. Save a question to **Review** for spaced repetition or open its condition in **Coach** for source-supported follow-ups. The text RAG selects known reference sections and renders canonical text/citations; unsupported details abstain. Voice remains generated speech and is not validated by that text constraint. The whole app is labeled **study use only, not medical advice**.

The four 25-condition groups cover cardiometabolic/renal/urologic disease; respiratory/infectious/gastrointestinal disease; neurologic/psychiatric/musculoskeletal/skin disease; and reproductive/pediatric/hematologic/urgent conditions. Five additional modules cover tobacco use disorder, epididymitis, scabies, head lice and tinea corporis. In total, 100 conditions have formal guideline or official recommendation evidence; five retain clearly labeled official-reference gaps. See [the complete condition inventory](CONDITION_COVERAGE.md), [RAG design and limits](GUIDELINE_RAG.md), `content/curriculum-manifest.json` and the four source-audit reports for exact coverage. Formal guidelines, official recommendations and official reference-only gaps are distinguished. This is a curated high-yield selection, not an established prevalence ranking or a full reproduction of 100 guidelines.

## Cases available in Library

| Case | Category | Practice focus | Approximate minutes |
| --- | --- | --- | ---: |
| Angry Patient — Delayed Referral | Difficult Conversations | Empathy, accountability, de-escalation, follow-through | 10 |
| Opioid Refill Request | Substance Use | Respectful discussion of pain, uncertainty, and concerning patterns | 12 |
| MMR Vaccine Hesitancy | Preventive Care | Listening to concerns and explaining evidence respectfully | 10 |
| Type 2 Diabetes — Treatment Concerns | Chronic Disease Management | Explore treatment beliefs and shared decisions | 12 |
| Complex Discharge — Low Health Literacy | Care Coordination | Clear explanations and checking understanding | 10 |
| Goals of Care Discussion | Palliative / End of Life | Values, prognosis conversations, and care preferences | 15 |
| Receiving Critical Feedback from an Attending | Professionalism | Receive feedback and commit to a specific improvement | 8 |
| Difficult Family Meeting | Family Dynamics | Facilitate disagreement and clarify care priorities | 15 |
| Dyspnea with Competing Explanations | Clinical Reasoning | Urgency, problem representation, competing explanations | 15 |
| Confusion after a Medication Change | Clinical Reasoning | Safety, medication reconciliation, and avoiding anchoring | 15 |
| A Complex Patient in 60 Seconds | Clinical Reasoning | Prioritize active problems and communicate a concise handoff | 10 |
| Revisit the First Diagnosis | Clinical Reasoning | Update the differential when new findings conflict | 12 |

Eight cases focus on communication, care coordination, or professionalism; four focus explicitly on reasoning. Case observations, patient histories, and medication lists are fictional scenario details. They are not prescribing recommendations. AI debriefs are educational feedback, not official ACGME milestone ratings or assessments of clinical competence.

## Starter cards and review

| Topic | Starter cards |
| --- | ---: |
| Problem representation | 2 |
| Differential diagnosis | 2 |
| Diagnostic uncertainty | 1 |
| Prioritization | 1 |
| Safety netting | 1 |
| Handoffs | 1 |
| Communication / teach-back | 2 |
| Reflection | 1 |
| Learning skills | 1 |
| **Total** | **12** |

Ten cards are authored reasoning or learning exercises. Two teach-back cards use original summaries with links to [AHRQ's Use the Teach-Back Method, Tool 5](https://www.ahrq.gov/health-literacy/improve/precautions/tool5.html). That official page was available at this check and states a last review of April 2024. Its description continues to support asking patients to explain information in their own words and clarifying misunderstandings. A source-currency check does not constitute an independent clinician's approval of the cards.

The review scheduler uses Again, Hard, Good, and Easy ratings, short relearning steps, daily new-card limits, and later scheduled reviews. It is an SM-2-inspired educational heuristic; the app does not claim a validated retention probability. Learners can create or import cards, attach sources, edit or suspend them, and save card drafts from a coaching conversation. Generated drafts remain unverified until checked; a learner's verification checkbox does not publish clinician-reviewed guideline content.

## Skills and study preferences

Progress includes reflection on Patient Care, Medical Knowledge, Practice-Based Learning and Improvement, Interpersonal and Communication Skills, Professionalism, and Systems-Based Practice. Confidence choices describe the learner's own deliberate practice and are not official competency scores.

Study preferences provide clinical reasoning and synthesis, exam preparation, or balanced learning; coaching can ask one question at a time, explain before quizzing, or give direct explanations. Selecting exam preparation changes coaching emphasis. It does not unlock a licensed ABFM exam bank or a clinically validated mock examination.

## ABFM alignment and coverage limits

The curriculum metadata matches the official [ABFM blueprint](https://www.theabfm.org/family-medicine-exam-blueprint/) and the [2026 examination information booklet, printed page 36](https://www.theabfm.org/app/uploads/2025/10/2026-FMCE-Examination-Information-Booklet-v.1.0.pdf), checked October 9, 2026:

| Domain | Target weight |
| --- | ---: |
| Acute Care and Diagnosis | 35% |
| Chronic Care Management | 25% |
| Emergent and Urgent Care | 20% |
| Preventive Care | 15% |
| Foundations of Care | 5% |

These weights support planning original material and future benchmark allocation. The condition bank and twelve cases are not a complete or proportionally balanced examination syllabus. Conditions and questions carry domain metadata; actual bank domain counts appear in the curriculum manifest. The app is independent and does not claim ABFM endorsement, official exam questions, guaranteed accuracy, or guaranteed board passage.

`content/guidelines.json` contains **zero approved commercial teaching records** and remains separate from the populated personal educational corpus in `content/conditions/`. Registry links do not imply complete guideline ingestion or permissions. Commercial grounded coaching must decline unsupported clinical questions until eligible, rights-cleared, clinician-reviewed teaching records are supplied. The source-linked personal bank does not confer commercial rights or clinician approval.

## Monthly official-source maintenance

The maintenance interval is **once each calendar month**, with urgent safety changes reviewed as soon as identified. A scheduled source check and subsequent clinical approval are separate steps. See `content/source-checks.json` for the current observations and `docs/CLINICAL_CONTENT.md` for eligibility and release requirements.

The owner's scheduled task **Refresh Family Medicine sources** was created and enabled on October 9, 2026, then expanded to cover the full condition corpus. It starts November 1, 2026 and repeats on the first day monthly at 08:00 America/New_York in the configured morning window. It checks actual condition-specific official sources, replacements, editions, addenda, withdrawals, safety notices, conflicts and reuse policies. Verified source-supported original updates to the personal pilot can be published/deployed after affected checks, with clinician review still pending. Blocked or uncertain material is quarantined and reported. It does not approve the commercial corpus or authorize app-store publication. Task reference for operators: `6ac87ed8329c81918c3701660444bf86`.

1. Check the official ABFM blueprint/current booklet, AHRQ teach-back page, all condition-specific sources and applicable source/rights pages. Follow official replacement links and check final published editions, addenda, effective dates, withdrawals, endorsement changes and safety notices. Record unavailable or incomplete pages as blocked, not current. Do not refresh dates merely because a URL responds.
2. Compare those observations with the previous monthly manifest. Record the source URL, check date, displayed edition/date, affected app content, and the proposed action. Preserve enough editorial evidence to reproduce the comparison; do not ingest protected full text into a public repository or an AI corpus merely because it can be read online.
3. Correct affected original personal study material only where actually verified permitted official evidence supports the change. Preserve study-only labels, jurisdiction and pending clinician review. Automated research cannot supply clinician approval or grant a content license. A qualified clinician must verify claims, populations, exceptions, contraindications and conflicts, and rights approval must cover the proposed use before commercial activation.
4. Withhold affected published teaching records while a clinically important conflict or change is unresolved. Expired rights and review dates already make guideline records ineligible. Record corrections or withdrawals, preserve learner review history, and make revisions visible; do not overwrite personal cards silently.
5. Run only checks affected by changed content, source metadata, prompts, retrieval or models. Regenerate the integrity manifest/coverage after a completed corpus revision and update the validation ledger. Publish verified personal educational revisions through GitHub and the existing private Railway pilot, observing deployment SUCCESS. Keep commercial approval separate. App-store submission still requires the owner's explicit permission.

The initial source checks expire November 9, 2026. If monthly maintenance fails or evidence is unresolved, the retrieval layer stops treating expired material as current. The bank covers selected teaching points, not every dosage, exception or newly published recommendation. Formal-source gaps and excluded documents appear in the audits and app. The registry's October 9 USPSTF landing-page error and CDC/AAFP immunization conflicts remain separate observations; no blanket immunization schedule has been silently imported or adjudicated.
