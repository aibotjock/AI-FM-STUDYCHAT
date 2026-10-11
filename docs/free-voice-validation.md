# Free speech implementation validation

The app uses the self-hosted Whisper `small.en` → existing selected Coach model → Kokoro `v1.0` speech path. Pipecat runs the local recognition and synthesis services. The answering model remains the app's existing OpenAI/Anthropic gateway; speech does not create a second answering-model request. Only a completed, saved Coach reply can be spoken. There is no automatic paid speech fallback.

Five selectable Kokoro voices are advertised by the server: Heart (`af_heart`), Bella (`af_bella`), Nicole (`af_nicole`), Michael (`am_michael`), and Emma (`bf_emma`). Stored voice preferences from the previous paid speech implementation fall back to the current default when opening the picker. The browser requires an explicit Start conversation press before microphone capture. Speech is identified as AI generated.

## Automated browser checks

On October 10, 2026, Chromium 153.0.8010.0 passed the focused voice suite's 14 checks and the existing app suite's 15 workflows without page errors or paid provider requests. Results are in [free-voice-browser-results.json](free-voice-browser-results.json) and [free-voice-app-browser-results.json](free-voice-app-browser-results.json).

The focused suite verifies:

- Five labeled voice choices and immediate, persisted preference saving.
- Microphone off at startup and dialog opening; capture starts only through the explicit user control.
- Permission denial and typed-chat recovery.
- The actual browser VAD encodes injected samples as mono PCM16 WAV at 16 kHz; one utterance produces one transcription, one Coach turn, and one chosen-voice speech request.
- A selected Anthropic model remains the answering model for voice turns, with no additional answering-model request for speech.
- Prepared audio is reused after a playback restriction instead of regenerating speech.
- Mute releases tracks and the audio context; unmute reacquires one microphone. Stop, Escape, Close and backgrounding release capture. Returning to the page does not restart it.
- Closing during delayed transcription prevents a stale transcript from submitting a Coach turn. Closing during delayed speech preparation prevents stale audio playback while keeping the saved text.
- Navigation during delayed voice-options loading cannot reopen a stale dialog or acquire a microphone.
- An unavailable speech service prevents microphone access while typed chat continues with the selected model.
- The compact composer control has at least a 44-pixel touch target; 320-pixel and 390-pixel layouts fit; reduced motion and native dialog focus are honored.

The app regression suite also verifies typed streaming, provider/model choice and limits, saved chat history, cancellation, practice, review, personal cards, lazy reference search, preferences, monitoring status, backup download and restore, progress, and typed-chat recovery when free speech is unconfigured.

### Reproduce browser checks

Playwright and Chromium are external QA tools, not production dependencies. Set their paths for your environment:

```sh
PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROMIUM_EXECUTABLE=/absolute/path/to/chromium \
VOICE_RESULTS=docs/free-voice-browser-results.json \
node qa/voice-smoke.mjs

PLAYWRIGHT_MODULE=/absolute/path/to/playwright \
CHROMIUM_EXECUTABLE=/absolute/path/to/chromium \
BROWSER_RESULTS=docs/free-voice-app-browser-results.json \
node qa/browser-smoke.mjs

npm test
```

## What these checks establish

The browser tests run the real app server and conversation coordinator with fixture answering models. The focused suite uses an authenticated local HTTP readiness fixture and intercepted transcription/speech responses; microphone frames and audio playback are simulated. They establish lifecycle behavior and API integration expectations, not Whisper recognition accuracy, Kokoro sound quality, production latency, or real model readiness.

The Python service isolates native inference from HTTP handling, limits concurrent work, bounds request and response sizes, and reports ready only after model execution succeeds. The app verifies service readiness before opening a microphone session. A failed or timed-out speech operation leaves the saved reply available as text. Cancellation cannot instantly terminate a native inference call already running; the service keeps that job occupied until it finishes instead of starting overlapping work.

Running this speech stack eliminates speech-vendor API charges. Hosting, hardware, electricity, and the chosen answering-model API remain separate costs.

## Real inference and device validation

The real local Node → Python integration passed on October 10, 2026 (New York time), using two CPU cores and the downloaded models. Results are in [free-voice-integration-results.json](free-voice-integration-results.json). This test verifies authenticated app readiness and session start, actual Whisper transcription, one saved reply from a fixture answering model with an Anthropic selection, actual Kokoro synthesis of that saved reply, and session end. Repeating the same transcription and speech IDs made no additional inference HTTP requests. The speech replay was byte-identical; only one answering-model attempt occurred. No paid API calls were made.

For this short synthetic greeting, the actual app transcription took 1.823 seconds. Preparing the saved reply in Heart took 1.307 seconds and produced 4.18 seconds of mono PCM16 WAV audio at 24 kHz. These are individual measured samples on the test CPU configuration, not a production latency promise or a benchmark of a real OpenAI/Claude response.

The integration script can reuse an already running private worker. Where separate tool invocations have isolated network namespaces, it can start the worker as its own child process so Node and Python share one local network. Keep the token in a private file and point to the already downloaded models:

```sh
SPEECH_SERVICE_URL=http://127.0.0.1:8081 \
SPEECH_SERVICE_TOKEN_FILE=/absolute/private/path/speech-token.txt \
SPEECH_PYTHON_EXECUTABLE=/absolute/path/to/speech-venv/bin/python \
SPEECH_MODELS_DIR=/absolute/path/to/downloaded-models \
SPEECH_CPU_AFFINITY=0,1 \
REAL_VOICE_RESULTS=docs/free-voice-integration-results.json \
node qa/free-voice-integration.mjs
```

Omit `SPEECH_PYTHON_EXECUTABLE` when the worker is already reachable. `SPEECH_CPU_AFFINITY` is optional and requires Linux `taskset` when supplied. Set `REAL_VOICE_ALL_VOICES=1` to generate the saved reply through each of the five voices; the recorded integration run uses Heart because the separate worker checks generated all five voices already.

Real model inference and physical-phone tests are separate from the browser fixtures. These results establish successful inference and transport with synthetic speech. They do not establish subjective voice quality, medical-term recognition accuracy, loudspeaker echo cancellation, Bluetooth behavior, native Android microphone permissions, or a successful Railway deployment.

Deployment still requires a reachable speech worker and the app's server-only worker URL and token configuration. On the user's phone, check microphone permission, turn pauses, interruption, changing network conditions, background/foreground recovery, and the selected voice's pronunciation of study terminology and numbers before treating physical-device behavior as validated.
