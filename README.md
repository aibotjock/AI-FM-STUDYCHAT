# Family Medicine Study Coach

**Release preparation, with store submission on hold.** The personal prototype is on `main`; `release/google-play-preparation` adds commercial safeguards and Android source for review. The first milestone is a private phone test. The paid medical product is not ready for public distribution: the rights-cleared clinical corpus is empty, email verification/recovery and operator workflows need implementation, and real billing/native/clinical validation remain outstanding.

The planned price is **US$4.99/month after a three-day trial for eligible new subscribers**. Google Play owns trial eligibility and billing; this app never starts a local trial timer or unlocks access from a client assertion. Clients use our server's AI integration without supplying their own API keys.

See [release plan](docs/RELEASE_PLAN.md), [security status](docs/SECURITY.md), [clinical content requirements](docs/CLINICAL_CONTENT.md), [subscription economics](docs/ECONOMICS.md), [phone trial](docs/PHONE_TEST.md), and [Android preparation](docs/ANDROID_RELEASE.md).

## Commercial private-pilot preparation

Select `APP_MODE=commercial` to use separate account workspaces, verified Play entitlements, cost reservations, reports, and account deletion. `PRIVATE_PILOT=true` can allow private testing without a purchase only when `PUBLIC_RELEASE=false`. It is not a free trial or a customer subscription. `PUBLIC_RELEASE=true` is deliberately refused by this scaffold.

Internet-accessible commercial pilots require an exact HTTPS `APP_ORIGIN` and a long `PILOT_INVITE_TOKEN` for registration. Store those in host settings. Real billing also requires `GOOGLE_SERVICE_ACCOUNT_JSON` and a separate base64-encoded 32-byte `BILLING_TOKEN_ENCRYPTION_KEY`. Set `COMMERCIAL_OPENAI_MODEL` independently of the personal prototype model; changing it requires matching cost rates and repeat validation.

Commercial clinical answers use only eligible, current, reviewed teaching evidence and server-supplied citations. With the checked-in empty corpus they abstain rather than fall back to ungrounded medical answers. Supported outputs reproduce reviewed teaching text, with optional fixed recall prompts. These controls do not prove correctness or relevance; independent clinical evaluation remains required.

The shared-token personal mode described below stays available for the owner's first phone trial. Its AI answers and user cards are unverified. Never share that workspace among paying clients.

A phone-first family medicine study app rebuilt from **Residency-Coach-AI**. Chat with a Socratic coach, practice complex cases, turn lessons into editable retrieval cards, and review them on a spaced schedule. The interface works on phones and desktops and supports home-screen installation over HTTPS.

The defaults follow the requested preferences: **clinical reasoning**, **guided questions**, **18 minutes daily**, and **five new cards per day**.

## Start locally

Requires **Node.js 24 or later**. There are no runtime npm dependencies and no build step.

```bash
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000`. Without an API key, the app explicitly offers guided reasoning worksheets, card reviews, and manual cards. It does not pretend to generate AI answers.

For conversational coaching, set `OPENAI_API_KEY` in `.env` or your host's secret settings and restart. The key stays on the server. `OPENAI_MODEL` is configurable; the default is `gpt-4.1-mini`. ChatGPT subscriptions do not supply an API key for this app. API usage is billed by the provider; this repository does not purchase subscriptions or provision paid services.

## Use on your phone

**From anywhere:** deploy this repository to a Node/Docker host with HTTPS. A Dockerfile and Railway configuration are included. On the deployed URL, sign in with your study access token, then open **Coach**. On Android Chrome, choose **Add to Home screen** or **Install app**. On iPhone Safari, use **Share → Add to Home Screen**.

**On your home Wi-Fi:** run the app on a computer on the same network, set `HOST=0.0.0.0` and a strong `STUDY_ACCESS_TOKEN` in `.env`, and open `http://<computer-LAN-IP>:3000` on your phone. Allow the port through the computer's firewall only on your private network. The computer must remain running. HTTPS is required for full home-screen installation and browser microphone support; phone keyboard dictation can still be used.

Generate a study access token locally:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the value in `.env` or host secrets and use it on the app's sign-in screen. Do not commit it. A host reachable from another device is refused without a token. Each deployment is a **single-user personal workspace**; everyone with that token sees the same study data.

### Railway deployment

1. Connect `aibotjock/AI-FM-STUDYCHAT` to a Railway service.
2. Set `HOST=0.0.0.0`, `STUDY_ACCESS_TOKEN`, and `OPENAI_API_KEY` in service variables. Leave `PORT` to the platform.
3. Attach a **persistent volume at `/app/data`** and set `DATA_DIR=/app/data`. The volume is necessary to preserve reviews and conversations across redeployments.
4. Generate an HTTPS service domain, wait for a healthy deployment, and open that URL on your phone.
5. Sign in and add the app to the home screen.

A private Railway test project, service and 500 MB volume have been prepared. The public repository is accessible; the initial deployment exposed a volume ownership issue. A bounded container initializer fixes only the data mount, drops all root identities/capabilities, and starts the app as UID/GID 1000. Persistent root execution was rejected by automatic review and was not enabled. See [hosting status](docs/HOSTING.md) for live verification status.

## Study workflow

