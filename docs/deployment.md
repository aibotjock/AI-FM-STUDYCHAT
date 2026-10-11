# Isolated Railway deployment

The rebuild is one Node 24 service with one SQLite volume. Optional self-hosted voice uses a separate private Python service; its model dependencies stay outside the Node app. The Node Dockerfile has no package installation or frontend build step. Railway supplies `PORT`; the app binds to `HOST=0.0.0.0`. `/health` is unauthenticated, returns no learner data, and makes no provider calls.

## Target and isolation

| Resource | Value |
| --- | --- |
| Project | `3d314e6c-8def-4947-949a-eef7ce930e63` (`AI-FM-STUDYCHAT`) |
| Environment | `05fb154d-1946-4db0-bf4e-786727e505df` (`private-test`) |
| New service name | `studychat-no-rag-test` |
| New volume name | `studychat-no-rag-data` |
| New volume mount | `/app/data` |
| Region and instances | `iad`, one replica |
| Source | `aibotjock/AI-FM-STUDYCHAT`, `feature/no-rag-rebuild`, reviewed exact commit |

The existing service `family-medicine-phone-test` (`78d73fb2-96fa-45bc-97e4-6aa108724dc5`) and volume `private-study-data` (`7c154489-6726-4d2c-9328-3495c655aa92`) remain untouched. The pilot's volume must not be attached to the rebuild. Initial import uses an exported backup copied to a separate test database.

An inventory read on October 10, 2026 found one existing service and its 500 MB volume in `private-test`, no staged changes, and shared variable names `APP_MODE`, `DATA_DIR`, `HOST`, and `STUDY_ACCESS_TOKEN`. No secret values were fetched for this document. Re-read the inventory before creating anything to avoid duplicate resources or committing unrelated staged changes.

## Runtime variables

| Variable | Deployment value |
| --- | --- |
| `HOST` | `0.0.0.0` |
| `DATA_DIR` | `/app/data` |
| `NODE_ENV` | `production` |
| `PORT` | Leave to Railway's injected value |
| `STUDY_ACCESS_TOKEN` | Private owner token, at least 32 characters; never commit or log it |
| `APP_ORIGIN` | Exact generated HTTPS origin, without a trailing slash |
| `OPENAI_API_KEY` | Server-only OpenAI text credential |
| `ANTHROPIC_API_KEY` | Server-only Claude credential; add to this new service to enable its selector choices |
| `OPENAI_MODEL` | Default OpenAI text model, `gpt-4.1-mini` |
| `ANTHROPIC_MODEL` | Default Claude text model, `claude-haiku-5-5` |
| `STANDARD_PROMPT_BYTES`, `MAX_OUTPUT_TOKENS` | Optional standard budget overrides; defaults `24000`, `1200` |
| `LIMITED_PROMPT_BYTES`, `LIMITED_OUTPUT_TOKENS` | Optional limited budget overrides; defaults `8000`, `768`; cannot exceed standard caps |
| `SPEECH_SERVICE_URL` | Optional private speech origin; see the voice-service configuration below |
| `SPEECH_SERVICE_TOKEN` | Independent server-only speech credential; never send it to the browser |

Secrets are supplied as service-scoped variables. Existing shared values may be referenced intentionally, but changing a shared value would affect the pilot and is unnecessary. The Docker image runs with the default root UID because Railway's mounted volume is root-owned. There are no secrets in image layers. SQLite migrations run at application startup, when the volume is mounted; pre-deploy commands must not open the database.

## Platform configuration sequence

Complete the code and tests before provisioning. Create an empty service scoped to the exact project and environment, then attach a **new** volume at `/app/data` before its first deployment. Use the current Railway connector to set these explicit service settings:

```json
{
  "dockerfilePath": "Dockerfile",
  "startCommand": "npm start",
  "healthcheckPath": "/health",
  "healthcheckTimeout": 120,
  "restartPolicyType": "ON_FAILURE",
  "restartPolicyMaxRetries": 3,
  "regions": { "iad": { "numReplicas": 1 } },
  "sleepApplication": false,
  "drainingSeconds": 10
}
```

