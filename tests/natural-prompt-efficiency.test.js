import test from 'node:test';
import assert from 'node:assert/strict';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyDialogueHistory } from '../server/study-conversation.js';
import { buildNaturalTutorPrompt, buildNaturalTutorSchema, buildNaturalReviewPrompt, buildNaturalReviewSchema, buildNaturalSourceSpans } from '../server/natural-tutor.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

function fixture() {
  const references = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const evidence = references.retrieve('Study asthma');
  const request = 'Explain the supplied study point without revealing my pending answer.';
  const question = references.boardQuestions()[0];
  const conversation = { mode: 'coach', messages: [
    { role: 'user', content: request },
    { role: 'assistant', content: 'Full approved earlier reply including unplayed text.', sourceVerified: true, curriculum: true,
      voicePlayback: { status: 'interrupted', clientReported: true, completedChunks: 1, presentedText: 'Approved earlier portion.' } },
    { role: 'user', content: request },
  ] };
  const draft = { segments: [{ id: 's1', text: evidence[0].text, sourceChunkIds: [evidence[0].key] }] };
  return { references, evidence, conversation, draft, settings: { coachStyle: 'direct', dailyMinutes: 15, focus: 'exam' },
    pendingQuestion: { key: question.key, fingerprint: question.fingerprint }, requireVersion3: true, voiceTurn: true, deduplicateCurrentRequest: true };
}

const data = (prompt, marker) => JSON.parse(prompt.split(`${marker}=`)[1]);
const withoutInlineSchema = prompt => prompt.replace(/^OUTPUT_SCHEMA=.*\n/m, '').replace('matching OUTPUT_SCHEMA exactly', 'matching the externally supplied structured-output schema exactly');

test('native-schema prompts preserve every safety instruction and source packet while omitting only the repeated schema', () => {
  const context = fixture();
  const pairs = [
    [buildNaturalTutorPrompt(context), buildNaturalTutorPrompt({ ...context, inlineOutputSchema: false }), buildNaturalTutorSchema(context).schema, 'NATURAL_TUTOR_CONTEXT'],
    [buildNaturalReviewPrompt(context.draft, context), buildNaturalReviewPrompt(context.draft, { ...context, inlineOutputSchema: false }), buildNaturalReviewSchema(context.draft, context).schema, 'NATURAL_REVIEW_DATA'],
  ];
  for (const [inline, native, schema, marker] of pairs) {
    assert.deepEqual(JSON.parse(inline.match(/^OUTPUT_SCHEMA=(.*)$/m)[1]), schema);
    assert.doesNotMatch(native, /^OUTPUT_SCHEMA=/m);
    assert.equal(native, withoutInlineSchema(inline));
    assert.deepEqual(data(native, marker), data(inline, marker));
    assert.match(native, /Preserve|exact supplied current authoritative source support/);
    assert.match(native, /pending/);
    assert.ok(Buffer.byteLength(native) < Buffer.byteLength(inline));
  }
  const reviewData = data(pairs[1][1], 'NATURAL_REVIEW_DATA');
  assert.deepEqual(reviewData.sourceSpans, buildNaturalSourceSpans(context));
  assert.deepEqual(reviewData.candidate, context.draft.segments);
  assert.ok(reviewData.pendingQuestion);
  assert.ok(reviewData.sources.every(source => !Object.hasOwn(source, 'text')));
  assert.match(pairs[1][1], /Evaluate the ENTIRE candidate reply/);
  assert.match(pairs[1][1], /direct entailment; selecting an ID alone is insufficient/);
  assert.match(pairs[1][1], /Separately list EVERY question/);
});

test('both builders retain inline schema by default for transports without native structured output', () => {
  const context = fixture();
  assert.equal(buildNaturalTutorPrompt(context), buildNaturalTutorPrompt({ ...context, inlineOutputSchema: true }));
  assert.equal(buildNaturalReviewPrompt(context.draft, context), buildNaturalReviewPrompt(context.draft, { ...context, inlineOutputSchema: true }));
});

test('standalone builders retain the latest history request unless the caller explicitly opts into deduplication', () => {
  const context = fixture();
  delete context.deduplicateCurrentRequest;
  const expected = studyDialogueHistory(context.conversation);
  assert.deepEqual(data(buildNaturalTutorPrompt(context), 'NATURAL_TUTOR_CONTEXT').history, expected);
  assert.deepEqual(data(buildNaturalReviewPrompt(context.draft, context), 'NATURAL_REVIEW_DATA').history, expected);
  assert.equal(buildNaturalTutorPrompt(context), buildNaturalTutorPrompt({ ...context, deduplicateCurrentRequest: false }));
  assert.equal(buildNaturalReviewPrompt(context.draft, context), buildNaturalReviewPrompt(context.draft, { ...context, deduplicateCurrentRequest: false }));
});

test('only the current trailing request is removed; earlier identical wording and playback trust remain', () => {
  const context = fixture(), before = structuredClone(context.conversation);
  const originalHistory = studyDialogueHistory(context.conversation);
  const author = data(buildNaturalTutorPrompt(context), 'NATURAL_TUTOR_CONTEXT');
  const reviewer = data(buildNaturalReviewPrompt(context.draft, context), 'NATURAL_REVIEW_DATA');
  for (const packet of [author, reviewer]) {
    assert.deepEqual(packet.history, originalHistory.slice(0, -1));
    assert.equal(packet.history[0].content, context.conversation.messages[0].content);
    assert.equal(packet.history[0].trust, 'learner-statement-unverified');
    assert.equal(packet.history[1].content, 'Approved earlier portion.');
    assert.equal(packet.history[1].presentation.unplayedContentExcluded, true);
    assert.equal(packet.history[1].presentation.heard, 'unknown');
    assert.ok(packet.sources.length);
  }
  assert.equal(reviewer.learnerRequest, context.conversation.messages.at(-1).content);
  assert.deepEqual(context.conversation, before);
});

test('a trailing assistant does not cause an older user message to be trimmed', () => {
  const context = fixture();
  context.conversation.messages.push({ role: 'assistant', content: 'Existing historical reply.', importedEvidence: true });
  const expected = studyDialogueHistory(context.conversation);
  const author = data(buildNaturalTutorPrompt(context), 'NATURAL_TUTOR_CONTEXT');
  const reviewer = data(buildNaturalReviewPrompt(context.draft, context), 'NATURAL_REVIEW_DATA');
  assert.deepEqual(author.history, expected);
  assert.deepEqual(reviewer.history, expected);
  assert.equal(reviewer.history.at(-1).trust, 'untrusted-history');
});

test('long current requests remain complete in the separate reviewer field without duplicating their history prefix', () => {
  const context = fixture();
  const request = 'Long synthetic request '.repeat(180);
  context.conversation.messages.at(-1).content = request;
  const expected = studyDialogueHistory(context.conversation).slice(0, -1);
  const author = data(buildNaturalTutorPrompt(context), 'NATURAL_TUTOR_CONTEXT');
  const reviewer = data(buildNaturalReviewPrompt(context.draft, context), 'NATURAL_REVIEW_DATA');
  assert.deepEqual(author.history, expected);
  assert.deepEqual(reviewer.history, expected);
  assert.equal(reviewer.learnerRequest, request);
  assert.doesNotMatch(JSON.stringify(author.history), /Long synthetic request/);
});
