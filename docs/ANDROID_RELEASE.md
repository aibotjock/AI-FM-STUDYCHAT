# Android release preparation — Family Medicine Board Study

Prepared October 9, 2026. Publication is **on hold until the owner explicitly
approves deployment and store submission**. Source changes and GitHub preparation
do not authorize hosting changes, Play uploads, test-track distribution, account
registration payments, real subscription purchases, or production release.

## What is prepared and what is still unverified

`android/` contains a Kotlin Android shell for the existing mobile web app with
native Google Play subscription purchase and restore flows. Its package is
`com.aibotjock.familymedicinestudycoach`; its one subscription product ID is
`family_medicine_monthly`. It targets and compiles API 36, supports API 26+, pins
AGP 8.13.2 / Kotlin 2.2.21 / Play Billing 8.3.0 / AndroidX WebKit 1.17.1, and expects
JDK 17 and Gradle 8.13. These versions are deliberate compatible pins, not a claim
that every dependency is the newest available.

The current preparation environment has JDK 17 but **no Android SDK or Gradle**.
There is no generated Gradle wrapper, compiled APK/AAB, signing key, device-test
result, Play product, verified merchant account, or store submission from this
work. An unsigned/source-only preparation is not a release-ready artifact.

The JavaScript bridge contract check (`node android/test-bridge.mjs`) and XML
parsing passed in this preparation environment. These verify message serialization,
repeat initialization, subframe/no-native refusal and resource syntax; they do
not verify Kotlin compilation, native origin enforcement, Play billing or device
behavior.

## Build and signing, after deployment permission

1. Choose the stable public HTTPS application origin and deploy the backend after
   owner approval. It must use persistent storage, per-user accounts, private AI
   keys, commercial entitlements and usage limits. The shell must point to this
   app, not a temporary preview or third-party reference page.
2. On a developer workstation install Android Studio, JDK 17, SDK platform 36,
   the compatible SDK build tools, Android platform tools and Gradle 8.13. Read
   and accept SDK licenses as the owner. Network access to official Gradle,
   Google Maven and Maven Central is needed for dependency resolution.
3. From `android/`, generate the official wrapper with installed Gradle. The URL
   below is a placeholder that must be replaced; it is not a deployed service:

   ```bash
   gradle -PAPP_URL=https://YOUR-DEPLOYED-APP-HOST/ wrapper --gradle-version 8.13 --distribution-type bin
   ./gradlew -PAPP_URL=https://YOUR-DEPLOYED-APP-HOST/ :app:lintDebug :app:assembleDebug
   ```

   Review and commit the official wrapper files and distribution checksum before
   CI is enabled. Supply `APP_URL` as an explicit Gradle property; builds reject
   missing values, HTTP, URL credentials, queries, fragments, non-443 ports and `.invalid`
   placeholder hosts. The APK contains this public URL only, never an AI or
   service-account credential. Android Studio can set the same property in a
   developer's untracked local Gradle configuration.
4. Install the debug APK on real Android phones, test all gates below, and address
   lint/compile/runtime failures. The app assumes a current Android System WebView
   with the origin-scoped WebMessageListener feature; update WebView if needed.
5. Generate a **signed Android App Bundle** through Android Studio's Generate
   Signed Bundle workflow with the owner's upload key. Enroll in Play App Signing.
   Keep the keystore, passwords and service-account JSON outside Git and APKs;
   preserve encrypted recoverable backups. The project has no built-in release
   signing configuration. A plain `bundleRelease` output without owner signing
   cannot be claimed to be suitable for Play upload.
6. Increment `versionCode` for every uploaded build. Keep the package immutable
   once a Play app is registered. Validate the final merged manifest and native
   dependencies, then recheck current Play target/billing requirements.

## Subscription setup, after permission to configure Play

Use a free-to-install app with a recurring subscription, not a $4.99 paid download.
Suggested Console configuration:

