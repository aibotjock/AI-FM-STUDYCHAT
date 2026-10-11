import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../server/config.js';
import { validateSettings } from '../server/store.js';

test('server configuration contains no hosted speech provider or credential', () => {
  const config = loadConfig({ OPENAI_API_KEY: 'chat-key', OPENAI_SPEECH_MODEL: 'ignored', SPEECH_SERVICE_URL: 'not-a-url', SPEECH_SERVICE_TOKEN: 'ignored' });
  assert.equal(config.apiKey, 'chat-key');
  assert.equal(config.voices.length, 5);
  for (const field of ['speechServiceUrl', 'speechServiceToken', 'speechModel', 'transcriptionModel', 'audioTimeoutMs']) assert.equal(Object.hasOwn(config, field), false);
});

test('legacy voice preferences migrate without changing selected reasoning model or other preferences', () => {
  const settings = validateSettings({ voice: 'cedar', aiProvider: 'anthropic', aiModel: 'claude-haiku-5-5', sessionMinutes: 25 });
  assert.equal(settings.voice, 'af_heart'); assert.equal(settings.aiProvider, 'anthropic'); assert.equal(settings.aiModel, 'claude-haiku-5-5'); assert.equal(settings.sessionMinutes, 25);
  assert.equal(validateSettings({ voice: 'bf_emma' }).voice, 'bf_emma');
  assert.throws(() => validateSettings({ voice: 'unadvertised-voice' }));
});
