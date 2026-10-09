# Security status and release gates

Security is an explicit product priority. This is a private-pilot preparation, not a security certification or a production medical-data service. Public release is refused in code. Store submission remains subject to the owner's permission after validation.

## Implemented boundaries

- Personal mode uses a long shared token and a single workspace. It is for the owner, not multiple customers. The hosted phone pilot must remain private.
- Commercial mode uses isolated account directories and account-owned SQLite records. Passwords use asynchronous scrypt with random salts; sessions are random, stored hashed, HttpOnly and SameSite, with Secure cookies over HTTPS.
- Private commercial pilots restrict registration with an operator-owned invitation secret when exposed beyond loopback. Host/origin validation, JSON-only writes, request limits and bounded bodies guard entry points.
- API keys and Google service-account keys stay on the server. Play purchase tokens are encrypted with AES-256-GCM using a separate host secret; token hashes enforce unique ownership. Google verification checks the package, product, account binding, state and expiry. A client purchase event cannot grant access.
- Commercial text-coaching costs are reserved in durable storage before calls. Retries are fingerprinted and deduplicated; uncertain outcomes retain cost reservations. User, trial, daily and global ceilings limit financial abuse. These commercial controls do not meter the separate personal voice pilot.
- Commercial medical evidence requires current clinical review, documented commercial and AI-processing rights with a valid duration, integrity hashes and approved source IDs. The separate personal educational corpus requires current actual source checks, official source URLs, bounded data and pending-clinician-review labels. Text RAG accepts only eligible canonical section/question IDs and renders server-owned text/citations; unsupported answers abstain. Neither output constraint proves clinical correctness or grants source rights.
- Generated text is rendered as text with escaped attributes. CSP, frame restrictions, source URL validation and external link isolation reduce injection exposure. The service worker caches the shell and never caches study APIs.
- The Android shell accepts native billing messages only from the exact HTTPS application origin and main frame. It disables file/content access, mixed content and third-party cookies, refuses TLS errors, and grants no camera or microphone permissions. Real-device/native security tests remain pending.
- Account deletion invalidates sessions and blocks late provider responses before they can save data. Active study files, report text and cached AI content are removed. A minimal pseudonymous purchase/cost ledger remains for receipt/spend abuse prevention. Secure SQLite deletion and WAL checkpointing reduce residual active-file data.
- A bounded container initializer fixes ownership only of the exact nonsymlink `/app/data` mount, then clears supplementary groups and drops real/effective/saved/filesystem UID/GID to 1000. It requires zero effective/permitted kernel capabilities before importing application code. The web app runs unprivileged; source and launcher remain root-owned and unwritable. It fails closed if the host cannot perform that setup. Persistent root execution is not enabled.
- Personal voice starts explicitly, uses server-authenticated OpenAI signaling and keeps the API key off the phone. Audio goes directly to OpenAI over WebRTC. Authentication, origin/body/rate bounds, one active call per owner, bounded SDP, known-call shutdown and setup/logout race guards protect app routes. Client tracks stop on Stop, backgrounding or the ten-minute limit; server shutdown is separately attempted. A failed hangup is surfaced, not treated as confirmed. Client captions are unverified text, never trusted usage or billing evidence. Fixed initial settings and normal-client controls do not establish a tamper-proof commercial budget or immutable upstream session settings. Paid voice release needs server-side observation, verified metering and spend controls.
- Ingenium receives only completed text-call metadata through a fixed HTTPS receiver, using a dedicated app key whose hash is held in the registered organization. Prompts, answers, identities and API credentials are excluded. The app has a bounded durable metadata outbox and retries delivery with the same UUID, never inference. Receiver revocation/organization checks, duplicate conflict rejection, RLS and server-only backend credentials preserve the ingestion boundary. This feed is not an Ingenium portal login or hosted routing gateway.

## Data limits and actual retention

Conversations and study records are stored on the application server. They are not end-to-end encrypted; the operator and host may have technical access. Play tokens are encrypted separately, but study SQLite files are not application-encrypted. Establish host disk encryption, backup controls, scoped operator access, and documented retention before public launch.

OpenAI text requests explicitly disable application-level response storage, but that does not eliminate provider abuse-monitoring retention. Its current policy permits default abuse-monitoring logs for up to 30 days with legal/safety exceptions; the current Realtime endpoint table also lists 30-day abuse monitoring and no application state. Microphone audio and relevant study context are processed by OpenAI for voice, while finalized client-reported captions are kept in the study workspace. The app records no audio files. Approved provider retention controls have not been configured for this project. Claude remains inactive; its retained adapter exposes only text and does not store or return thinking blocks. Do not claim zero retention or HIPAA compliance. Browser or keyboard dictation can process speech through device/vendor services according to their settings.

Ingenium's database keeps app-level usage metadata independently of study conversations. The app bounds its local delivery queue and recent receipts to 500 each; that is not a retention policy for the hosted Ingenium database. Set an operator-owned metadata retention/deletion policy before public customers. One genuine nonclinical connection event was verified on October 9, 2026; no study transcript was sent to that receiver.

Keep study cases fictional or de-identified. This app has no verified patient-identifier detection and is not an EHR. Do not enter patient names, dates of birth, record numbers, identifying images or other sensitive patient data. Backups downloaded by a learner remain under that learner's control.

## Required before accepting public customers

1. Implement verified email ownership, safe recovery, credential-change reauthentication and session-management UI; consider managed identity and MFA for operator access.
2. Require a canonical HTTPS origin, review trusted proxy behavior, verify private-pilot invitations, and test rate-limit/resource exhaustion behavior behind the actual host.
3. Run an independent security assessment covering cross-account access, backups, purchase theft, CSRF, injection, deletion races, native navigation and billing bridges. Resolve serious findings and retain evidence.
4. Configure least-privilege Google/OpenAI service accounts, separate staging/production keys, rotation and incident revocation. Confirm keys never appear in source, bundles, reports or logs.
5. Add verified RTDN processing, purchase acknowledgement retry/reconciliation workers and operational alerts; test refund/revocation handling with real Play license testers.
6. Define backup encryption and retention, deletion tombstone handling during restore, operator access audit, security-log minimization, incident response and breach notification procedures applicable to the operator.
7. Establish report triage and abuse moderation with an assigned operator, accurate privacy/Data safety disclosures, and an actual support contact.
8. Build/sign Android with protected signing keys, complete native/device tests, review dependency updates and produce a release inventory. No native compile or signed AAB has been validated here.

The current account-isolation, receipt-binding, budget, deletion and grounding tests provide regression checks. They do not replace a penetration test, legal/privacy review, or clinical review.

Provider retention reference, checked October 9, 2026: https://developers.openai.com/api/docs/guides/your-data

Anthropic retention: https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data and https://platform.claude.com/docs/en/build-with-claude/api-and-data-retention
