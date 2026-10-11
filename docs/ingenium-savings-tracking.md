# Build-aware Ingenium baseline tracking

This branch adds metadata to the existing optional Ingenium outbox. It does not activate an optimizer, change model selection, collect device speech events, or create additional inference requests. Ordinary attempted OpenAI and Anthropic text requests continue to produce one observation after success or failure.

New application bootstrap observations may include this optional field:

```json
{
  "measurement": {
    "schemaVersion": 1,
    "appVersion": "app-sha256-<64 lowercase hexadecimal characters>",
    "modelConfigVersion": "model-sha256-<64 lowercase hexadecimal characters>",
    "voiceRuntimeVersion": "voice-sha256-<64 lowercase hexadecimal characters>",
    "pricingVersion": "pricing-sha256-<64 lowercase hexadecimal characters>",
    "basis": "baseline",
    "stage": "text"
  }
}
```

The other observation fields and their validation remain unchanged. The measurement object is constructed from server code and trusted configuration, never copied from prompts, model responses, client options, or provider metadata. Collector simulations retain their existing `client_simulated` label and do not receive application build measurement.

`appVersion` fingerprints actual shipped source content, package/lock files, the voice build script, bounded public model configuration, enabled telemetry schema, offered voice-runtime identity, and the actual catalogue pricing snapshot. It is a content-derived build identity, not a Git commit claim; no self-referencing commit SHA or startup timestamp is fabricated. Source files are read once at startup. `.git`, `.env`, the data directory, tests, documentation, and voice model binary files are excluded. If optional manifest construction or tagging is unavailable, the original observation remains valid without measurement.

`modelConfigVersion` fingerprints the configured defaults/limits together with that observation's selected provider, requested model, and endpoint. `pricingVersion` fingerprints the actual tariff table and its recorded check date; it does not assert that prices were reverified or that estimated cost is an invoice. The existing returned-model field remains available to detect provider alias changes.

`voiceRuntimeVersion` fingerprints the offered voice scripts, pinned runtime dependencies, and generated voice-asset manifest when present. It does not establish which pack a learner installed, whether speech was used, or device speech latency. All observations in this change have `stage: "text"`.

Provider keys, telemetry keys, access tokens, learner IDs, prompts, answers, cookies, and data-directory paths do not enter any fingerprint or observation. Rotating a secret preserves fingerprints; changing public source/model limits/prices or offered voice content changes the relevant versions.

Existing persisted outbox events keep their original serialized bytes and UUIDs during retry. A duplicate legacy observation with unchanged base fields remains deduplicated when build tagging becomes available. An observation cannot overwrite an existing event with different usage, model, status, or original measurement.

Deploy the receiver's optional measurement schema before deploying this branch. Legacy receiver deployments that reject extra fields must not receive the new payload until upgraded. Publishing this branch does not deploy it; the tracking implementation performs no deployment.

Validation uses local SQLite, deterministic provider fixtures, and a fake collector. No live provider inference is needed for the tests. Run `npm test` on Node 24 to verify ordinary provider flows, metadata privacy, fingerprint invalidation, old-outbox compatibility, and existing application behavior.
