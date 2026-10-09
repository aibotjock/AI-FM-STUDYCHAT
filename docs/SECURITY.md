# Security status and release gates

Security is an explicit product priority. This is a private-pilot preparation, not a security certification or a production medical-data service. Public release is refused in code. Store submission remains subject to the owner's permission after validation.

## Implemented boundaries

- Personal mode uses a long shared token and a single workspace. It is for the owner, not multiple customers. The hosted phone pilot must remain private.
- Commercial mode uses isolated account directories and account-owned SQLite records. Passwords use asynchronous scrypt with random salts; sessions are random, stored hashed, HttpOnly and SameSite, with Secure cookies over HTTPS.
- Private commercial pilots restrict registration with an operator-owned invitation secret when exposed beyond loopback. Host/origin validation, JSON-only writes, request limits and bounded bodies guard entry points.
- API keys and Google service-account keys stay on the server. Play purchase tokens are encrypted with AES-256-GCM using a separate host secret; token hashes enforce unique ownership. Google verification checks the package, product, account binding, state and expiry. A client purchase event cannot grant access.
- AI costs are reserved in durable storage before calls. Retries are fingerprinted and deduplicated; uncertain outcomes retain cost reservations. User, trial, daily and global ceilings limit financial abuse.
- Medical evidence requires current clinical review, documented commercial and AI-processing rights with a valid duration, integrity hashes and approved source IDs. Unsupported answers abstain. This is an output constraint, not proof of clinical correctness.
- Generated text is rendered as text with escaped attributes. CSP, frame restrictions, source URL validation and external link isolation reduce injection exposure. The service worker caches the shell and never caches study APIs.
- The Android shell accepts native billing messages only from the exact HTTPS application origin and main frame. It disables file/content access, mixed content and third-party cookies, refuses TLS errors, and grants no camera or microphone permissions. Real-device/native security tests remain pending.
- Account deletion invalidates sessions and blocks late provider responses before they can save data. Active study files, report text and cached AI content are removed. A minimal pseudonymous purchase/cost ledger remains for receipt/spend abuse prevention. Secure SQLite deletion and WAL checkpointing reduce residual active-file data.
- A bounded container initializer fixes ownership only of the exact nonsymlink `/app/data` mount, then clears supplementary groups and drops real/effective/saved/filesystem UID/GID to 1000. It requires zero effective/permitted kernel capabilities before importing application code. The web app runs unprivileged; source and launcher remain root-owned and unwritable. It fails closed if the host cannot perform that setup. Persistent root execution is not enabled.

## Data limits and actual retention

Conversations and study records are stored on the application server. They are not end-to-end encrypted; the operator and host may have technical access. Play tokens are encrypted separately, but study SQLite files are not application-encrypted. Establish host disk encryption, backup controls, scoped operator access, and documented retention before public launch.

OpenAI requests explicitly disable application-level response storage, but that does not eliminate provider abuse-monitoring retention. The provider's current data policy permits default abuse-monitoring logs for up to 30 days, with legal/safety exceptions; approved retention controls have not been configured for this project. Do not claim zero retention or HIPAA compliance. Browser or keyboard dictation can process speech through device/vendor services according to their settings; this app does not store audio recordings.

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