| Console object | Value |
|---|---|
| Subscription product | `family_medicine_monthly` |
| Subscription name | Family Medicine Board Study |
| Base plan | `monthly`, auto-renewing, one-month period |
| US base price | USD 4.99 |
| Acquisition offer | `trial-3-days`, 3-day free trial, then the base plan |
| Trial eligibility | New customer acquisition: never had any subscription in this app |
| Initial audience | US adult medical learners and physicians; owner confirms regions |

Google's supported minimum free trial is three days. Never name the product
"Free Trial," promise a trial to ineligible returning customers, or substitute a
local timer for a purchase verified by Google. Price, currency, billing period
and eligible offer token come from native `ProductDetails` and are authoritative;
the prepared commercial terms describe the intended US product only. Show all
pricing phases, renewal terms, included usage limits and cancellation instructions
before opening Google's purchase sheet. Returning users may receive a paid-only
offer. Do not hardcode their display to "$4.99 after 3 days."

Typical eligible-US copy: **3 days free, then $4.99/month. Renews automatically
unless canceled. Cancel in Google Play before the trial ends to avoid the first
charge.** Review the exact text against the returned offer. Entitlements are
server-verified; canceled subscriptions retain access through verified expiry,
grace periods retain access where Google says so, and account hold/expiry/revocation
must remove access. Account deletion does not cancel a Google Play subscription;
show the management link separately.

For US auto-renewing subscriptions Google's current fee is 10% service fee plus
5% billing fee with Google Play Billing: $4.99 leaves $4.2415 before taxes,
refunds, trial AI use, AI requests, hosting, review and support. An enrolled US
alternative billing route has a 10% Play fee plus its processor costs and
reporting obligations; standard Play Billing is the simplest prepared route.

## Web/native bridge contract

Only the configured exact HTTPS origin receives `FamilyMedicineAndroid` through
AndroidX `WebViewCompat.addWebMessageListener`. Native callbacks reject subframes
and nonmatching origins. There is no `addJavascriptInterface` or generic
arbitrary-URL bridge. Main-frame foreign HTTPS references open in an external
browser only after a user gesture. Cleartext traffic, mixed content, file/content
access, third-party cookies, and TLS error bypass are disabled.

After its main page finishes loading the shell injects this frozen API and emits
`fm-native-billing` with `detail.type === 'native-ready'`. The web app should
request product details and restore again at that point; early native startup
events may occur before a page listener exists.

```javascript
window.FMNativeBilling.getProductDetails();
window.FMNativeBilling.purchase(JSON.stringify({
  productId: 'family_medicine_monthly',
  offerToken: eligibleOfferFromGoogle.offerToken,
  accountId: status.account.obfuscatedAccountId
}));
window.FMNativeBilling.restore();
window.FMNativeBilling.manageSubscriptions();
window.addEventListener('fm-native-billing', event => handleBilling(event.detail));
```

`getProductDetails()` emits:

```json
{
  "type": "product-details",
  "products": [{
    "productId": "family_medicine_monthly",
    "title": "Provider-returned title",
    "description": "Provider-returned description",
    "offers": [{
      "basePlanId": "monthly",
      "offerId": "trial-3-days",
      "offerToken": "provider-token",
      "pricingPhases": [{
        "formattedPrice": "provider-localized-price",
        "priceCurrencyCode": "USD",
        "priceAmountMicros": 0,
        "billingPeriod": "P3D",
        "recurrenceMode": 2,
        "billingCycleCount": 1
      }]
    }]
  }]
}
```

This example illustrates shape, not a real configured offer; real offers contain
all pricing phases and may have `offerId: null`. The native shell validates the
product ID, provider-issued offer token and 64-character lowercase hexadecimal
obfuscated account ID before purchase. `GET /api/status` supplies
`account.obfuscatedAccountId`; never pass an email or a locally fabricated ID.

Successful/pending/restored purchases emit:

