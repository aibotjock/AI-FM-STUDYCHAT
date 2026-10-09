import { PREMIUM_SPEECH_MODEL, PREMIUM_SPEECH_LIMITS } from './premium-speech.js';

export const PREMIUM_CHECK_REQUEST_ID = 'b702b983-06a9-45d1-a987-bd717e3b36b4';
const voices = ['marin', 'cedar', 'coral', 'sage', 'ash'];
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function validMetadata(metadata) {
  return object(metadata) && metadata.provider === 'openai' && metadata.endpoint === 'audio/speech' && metadata.model === PREMIUM_SPEECH_MODEL && metadata.voice === 'marin' && Number.isInteger(metadata.audioBytes) && metadata.audioBytes > 100 && metadata.audioBytes <= PREMIUM_SPEECH_LIMITS.maxAudioBytes && metadata.usage === null && metadata.estimatedCostUsd === null;
}

/** One fixed nonmedical Marin preview; saved outcomes never trigger a paid repeat. */
export async function runPremiumVoiceCheck({ baseUrl, env = process.env, fetchImpl = globalThis.fetch } = {}) {
  if (env.STUDY_INITIAL_PREMIUM_VOICE_CHECK !== 'premium-v1') return { skipped: true };
  if ((env.APP_MODE || 'personal') !== 'personal' || (env.AI_PROVIDER || 'openai').trim().toLowerCase() !== 'openai') return { skipped: true, reason: 'personal_openai_only' };
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Premium voice checks require the local app listener.');
  if (!(env.STUDY_ACCESS_TOKEN || '').trim() || !(env.OPENAI_API_KEY || '').trim()) return { skipped: true, reason: 'server_credentials_not_configured' };
  let cookie = '', authenticated = false, submitted = 0, receipt = { failed: true, stage: 'premium_voice_check' };
  const request = (path, body) => fetchImpl(new URL(path, base), { method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal: AbortSignal.timeout(55000), headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  try {
    const statusResponse = await request('/api/status');
    if (!statusResponse.ok) return receipt = { failed: true, stage: 'status' };
    const status = await statusResponse.json();
    if (!status.aiConfigured || status.providerId !== 'openai') return receipt = { skipped: true, reason: 'openai_not_active' };
    const login = await request('/api/login', { token: env.STUDY_ACCESS_TOKEN });
    if (!login.ok) return receipt = { failed: true, stage: 'sign_in' };
    cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    if (!/^studychat_session=[A-Za-z0-9._-]+$/.test(cookie)) return receipt = { failed: true, stage: 'sign_in' };
    authenticated = true;
    const optionsResponse = await request('/api/voice/options');
    if (!optionsResponse.ok) return receipt = { failed: true, stage: 'voice_catalog' };
    const options = await optionsResponse.json();
    if (options.enabled !== true || options.model !== PREMIUM_SPEECH_MODEL || options.defaultVoice !== 'marin' || !Array.isArray(options.voices) || options.voices.length !== 5 || !voices.every(id => options.voices.filter(voice => voice?.id === id).length === 1)) return receipt = { failed: true, stage: 'voice_catalog' };
    const savedResponse = await request(`/api/voice/check/${PREMIUM_CHECK_REQUEST_ID}`);
    if (!savedResponse.ok) return receipt = { failed: true, stage: 'saved_speech_request' };
    const saved = await savedResponse.json();
    if (saved.requestId !== PREMIUM_CHECK_REQUEST_ID) return receipt = { failed: true, stage: 'saved_speech_request' };
    if (saved.status === 'complete') {
      if (!validMetadata(saved.metadata)) return receipt = { failed: true, stage: 'saved_speech_validation' };
      return receipt = { premiumVoicePassed: true, voiceCatalogPassed: true, cached: true, submitted: 0, requestedModel: PREMIUM_SPEECH_MODEL, voice: 'marin', audioBytes: saved.metadata.audioBytes, usage: null, estimatedCostUsd: null };
    }
    if (saved.status !== 'not_started') return receipt = { failed: true, uncertain: true, stage: 'saved_speech_request', submitted: 0 };
    submitted = 1;
    const speech = await request('/api/voice/preview', { voice: 'marin', requestId: PREMIUM_CHECK_REQUEST_ID });
    if (!speech.ok) return receipt = { failed: true, uncertain: true, stage: 'speech_response', status: speech.status, submitted };
    if (!/^audio\/mpeg(?:;|$)/i.test(speech.headers.get('content-type') || '') || speech.headers.get('x-study-speech-model') !== PREMIUM_SPEECH_MODEL || speech.headers.get('x-study-speech-voice') !== 'marin' || speech.headers.get('x-study-speech-chunks') !== '1' || speech.headers.get('x-study-speech-chunk') !== '0' || speech.headers.get('x-study-speech-usage') !== 'unknown' || speech.headers.get('x-study-speech-cost') !== 'unknown' || speech.headers.get('cache-control') !== 'no-store') return receipt = { failed: true, stage: 'speech_headers', submitted };
    const body = new Uint8Array(await speech.arrayBuffer());
    const recognizableMp3 = (body[0] === 73 && body[1] === 68 && body[2] === 51) || (body[0] === 255 && (body[1] & 224) === 224);
    if (body.length <= 100 || body.length > PREMIUM_SPEECH_LIMITS.maxAudioBytes || !recognizableMp3) return receipt = { failed: true, stage: 'speech_bytes', submitted };
    return receipt = { premiumVoicePassed: true, voiceCatalogPassed: true, cached: false, submitted, requestedModel: PREMIUM_SPEECH_MODEL, voice: 'marin', audioBytes: body.length, usage: null, estimatedCostUsd: null };
  } catch {
    return receipt = { failed: true, stage: 'premium_voice_check', submitted, ...(submitted ? { uncertain: true } : {}) };
  } finally {
    if (authenticated) { try { await request('/api/logout', {}); receipt.logoutAttempted = true; } catch { receipt.logoutAttempted = true; } }
  }
}
