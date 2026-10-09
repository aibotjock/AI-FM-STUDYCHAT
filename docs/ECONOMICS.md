# Subscription economics — planning assumptions

Prepared October 9, 2026. This is a cost model, not a revenue or profit forecast. The requested launch price is **US$4.99 monthly after a three-day trial for eligible new subscribers**. Regional prices, taxes, and trial eligibility must come from Google Play product details.

## Connect AI for subscribers

Subscribers create an app account; they do not bring an OpenAI key or need a ChatGPT subscription. The Android app sends the purchase token to our authenticated server. The server verifies ownership, product, expiry, and subscription state with Google, then authorizes coaching. The server calls OpenAI using the operator's secret key. Keys and Google service-account credentials never enter the browser or Android bundle.

The preparation uses the pinned `gpt-5.4-mini-2026-03-17` snapshot for bounded text requests. It is a candidate model, not a clinically validated selection. A model change requires a repeat of the clinical benchmark and a price update. Device keyboard dictation and browser read-aloud avoid a separate paid realtime audio connection; a conversational voice service would need its own budget and evaluation.

## Per-member illustration

OpenAI lists standard text prices of $0.75 per million input tokens and $4.50 per million output tokens. At an **assumed** 3,000 input tokens and 400 output tokens per completed turn:

`(3,000 × 0.75 + 400 × 4.50) / 1,000,000 = $0.00405 per turn`

Two hundred such turns cost **$0.81**. This excludes retries, moderation, embeddings, searches, and any separate audio service. There is no assumed cache discount. Real token usage must be measured; long conversations can cost more.

| Monthly amount per paying member | Illustrative US dollars |
| --- | ---: |
| Subscription price | 4.99 |
| Google Play fees, 15% combined | −0.7485 |
| Receipt before other expenses | 4.2415 |
| AI at the assumed usage above | −0.81 |
| Contribution before hosting and other expenses | **3.4315** |

Google's current US subscription schedule is a 10% service fee plus a 5% Play Billing fee. This model uses normal Play Billing. Alternative billing adds operational requirements and payment-processor costs and is not part of this preparation.

| Paying members | Gross sales | Play fees | Illustrative AI | Assumed hosting | Remaining contribution |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | $499.00 | $74.85 | $81.00 | $25.00 | **$318.15** |
| 500 | $2,495.00 | $374.25 | $405.00 | $25.00 | **$1,690.75** |
| 1,000 | $4,990.00 | $748.50 | $810.00 | $25.00 | **$3,406.50** |

The $25 hosting line is an assumption, not a Railway quote or a scale guarantee. Remaining contribution is **not profit**: clinical editing, content licenses, support, acquisition, failed trials, refunds, taxes, and operating labor are still unpaid. In particular, licensed guideline content and clinician review could exceed infrastructure costs.

## Bound costs before charging customers

The scaffold reserves a conservative request cost before a provider call and persists the reservation. It reconciles reported usage afterward; uncertain provider outcomes retain the reservation. Default ceilings are $1 per paid entitlement period, $0.15 lifetime trial spend, 200 turns per period, 20 per UTC day, and $20 globally per UTC month. The global limit is a private-pilot safety setting and must be deliberately increased with a funded operating budget before accepting a larger subscriber base.

Cost and turn ceilings both apply, so **200 is an upper limit, not a promise of 200 long answers**. Show this clearly before purchase. Card scheduling, manually authored cards, account export, and deletion do not require an AI call. Request IDs, account isolation, and server-side entitlement checks prevent accidental duplicate charges and client-controlled access.

At the default worst reservation (8,000 input and 600 output tokens), a turn reserves $0.0087, so a $1 budget supports at most 114 such reservations. Failed or uncertain requests can reduce available turns further. The operator must compare measured p50/p95 usage and successful-turn availability before choosing the final marketed allowance.

## Test whether $4.99 can work

Start with the owner's private phone test, then a small consented pilot after clinical content and account recovery are ready. Measure first-session completion, return for due reviews, trial conversion, paid retention, report rate, successful coaching turns, AI cost per active member, and support minutes. Collect aggregate product events without logging patient details or raw conversation text into analytics.

An example planning assumption of 10% monthly paid churn implies an average ten-month paid lifetime and about $34.32 contribution before fixed/editorial expenses. This is not observed retention. Acquisition spending must fit below contribution after those expenses; do not buy ads on this assumption alone. If trials convert at 20% and cost the full $0.15 each, trial AI alone adds $0.75 per acquired paying member, before marketing.

The value proposition is a short daily reasoning-and-recall session, rather than unlimited AI. Keep the launch scope focused: useful reviewed content, comfortable phone chat, editable active-recall cards, a transparent schedule, and visible source dates. Add paid realtime voice only if measured retention justifies its cost.

Sources checked October 9, 2026:

- OpenAI model pricing and snapshot: https://developers.openai.com/api/docs/models/gpt-5.4-mini
- Google Play fees: https://support.google.com/googleplay/android-developer/answer/112622?hl=en
- Subscription and trial setup: https://support.google.com/googleplay/android-developer/answer/140504?hl=en
- OpenAI server-only keys: https://developers.openai.com/api/reference/overview