```json
{
  "type": "purchase",
  "source": "purchase",
  "productId": "family_medicine_monthly",
  "purchaseToken": "sensitive-provider-token",
  "purchaseState": "PURCHASED",
  "acknowledged": false
}
```

`source` can be `restore`; `purchaseState` can be `PENDING`. A pending purchase
does not unlock anything. For `PURCHASED`, send only `{purchaseToken}` by same-origin
authenticated POST to `/api/billing/verify`. The server checks Google's current
state/expiry/product/account binding, persists ownership, then acknowledges. Never
show the native callback as an active subscription until verification succeeds.
Tokens must not enter logs, analytics, screenshots, URLs, exports or localStorage.
Deduplicate repeat purchase callbacks while verification is in flight.

Other event types are `billing-ready`, `billing-error` (safe `message`, numeric
`code` when available), `billing-unavailable`, `purchase-canceled`,
`purchase-launched`, `restore-complete` (number `count`) and `native-ready`.
`restore-complete` only means enumeration completed, not server verification.
Product requests and billing errors do not grant access. Renewals do not need
acknowledgement; new purchases need server acknowledgement within three days.

Before production, provision Real-time Developer Notifications (RTDN), validate
delivery authentication, re-query Google for authoritative state, and implement
retry/reconciliation for missed events and acknowledgement failures. A restore
button alone is not a reliable full subscription lifecycle implementation.

## Phone and voice behavior

The first Android version supports text chat and **keyboard dictation** (the
microphone on a compatible phone keyboard). It does not request microphone,
camera, location or file permissions; WebView media permission requests are
denied. Do not advertise a working native audio assistant, always-listening
conversation, or Web Speech microphone button without physical-device evidence.
If direct in-app voice is added later, test a native speech path, obtain runtime
permission only when the user invokes it, disclose actual processing providers,
and update the privacy/Data safety declarations.

## Device, account and Play verification gates

Before an owner-approved test-track upload and, again, before public release:

- Compile and lint the actual signed build; test supported phones at API 26,
  a current Android version, and API 36 with updated Android System WebView.
- Check login/sign-up/logout/deletion, per-user data isolation, keyboard scrolling,
  bottom controls, landscape, system bars, font scaling, TalkBack and offline/retry
  behavior. Keyboard dictation must be checked on the user's actual phone.
- Verify foreign links/subframes cannot use billing, bad TLS cannot load the app,
  HTTP config is rejected, web-session cookies remain secure, and no secret enters
  the APK, bridge events beyond temporary purchase tokens, logs or backups.
- With **license-test accounts only**, test eligible trial, ineligible returning
  user, paid subscription, pending/canceled purchase, offer refresh, unavailable
  product, restored purchase, wrong app account, simultaneous verification,
  server outage/retry, renewal, cancellation, grace/hold, expiry and revoked/refunded
  purchase. Record results against native and backend versions. License test
  subscriptions have accelerated timings; don't interpret those as a real 3-day
  client trial. Do not perform a real charge without owner authorization.
- Verify server purchase processing binds tokens to one account, acknowledges
  promptly, revokes access from updated authoritative state, and never exposes
  Google service-account/AI credentials. Confirm RTDN and reconciliation work.
- Establish a clinician-reviewed guideline corpus and medical accuracy benchmark,
  source-date/update process, AI error reporting and safety review. A published
  ABFM content blueprint is a topic outline, not clinical guidance, ABFM approval,
  or proof of generated-answer accuracy. Do not claim ABFM certification,
  endorsement, exam-question equivalence or guaranteed medical correctness.
- Complete Health apps declaration, accurate Data safety, content rating,
  adult-audience decision, reviewer credentials and support contact. Publish actual
  HTTPS privacy and account-deletion-request pages accessible without reinstalling.
  Verify in-app report handling, data retention/deletion and AI-processing
  disclosures; placeholders do not satisfy these gates.
