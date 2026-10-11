import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';
import { validateSettings } from '../server/store.js';

test('speech uses server-owned local or HTTPS endpoints with an independent credential', () => {
  for (const url of ['http://localhost:8080', 'http://127.0.0.1:8080', 'http://[::1]:8080', 'http://speech.railway.internal:8080', 'https://speech.example.com']) {
    const config = loadConfig({ SPEECH_SERVICE_URL: url, SPEECH_SERVICE_TOKEN: 's'.repeat(32) });
    assert.equal(config.speechServiceUrl, url); assert.equal(config.voices.length, 5);
  }
  for (const url of ['http://speech.example.com', 'https://user:password@speech.example.com', 'https://speech.example.com/path', 'https://speech.example.com?token=abc', 'file:///tmp/audio']) assert.throws(() => loadConfig({ SPEECH_SERVICE_URL: url, SPEECH_SERVICE_TOKEN: 's'.repeat(32) }));
  assert.throws(() => loadConfig({ SPEECH_SERVICE_URL: 'http://localhost:8080', SPEECH_SERVICE_TOKEN: 'short' }));
  for (const token of ['s'.repeat(513), `${'s'.repeat(32)} token`, `${'s'.repeat(32)}\nheader`]) assert.throws(() => loadConfig({ SPEECH_SERVICE_URL: 'http://localhost:8080', SPEECH_SERVICE_TOKEN: token }));
  const config = loadConfig({ OPENAI_API_KEY: 'chat-key', OPENAI_SPEECH_MODEL: 'paid-model-is-ignored' });
  assert.equal(config.speechServiceUrl, ''); assert.equal(config.speechModel, 'kokoro-v1.0');
});

test('legacy voice preferences migrate without changing selected reasoning model or other preferences', () => {
  const settings = validateSettings({ voice: 'cedar', aiProvider: 'anthropic', aiModel: 'claude-haiku-5-5', sessionMinutes: 25 });
  assert.equal(settings.voice, 'af_heart'); assert.equal(settings.aiProvider, 'anthropic'); assert.equal(settings.aiModel, 'claude-haiku-5-5'); assert.equal(settings.sessionMinutes, 25);
  assert.equal(validateSettings({ voice: 'bf_emma' }).voice, 'bf_emma');
  assert.throws(() => validateSettings({ voice: 'unadvertised-voice' }));
});
