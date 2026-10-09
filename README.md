# Family Medicine Board Study

**Release preparation, with store submission on hold.** The personal prototype is on `main`; `release/google-play-preparation` adds commercial safeguards and Android source for review. The first milestone is a private phone test. The paid study product is not ready for public distribution: the rights-cleared clinical corpus is empty, email verification/recovery and operator workflows need implementation, and real billing/native/clinical validation remain outstanding.

The planned price is **US$4.99/month after a three-day trial for eligible new subscribers**. Google Play owns trial eligibility and billing; this app never starts a local trial timer or unlocks access from a client assertion. Clients use our server's AI integration without supplying their own API keys.

See [release plan](docs/RELEASE_PLAN.md), [security status](docs/SECURITY.md), [clinical content requirements](docs/CLINICAL_CONTENT.md), [subscription economics](docs/ECONOMICS.md), [phone trial](docs/PHONE_TEST.md), [validation status](docs/VALIDATION_STATUS.md), and [Android preparation](docs/ANDROID_RELEASE.md).

## Commercial private-pilot preparation

Select `APP_MODE=commercial` to use separate account workspaces, verified Play entitlements, cost reservations, reports, and account deletion. `PRIVATE_PILOT=true` can allow private testing without a purchase only when `PUBLIC_RELEASE=false`. It is not a free trial or a customer subscription. `PUBLIC_RELEASE=true` is deliberately refused by this scaffold.

Internet-accessible commercial pilots require an exact HTTPS `APP_ORIGIN` and a long `PILOT_INVITE_TOKEN` for registration. Store those in host settings. Real billing also requires `GOOGLE_SERVICE_ACCOUNT_JSON` and a separate base64-encoded 32-byte `BILLING_TOKEN_ENCRYPTION_KEY`. Set `COMMERCIAL_OPENAI_MODEL` independently of the personal prototype model; changing it requires matching cost rates and repeat validation.

Commercial clinical answers use only eligible, current, reviewed teaching evidence and server-supplied citations. With the checked-in empty corpus they abstain rather than fall back to ungrounded medical answers. Supported outputs reproduce reviewed teaching text, with optional fixed recall prompts. These controls do not prove correctness or relevance; independent clinical evaluation remains required.

The shared-token personal mode described below stays available for the owner's phone trial. Coach generates natural replies and subjects each draft to a separate automated source review before displaying it. Medical teaching must be supported by current retrieved study sources, with links supplied by the server. Automated review is not clinician approval or an accuracy guarantee. Personal and imported notes remain unverified. Never share that workspace among paying clients.

A phone-first family medicine study app rebuilt from **Residency-Coach-AI**. Talk with Coach about your learning goals, plan a study session, discuss cited condition summaries, answer original board-style questions in chat or weighted practice sessions, save questions as retrieval cards, and review them on a spaced schedule. The interface works on phones and desktops and supports home-screen installation over HTTPS.

The defaults follow the requested preferences: **clinical reasoning**, **guided questions**, **18 minutes daily**, and **five new cards per day**.

## Start locally

Requires **Node.js 24 or later**. There are no runtime npm dependencies and no build step.

```bash
cp .env.example .env
npm start
```

Open `http://127.0.0.1:3000`. Without an API key, the app explicitly offers guided reasoning worksheets, card reviews, and manual cards. It does not pretend to generate AI answers.

The current pilot uses **OpenAI only**; Claude remains inactive. Set `AI_PROVIDER=openai` and `OPENAI_API_KEY` in host secrets or local `.env`, then restart. `OPENAI_MODEL` sets the initial personal model; `COMMERCIAL_OPENAI_MODEL` controls commercial mode separately. The key stays on the server and is never used as the app's study access code. A ChatGPT subscription does not configure API credentials. Usage is billed to the operator's API account. There is no automatic retry or provider fallback. **Astra is prohibited at all times, with no exceptions.** See [AI setup and model controls](docs/AI_PROVIDERS.md).

## Use on your phone

**Private phone pilot:** open https://family-medicine-phone-test-private-test.up.railway.app and paste the `STUDY_ACCESS_TOKEN` value from Railway → `private-test` → `family-medicine-phone-test` → **Variables** into **Study access code**. Open **Coach**. The owner has already configured `OPENAI_API_KEY` on Railway; the owner confirmed phone sign-in and one genuine nonclinical READY request verified provider connectivity. Never enter that API key in the sign-in form. On Android Chrome, choose **Add to Home screen** or **Install app**. On iPhone Safari, use **Share → Add to Home Screen**. See [hosting status](docs/HOSTING.md) and the [phone checklist](docs/PHONE_TEST.md).

