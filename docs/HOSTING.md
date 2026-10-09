# Private phone hosting status

Updated October 9, 2026. **The personal phone pilot is live over HTTPS.** Railway reported a successful deployment; runtime logs confirmed the app runs as UID/GID 1000. The live `/api/status` returned HTTP 200 with private access required and no AI key configured. This verifies hosting, not a live model conversation or the owner's physical phone.

Railway project: `AI-FM-STUDYCHAT`, ID `3d314e6c-8def-4947-949a-eef7ce930e63`.
Environment: `private-test`, ID `05fb154d-1946-4db0-bf4e-786727e505df`.
Service: `family-medicine-phone-test`, ID `78d73fb2-96fa-45bc-97e4-6aa108724dc5`.
Volume: `private-study-data`, 500 MB, mounted at `/app/data`.

Dashboard: https://railway.com/project/3d314e6c-8def-4947-949a-eef7ce930e63/service/78d73fb2-96fa-45bc-97e4-6aa108724dc5?environmentId=05fb154d-1946-4db0-bf4e-786727e505df

Phone app: https://family-medicine-phone-test-private-test.up.railway.app

## Open the private phone pilot

1. Repository access is now available after the owner made `aibotjock/AI-FM-STUDYCHAT` public. The source is pinned to a specific tested commit so later pushes cannot silently replace the owner's pilot.
2. The service uses `APP_MODE=personal` for the owner's first trial. Do not use commercial accounts as an unverified paid launch.
3. `HOST=0.0.0.0`, `DATA_DIR=/app/data`, and a strong randomly generated `STUDY_ACCESS_TOKEN` are already set on the service. Retrieve the token through the owner's Railway dashboard when signing into the app. Never put it in a URL or public repository.
4. The requested Claude setup uses `AI_PROVIDER=anthropic` and `CLAUDE_MODEL=claude-haiku-5-5`. Add `CLAUDE_API_KEY` through the Railway service's Variables tab, then deploy the variable change. To select OpenAI instead, set `AI_PROVIDER=openai` and `OPENAI_API_KEY`. Without the selected provider's key, the app provides explicitly labeled worksheets and card review. API charges belong to the operator's provider account; no API key was supplied or provisioned here. See [AI_PROVIDERS.md](AI_PROVIDERS.md).
5. The container initializer changes only `/app/data` ownership and permissions, clears groups, drops all UID/GID identities to 1000 and verifies zero effective/permitted capabilities before importing the app. Application source is root-owned/read-only. It never walks descendants or starts a listener as root. A persistent-root runtime variable was rejected by automatic review and was not enabled. The successful deployment logs confirmed UID/GID 1000 and server startup; the SQLite store was initialized before listening.
6. Live HTTPS responses have no-store caching, CSP, frame denial, MIME sniffing protection and a restrictive permissions policy. Owner authentication and saved-card/review persistence across a host restart still need the physical phone checklist. Check the actual hosting plan and usage, and keep the pilot small.
7. Run [PHONE_TEST.md](PHONE_TEST.md) on the owner's physical phone. Do not charge subscribers or submit to Google Play from this environment.

For a later commercial pilot, use a separate data directory/environment, `APP_MODE=commercial`, `PRIVATE_PILOT=true`, `PUBLIC_RELEASE=false`, an exact HTTPS `APP_ORIGIN`, and a long invitation token. Configure separate staging billing/provider secrets if testing real billing. Do not copy the owner's personal workspace into subscriber accounts.
