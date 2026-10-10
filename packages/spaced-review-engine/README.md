# Spaced review engine

Standalone extraction of `shared/scheduler.js` from AI-FM-STUDYCHAT commit f4b20414d337230f4d90a3c8a14656c3922f5ff1. No runtime dependencies, framework, build step, AI calls, network, database or background service. Import it directly in a browser module or Node host; the host owns storage and UI.

```js
import { createCard, scheduleReview, getDueCards } from './packages/spaced-review-engine/index.js';
const card = createCard({ front: 'Question', back: 'Answer', topic: 'Your subject' });
const { card: updated, review } = scheduleReview(card, 'good');
// Persist updated and review in your host application.
const due = getDueCards([updated], { reviews: [review], newLimit: 5, timeZone: 'America/New_York' });
```

Exports card creation, Again/Hard/Good/Easy scheduling, due-card ordering, daily new-card limits, interval previews and review statistics. The original default topic remains for compatibility; supply your own topic for nonmedical applications. Existing scheduling behavior is unchanged. This is an SM-2-inspired heuristic, not FSRS, a retention prediction, mastery assessment or official exam score.

Run `node --test packages/spaced-review-engine/tests/*.test.js` from the repository root, or `npm test` in this package. Nine extracted tests cover intervals, relearning, due ordering, daily caps, local midnight, DST, interval bounds and invalid inputs. Modern browser/Node support for Web Crypto and Intl time zones is required. No license grant is added.