**On your home Wi-Fi:** run the app on a computer on the same network, set `HOST=0.0.0.0` and a strong `STUDY_ACCESS_TOKEN` in `.env`, and open `http://<computer-LAN-IP>:3000` on your phone. Allow the port through the computer's firewall only on your private network. The computer must remain running. HTTPS is required for full home-screen installation and browser microphone support; phone keyboard dictation can still be used.

Generate a study access token locally:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Keep the value in `.env` or host secrets and use it on the app's sign-in screen. Do not commit it. A host reachable from another device is refused without a token. Each deployment is a **single-user personal workspace**; everyone with that token sees the same study data.

### Railway deployment

1. Connect `aibotjock/AI-FM-STUDYCHAT` to a Railway service.
2. Set `HOST=0.0.0.0`, `STUDY_ACCESS_TOKEN`, `AI_PROVIDER=openai`, and `OPENAI_API_KEY` in service variables. Keep the study access code and API key separate. Leave `PORT` to the platform.
3. Attach a **persistent volume at `/app/data`** and set `DATA_DIR=/app/data`. The volume is necessary to preserve reviews and conversations across redeployments.
4. Generate an HTTPS service domain, wait for a healthy deployment, and open that URL on your phone.
5. Sign in and add the app to the home screen.

A private Railway test project, service and 500 MB volume are running. A bounded container initializer fixes only the data mount, drops all root identities/capabilities, and starts the app as UID/GID 1000; hosted logs confirmed this. See [hosting status](docs/HOSTING.md) for verification limits.

## Study workflow

- **Coach:** chat naturally about your day, learning goals or study difficulties; continue with a follow-up or ask a sourced study question. The selected OpenAI model writes a reply using bounded recent history and saved learning preferences. A second request reviews every paragraph for unsupported facts, source support and safety, pairing quoted claims with current immutable source-span IDs. The server checks those bindings and supplies the exact source excerpts before accepting it. A successful generated turn uses two paid text-model calls. Ask for an original quiz and answer A–E for deterministic grading with rationale, distractor explanations and citations. A pending quiz survives reflective conversation; factual hints wait for an answer or an explicit reveal request. Written clinical reasoning is not independently graded. Unsupported facts are declined, and rejected drafts are not displayed. Conversations are saved; internal operator probes stay out of learner history and backups.
- **Board practice:** choose 10, 20, 40, 80 or 100 original questions with blueprint-weighted allocation; an optional timer is a practice setting, not an official exam specification. Resume a saved session, review missed items and practice a weaker domain. Scores summarize only the items answered.
- **Cases:** twelve original fictional reflection exercises with natural conversational coaching. Fictional characters are allowed; any claimed drug effect, clinical recommendation or medical outcome still requires source support. The tutor does not grade clinical competence. With AI unavailable, safe fixed prompts remain available.
- **Review:** attempt an answer before revealing it, then rate **Again / Hard / Good / Easy**. The app shows the next interval, prioritizes due learning and review cards, and limits new introductions. Repeated misses flag cards for revision.
- **Cards:** create, search, edit, suspend, and delete cards. Canonical question cards carry source provenance; personally written and imported cards remain unverified. Sources must support factual notes. Source titles and links are editable. You can create a card manually from a coach answer.
- **Progress:** review counts, study activity, streaks based on actual reviews, difficult topics, and self-rated recall. Six competency ratings are learner reflections, not official ACGME milestone evaluations.
- **Settings:** change focus, coaching style, session length, new-card limit, timezone, and voice controls. Export and restore JSON backups, or import a JSON card list with `front` and `back` fields.

In the owner's personal workspace, **Study preferences → Choose or test a model** lets you select a supported OpenAI text model, save that choice, run a bounded paid connection check, and export model results. The catalog matches documented conversational models and verified snapshots to the account model list, excludes retired or unsupported IDs, and labels unconfirmed lists when account lookup is unavailable. Astra is blocked without exceptions. Completed connection checks are reused; their token usage, latency, model identity, and estimated cost do not establish clinical accuracy. Anyone with the shared study access code has these owner controls. Subscriber model selection is disabled; Ingenium receives completed text-call metadata, while OpenAI routing remains direct. See [model controls and limits](docs/AI_PROVIDERS.md).

