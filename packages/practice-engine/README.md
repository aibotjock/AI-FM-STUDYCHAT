# Isolated question practice engine

Extracted from AI-FM-STUDYCHAT commit f4b20414d337230f4d90a3c8a14656c3922f5ff1. No npm dependencies, build step, AI requests, RAG, HTTP server or database. Run on the host server so answer keys remain private. The existing ABFM blueprint is retained; this version is a medical-study engine rather than a generic exam engine.

```js
import { readFileSync } from 'node:fs';
import { createBoardPractice, createQuestionBankCurriculum } from './practice-engine/index.js';
const bank = JSON.parse(readFileSync('questions/medical-question-bank.json', 'utf8'));
const engine = createBoardPractice({ curricula: [createQuestionBankCurriculum(bank)] });
const state = {}; // Host loads and saves this per learner.
const session = engine.start(state, { count: 20 });
const feedback = engine.answer(state, { sessionId: session.sessionId, questionKey: session.question.key, choiceId: 'A' });
```

Supports mixed blueprint-weighted, domain, missed, weak-domain and fresh-topic practice; immediate/end feedback; optional timers; saved sessions; results; learning priorities; and bounded unverified history imports. `view` exposes no answer keys before grading. Never send the raw bank to the learner client. The adapter copies and fingerprints content once, resolves questions through a Map and checks review expiry at use time. Expired material is excluded; refreshing dates requires actual source rechecking by the host.

Run `node --test practice-engine/tests/*.test.js` from the repository root. Three extraction tests exercise the actual 558-item U.S. bank, session allocation, answer-safe presentation, grading, timer expiry, source expiry, caller mutation and untrusted imports. Eight comparative items remain in the bank but do not enter board practice.

The engine retains the existing selection/reporting logic and a small bank adapter; it does not import StudyChat's clinical retrieval/validation pipeline. It is not clinical certification or a complete exam syllabus. Host authorization, canonical content review, persistence and deployment remain host responsibilities. No license grant or commercial activation approval is added.
