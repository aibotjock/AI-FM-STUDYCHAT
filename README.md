# Family Medicine StudyChat — no RAG rebuild

A private, single-owner study app: one Node.js 24 process, one SQLite database, and browser modules. Coach makes one direct request to the selected OpenAI or Anthropic text model for an ordinary chat turn. Practice grades canonical questions on the server; review uses the copied SM-2-inspired scheduler. There are no production dependencies or frontend build step.

## Run

```sh
cp .env.example .env
# Add OPENAI_API_KEY and/or ANTHROPIC_API_KEY on the server for AI.
npm start
```

Open http://127.0.0.1:3000. Local loopback use can omit the study access token. Any remote bind requires `STUDY_ACCESS_TOKEN` with at least 32 characters; use an independently generated random value, never a provider key. Remote `APP_ORIGIN` must be the exact HTTPS origin.

```sh
npm test
```

Node 24's built-in `node:sqlite` is required. No `npm install` is needed. Docker runs the same application. See [deployment instructions](docs/deployment.md) for the isolated Railway service and persistent `/app/data` volume. Keep one replica.

## Study behavior

Defaults are clinical reasoning, guided questions, 18 minutes daily, and five new cards. The original eligible cases, starter cards, and reflection worksheets are retained. Study signals and self-ratings are learning aids, not official competency ratings or board-passage predictions.

The bank begins with 566 original questions: 558 U.S. study items and eight comparative items. Runtime eligibility, source expiry, withdrawals, jurisdiction, and shortages come from the pinned engine. Some starting source reviews expire on November 9, 2026; availability may decrease. An operator must supply a reviewed bank update with new provenance rather than change dates to bypass expiry. Original questions are independent study material, not official ABFM exam items.

Coach quiz commands are `/quiz`, `/quiz <topic>`, choices A–E, and `/reveal`. Reflection preserves a pending question. Practice and review actions carry unique IDs so repeated delivery commits once. Reload resumes saved study state; AI work does not restart automatically.

Cards can be personal or drawn from a canonical question. Personal and imported cards stay unverified. Editing a question card removes its canonical-source status. Review is an SM-2-inspired heuristic, not FSRS or a validated retention estimate.

## References and uncertainty

The separate searchable directory preserves 429 URLs, 523 metadata records, 75 registry records, and 17 historical research documents with their source-use restrictions. Metadata loads on demand. Historical notes are not medical authority. Publisher identity screening did not clinically validate every entry or grant AI-processing/commercial rights.

Directory entries are labeled **Reference link**. The app does not fetch or process their full documents, and never labels a directory selection **Consulted source**. Canonical quiz citations are **Question sources**, with no claim they were checked live. Model-written URLs do not create source badges. Missing sources never block ordinary conversation; precise or changing recommendations require honest limits.

## Chat and optional voice

Each turn has a stable identity and one active attempt per conversation. New turns stop the previous attempt. Completed delivery is idempotent; retrying the latest failed turn uses a new attempt on the same user message. Failed, cancelled, and interrupted text stays visible and is excluded from normal model context. An accepted input is saved before the provider request; terminal state is saved separately. Restart marks unfinished attempts interrupted.

Choose a model in Coach or Settings. The authenticated catalogue reads each configured provider's available general text models and caches the list for ten minutes. Audio, image, embedding, tool-specific, and retired models are excluded. Missing provider credentials disable its choices. If listing fails, documented choices are marked with account access unconfirmed. A selection is saved and captured per attempt; changing it does not redirect a running reply. The app never retries, changes providers, or falls back to another model automatically.

Models priced at $3 or more per million input tokens, $15 or more per million output tokens, or with unconfirmed prices use the limited budget. Prices are standard API rates checked October 10, 2026; account-specific and future prices may differ. Server limits cap prompt bytes and output tokens, with only one paid Coach reply active at a time. Older completed conversation pairs are dropped to fit the prompt budget; an oversized essential prompt is rejected before a paid request. These limits reduce spending, but are not a guaranteed dollar ceiling. OpenAI reasoning tokens can consume the output budget; a truncated reply is reported as incomplete. Modern OpenAI models use Responses, legacy compatible models use Chat Completions, and Claude uses Messages. Models documented without streaming use one buffered request.

Voice is optional and loaded from the compact waveform button beside the message box. Choose Heart, Bella, Nicole, Michael, or Emma in the voice dialog or Settings; no Settings opt-in is required. Press Start conversation to allow microphone capture. Stop, close, or background the app to release it. Final transcripts follow the same chat contract and use the selected OpenAI/Claude answering model. Speech reads only a completed saved response; audio never delays text or generates a second answer. Speech is AI-generated. Microphone capture needs a secure browser context and explicit permission. Browser mock tests cannot establish physical-phone echo cancellation or Bluetooth reliability.

The separate [speech service](services/speech/README.md) uses Pipecat's local Faster-Whisper recognition and Kokoro ONNX synthesis. It has no paid speech API or paid fallback. Only the Node backend connects to it; the browser never receives its URL or credential. The app checks model readiness before offering microphone capture. If speech is unavailable, typed chat remains usable. Existing paid voice preferences migrate to Heart when loading settings or backups. No speech models or Python dependencies are loaded into the Node app.