- **Coach:** ask a question or describe a de-identified fictional case. The coach asks one question at a time, works on synthesis and differential reasoning, and receives your recent difficult review topics. Conversations are saved. You can create and revisit separate sessions.
- **Cases:** twelve scenarios: eight retained from the uploaded app and four new reasoning exercises. Connected AI can roleplay and debrief. Offline mode provides a clearly labeled worksheet rather than simulated AI feedback.
- **Review:** attempt an answer before revealing it, then rate **Again / Hard / Good / Easy**. The app shows the next interval, prioritizes due learning and review cards, and limits new introductions. Repeated misses flag cards for revision.
- **Cards:** create, search, edit, suspend, and delete cards. AI-generated cards appear as drafts for review and approval; they are never automatically treated as verified medical facts. Source titles and links are editable. You can create a card manually from a coach answer.
- **Progress:** review counts, study activity, streaks based on actual reviews, difficult topics, and self-rated recall. Six competency ratings are learner reflections, not official ACGME milestone evaluations.
- **Settings:** change focus, coaching style, session length, new-card limit, timezone, and voice controls. Export and restore JSON backups, or import a JSON card list with `front` and `back` fields.

Microphone dictation and reading answers aloud use supported browser speech APIs. Dictation is browser-dependent and may use the browser vendor's service. Text chat and your phone's keyboard remain available. There is no separate Realtime voice-model connection or audio-storage feature.

The service worker caches only the public app shell. It never caches API responses, conversations, or study records. Reviewing and chatting require the backend connection; cached shell availability does not mean study data is synchronized offline.

## Scheduling

The scheduler is a transparent **SM-2-inspired heuristic**, not FSRS and not a prediction of individual retention:

- A new card rated Good returns in one day; a subsequent Good returns in six days. Later intervals grow with its ease factor.
- Again returns in ten minutes, resets successful repetitions, and brings the card back to a one-day graduation interval after relearning.
- Hard on a new or relearning card returns in thirty minutes. On review cards it grows more slowly than Good.
- Easy never schedules earlier than Good. All intervals are capped at 365 days.
- Due cards precede new cards. The new-card cap counts unique first reviews within the learner's chosen timezone.
- Recall percentages summarize self-ratings, not verified knowledge, exam readiness, or clinical competence.

Spaced and retrieval practice have supporting education evidence. The evidence does not establish this app's exact intervals as optimal:

- Trumble et al., systematic review of distributed and retrieval practice in health professions education: https://pubmed.ncbi.nlm.nih.gov/37615780/
- Family medicine study of spaced repetition and transfer using ABFM CKSA: https://pubmed.ncbi.nlm.nih.gov/39250798/

## Data and security

SQLite stores study records in `DATA_DIR/studychat.sqlite`. It uses WAL and full synchronization. Back up through **Settings → Export backup**, and keep the JSON file somewhere private. Exported backups include conversations and learning data, never the API key or access token.

The workspace has a 16 MiB backup limit; growth beyond that budget is rejected without changing saved data. Export and archive old conversations as needed. Additional upper limits are 10,000 cards, 100,000 reviews, 500 conversations, and 1,000 messages per conversation; the storage budget can be reached sooner.

Remote access uses a shared secret and an HttpOnly, SameSite session cookie. On HTTPS, cookies are marked Secure. Origin validation, JSON-only writes, request limits, login throttling, source-URL validation, and per-conversation locks protect the personal workspace. Expiring in-memory sessions require another sign-in after server restart. This is not a multi-user service, an EHR, or a repository for patient-identifying data.

## Accuracy boundaries

The coach has **no live web retrieval or verified guideline corpus**. It is instructed to flag uncertainty and never invent citations, official scores, or PGY requirements. You should check factual clinical cards against current authoritative references before marking them reviewed. Educational case feedback is not evidence of readiness for independent clinical practice.

The rebuild preserves the source app's simulation concepts and six competency domains, corrects the MMR case title and teach-back exercise, and replaces its Replit/Clerk/PostgreSQL setup with one portable Node process and SQLite. The uploaded source did not supply saved conversations; the separate `conversations.json` contained `[]`. Historical mobile AsyncStorage records are not migrated by this rebuild.

## Verify

```bash
npm run check
npm test
```

Tests cover review timing and daily limits, timezone boundaries and DST streaks, auth and request guards, durable data, atomic backups, chat retries and concurrency, and mocked AI-provider success/failure. Live provider access requires a configured API key and is a separate verification step.

JavaScript/asset, guideline-schema, billing-bridge and automated integration checks are included. Fresh mobile browser checks at 360 × 800 passed the personal study workflow and commercial account, pilot, subscription-details and deletion flows. Those checks use local test servers and synthetic data. A physical phone, live OpenAI connection, actual Play purchase, Kotlin compilation and signed AAB remain unverified. Test microphone permissions and home-screen installation on the real HTTPS URL.

## Files

- `public/`: responsive interface, install manifest, and shell-only service worker
- `server/`: HTTP API, SQLite persistence, authentication, coach prompts, provider integration
- `shared/`: scheduling and adapted educational content
- `tests/`: deterministic scheduler and integration tests
- `Dockerfile`, `compose.yaml`, `railway.json`: deployment options

Official API references: https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create and https://developers.openai.com/api/docs/models/gpt-4.1-mini.
