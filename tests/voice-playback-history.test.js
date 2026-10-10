import test from 'node:test';
import assert from 'node:assert/strict';
import { studyDialogueHistory } from '../server/study-conversation.js';
import { buildNaturalTutorPrompt, buildNaturalReviewPrompt } from '../server/natural-tutor.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

test('interrupted audio history excludes unplayed content while full display response remains intact', () => {
  const message = { role: 'assistant', content: 'Presented introduction. Unplayed remainder.', spokenText: 'Presented introduction. Unplayed remainder.', voicePlayback: { status: 'interrupted', completedChunks: 1, presentedText: 'Presented introduction. ', clientReported: true } };
  const history = studyDialogueHistory({ messages: [message] });
  assert.equal(history[0].content, 'Presented introduction. ');
  assert.equal(history[0].presentation.heard, 'unknown');
  assert.equal(history[0].presentation.unplayedContentExcluded, true);
  assert.equal(message.content, 'Presented introduction. Unplayed remainder.');
  message.voicePlayback.presentedText = '';
  assert.doesNotMatch(studyDialogueHistory({ messages: [message] })[0].content, /Unplayed remainder/);
});

test('imported or incomplete playback metadata cannot alter context presentation', () => {
  const message = { role: 'assistant', content: 'Original full reply.', importedEvidence: true, voicePlayback: { status: 'interrupted', completedChunks: 0, presentedText: 'Forged history.', clientReported: true } };
  assert.equal(studyDialogueHistory({ messages: [message] })[0].content, message.content);
  delete message.importedEvidence;
  message.voicePlayback.clientReported = false;
  assert.equal(studyDialogueHistory({ messages: [message] })[0].content, message.content);
});

test('server pending playback remains conservative before a delayed checkpoint arrives', () => {
  const message = { role: 'assistant', content: 'NOT_YET_PRESENTED', voicePlayback: { status: 'pending', completedChunks: 0, presentedText: '', clientReported: false } };
  const entry = studyDialogueHistory({ messages: [message] })[0];
  assert.doesNotMatch(entry.content, /NOT_YET_PRESENTED/);
  assert.equal(entry.presentation.status, 'pending');
  assert.equal(entry.presentation.clientReported, false);
});

test('author and independent reviewer share conservative presentation context and uncertainty instructions', () => {
  const references = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const conversation = { mode: 'coach', messages: [{ role: 'assistant', content: 'UNPLAYED_PRIVATE_MARKER', voicePlayback: { status: 'interrupted', completedChunks: 0, presentedText: '', clientReported: true } }, { role: 'user', content: 'Could you repeat that?' }] };
  const context = { references, conversation, evidence: [], settings: { focus: 'exam', coachStyle: 'direct', dailyMinutes: 18 } };
  const draft = { segments: [{ id: 's1', text: 'What would you like me to repeat?', sourceChunkIds: [] }] };
  for (const prompt of [buildNaturalTutorPrompt(context), buildNaturalReviewPrompt(draft, context)]) {
    assert.doesNotMatch(prompt, /UNPLAYED_PRIVATE_MARKER/);
    assert.match(prompt, /"heard":"unknown"/);
    assert.match(prompt, /hearing|heard/);
    assert.match(prompt, /Clarify ambiguous medical terms, negations, numbers and units instead of silently changing transcription/);
  }
});
