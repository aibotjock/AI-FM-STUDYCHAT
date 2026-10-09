import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { splitPremiumSpeech, PREMIUM_SPEECH_LIMITS, PREMIUM_PREVIEW_TEXT, createPremiumSpeechService } from '../server/premium-speech.js';

test('short checked replies remain a single unchanged speech request', () => {
  const text = ('A complete sentence with emoji 😀 and intact qualifications. '.repeat(18)).slice(0, 1000);
  assert.equal(text.length, 1000);
  assert.deepEqual(splitPremiumSpeech(text), [text]);
});

test('long checked replies start with a complete short paragraph or sentence and retain every character', () => {
  const paragraph = 'A complete checked sentence retaining its original wording and every qualification. '.repeat(5).trim() + '\n\n';
  const paragraphReply = paragraph + 'The remaining complete explanation stays available and is spoken in sequence. '.repeat(30);
  const chunks = splitPremiumSpeech(paragraphReply);
  assert.equal(chunks[0], paragraph);
  assert.ok(chunks[0].length >= 360 && chunks[0].length <= 640);
  assert.equal(chunks.join(''), paragraphReply);
  const sentenceReply = 'A longer checked sentence keeps its exact text and its emoji 😀 while ending at a full stop. '.repeat(200);
  const sentenceChunks = splitPremiumSpeech(sentenceReply);
  assert.match(sentenceChunks[0], /\.\s$/);
  assert.ok(sentenceChunks[0].length >= 360 && sentenceChunks[0].length <= 640);
  assert.equal(sentenceChunks.join(''), sentenceReply);
  assert.ok(sentenceChunks.length <= 8);
  for (const chunk of sentenceChunks) {
    assert.ok(chunk.length <= 4096);
    assert.doesNotMatch(chunk, /[\uD800-\uDBFF]$/);
    assert.doesNotMatch(chunk, /^[\uDC00-\uDFFF]/);
  }
});

test('unbroken and unsafe early boundaries keep original chunking within total and Unicode limits', () => {
  const maximum = 'x'.repeat(4095) + '😀' + 'z'.repeat(19903);
  assert.equal(maximum.length, PREMIUM_SPEECH_LIMITS.maxTotalChars);
  const chunks = splitPremiumSpeech(maximum);
  assert.equal(chunks[0].length, 4095);
  assert.equal(chunks.join(''), maximum);
  assert.ok(chunks.length <= 8);
  assert.ok(chunks.every(chunk => chunk.length <= 4096));
  const unsafe = 'Short filler. ' + 'x'.repeat(6000);
  assert.equal(splitPremiumSpeech(unsafe)[0].length, 4096);
  const complete = 'An intact sentence with emoji 😀 and punctuation. '.repeat(520).slice(0, 24000);
  const maximumChunks = splitPremiumSpeech(complete);
  assert.equal(maximumChunks.join(''), complete);
  assert.ok(maximumChunks.length <= 8);
  assert.throws(() => splitPremiumSpeech(complete + 'x'), { code: 'speech_text_limit' });
});

test('an early abbreviation or initial is not used to shorten a continuing sentence', () => {
  for (const abbreviation of ['e.g.', 'i.e.', 'Dr.', 'U.S.', 'A.', '1.']) {
    const text = 'A continuing checked explanation '.repeat(14) + abbreviation + ' ' + 'qualifications remain within this same sentence '.repeat(15) + '.';
    assert.ok(text.indexOf(abbreviation) >= 360 && text.indexOf(abbreviation) <= 640);
    assert.ok(text.length > 1000 && text.length < 4096);
    assert.deepEqual(splitPremiumSpeech(text), [text], abbreviation);
  }
});

test('articulate speech instructions retain the selected voice, exact input and one durable provider request', async t => {
  const db = new DatabaseSync(':memory:');
  const calls = [];
  const mp3 = Buffer.from('ID3synthetic-audio-for-local-latency-contract-only');
  const speech = createPremiumSpeechService({ db, env: { OPENAI_API_KEY: 'synthetic-key-only' }, fetchImpl: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    return new Response(mp3, { headers: { 'Content-Type': 'audio/mpeg' } });
  } });
  t.after(() => { speech.close(); db.close(); });
  const request = { text: PREMIUM_PREVIEW_TEXT, voice: 'cedar', requestId: randomUUID(), scope: 'preview' };
  assert.equal((await speech.synthesize(request)).cached, false);
  assert.equal((await speech.synthesize(request)).cached, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/audio/speech');
  assert.equal(calls[0].body.model, 'gpt-4o-mini-tts');
  assert.equal(calls[0].body.voice, 'cedar');
  assert.equal(calls[0].body.input, PREMIUM_PREVIEW_TEXT);
  assert.match(calls[0].body.instructions, /clearly projected, articulate/);
  assert.match(calls[0].body.instructions, /Do not add introductions, explanations, facts or advice/);
  assert.equal(speech.inspect(request.requestId).status, 'complete');
});