Microphone dictation is browser-dependent and may use the browser vendor's service. Text chat and your phone's keyboard remain available. **Talk with Coach** sends recognized text through the same authenticated conversational chat route, then premium OpenAI speech reads the checked reply. **Coach voice** offers Marin (default), Cedar, Coral, Sage and Ash; **Preview voice** plays a fixed AI-generated sample. The live catalog and one Marin preview passed; the other voices have not been separately auditioned through paid calls. Generated replies retain their automated-review label, while citations remain visible. Premium speech adds paid requests per uncached chunk to the two generated-chat calls; its token/cost usage is unknown when the binary response reports none, and Ingenium's current text receiver does not ingest it. Temporary audio caching is bounded and not durable. There is no automatic device-voice fallback, and unchecked Realtime speech remains disabled. Physical-phone playback, pronunciation and voice quality remain to check. The corrected generated-study flow is still awaiting its `natural-v3` live check after earlier safely withheld replies; voice-preview success does not establish that study path or clinical accuracy.

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

The personal text Coach combines natural conversation with **source-linked educational RAG for 105 conditions**, with 210 condition questions plus 12 questions from six separate Foundations of Care topics: **222 original questions** in total. Open **Board practice** from Today or Library, or use **Library → Guidelines & boards**. Generated factual claims require current source IDs and a separate automated review pairing exact candidate quotations with immutable source-span IDs. The server binds those IDs to canonical excerpts and supplies the citations. Newly bound reviews reject a changed study section on replay; older unbound reviews retain their earlier compatibility checks. It has no live web retrieval during a chat. The review model still judges whether every fact was identified and whether its evidence entails the claim; those judgments can be wrong. Source dates, formal-guideline gaps, jurisdiction and pending clinician review are visible. Unsupported factual questions abstain; saved questions can be reviewed with spaced repetition. See [coverage](docs/CONDITION_COVERAGE.md) and [RAG design and limits](docs/GUIDELINE_RAG.md). This is study use only, not medical advice, not for clinical use and not an official ABFM bank. All five blueprint domains have practice items, but this finite bank is not a complete exam syllabus; health-policy/legal coverage and independent clinician review remain gaps. See [board-study coverage](docs/BOARD_STUDY.md). Neither model review, source checks nor educational feedback establish clinical competence or guarantee accuracy. The separate commercial approved corpus remains empty.

The rebuild preserves the source app's simulation concepts and six competency domains, corrects the MMR case title and teach-back exercise, and replaces its Replit/Clerk/PostgreSQL setup with one portable Node process and SQLite. The uploaded source did not supply saved conversations; the separate `conversations.json` contained `[]`. Historical mobile AsyncStorage records are not migrated by this rebuild.

## Verify

```bash
npm run check
npm test
```

Run the affected or previously unverified checks when changing the app. Avoid repeating a passing check unless a relevant change or failure gives a reason. Tests cover review timing and daily limits, timezone boundaries and DST streaks, auth and request guards, durable data, atomic backups, chat retries and concurrency, and mocked AI-provider success/failure. Live authenticated provider access is a separate verification step.

JavaScript/asset, guideline-schema, billing-bridge and automated integration checks are included. Earlier mobile browser checks at 360 × 800 passed the personal study workflow and commercial account, pilot, subscription-details and deletion flows using local servers and synthetic data. Hosted UID/GID 1000 and the configured OpenAI key were subsequently observed. Those earlier checks do not validate the new natural-tutor path or clinical accuracy. See [VALIDATION_STATUS.md](docs/VALIDATION_STATUS.md) for current results and remaining checks, including the physical phone, real Play purchase, Kotlin compilation, and signed AAB. Test microphone permissions and home-screen installation on the real HTTPS URL.

## Files

- `public/`: responsive interface, install manifest, and shell-only service worker
- `server/`: HTTP API, SQLite persistence, authentication, coach prompts, provider integration
- `shared/`: scheduling and adapted educational content
- `tests/`: deterministic scheduler and integration tests
- `Dockerfile`, `compose.yaml`, `railway.json`: deployment options

Official API references: https://developers.openai.com/api/reference/resources/models/methods/list, https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create, and https://developers.openai.com/api/reference/resources/responses/methods/create.
