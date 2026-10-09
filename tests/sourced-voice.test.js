import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalSpokenReply, speechChunks, sourcedVoiceSupported } from '../public/sourced-voice.js';

test('sourced speech chunks preserve every original character without losing citations or splitting surrogate pairs', () => {
  const text = ('Original study text. Source: [NIH-1]\nhttps://www.niddk.nih.gov/example 😀 ' + 'x'.repeat(102) + '\n').repeat(20);
  const chunks = speechChunks(text, 100);
  assert.equal(chunks.join(''), text);
  assert(chunks.every(chunk => chunk.length > 0 && chunk.length <= 100));
  assert(chunks.every(chunk => !/^[\uDC00-\uDFFF]/.test(chunk) && !/[\uD800-\uDBFF]$/.test(chunk)));
  assert.deepEqual(speechChunks(''), []);
  assert.deepEqual(speechChunks(' '.repeat(10)), []);
  assert.deepEqual(speechChunks('x'.repeat(24001)), []);
});

test('speech requires explicit canonical provenance and bounded nonempty text', () => {
  assert.equal(canonicalSpokenReply({ content: 'Canonical exact text.', sourceVerified: true }), true);
  for (const value of [null, { content: 'An unchecked claim.' }, { content: 'An unchecked claim.', sourceVerified: 'true' }, { content: '   ', sourceVerified: true }, { content: 'x'.repeat(24001), sourceVerified: true }]) assert.equal(canonicalSpokenReply(value), false);
});

test('sourced voice feature detection requires HTTPS, recognition and synthesis rather than WebRTC or an API key', () => {
  const supported = { isSecureContext: true, webkitSpeechRecognition: function () {}, speechSynthesis: {}, SpeechSynthesisUtterance: function () {} };
  assert.equal(sourcedVoiceSupported(supported), true);
  assert.equal(sourcedVoiceSupported({ ...supported, isSecureContext: false }), false);
  assert.equal(sourcedVoiceSupported({ ...supported, speechSynthesis: undefined }), false);
  assert.equal(sourcedVoiceSupported({ ...supported, webkitSpeechRecognition: undefined, RTCPeerConnection: function () {} }), false);
});
