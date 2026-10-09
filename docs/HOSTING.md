# Private phone hosting status

Updated October 9, 2026. **The personal phone pilot is live over HTTPS and uses OpenAI.** Railway reported a successful deployment; runtime logs confirmed the app runs as UID/GID 1000. Live `/api/status` returned HTTP 200 with private access required and the owner's OpenAI key configured. Successful live authenticated sign-in and inference remain unverified. Configuration status does not establish provider connectivity or clinical accuracy; see [VALIDATION_STATUS.md](VALIDATION_STATUS.md).

Railway project: `AI-FM-STUDYCHAT`, ID `3d314e6c-8def-4947-949a-eef7ce930e63`.
Environment: `private-test`, ID `05fb154d-1946-4db0-bf4e-786727e505df`.
Service: `family-medicine-phone-test`, ID `78d73fb2-96fa-45bc-97e4-6aa108724dc5`.
Volume: `private-study-data`, 500 MB, mounted at `/app/data`.

Dashboard: https://railway.com/project/3d314e6c-8def-4947-949a-eef7ce930e63/service/78d73fb2-96fa-45bc-97e4-6aa108724dc5?environmentId=05fb154d-1946-4db0-bf4e-786727e505df

Phone app: https://family-medicine-phone-test-private-test.up.railway.app

## Open the private phone pilot

1. Repository access is available after the owner made `aibotjock/AI-FM-STUDYCHAT` public. Deploy the intended release revision and check Railway's active deployment; a GitHub push alone does not establish which revision is running.
2. The service uses `APP_MODE=personal` for the owner's first trial. Do not use commercial accounts as an unverified paid launch.
3. `HOST=0.0.0.0`, `DATA_DIR=/app/data`, and a strong randomly generated `STUDY_ACCESS_TOKEN` are already set on the service. Copy that variable's value into the phone's **Study access code** field. It is separate from `OPENAI_API_KEY`. Never put either secret in a URL or public repository.
4. Use `AI_PROVIDER=openai`. The owner has already configured `OPENAI_API_KEY` privately in the service's **Variables** tab; live status confirms its presence. `OPENAI_MODEL` sets the initial personal model, and `COMMERCIAL_OPENAI_MODEL` is separate. Claude remains inactive. Deploy variable changes. API charges belong to the operator's OpenAI account. See [AI_PROVIDERS.md](AI_PROVIDERS.md) for owner model selection, connection checks, and export. Astra is prohibited at all times, without exceptions.
5. The container initializer changes only `/app/data` ownership and permissions, clears groups, drops all UID/GID identities to 1000 and verifies zero effective/permitted capabilities before importing the app. Application source is root-owned/read-only. It never walks descendants or starts a listener as root. A persistent-root runtime variable was rejected by automatic review and was not enabled. The successful deployment logs confirmed UID/GID 1000 and server startup; the SQLite store was initialized before listening.
6. Live HTTPS responses have no-store caching, CSP, frame denial, MIME sniffing protection and a restrictive permissions policy. Owner sign-in, live inference, physical-phone behavior, and persistence across a host restart need their outstanding checks. Check the hosting plan and usage, and keep the pilot small.
7. Complete outstanding items in [PHONE_TEST.md](PHONE_TEST.md) on the owner's physical phone. Model controls belong to this shared-token personal workspace; keep its access code private. The catalog filters supported documented text models against account availability and labels unconfirmed lists. Model connection tests do not evaluate clinical accuracy, and Ingenium is not connected. Store submission remains on hold until the owner gives permission; do not charge subscribers from this environment.

For a later commercial pilot, use a separate data directory/environment, `APP_MODE=commercial`, `PRIVATE_PILOT=true`, `PUBLIC_RELEASE=false`, an exact HTTPS `APP_ORIGIN`, and a long invitation token. Configure separate staging billing/provider secrets if testing real billing. Do not copy the owner's personal workspace into subscriber accounts.