Set the variables on the new service. Generate its own HTTPS domain and set `APP_ORIGIN` to that exact origin. Keep authentication required for APIs and learner data. An authenticated HTTPS test URL is the private pilot interface; it is not an unauthenticated public product release.

Connect the new service to the reviewed rebuild commit only after its configuration and volume are ready. Pinning `commitSha` avoids automatic deployment of unfinished later pushes. Apply operations with explicit new service IDs. If staging is used, inspect the full pending patch before accepting it; never accept unrelated changes.

Railway detects the root `Dockerfile` automatically. No `railway.json` is included: Railway's current Config-as-Code documentation says that mechanism is deprecated, with legacy support through December 1, 2026. Setting the small service configuration directly avoids adding an infrastructure framework for one app.

Creation and deployment use resources from the existing Railway account. No plan purchase, upgrade, app-store submission, public release, or pilot deletion is part of this setup.

## Optional private speech worker

The `feature/free-voice-pipecat` branch supplies a separate [Whisper/Kokoro/Pipecat service](../services/speech/README.md). This configuration is proposed; it does not establish a deployed speech worker. The owner is also considering inference on user devices, which requires a different client integration. No additional Railway speech runtime has been activated.

For a server-hosted deployment, create one private `studychat-free-speech` service from the reviewed branch commit with root directory `/services/speech`, Dockerfile `Dockerfile`, health path `/health`, 300-second health timeout, and one `iad` replica. Initial resource limits are 2 vCPU and 3 GB RAM; disable sleeping to avoid repeatedly loading the models. Set `HOST=0.0.0.0`, `PORT=8081`, `OMP_NUM_THREADS=2`, and an independent random `SPEECH_SERVICE_TOKEN`. The image contains the fixed model assets, so this service needs no public domain, database, or volume.

On the existing Node app, set `SPEECH_SERVICE_URL` to `http://${{studychat-free-speech.RAILWAY_PRIVATE_DOMAIN}}:${{studychat-free-speech.PORT}}` and `SPEECH_SERVICE_TOKEN` to `${{studychat-free-speech.SPEECH_SERVICE_TOKEN}}`. Pin both services to the reviewed free-voice commit. Keep the existing Node volume, provider credentials, authentication, and monitoring account. The older paid-speech environment variables are ignored by this branch.