Self-hosted speech removes vendor speech fees; CPU, RAM, hosting and the selected answering model are separate costs. Railway can host the speech worker privately in the same project and region. The worker's Docker image includes its models, so a separate model volume is unnecessary. Start with one worker and measure latency and memory before increasing resources; this turn-based architecture is not native simultaneous speech-to-speech.

## Settings and backups

Settings and validated JSON backups use authenticated APIs. Export contains learner data and model preferences, never provider keys, the access token, or session cookie. Restore replaces the workspace atomically and validates its schema and size before changing data. Version-one pilot backups migrate on a copy: historical sources remain imported/unverified, old practice scores are not trusted, and old active quizzes do not become live pending state. Back up before restore. The rebuild never opens the pilot's writable database.

The installable shell caches public interface files only. Saved study data still requires this backend; shell caching is not offline synchronization.

## Configuration and limits

| Setting | Default | Purpose |
| --- | --- | --- |
| `HOST`, `PORT` | `127.0.0.1`, `3000` | Railway supplies `PORT`; remote host is `0.0.0.0` |
| `DATA_DIR` | `./data` | One durable SQLite database |
| `APP_ORIGIN` | derived origin locally | Pin the hosted HTTPS origin |
| `STUDY_ACCESS_TOKEN` | empty locally | Private owner login |
| `OPENAI_API_KEY` | empty | Server-only OpenAI text-model credential |
| `ANTHROPIC_API_KEY` | empty | Server-only Anthropic credential |
| `OPENAI_MODEL` | `gpt-4.1-mini` | Default OpenAI text model |
| `ANTHROPIC_MODEL` | `claude-haiku-5-5` | Default Anthropic text model |
| `CHAT_TIMEOUT_MS` | `90000` | Bounded generation; independent browser deadline |
| `MAX_INPUT_CHARS` | `8000` | Input bound |
| `MAX_OUTPUT_TOKENS` | `1200` | Standard-model output bound |
| `LIMITED_OUTPUT_TOKENS` | `768` | Expensive or unpriced-model output bound |
| `STANDARD_PROMPT_BYTES` | `24000` | Standard-model UTF-8 prompt bound |
| `LIMITED_PROMPT_BYTES` | `8000` | Expensive or unpriced-model UTF-8 prompt bound |
| `MAX_HISTORY_MESSAGES` | `12` | Completed context window |
| `SPEECH_SERVICE_URL` | empty | Separate speech service origin: local/private Railway HTTP or remote HTTPS |
| `SPEECH_SERVICE_TOKEN` | empty | Independent server-only bearer credential, at least 32 characters |

Additional fixed bounds: 128 KiB ordinary JSON, 16 MiB backup/workspace, 2 MiB microphone upload (60 seconds at 16 kHz), 8 MiB speech output, 4,096 spoken text characters, 20,000 chat output characters, 45-second speech deadline and 95-second transcription deadline. The speech worker itself limits operations to 90 seconds. These are request/resource bounds, not daily AI quotas. Transcription retains the existing owner/session/request safeguards. Speech metadata records zero vendor API fees while explicitly excluding hosting costs. Cancellation can still incur answering-model charges or consume self-hosted CPU time.

The app logs startup and terse error/status diagnostics without learner text or secrets. Model/provider failures are service errors, not invented medical abstentions. The tutor prompt supports honesty; it does not guarantee medical correctness.

## Ingenium test client

The optional Ingenium feed uses a separate test application account, `STUDYCHAT-NO-RAG-TEST`, and a dedicated server credential. Configure `INGENIUM_TELEMETRY_KEY` and `INGENIUM_TELEMETRY_ORGANIZATION_ID` only on the new service. Each attempted provider text request produces model, usage, timing, status, and nullable estimated-cost metadata. Prompts, answers, learner identities, recordings, provider keys, and cookies are excluded. Unknown usage or cost stays unknown. Deterministic practice, model-list reads, and blocked requests produce no invented inference events.

Metadata enters a small SQLite outbox and is delivered in the background to Ingenium's dedicated `studychat-test-events` receiver. Reply streaming never waits for telemetry. Delivery retries reuse the observation UUID and never repeat model inference. At most 500 local observations are retained; a full queue reports dropped events instead of growing without bound. Authentication rejection pauses delivery until credentials are corrected and the app restarted. Settings shows delivery counts, errors, and the last acknowledgement, refreshing every ten seconds while visible. These counters report collector delivery, not model quality or clinical correctness.

Genuine requests are marked `app_observed`. Collector fixtures are marked `client_simulated` and must have null token and cost values. Ingenium stores the actual returned model (or the requested model if unavailable), while each saved chat attempt retains its requested provider/model locally. The test application account uses an application key; it does not create a portal password or weaken portal MFA. See [test-client integration](docs/ingenium-test-client.md).

## Provenance and validation

[Component manifest](docs/components.json) records exact source commits and local changes. Copied notices and reference restrictions remain in place. No commercial release or rights grant is implied.

[Validation record](docs/validation.md) separates engine, deterministic provider, browser, actual-model, hosted, and physical-device evidence. Checks that have not run are identified explicitly.

[Free speech validation](docs/free-voice-validation.md) records the Whisper/Kokoro/Pipecat branch's checks and separates local inference from browser fixtures and physical-phone testing.
