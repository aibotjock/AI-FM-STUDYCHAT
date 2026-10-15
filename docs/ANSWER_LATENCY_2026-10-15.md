# Answer latency investigation — October 15, 2026

The app used in the recent phone session is `family-medicine-phone-test`, running
public repository `aibotjock/AI-FM-STUDYCHAT` at restored commit
`f4b20414d337230f4d90a3c8a14656c3922f5ff1` (`feature/conversation-agent`).
This branch starts at that exact revision. The separate no-RAG app and private
JEV experiment are different builds and are not the basis of this change.

## Observed evidence

Railway HTTP logs for the recent session contain eight successful `/api/chat`
requests lasting 2,588–9,688 ms. Their total durations include the server's
complete chat work; they do not identify the share spent writing versus
reviewing. Separate speech requests followed six of those replies. These HTTP
timings are not first-audible-playback measurements.

The app's public `/api/status` reported the selected model as
`gpt-4o-mini-2024-07-18`. No credential or learner transcript was read.

In `server/index.js`, each generated natural reply awaits two calls to that
selected model: complete author output (800-token cap), then an independent
whole-answer/source review (2,000-token cap). Server validation then checks the
review, source spans and question restrictions before saving and returning the
reply. Speech uses that saved approved text. The second call depends on the
completed first answer; this branch retains that sequence.

There is no web-search request or model-catalogue refresh on this chat path.
Ingenium queues telemetry locally and starts delivery asynchronously. The
reviewed code therefore does not establish those as the source of the wait.
JEV variables are on `studychat-no-rag-test`, which does not serve the recent
phone requests; JEV is not currently accelerating this conversation path.

## This branch

- Removes the exact current request duplicate from bounded prompt history only
  when the actual chat caller explicitly supplies it separately. The full
  request still reaches the author as its final user message and the reviewer
  as `learnerRequest`. Earlier repeated wording and playback/trust metadata stay.
- Omits duplicated inline output schemas only for models already receiving
  the identical strict native schema. The adapter's supported-model list and
  outgoing request behavior are unchanged. The current GPT-4o-mini profile
  retains its existing inline-schema behavior.
- Displays saved provider durations as `Writing … s · Checking … s`, making the
  two stages distinguishable. These labels do not measure speech or establish
  medical accuracy. Imported, client-reported and invalid timings are excluded.
- Serves and precaches the new display helper so the installed app can load it.

The selected model, source checks, output caps, independent reviewer, speech
engines and interruption controller are unchanged. No service was deployed.

A synthetic short-request fixture removed **272 prompt bytes** across both
calls on the current model's path; native-schema mode removed **3,025 bytes**.
These are input-size measurements, not measured latency or clinical-quality
results. In particular, the current-model saving is modest.

## Verification and next decision

The complete Node suite reports **499 tests: 498 passed, 1 existing skip, 0
failures**. `npm run check`, JavaScript syntax checks and whitespace checks pass.
An HTTP regression test uses the actual public model snapshot and confirms
both calls retain full schemas, the current request remains complete, earlier
identical wording remains, and no response is delivered until review completes.
The timing helper is tested through the real static route and service-worker
asset list. Independent code review found no blocking regression.

No new live inference, paid model comparison, microphone/device test, or
browser rendering test was run; the local Playwright Chromium binary is absent.
Existing corpus checks do not establish clinical readiness or launch approval.

The next useful phone comparison should record the displayed writing and
checking times for representative study turns. Then evaluate a faster candidate
for the slower stage against the same complete answers, sources and acceptance
checks. A reviewer change requires workload qualification; passing schema tests
or a high JEV relevance score does not qualify its medical judgments. Promote a
change only after repeated quality and total-latency comparisons, retaining the
restored build as the rollback target. No substantial user-visible speedup has
yet been demonstrated by this branch.
