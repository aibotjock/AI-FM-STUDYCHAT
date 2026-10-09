import { randomUUID } from 'node:crypto';

export const INGENIUM_TELEMETRY_ENDPOINT = 'https://mzmtbauuqywucgssckwx.supabase.co/functions/v1/studychat-events';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/;
const KEY = /^ia_[A-Za-z0-9_-]{43}$/;
const count = (value, limit) => Number.isSafeInteger(value) && value >= 0 && value <= limit;
const safeModel = value => typeof value === 'string' && MODEL.test(value) && !/astra/i.test(value);

// Only this explicit projection can leave StudyChat. Prompts, answers, users and
// arbitrary provider fields are never serialized by the observer.
export function projectIngeniumMetadata(metadata, { requestId = randomUUID() } = {}) {
  if (!metadata || metadata.provider !== 'openai' || !UUID.test(requestId) || !safeModel(metadata.requestedModel)) return null;
  if (metadata.returnedModel != null && !safeModel(metadata.returnedModel)) return null;
  if (!['chat', 'responses'].includes(metadata.endpoint) || !count(metadata.latencyMs, 3600000)) return null;
  const usage = metadata.usage;
  if (usage != null && (!count(usage.prompt_tokens, 10000000) || !count(usage.completion_tokens, 2000000))) return null;
  const cost = metadata.estimatedCostUsd;
  if (cost != null && (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0 || cost > 10000 || usage == null)) return null;
  if (!Number.isSafeInteger(metadata.recordedAt) || !Number.isFinite(new Date(metadata.recordedAt).getTime())) return null;
  return {
    requestId,
    provider: 'openai',
    requestedModel: metadata.requestedModel,
    returnedModel: metadata.returnedModel ?? null,
    endpoint: metadata.endpoint,
    latencyMs: metadata.latencyMs,
    inputTokens: usage?.prompt_tokens ?? null,
    outputTokens: usage?.completion_tokens ?? null,
    estimatedCostUsd: cost ?? null,
    occurredAt: new Date(metadata.recordedAt).toISOString(),
    source: 'app_observed'
  };
}

export function createIngeniumTelemetry({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const key = (env.INGENIUM_TELEMETRY_KEY || '').trim();
  const organizationId = (env.INGENIUM_TELEMETRY_ORGANIZATION_ID || '').trim();
  const configured = KEY.test(key) && UUID.test(organizationId);
  let accepted = 0, failed = 0, lastResult = null;
  return {
    status() {
      return { configured, endpoint: INGENIUM_TELEMETRY_ENDPOINT, organizationId: configured ? organizationId : null, source: 'app_observed', accepted, failed, lastResult };
    },
    async observe(metadata, options = {}) {
      const event = projectIngeniumMetadata(metadata, options);
      if (!event) return { accepted: false, reason: 'invalid_metadata' };
      if (!configured) return { accepted: false, reason: 'not_configured', requestId: event.requestId };
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      let result;
      try {
        const response = await fetchImpl(INGENIUM_TELEMETRY_ENDPOINT, {
          method: 'POST',
          redirect: 'error',
          signal: controller.signal,
          headers: { 'Content-Type': 'application/json', 'x-ingenium-key': key, 'x-ingenium-organization': organizationId },
          body: JSON.stringify(event)
        });
        // The receiver's small acknowledgment is not needed. Never propagate
        // remote response text or network errors into app logs or the browser.
        if (response.ok) {
          accepted++;
          result = { accepted: true, requestId: event.requestId };
        } else {
          failed++;
          result = { accepted: false, reason: response.status === 401 || response.status === 403 ? 'registration_rejected' : response.status === 409 ? 'event_conflict' : 'delivery_failed', requestId: event.requestId };
        }
        await response.body?.cancel().catch(() => {});
      } catch {
        failed++;
        result = { accepted: false, reason: 'delivery_failed', requestId: event.requestId };
      } finally {
        clearTimeout(timeout);
      }
      lastResult = { ...result, recordedAt: Date.now() };
      return result;
    }
  };
}
