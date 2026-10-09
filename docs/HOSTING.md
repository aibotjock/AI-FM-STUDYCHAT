# Private phone hosting status

Updated October 9, 2026. **The personal phone pilot is live over HTTPS and uses OpenAI.** Railway reported a successful deployment; runtime logs confirmed the app runs as UID/GID 1000. Live `/api/status` returned HTTP 200 with private access required and the owner's OpenAI key configured. The owner confirmed live phone sign-in; a previous genuine READY request verified nonclinical provider connectivity. The new curriculum release reports 105 conditions/210 questions, 100 with guideline or recommendation evidence. Neither connection nor source checks establish clinical accuracy; see [VALIDATION_STATUS.md](VALIDATION_STATUS.md).

Railway project: `AI-FM-STUDYCHAT`, ID `3d314e6c-8def-4947-949a-eef7ce930e63`.
Environment: `private-test`, ID `05fb154d-1946-4db0-bf4e-786727e505df`.
Service: `family-medicine-phone-test`, ID `78d73fb2-96fa-45bc-97e4-6aa108724dc5`.
Volume: `private-study-data`, 500 MB, mounted at `/app/data`.

Dashboard: https://railway.com/project/3 d 314 e 6 c-8 def-4947-949 a-eef 7 ce 930 e 63/service/78 d 73 fb 2-96 fa-45 bc-97 e 4-6 aa 108724 dc 5?environmentId=05 fb 154 d-1946-4 db 0-bf 4 e-786727 e 505 df

Phone app: https://family-medicine-phone-test-private-test.up.railway.app

## Open the private phone pilot

1. Repository access is available after the owner made `aibotjock/AI-FM-STUDYCHAT` public. Deploy the intended release revision and check Railway's active deployment; a GitHub push alone does not establish which revision is running.
2. The service uses `APP_MODE=personal` for the owner's first trial. Do not use commercial accounts as an unverified paid launch.
3. `HOST=0.0.0.0`, `DATA_DIR=/app/data`, and a strong randomly generated `STUDY_ACCESS_TOKEN` are already set on the service. Copy that variable's value into the phone's **Study access code** field. It is separate from `OPENAI_API_KEY`. Never put either secret in a URL or public repository.
4. Use `AI_PROVIDER=openai`. The owner has already configured `OPENAI_API_KEY` privately in the service's **Variables** tab; live status confirms its presence. `OPENAI_MODEL` sets the initial personal model, and `COMMERCIAL_OPENAI_MODEL` is separate. Claude remains inactive. Deploy variable changes. API charges belong to the operator's OpenAI account. See [AI_PROVIDERS.md](AI_PROVIDERS.md) for owner model selection, connection checks, and export. Astra is prohibited at all times, without exceptions.
5. The container initializer changes only `/app/data` ownership and permissions, clears groups, drops all UID/GID identities to 1000 and verifies zero effective/permitted capabilities before importing the app. Application source is root-owned/read-only. It never walks descendants or starts a listener as root. A persistent-root runtime variable was rejected by automatic review and was not enabled. The successful deployment logs confirmed UID/GID 1000 and server startup; the SQLite store was initialized before listening.
6. Live HTTPS responses have no-store caching, CSP, frame denial, MIME sniffing protection and a restrictive permissions policy. The new source-linked curriculum endpoint rejects unauthenticated requests. Previously confirmed owner sign-in/READY checks were not repeated; physical-phone audio and complete restart/purchase checks remain distinct. Check the hosting plan and usage, and keep the pilot small.
7. Complete outstanding items in [PHONE_TEST.md](PHONE_TEST.md) on the owner's physical phone. Model controls belong to this shared-token personal workspace; keep its access code private. The catalog filters supported documented text models against account availability and labels unconfirmed lists. Model connection tests do not evaluate clinical accuracy, and Ingenium receives metadata-only text events while model routing remains direct to OpenAI. Store submission remains on hold until the owner gives permission; do not charge subscribers from this environment.

For a later commercial pilot, use a separate data directory/environment, `APP_MODE=commercial`, `PRIVATE_PILOT=true`, `PUBLIC_RELEASE=false`, an exact HTTPS `APP_ORIGIN`, and a long invitation token. Configure separate staging billing/provider secrets if testing real billing. Do not copy the owner's personal workspace into subscriber accounts.


## Previous source-linked curriculum deployment

Hosted code commit: `c42e8f6b923b2aaa7225931cb0cda95eea1ac550` on `release/google-play-preparation`, tree `c965d315bebc16bf6e37953e11a078f1b67308d6`. Railway deployment `8e417145-ad99-4443-8935-2554160522fc` reached terminal **SUCCESS** at `2026-10-09T09:53:57.176Z`. Startup logs confirm UID/GID 1000 and normal app initialization, with no repeated READY bootstrap.

Live readback: `/api/status` 200, OpenAI configured (`gpt-4.1-mini`), access required, 105 conditions/210 questions/105 current/100 guideline or recommendation conditions. `/api/curriculum` 401 without sign-in. Served `/app.js` and `/sw.js` bytes match published local sources; shell v5 is active. These were new deployment checks, not repeated model inference or previous functional suites. Refresh an already-open phone page to load the new library; server restart can require the existing study code again. App-store publication is still on hold.

## Board-study deployment

Code commit `15055caa02160373f72228dc0eb9896e88412c4c` is published on `release/google-play-preparation`, tree `086899530f80bfff7c17009f4818f33c395d5138`. Railway deployment `12671bfc-0405-47a0-96d4-2dfde784cee9` reached SUCCESS at `2026-10-09T10:58:39.672Z`, running UID/GID 1000. Public status shows 105 current conditions/210 condition questions and 222 combined practice questions, with 10/20/40/80/100 mixed sizes available. Browser sourced voice is enabled; unchecked Realtime is disabled. Changed app/voice/shell/disclosure/install/content assets were read back and matched published bytes.

The first new source-selector preflight stopped before a paid call on a topic-alias collision; the validation ledger records this new defect and its targeted correction. A successful deployment is not a successful source-selection or accuracy test. Refresh an existing phone page for shell v6. Physical microphone/playback and independent clinical review remain outstanding; no store submission is authorized.

### Active retrieval correction and genuine source check

The service is now pinned to code commit `fe1eb7ba1906e3469daf4cdb6750c35f63048161`. Deployment `0f7af3b0-e3e3-45d6-911b-734646c4620f` reached terminal SUCCESS at `2026-10-09T11:05:58.800Z`. The AF/stroke-risk topic collision is corrected; new and affected retrieval checks passed before publication. Public UI assets are unchanged from the byte-verified board-study release above.

One new authenticated, uncached OpenAI source-selection request passed exact canonical-text/citation/current-source checks and selected both required AF sections. It returned `gpt-4.1-mini-2025-04-14`, 817 input and 39 output tokens, estimated USD 0.0003892. The genuine metadata-only event was read back from Ingenium. This establishes that narrow path, not general medical accuracy or total syllabus coverage. The source-check flag is disabled with no extra deployment; durable request history prevents a repeated paid inference. The earlier READY test was not repeated.

The phone study tool is ready to try at the existing link. Use Board practice or Coach's sourced quizzes, then test sourced browser voice. Actual phone speech remains unverified. The user has not authorized app-store publication.
