import { resolve } from 'node:path';

function integer(env, key, fallback, min, max) {
  const value = env[key] === undefined || env[key] === '' ? fallback : Number(env[key]);
  if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer from ${min} to ${max}.`);
  return value;
}
export function loadConfig(env = process.env) {
  const host = env.HOST || '127.0.0.1';
  const accessToken = env.STUDY_ACCESS_TOKEN || '';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && accessToken.length < 32) throw new Error('Remote access requires a STUDY_ACCESS_TOKEN of at least 32 characters.');
  const model = env.OPENAI_MODEL || 'gpt-4.1-mini';
  if (!/^[a-zA-Z0-9_.-]{1,100}$/.test(model) || /astra/i.test(model)) throw new Error('OPENAI_MODEL is invalid or prohibited.');
  let appOrigin = env.APP_ORIGIN || '';
  if (appOrigin) {
    const url = new URL(appOrigin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.origin !== appOrigin) throw new Error('APP_ORIGIN must be an exact HTTP(S) origin.');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) && url.protocol !== 'https:') throw new Error('Remote APP_ORIGIN must use HTTPS.');
    appOrigin = url.origin;
  }
  return Object.freeze({
    host, accessToken, appOrigin, model, apiKey: env.OPENAI_API_KEY || '',
    port: integer(env, 'PORT', 3000, 0, 65535), dataDir: resolve(env.DATA_DIR || 'data'),
    chatTimeoutMs: integer(env, 'CHAT_TIMEOUT_MS', 90000, 1000, 180000),
    maxInputChars: integer(env, 'MAX_INPUT_CHARS', 8000, 64, 20000),
    maxOutputTokens: integer(env, 'MAX_OUTPUT_TOKENS', 1200, 64, 4000),
    maxHistoryMessages: integer(env, 'MAX_HISTORY_MESSAGES', 12, 0, 40),
    maxOutputChars: 20000, jsonBytes: 128 * 1024, backupBytes: 16 * 1024 * 1024,
    audioBytes: 2 * 1024 * 1024, audioTimeoutMs: 45000, sessionMs: 12 * 60 * 60 * 1000,
    transcriptionModel: env.OPENAI_TRANSCRIPTION_MODEL || 'gpt-4o-mini-transcribe',
    speechModel: env.OPENAI_SPEECH_MODEL || 'gpt-4o-mini-tts',
    voices: Object.freeze(['marin', 'cedar', 'coral', 'sage', 'ash'])
  });
}
