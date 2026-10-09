# Family Medicine Study Coach — release preparation

**Store submission is on hold until the owner explicitly approves it.** No Play app, subscription or production release was created. The personal phone pilot is live at https://family-medicine-phone-test-private-test.up.railway.app. The first milestone is the owner's physical phone test, including a live provider conversation after a server API key is configured.

## Product definition

Working title: **Family Medicine Study Coach** (27 characters). Proposed package: `com.aibotjock.familymedicinestudycoach`. Proposed subscription ID: `family_medicine_monthly`, monthly base plan, US$4.99, eligible-new-subscriber three-day free-trial offer configured in Play Console. These identifiers must be confirmed before creation; Play product IDs cannot subsequently be reused or renamed.

The initial audience is family medicine residents and physicians studying clinical reasoning. The app is an independent educational product. It is not ABFM-endorsed, an official exam bank, accredited CME, a clinical decision device, or a substitute for professional judgment. Do not use ABFM branding or claim board-exam success or guaranteed accuracy.

The curriculum map follows the ABFM's public blueprint: acute care and diagnosis 35%, chronic care management 25%, emergent and urgent care 20%, preventive care 15%, and foundations of care 5%. This defines topic coverage; guideline recommendations require their own current, authorized sources and clinical review. See [CLINICAL_CONTENT.md](CLINICAL_CONTENT.md).

## First: private phone trial

Keep the personal workspace available for the owner's first study session. It supports chat with a server-configured API key, or explicitly labeled worksheets without a key, plus editable cards and spaced reviews. It has no reviewed clinical guideline corpus. Do not infer clinical validation from a working chat.

The HTTPS host has persistent storage and a private access token. Retrieve the access token from the host dashboard, then open the real app URL on the phone. The bounded ownership-and-privilege-drop initialization described in [HOSTING.md](HOSTING.md) was verified in a successful hosted deployment. The requested provider is Claude Haiku 5.5; OpenAI remains an option. No live provider key has been provided. Configure it in host secrets, never in chat or the repository.

Use [PHONE_TEST.md](PHONE_TEST.md) to run chat, keyboard dictation, answer-to-card editing, review ratings, reload persistence, and home-screen installation. The Android source is preparation for a later native trial, not a substitute for the first browser test.

## Preparation present in this branch

- Personal mode remains available as a single-user prototype.
- Commercial mode adds separate accounts and workspaces, server-side entitlement verification, AI cost reservations, answer reports, and deletion flows.
- Commercial clinical answers accept only reviewed, commercially authorized, current evidence records. Empty or unmatched evidence produces an explicit abstention. The included reviewed corpus is empty.
- Android source targets API 36 and uses Play Billing 8 or later. The native source needs an SDK build and physical-device billing tests.
- Clinical, billing, privacy, and cost documentation records the outstanding launch work.

This is a **private-pilot scaffold**. `PUBLIC_RELEASE=true` is deliberately blocked. Email verification/recovery, production report triage, purchase lifecycle operations, clinical content, and native distribution have not been certified ready.

Deleting an account removes its active study files, credentials, sessions, report text, and cached AI content. A minimal pseudonymous receipt/cost ledger is retained to prevent receipt reuse and spending abuse. Account deletion does not cancel a Google Play subscription; show the cancellation route at deletion. Exported backups and operator-managed storage backups need a documented retention/deletion policy before launch, and restoration must not resurrect deleted accounts. Do not promise deletion of already downloaded user exports.

## Gates before any paying public launch

| Gate | Concrete evidence needed |
| --- | --- |
| Owner phone test | Completed checklist, app URL, device/OS, observations and fixes |
| Clinical corpus | Rights cleared for commercial redistribution and AI processing; named clinician reviews; effective/review dates; conflict policy |
| Clinical evaluation | Independently reviewed benchmark covering all blueprint domains, high-risk scenarios, disagreement and abstention; every critical failure resolved |
| Account security | Email verification, recovery, abuse controls, deletion under in-flight calls, independent security review |
| Billing | Real Play license-tester purchases, trial eligibility, acknowledgement, renewals, restore, cancellations, grace/hold, refunds/revocations and RTDN reconciliation |
| Native quality | Android SDK build, signed AAB, physical phone tests, accessibility, external-link/bridge security, edge-to-edge/keyboard checks |
| Privacy | Real operator and support contact, retention and processor disclosures, live public HTML privacy/deletion pages, accurate Data safety form |
| AI reports | Reports received and triaged by an assigned operator; prohibited-content handling and response process |
| Commercial model | Measured costs and retention, final allowance disclosed before purchase, funded provider/global budget, content/support costs included |
| Store prerequisites | Appropriate developer account, health declaration, content rating, screenshots, app access instructions, applicable testing requirements |
| Submission | Owner reviews release evidence and gives explicit permission |

Google directs health/medical apps to organization accounts; confirm the medical-education category before choosing the account type. Organization verification can require a D-U-N-S number. New personal accounts can have closed-testing and physical-device verification requirements. These steps are not completed by writing source code.

## Store copy draft — use only after launch gates pass

Short description: **Practice family medicine reasoning with a study coach and spaced recall.**

Long description draft:

> Build a daily family medicine study routine. Work through guided reasoning questions, revisit difficult topics, and turn lessons into editable active-recall cards. Review cards on a spaced schedule and track your learning activity.
>
> Reviewed learning material shows its source and review date. The coach identifies when available evidence does not support an answer. The curriculum is organized around the public ABFM exam blueprint. This independent app is not affiliated with or endorsed by ABFM.
>
> Coaching requires a subscription after an eligible free trial. Your applicable price, trial eligibility, renewal terms, and coaching allowance are shown before purchase. Manage or cancel your subscription through Google Play.
>
> For education only. This app is not a medical device and does not diagnose, treat, cure, or prevent medical conditions. Consult a qualified healthcare professional for medical advice, diagnosis, or treatment. Do not enter identifying patient information.

Do not publish this draft while the reviewed corpus is empty. Screenshots must show actual final behavior, not invented accurate answers, fake subscriptions, or fabricated clinical endorsements.

Suggested US paywall terms, only when matching the returned Play offer: “3 days free for eligible new subscribers, then $4.99/month. Renews automatically unless canceled. Cancel in Google Play before the trial ends to avoid the first charge.” Display the localized actual offer and all included limits. Account deletion and subscription cancellation are separate actions and must both be easy to find.

Sources checked October 9, 2026:

- ABFM blueprint: https://www.theabfm.org/family-medicine-exam-blueprint/
- Play target API: https://support.google.com/googleplay/android-developer/answer/11926878?hl=en
- Play billing versions: https://developer.android.com/google/play/billing/deprecation-faq?hl=en
- Subscription policy: https://support.google.com/googleplay/android-developer/answer/9900533?hl=en
- Health requirements: https://support.google.com/googleplay/android-developer/answer/16679511?hl=en
- Account type: https://support.google.com/googleplay/android-developer/answer/13634885?hl=en
- Account deletion: https://support.google.com/googleplay/android-developer/answer/13327111?hl=en
- AI reporting: https://support.google.com/googleplay/android-developer/answer/13985936?hl=en
