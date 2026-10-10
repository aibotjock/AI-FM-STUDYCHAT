# Reusable conversational voice integration

Voice source is maintained in **aibotjock/Conversation-Agent**. StudyChat integrates it on **feature/conversation-agent**, and the private-test Railway service must deploy that branch. Store submission remains on hold. The artifact's actual source revision is recorded after GitHub publication; confirm the running deployment revision before a phone trial.

## Host boundary

The reusable browser package owns the original teal/gold circle, captions, local microphone capture and VAD, bounded pre-roll, independent input/output state, interruption epochs and cancellation. Its optional Node server module supplies an OpenAI transcription transport with an injected request ledger. No StudyChat knowledge, credentials or medical policy belongs in the browser core.

StudyChat retains authentication, owner/session/workspace boundaries, saved conversations, retrieval, source currency, exact source-span binding, independent whole-reply review, server-approved speech, canonical question grading, cards and spaced repetition. Client `readoutAllowed` and similar fields are presentation hints; they cannot authorize a fact or audio request. Imported metadata never creates trusted voice evidence.

The sequence is local speech detection → completed WAV utterance → OpenAI transcription → existing `/api/chat` generation/review → authorized saved-message speech. Direct generated Realtime audio does not bypass medical review. OpenAI is the only active provider; Claude remains on hold and Astra is prohibited without exceptions.

## Implemented behavior

- Foreground `getUserMedia`/Web Audio capture requests echo cancellation and maintains approximately 500 ms pre-roll in memory. A completed utterance becomes mono PCM16 WAV, normally 16 kHz, capped at 60 seconds. Cloud partial transcripts are not implemented.
- Local input can monitor during generation and audio playback. Detected speech interrupts immediately, aborts active HTTP work, reports the active request for cancellation and ignores late callbacks. Stable utterance IDs prevent duplicate submission without suppressing repeated words in a new turn.
- Mute fully releases microphone tracks; unmute reacquires them. Stop, logout, navigation/backgrounding, session expiry and a browser offline event also stop capture. Returning online never automatically restarts it. Provider/server failures retain manual recovery without an automatic paid retry; permission/device failures retain typing.
- Speech requests use a saved conversation/message identity and one of **Marin, Cedar, Coral, Sage or Ash**. Current source and replay checks remain server-side. Approved MP3 can play progressively through MediaSource where supported or use buffered playback. A stalled MediaSource startup falls back once to the same downloaded recording, without another speech request. Playback starts without blocking the remaining audio download. Explicit permission denial retains the recording for **Play prepared audio**, beside the circle before captions; stalls and pauses have distinct labels. Resuming a paused recording updates the speaking state again. Manual Read aloud ends the conversation before replacing the shared player.
- Completed audio chunks provide a conservative playback checkpoint. The complete reply remains visible. Future voice context does not assume unplayed text was heard; unacknowledged voice replies default to zero completed chunks. Checkpoint acknowledgment is bounded and failure does not freeze the next turn. Playback position is not proof of physical hearing or exact word-level alignment.

Echo handling remains best effort. The input API accepts an optional PCM playback reference for correlation, but StudyChat's actual player does not supply one. Tighter output-time energy detection and browser echo cancellation cannot establish reliable loudspeaker separation. Playback echo and credible short backchannels may interrupt. Use headphones, the Interrupt control or typed/manual recovery where necessary; confirm behavior on the owner's phone.

## Shared source and artifact

`scripts/sync-conversation-agent.mjs` generates the browser artifact under `public/vendor/conversation-agent` and the server artifact under `server/vendor/conversation-agent`, with hashes/provenance. Edit the independent source repository, run new/affected checks, then sync. Generated copies are not separately maintained implementations. `sourceRevision` must be the actual published source commit, never a fabricated identifier.

The credential-free package demo uses a second mock host and fixed nonfactual responses. Optional real microphone capture still uses an explicitly simulated transcript there. Its optional device speech does not enable a StudyChat production fallback.

## Evidence and outstanding checks

Recorded local scopes: package **28 unique groups**, host backend **14 mocks**, speech **37 new/affected groups** plus **3 affected existing Node EventTarget/Audio player mock groups**, conservative history **4 groups**, and actual host/adapter integration **3 groups** passed. The adapter checks used the shipped callback and real authenticated local routes with 7 synthetic provider dispatches, covering session/transcription/approved-readout/checkpoint binding, active cancellation and late-result suppression, and bounded acknowledgment failure recovery. No paid calls were made; tested hashes are in `qa/conversation-agent-integration-results.json`.

The **9 new browser integration groups have not executed (0/9)**: Chromium was absent and its installer returned empty/invalid archives. This is an environment blocker, not nine failed app scenarios. These are scoped automated checks, not physical Android acceptance or clinical validation; StudyChat's [validation ledger](VALIDATION_STATUS.md) remains authoritative for live receipts and earlier failures.

Physical Android Chrome permission/capture, first syllables, speaker/headset/Bluetooth interruption, actual volume/routing, pronunciation, foreground lifecycle and response latency remain unverified. Other browsers/native shells need explicit acceptance. Do not describe provisional speed or echo targets as measured results. Repeat passed functionality only after a relevant change or failure, documenting the reason.

Existing history, learning preferences and spaced-repetition records support adaptation. Persistent-memory consent/inspection/edit/delete controls and editable pronunciation remain future host features. Learning adaptation never modifies validated medical knowledge or turns learner statements into official facts.

This is a family medicine board-study tool only, not medical advice or for clinical use. Automated source review and a natural AI voice do not guarantee accuracy, assess competence or replace independent clinical review. Transcription and speech add provider requests; cancellation does not guarantee zero cost. Provider usage absent from responses stays unknown. Store publication requires separate owner permission.
