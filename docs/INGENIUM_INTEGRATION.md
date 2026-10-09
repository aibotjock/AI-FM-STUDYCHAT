# Ingenium Applicatum integration

Reviewed 2026-10-09. The authoritative gateway repository is [aibotjock/IngeniumApplicatum](https://github.com/aibotjock/IngeniumApplicatum).

## Current state

StudyChat calls OpenAI directly from its server. Claude is inactive. Astra is prohibited in catalog display, selection and execution. A genuine application registration is now verified in Ingenium's Supabase database: organization `21bca727-553f-4df8-a2c6-e702f45e4ca2`, name `AI-FM-STUDYCHAT`, with one active dedicated hash-only credential record. The server-held raw credential is configured privately in Railway. This trusted project-admin registration creates no portal user, membership or trial and does not change portal MFA.

The planned authenticated metadata receiver is `https://mzmtbauuqywucgssckwx.supabase.co/functions/v1/studychat-events`. Deployment and actual receipt verification are still pending at this checkpoint. The OpenAI transport remains direct, and there is no hosted Ingenium routing gateway connection. Source fixtures and imported reports remain distinct from verified application registration and genuine provider traffic.

The inspected Ingenium security branch is `repair/security-baseline-2026-10-06`, remote commit `6304a6c30a165934fa62d02dcbd5c849614170fe`, tree `7c37a6ffa47cd698a3165d9a525da0b9c9a28e25`. Its source supports OpenAI passthrough at `GET /v1/models`, `POST /v1/chat/completions` and `POST /v1/responses`. Gateway identity uses a server-held `x-ingenium-key`; the provider bearer credential is forwarded upstream, rather than retained. Tenant telemetry contains model, usage, timing, status and configured cost metadata. Normal server startup does not activate controlled optimization or automatic model replacement.

StudyChat's owner model selector and connection-test export are useful inputs for a future integration. The `READY` check measures connectivity and instruction following only; it does not measure medical accuracy. A cached result avoids another paid call. Requested and returned model IDs, token usage, latency and estimated cost remain distinct fields. Unpriced models cannot support a defensible dollar comparison.

## Implementation sequence

1. **Application database registration complete.** Publish the authenticated metadata receiver and confirm one bounded owner OpenAI request produces one actual, deduplicated usage record for the registered organization. Keep prompts, answers and credentials out of Ingenium; preserve direct OpenAI transport.
2. **Offline test pack prepared.** Exercise the existing authenticated gateway against an isolated loopback OpenAI mock using StudyChat-shaped chat and Responses payloads. Check unchanged payloads, tenant attribution, model/usage/cost metadata, error handling and credential/prompt exclusion from retained evidence. These synthetic tests are separate from the genuine telemetry feed.
3. Create or verify the owner organization through the authenticated Ingenium portal, issue a dedicated StudyChat gateway key and confirm tenant isolation. Confirm the selected deployed gateway has the reviewed security changes; source and CI checks alone are insufficient.
4. Add an opt-in StudyChat server transport to the verified HTTPS gateway. Keep provider and gateway credentials in Railway server variables. Fix the destination allowlist, use both supported API formats, and retain direct OpenAI transport as an explicit operator rollback setting. Never expose either credential to the browser.
5. Start with metadata collection and shadow recommendations. Use an exact OpenAI candidate allowlist, reject Astra before any request and reject any fallback proposing Astra. Keep Claude disabled. Require known pricing, bounded request counts, concurrency of one, no automatic retries, output limits and an operator-set dollar ceiling for experiments. Rate limits alone are not a dollar ceiling.
6. Build a clinician-reviewed, source-dated family medicine evaluation set before approving a cheaper model for medical teaching. Include incorrect answers, source mismatch, outdated guidance, contradictory evidence, uncertainty, abstention and unsafe advice. Evaluate against reviewed references, rather than agreement with a more expensive model. Keep failures and unknown outcomes visible. Total accuracy cannot be established by a finite benchmark.
7. Enable a candidate only for the workload and guideline version it has passed. An unvalidated clinical workload remains ineligible for automatic live optimization. Clinical corpus and public-store release gates remain separate from transport/model tests.

## Test data and evidence boundary

Synthetic nonclinical learning fixtures can cover a Socratic next question, a JSON flashcard draft, review feedback, context preservation, output budgets and refusal to follow injected instructions. They can provide known references for Ingenium's existing exact-text, JSON-equivalence and classification contracts. Generated medical examples must remain labeled unreviewed and must not become an accuracy benchmark or production corpus.

The future live pilot should retain metadata and reference IDs only in Ingenium. Do not export personal chat text, patient information, passwords, API keys, access codes or raw medical model responses to its test laboratory. Keep local synthetic prices explicitly synthetic; replace them with exact verified rates when calculating real model costs. Connection-test export alone cannot prove quality, savings, registration or deployment.

Track each new check once in the validation ledger. Repeat a passed check only after relevant code changes, a failure, changed model behavior or changed reference guidance. Physical phone voice input, native billing and owner-authenticated live inference require their own evidence.
