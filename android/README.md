# Family Medicine Study Coach — Android source

This directory contains an Android WebView shell and native Google Play Billing
integration for the existing HTTPS app. The JavaScript app talks to its own
authenticated backend to verify purchases and enable AI access. No AI credentials
belong in this Android project.

See [Android release preparation](../docs/ANDROID_RELEASE.md) for the bridge
contract, build prerequisites, signing, store setup, verification and release
gates. This is source preparation; no Play submission or deployment is authorized.

Security design review: the exact HTTPS origin and main frame are checked for
every native message. Replies use `JavaScriptReplyProxy`, which is tied to the
requesting frame; purchase tokens are never interpolated into evaluated JavaScript.
Reply state and queued purchase requests are cleared on navigation. Request-level
origin checks cover ordinary WebView and service-worker network requests, including
POST navigations that the navigation callback does not cover. Foreign references
open in a browser; arbitrary intent schemes are rejected. Cleartext, mixed content,
local file/content access, third-party cookies, media permissions, backup and
release WebView debugging are disabled. The backend still must verify Google
purchase ownership and authenticated account binding before granting access.

Run `node android/test-bridge.mjs` for the JavaScript message-contract checks.
Kotlin compilation and physical-device security tests remain pending; this design
review is not a penetration test, security certification or launch approval.