Inspect staged changes before applying them. Activate additional paid compute only after the owner chooses server hosting and approves its cost. [Railway resource prices](https://docs.railway.com/pricing/plans), checked October 10, 2026, are $10 per GB-month RAM and $20 per average vCPU-month, plus egress. These apply to actual consumption; the resource limits are not a guaranteed billing ceiling. Local measurements cannot establish Railway latency or actual monthly usage.

## Verification and recovery

Observe terminal Railway deployment status `SUCCESS` before claiming deployment. A queued build is not success. Then verify health, login protection, normal chat streaming (or explicit AI unavailable), Stop/retry behavior, practice grading, cards/review, reference browsing, and backup/restore. Restart only the new service and confirm saved records persist on its new volume. A volume-backed service has brief redeployment downtime; no zero-downtime claim is made. Railway's healthcheck is a deployment gate, not continuous monitoring.

If deployment fails, inspect bounded build/runtime logs for the new service. Correct its configuration or code without moving the pilot's volume or changing its source. Keep the volume after failed deployments. Back up through the app's export facility before restoring or modifying learner state; copying a live WAL database is not a backup procedure.

Local Docker verification, when Docker is available:

```bash
docker build -t studychat-no-rag .
docker volume create studychat-no-rag-test-data
docker run --rm --env-file .env -e HOST=0.0.0.0 -e DATA_DIR=/app/data -p 127.0.0.1:3000:3000 -v studychat-no-rag-test-data:/app/data studychat-no-rag
```

The local workspace has no Docker CLI. Railway successfully built and deployed the Dockerfile with Node v24.21.0; its healthcheck passed. The application's Node 24 tests provide separate local runtime evidence.

## Official documentation checked

- [Railway Dockerfiles](https://docs.railway.com/builds/dockerfiles)
- [Railway volumes](https://docs.railway.com/volumes)
- [Railway healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Railway public networking](https://docs.railway.com/networking/public-networking)
- [Railway Config-as-Code reference](https://docs.railway.com/config-as-code/reference)
- [Node 24 SQLite API](https://nodejs.org/download/release/latest-v24.x/docs/api/sqlite.html)
- [Official Node Docker image](https://hub.docker.com/_/node)

The Node 24 SQLite module is available without an enabling flag. Its documented stability still depends on the minor release; the image build runs a `DatabaseSync` smoke check, and hosted verification must record the actual Node version and image used.

## Prepared deployment record

On October 10, 2026, the following new resources were prepared:

- Service: `6f422cde-c9b9-4bdf-a8cc-3b41a31b6e1d` (`studychat-no-rag-test`).
- Domain: `https://studychat-no-rag-test-private-test.up.railway.app`.
- New staged volume: `5e1e422a-5a56-43a5-a8ed-d9da1733aaed`, 500 MB, iad, `/app/data`.
- Reviewed pending patch: `4f245262-e4aa-4f82-b115-a1b489f8ef77`, 26 changes, only this new service and volume, no shared variable changes.
- Pinned runtime commit: `844ad092b6c24ed052f9897cd4477e98f57f5e41`.
- The owner access token is separate from the original pilot and is omitted from this repository.
- Provider credential is a Railway service reference to the pilot's existing server-only key; no key was read or changed.

The initial deployment approval action returned “Cancelled — the user did not approve this action. No changes were made.” The owner then applied the patch directly in Railway, as recorded below.

## Live deployment verification

The owner applied the staged configuration directly in Railway. Deployment `46594ad7-e106-4d24-8f75-1ce28d549e79` reached SUCCESS from branch commit `dc3714062e9a47e418ca7feb2e8f36ada146c398`. The generated HTTPS domain is live. Both old and new services remained SUCCESS; no staged changes remained. Hosted sign-in, real chat streaming, study endpoints, and persistence after restarting only the new service passed. Actual-model observations and limitations are in validation.md and model-results.json.

## Model selector and Ingenium rollout

Tested runtime commit `2c1d48a052cbe58d5957716d883a6686b66d13fc` adds selectable OpenAI/Anthropic text models, server cost limits, and a separate Ingenium metadata account. The entire tested Git tree `cea70c9f163a561613aab0645070c3ca5e03fdb3` matched the pushed tree. All 117 automated checks and 15 browser workflows passed; the dedicated Ingenium receiver's 12 checks passed separately.

Railway patch `d2443db4-9985-42c9-85ab-bf8aa83c5163` contains six non-destructive changes affecting only service `6f422cde-c9b9-4bdf-a8cc-3b41a31b6e1d`: the reviewed repository/branch/commit source fields and two private service variables, `INGENIUM_TELEMETRY_KEY` and `INGENIUM_TELEMETRY_ORGANIZATION_ID`. No volume or shared variable changes are staged. The app deployment approval tool returned “Cancelled — the user did not approve this action. No changes were made.” No alternative deployment path was used.

The owner subsequently applied the patch. Deployment `ecb299bb-d427-4e94-a440-0f902240c657` reached SUCCESS from commit `45b33e7478c3b227c1ea3aa9963bc48544067139`. Authenticated health, both model catalogues, and telemetry status passed. A real OpenAI greeting streamed successfully. A real Claude Haiku request returned HTTP 400; catalogue access does not establish working paid inference. Ingenium independently stored both observed requests in the new account, with no rejected/dropped deliveries and no manufactured usage for the failed request. A private pre-update workspace checkpoint was captured; learner data must remain intact.

Final inventory confirms `ANTHROPIC_API_KEY` has been added directly to the new service. Claude inference remains unresolved after its HTTP 400 response. OpenAI's existing server-only credential reference is retained. Provider credentials stay out of the browser, GitHub, and chat. The Ingenium test receiver is ACTIVE and its two earlier simulated collector rows were independently verified, with no model calls or invented usage in those simulation fixtures.

The owner's intervening variable update had deployed the earlier runtime as deployment `ccea49f5-845b-4e70-9eea-8c691e678ec6`, commit `8e9b94f25cdf8f60ae825901ee36b66deee40528`; it was removed when the updated app became live. The original pilot remains separate. The voice UI update keeps the same app process, credentials, database, and volume; it adds no production dependencies.
