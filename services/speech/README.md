# Local speech service

This service replaces paid transcription and speech APIs with Pipecat's
`WhisperSTTService` and `KokoroTTSService`. It does not answer questions: the
existing StudyChat server still selects OpenAI or Anthropic, saves the answer,
and sends only that completed answer here for speech. There are no speech vendor
calls or automatic paid fallbacks.

The Python models are isolated from the Node app and browser bundle. Only
Pipecat's Whisper and Kokoro extras are installed; there is no PyTorch, CUDA,
WebRTC server, vector store, or separate conversation database.

## Run with Docker

From this directory, set a random shared token without displaying it:

```sh
export SPEECH_SERVICE_TOKEN="$(python -c 'import secrets; print(secrets.token_urlsafe(48))')"
docker compose up --build -d
```

Set the same `SPEECH_SERVICE_TOKEN` on the Node app, and set
`SPEECH_SERVICE_URL=http://127.0.0.1:8081` when both run on this computer.
If Node runs in another container, use that container network's service name,
such as `http://speech:8081`. The compose port is bound to loopback.

Building downloads approximately 840 MB of fixed model assets. Exact package
versions are in `requirements.txt`; `download_models.py` pins the Whisper
revision, SHA-256 hashes for both speech models and the voices file, and Git
blob hashes for Whisper's tokenizer/configuration. Corrupted cached files fail
closed. Model weights are baked into the image. No persistent volume is needed
for the standard Docker deployment. Initialization warms both models before
`/health` returns 200.

For Python development, use Python 3.12 and:

```sh
python -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
export MODELS_DIR="$PWD/models"
.venv/bin/python download_models.py
.venv/bin/python service.py
```

The shared token must already be set. `MODELS_DIR` defaults to `/models`,
`HOST` to `0.0.0.0`, and `PORT` to `8081`. Set `OMP_NUM_THREADS=2` on a 2-vCPU
host. Pipecat's Whisper service uses faster-whisper's own CPU thread defaults;
OMP does not override every inference backend's thread pool.

## Railway deployment

Use a separate private service with repository root directory `services/speech`
and this Dockerfile. Configure `SPEECH_SERVICE_TOKEN`, `PORT=8081`,
`OMP_NUM_THREADS=2`, and health check path `/health`. Start with one replica,
2 vCPU and 3 GB RAM, then verify actual startup and turn latency on that host.
These are proposed resource limits, not a promise about Railway performance.
Use the service's private hostname for the Node server's `SPEECH_SERVICE_URL`,
for example `http://speech.railway.internal:8081`, and the same token on both.
The current Railway environment supports IPv4 private DNS; this service binds
IPv4. It does not need a public domain, a database, or a volume.

A Node app hosted on Railway cannot reach a speech process on your computer
through `127.0.0.1`. Running speech locally requires a stable authenticated
HTTPS endpoint reachable from Railway. Arrange its hostname and certificate
outside this service, keep the bearer token private, and use that HTTPS URL in
the Node configuration. Alternatively, run both app and speech locally.

Self-hosted speech has no provider usage fee. Railway compute and your selected
OpenAI/Anthropic answering model still incur their normal costs. Do not confuse
free model licensing with free cloud hosting.

## HTTP contract

| Endpoint | Request | Response |
|---|---|---|
| `GET /health` | No authentication; minimal readiness metadata | 200 when ready, 503 otherwise; `ready`, `provider`, `transcriptionModel`, `speechModel`, `voices` |
| `POST /transcribe` | Bearer token; `audio/wav` body, mono signed PCM16 at 16 kHz | JSON `{text, language:"en", model:"small.en", provider:"self-hosted"}` |
| `POST /speech` | Bearer token; JSON `{text, voice}` | `audio/wav`, mono PCM16 at 24 kHz |

Speech accepts exactly five voices: `af_heart`, `af_bella`, `af_nicole`,
`am_michael`, and `bf_emma`. Emma uses British English phonemization; the other
four use American English. Voice selection uses Pipecat's public settings
frame API, and inference uses its public `run_stt` / `run_tts` methods.

Recordings must be 120 ms–60 seconds and at most 2 MiB. Text must contain
1–4096 characters, and generated audio is bounded at 8 MiB (about 175 seconds
of 24-kHz PCM). A long reply can exceed this audio bound; its saved text remains
available. JSON bodies are capped at 32 KiB. Malformed files, unsupported voices,
and extra speech fields are rejected before inference. Logs do not include
recordings, transcripts, answer text, or credentials.

One inference job runs at a time. Additional calls receive 503 `speech_busy`
instead of forming a queue. A disconnected or timed-out HTTP caller cannot
start another job while the native model work is still running. The service's
own deadline is 90 seconds; Node allows 95 seconds for transcription and 45
seconds for speech, with browser waits of 100 and 50 seconds respectively.
Closing the browser stops microphone and playback immediately;
an already-running native CPU operation may finish in the background. Audio
is held only in memory and responses use `Cache-Control: no-store`.

## Validation

Run the isolated contract tests:

```sh
.venv/bin/python -m unittest discover -s tests -v
```

The opt-in `tests/smoke_models.py` starts the real service as a child process,
generates all five voices, checks WAV format and deterministic replay,
transcribes synthetic speech, and measures a 60-second recording and a longer
reply. It needs `SPEECH_TEST_TOKEN_FILE` pointing to a local file containing the
token, plus `MODELS_DIR`. It makes no paid speech or answering-model requests.
Its synthetic fixture verifies the integration, not clinical accuracy or real
microphone usability. Medical terms, accents, noisy rooms, and phone/browser
permissions still require testing with real users.

Observed on two CPU cores in this development environment: short five-voice
synthesis took 1.6–2.9 seconds, and synthetic greeting recognition took
2.2–2.4 seconds. A 1239-character reply took 18.3 seconds to synthesize. A
continuous 60-second synthetic recording took 69.5 seconds to transcribe.
Short turns are substantially more responsive than long recordings. These
measurements do not include answering-model delay, WAN transfer, or microphone
capture and are not a Railway latency guarantee. The measured warm service
used approximately 1.11 GiB RAM at readiness and 1.37 GiB after short tests,
with a 1.46 GiB observed peak; long-turn peak RAM was not measured. The 3-GB
initial limit allows headroom and still needs verification on the deployment.
`validation.json` records the measurements and their limitations.

```sh
.venv/bin/python tests/smoke_models.py --output /tmp/speech-results.json --audio-dir /tmp/speech-audition
```

Primary implementation references:

- [Pipecat Whisper service](https://reference-server.pipecat.ai/en/stable/api/pipecat.services.whisper.stt.html)
- [Pipecat Kokoro service](https://reference-server.pipecat.ai/en/stable/api/pipecat.services.kokoro.tts.html)
- [faster-whisper](https://github.com/SYSTRAN/faster-whisper)
- [Kokoro ONNX](https://github.com/thewh1teagle/kokoro-onnx)
- [Kokoro model and voice notes](https://huggingface.co/hexgrad/Kokoro-82M)

Pipecat is BSD-2-Clause, Whisper/faster-whisper and the Kokoro ONNX wrapper are
MIT, and the Kokoro model weights are Apache-2.0. Keep upstream notices when
redistributing the image.
