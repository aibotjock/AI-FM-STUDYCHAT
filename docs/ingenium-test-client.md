# Ingenium test application account

Created October 10, 2026 for the no-RAG rebuild. This is a separate application account with its own hashed credential, not a portal password account. Portal signup and authenticator enrollment remain separate user actions.

| Resource | Value |
| --- | --- |
| Account | `STUDYCHAT-NO-RAG-TEST` |
| Organization | `a4138b5b-c5ce-4590-abd8-e10739c38c73` |
| Repository | `aibotjock/IngeniumApplicatum` |
| Integration branch | `studychat/no-rag-test-client` |
| Supabase project | `mzmtbauuqywucgssckwx` |
| Receiver | `https://mzmtbauuqywucgssckwx.supabase.co/functions/v1/studychat-test-events` |
| Application service | `studychat-no-rag-test`, private-test |

Only `INGENIUM_TELEMETRY_KEY` and `INGENIUM_TELEMETRY_ORGANIZATION_ID` are added to the new Railway service. The raw dedicated credential stays on the server; Ingenium stores its SHA-256 hash. No provider API key is sent to Ingenium. The original client, service, receiver, and data remain independent.

The receiver authenticates a non-revoked key belonging to this exact test account and derives the organization from that lookup. It rejects browser-origin requests, anonymous reads, oversized bodies, arbitrary fields, conflicting stored events, and credentials belonging to another tenant. Custom application authentication is enforced inside the handler; JWT verification is disabled only for this dedicated application-key endpoint. Existing RLS stays enabled. No database schema or portal authorization rule changed.

Each attempted OpenAI or Anthropic text POST produces operational metadata after its outcome. A failure after HTTP headers may retain status 200 together with an explicit stream error code; it is not thereby a successful completion. Unknown usage/cost remains null. Provider-reported cache and reasoning tokens are retained when valid. Cost estimates require verified pricing and compatible reported service/geography/cache metadata; they are estimates, not invoices. No prompt, reply, source document, learner ID, recording, cookie, or provider credential is accepted.

Events are queued durably and delivered immediately in the background. Only metadata delivery retries; inference never retries automatically. Duplicate delivery uses one UUID and cannot overwrite stored telemetry. Local retention is bounded to 500 events, including at most 100 delivered receipts; dropped events and receiver errors remain visible. This local bound does not establish Ingenium's hosted data retention policy. Settings polls the private status endpoint every ten seconds while visible and stops on navigation/logout.

`app_observed` denotes actual attempted provider calls from the test application. `client_simulated` denotes collector fixtures and requires null token and monetary values. The receiver includes this distinction in `pricing_source`; simulated events must be excluded from paid-usage and performance conclusions. No scheduled paid traffic generator, optimization, model substitution, billing activation, or savings claim is included.

Verification: the application suite covers provider observation, privacy, queue limits, persistence, retries, cancellation, and authenticated status. The dedicated receiver has 12 passing deterministic tests covering tenant/authentication boundaries, OpenAI/Anthropic, simulation labeling, duplicate delivery, and input bounds. Hosted and genuine-provider evidence is recorded separately in the validation record.
