# Private phone hosting status

Prepared October 9, 2026. **No live deployment has been observed.** A generated domain by itself does not mean the app is running. The first test remains pending repository authorization and successful deployment verification.

Railway project: `AI-FM-STUDYCHAT`, ID `3d314e6c-8def-4947-949a-eef7ce930e63`.
Environment: `private-test`, ID `05fb154d-1946-4db0-bf4e-786727e505df`.
Service: `family-medicine-phone-test`, ID `78d73fb2-96fa-45bc-97e4-6aa108724dc5`.
Volume: `private-study-data`, 500 MB, mounted at `/app/data`.

Dashboard: https://railway.com/project/3d314e6c-8def-4947-949a-eef7ce930e63/service/78d73fb2-96fa-45bc-97e4-6aa108724dc5?environmentId=05fb154d-1946-4db0-bf4e-786727e505df

Reserved domain: https://family-medicine-phone-test-private-test.up.railway.app

## Complete the private trial deployment

1. Repository access is now available after the owner made `aibotjock/AI-FM-STUDYCHAT` public. The source is pinned to a specific tested commit so later pushes cannot silently replace the owner's pilot.
2. Connect the service to the validated owner-test commit/branch. Keep `APP_MODE=personal` for the owner's first trial. Do not use commercial accounts as an unverified paid launch.
3. `HOST=0.0.0.0`, `DATA_DIR=/app/data`, and a strong randomly generated `STUDY_ACCESS_TOKEN` are already set on the service. Retrieve the token through the owner's Railway dashboard when signing into the app. Never put it in a URL or public repository.
4. Configure `OPENAI_API_KEY` in host secrets for actual AI conversation. Without it, the app provides explicitly labeled worksheets and card review. API charges belong to the operator's provider account; no API key was supplied or provisioned here.
5. The initial Node deployment confirmed the root-owned mount prevents database access. The new container initializer changes only `/app/data` ownership and permissions, clears groups, drops all UID/GID identities to 1000 and verifies zero effective/permitted capabilities before importing the app. Application source is root-owned/read-only. It never walks descendants or starts a listener as root. A persistent-root runtime variable was rejected by automatic review and was not enabled. Verify logs show UID/GID 1000 and successful database writes before calling this setup ready; if the host refuses initialization, arrange a bounded storage ownership fix with the host instead.
6. Observe a terminal successful deployment, authenticate, test saved-card/review persistence across a restart, and verify HTTPS/security headers before calling the phone URL ready. Check the actual hosting plan and usage, and keep the pilot small.
7. Run [PHONE_TEST.md](PHONE_TEST.md) on the owner's physical phone. Do not charge subscribers or submit to Google Play from this environment.

For a later commercial pilot, use a separate data directory/environment, `APP_MODE=commercial`, `PRIVATE_PILOT=true`, `PUBLIC_RELEASE=false`, an exact HTTPS `APP_ORIGIN`, and a long invitation token. Configure separate staging billing/provider secrets if testing real billing. Do not copy the owner's personal workspace into subscriber accounts.
