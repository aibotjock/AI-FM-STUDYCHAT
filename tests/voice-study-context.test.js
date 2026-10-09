import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceService, voiceStudyContext, VOICE_MODEL } from '../server/voice.js';

const source = { id: 'official-fixture', title: 'Nonclinical source fixture', organization: 'NIH fixture', url: 'https://www.nih.gov/', edition: 'Fixture', checkedAt: '2026-10-09', kind: 'official-clinical-reference' };
const context = { title: 'Fictional educational topic', current: true, checkedAt: '2026-10-09', expiresAt: '2026-11-09', sources: [source], sections: [{ id: 'recall', title: 'Practice', text: 'Use original recall exercises for study.', sourceIds: [source.id] }] };

test('voice receives bounded selected-condition references without changing the fixed model or claiming validated speech', async () => {
  let payload;
  const offer = 'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n';
  const service = createVoiceService({ env: { OPENAI_API_KEY: 'fixture-server-only' }, fetchImpl: async (url, options) => {
    if (url.endsWith('/hangup')) return new Response(null, { status: 200 });
    payload = JSON.parse(options.body.get('session'));
    return new Response(offer, { status: 201, headers: { Location: '/v1/realtime/calls/rtc_context_fixture' } });
  } });
  try {
    await service.createSession({ sdp: offer, conversation: { id: 'context-fixture', mode: 'coach', messages: [] }, settings: {}, studyContext: context });
    assert.equal(payload.model, VOICE_MODEL);
    assert.deepEqual(payload.tools, []);
    assert.match(payload.instructions, /SELECTED_CONDITION_STUDY_REFERENCES=/);
    assert.match(payload.instructions, /Use original recall exercises for study/);
    assert.match(payload.instructions, /not medical advice/);
    assert.match(payload.instructions, /has not passed the text Coach's canonical-answer validation/);
    assert(!payload.instructions.includes('fixture-server-only'));
  } finally { await service.closeAll(); }
});

test('voice omits stale, unsupported-origin and unsourced context', () => {
  assert.equal(voiceStudyContext({ ...context, current: false }), '');
  assert.equal(voiceStudyContext({ ...context, sources: [{ ...source, url: 'https://attacker.example/' }] }), '');
  assert.equal(voiceStudyContext({ ...context, sections: [{ text: 'Invented reference', sourceIds: ['absent'] }] }), '');
  assert(voiceStudyContext({ ...context, sections: [{ ...context.sections[0], text: 'x'.repeat(10000) }] }).length < 4000);
});