- Google's account guidance directs medical/health apps toward an Organization
  account with a verified D-U-N-S number. Verify classification and existing
  developer-account eligibility in Console; do not assume a personal account is
  eligible because the product is educational. Organization setup can take time.
  If a new personal account is applicable, accounts created after November 13,
  2023 need 12 testers continuously opted in for 14 days and production-access
  approval, plus physical-device verification for new personal accounts.
- Get the owner's separate approval for Play submission/deployment only after
  the final signed build, declarations, test record and listing are reviewable.

## Screenshots and listing assets still to capture

Capture the **actual Android app** with de-identified fictional study material,
no email, patient data, purchase token or unsupported feature:

1. Coach conversation with source labels and visible educational context.
2. Guideline-based study case and one-question-at-a-time feedback.
3. Spaced-repetition review and due queue.
4. Progress and topic coverage.
5. Eligible Google Play subscription screen with real localized pricing,
   trial/renewal terms, usage limits and cancel/restore controls.
6. Account/privacy/deletion/report controls.

Prepare 1080×1920 portrait screenshots from real tested screens, a reviewed
512×512 store icon and 1024×500 feature graphic. Play accepts screenshots from
320 to 3840 pixels per dimension with the longer dimension no more than twice
the shorter. At least two screenshots are required; four high-resolution
screenshots help meet screenshot-led recommendation guidance. The source vector
launcher icon is a development asset, not an exported final Play graphic.

## Official sources checked October 9, 2026

| Requirement | Official documentation |
|---|---|
| Target API 36 | https://support.google.com/googleplay/android-developer/answer/11926878?hl=en |
| Billing Library 8+ deadline | https://developer.android.com/google/play/billing/deprecation-faq |
| Billing 8.3.0 release | https://developer.android.com/google/play/billing/release-notes |
| AGP/JDK/Gradle compatibility | https://developer.android.com/build/releases/agp-8-13-0-release-notes |
| AndroidX WebKit | https://developer.android.com/jetpack/androidx/releases/webkit |
| Origin-scoped message bridge | https://developer.android.com/reference/androidx/webkit/WebViewCompat#addWebMessageListener(android.webkit.WebView,java.lang.String,java.util.Set,androidx.webkit.WebViewCompat.WebMessageListener) |
| AAB requirement | https://developer.android.com/guide/app-bundle |
| Play App Signing | https://support.google.com/googleplay/android-developer/answer/9842756?hl=en |
| Trial eligibility/configuration | https://support.google.com/googleplay/android-developer/answer/140504?hl=en |
| Subscription disclosure/cancellation | https://support.google.com/googleplay/android-developer/answer/9900533?hl=en |
| US fees | https://support.google.com/googleplay/android-developer/answer/112622?hl=en |
| US alternative billing | https://support.google.com/googleplay/android-developer/answer/16497028?hl=en |
| Subscription lifecycle/acknowledgement | https://developer.android.com/google/play/billing/lifecycle/subscriptions |
| Health apps/disclaimers | https://support.google.com/googleplay/android-developer/answer/16679511?hl=en |
| AI reporting | https://support.google.com/googleplay/android-developer/answer/13985936?hl=en |
| Account deletion | https://support.google.com/googleplay/android-developer/answer/13327111?hl=en |
| Developer account type | https://support.google.com/googleplay/android-developer/answer/13634885?hl=en |
| Organization/D-U-N-S | https://support.google.com/googleplay/android-developer/answer/13628312?hl=en |
| Conditional personal closed test | https://support.google.com/googleplay/android-developer/answer/14151465?hl=en |
| Device verification | https://support.google.com/googleplay/android-developer/answer/14316361?hl=en |
| Listing assets | https://support.google.com/googleplay/android-developer/answer/9866151?hl=en |

The API target deadline is August 31, 2026; Billing Library 7's deadline is also
August 31, 2026. US alternative-billing reporting/fees began October 1, 2026 under
Google's July 22 update. Recheck these policies before an approved upload; this
document records preparation facts, not account-specific approval.
