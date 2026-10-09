# Ingenium Applicatum integration

Reviewed 2026-10-09. The authoritative gateway repository is [aibotjock/IngeniumApplicatum](https://github.com/aibotjock/IngeniumApplicatum).

## Current state

StudyChat calls OpenAI directly from its server. Claude is inactive. Astra is prohibited in catalog display, selection and execution. No StudyChat registration record or active StudyChat tenant connection was found in the inspected Ingenium checkouts. A source manifest or test fixture is repository configuration; it does not establish that an authenticated deployed tenant, gateway credential or live telemetry feed exists.

The inspected Ingenium security branch is `repair/security-baseline-2026-10-06`, remote commit `6304a6c30a165934fa62d02dcbd5c849614170fe`, tree `7c37a6ffa47cd698a3165d9a525da0b9c9a28e25`. Its source supports OpenAI passthrough at `GET /v1/models`, `POST /v1/chat/completions` and `POST /v1/responses`. Gateway identity uses a server-held `x-ingenium-key`; the provider bearer credential is forwarded upstream, rather than retained. Tenant telemetry contains model, usage, timing, status and configured cost metadata. Normal server startup does not activate controlled optimization or automatic model replacement.

StudyChat's owner model selector and connection-test export are useful inputs for a future integration. The `READY` check measures connectivity and instruction following only; it does not measure medical accuracy. A cached result avoids another paid call. Requested and returned model IDs, token usage, latency and estimated cost remain distinct fields. Unpriced models cannot support a defensible dollar comparison.

## Implementation sequence

1. Register StudyChat in source with a versioned application/workload manifest. Keep synthetic fixtures separate from actual usage and identify the exact app/gateway revisions that produced evidence.
2. Exercise the existing authenticated gateway against an isolated loopback OpenAI mock using StudyChat-shaped chat and Responses payloads. Check unchanged payloads, tenant attribution, model/usage/cost metadata, error handling and credential/prompt exclusion from retained evidence. This requires no customer data or paid inference.
3. Create or verify the owner organization through the authenticated Ingenium portal, issue a dedicated StudyChat gateway key and confirm tenant isolation. Confirm the selected deployed gateway has the reviewed security changes; source and CI checks alone are insufficient.
4. Add an opt-in StudyChat server transport to the verified HTTPS gateway. Keep provider and gateway credentials in Railway server variables. Fix the destination allowlist, use both supported API formats, and retain direct OpenAI transport as an explicit operator rollback setting. Never expose either credential to the browser.
5. Start with metadata collection and shadow recommendations. Use an exact OpenAI candidate allowlist, reject Astra before any request and reject any fallback proposing Astra. Keep Claude disabled. Require known pricing, bounded request counts, concurrency of one, no automatic retries, output limits and an operator-set dollar ceiling for experiments. Rate limits alone are not a dollar ceiling.
6. Build a clinician-reviewed, source-dated family medicine evaluation set before approving a cheaper model for medical teaching. Include incorrect answers, source mismatch, outdated guidance, contradictory evidence, uncertainty, abstention and unsafe advice. Evaluate against reviewed references, rather than agreement with a more expensive model. Keep failures and unknown outcomes visible. Total accuracy cannot be established by a finite benchmark.
7. Enable a candidate only for the workload and guideline version it has passed. An unvalidated clinical workload remains ineligible for automatic live optimization. Clinical corpus and public-store release gates remain separate from transport/model tests.

## Test data and evidence boundary

Synthetic nonclinical learning fixtures can cover a Socratic next question, a JSON flashcard draft, review feedback, context preservation, output budgets and refusal to follow injected instructions. They can provide known references for Ingenium's existing exact-text, JSON-equivalence and classification contracts. Generated medical examples must remain labeled unreviewed and must not become an accuracy benchmark or production corpus.

The future live pilot should retain metadata and reference IDs only in Ingenium. Do not export personal chat text, patient information, passwords, API keys, access codes or raw medical model responses to its test laboratory. Keep local synthetic prices explicitly synthetic; replace them with exact verified rates when calculating real model costs. Connection-test export alone cannot prove quality, savings, registration or deployment.

Track each new check once in the validation ledger. Repeat a passed check only after relevant code changes, a failure, changed model behavior or changed reference guidance. Physical phone voice input, native billing and owner-authenticated live inference require their own evidence.
