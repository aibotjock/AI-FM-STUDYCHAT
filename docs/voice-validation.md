# Voice validation history

The current implementation runs Whisper and Kokoro on each user device. Its evidence and limitations are recorded in [device-voice-validation.md](device-voice-validation.md).

Earlier paid-speech browser and hosted observations remain in `voice-browser-results.json` and `live-voice-results.json`. They concern a different implementation and do not establish current local-model performance. The separate server Whisper/Kokoro/Pipecat prototype is preserved on the `feature/free-voice-pipecat` branch; no Railway speech worker was activated.
