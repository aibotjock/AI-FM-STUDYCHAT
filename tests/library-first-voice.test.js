import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStudyCurriculum } from '../server/study-curriculum.js';
import { renderNaturalTutor } from '../server/natural-tutor.js';
import { premiumSpeechText } from '../server/premium-speech.js';
import { conversationalEvidence, pendingStudyQuestion, studyDialogueHistory } from '../server/study-conversation.js';
import { studyCondition, STUDY_NOW } from './fixtures/study-condition.js';

const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const readoutCode = app.slice(app.indexOf('function trustedStudySpeech('), app.indexOf('function renderMessage('));
const readout = new Function(readoutCode + '\nreturn {allowed:readoutMessageAllowed,text:studySpokenText};')();
const evidenceCode = app.slice(app.indexOf('function renderAnswerEvidence('), app.indexOf('function renderAccountLogin('));
const evidenceUi = new Function('readoutMessageAllowed', 'esc', 'safeUrl', 'sourceReuseNotice', 'renderSourceComparison', evidenceCode + '\nreturn renderAnswerEvidence;')(
  readout.allowed, value => String(value ?? ''), value => value, () => '', () => '',
);

function fixture({ social = false, pendingQuestion = null } = {}) {
  const references = createStudyCurriculum({ records: [studyCondition()], now: () => STUDY_NOW });
  const conversation = { id: 'library-voice', mode: 'coach', messages: [{ id: 'u1', role: 'user', content: social ? 'I am unsure.' : 'Explain asthma inhaler technique.' }] };
  const evidence = references.retrieve('Study asthma inhaler technique');
  const draft = { segments: [{ id: 's1', text: social ? 'We can take our time and work through this together.' : evidence.find(source => source.key === 'asthma:management').text, sourceChunkIds: social ? [] : ['asthma:management'] }] };
  const rendered = renderNaturalTutor(draft, { references, evidence, conversation, pendingQuestion });
  const message = { id: 'a1', role: 'assistant', responseTo: 'u1', ...rendered };
  conversation.messages.push(message);
  return { references, evidence, conversation, message };
}

test('a complete library-bound answer reaches the existing voice path without independent-review claims', () => {
  const { references, conversation, message } = fixture();
  assert.equal(message.libraryGroundedDialogue, true);
  assert.equal(message.reviewedDialogue, undefined);
  assert.equal(message.groundingReview, undefined);
  assert.equal(message.sourceVerified, false);
  assert.equal(message.humanReview, false);
  assert.equal(premiumSpeechText({ references, conversation, message }), message.spokenText);
  assert.equal(readout.allowed(message), true);
  assert.equal(readout.text(message), message.spokenText);
  assert.notEqual(message.content, message.spokenText, 'Display source markers are not spoken.');
  const html = evidenceUi(message);
  assert.match(html, /Study library explanation/);
  assert.match(html, /No independent model or clinician review/);
  assert.doesNotMatch(html, /Automated source check|Clinician review recorded/);
});

test('speech rejects altered words, source bindings, expired sources, imports and mismatched turns', () => {
  const mutators = [
    message => { message.content += ' Extra unsaved speech.'; },
    message => { message.spokenText += ' Extra unsaved speech.'; },
    message => { message.libraryGrounding.sourceSpanBindings[0].spanId = 'span_' + '0'.repeat(64); },
    message => { message.libraryGrounding.sourceChunkIds = ['asthma:diagnosis']; },
    message => { delete message.libraryGrounding.sourceSpanBindings; },
    message => { message.importedEvidence = true; },
    message => { message.voiceTranscript = true; },
    message => { message.ai = { imported: true }; },
    message => { message.responseTo = 'different-user'; },
  ];
  for (const mutate of mutators) {
    const { references, conversation, message } = fixture();
    mutate(message);
    assert.throws(() => premiumSpeechText({ references, conversation, message }));
  }
  const { conversation, message } = fixture();
  const expired = createStudyCurriculum({ records: [studyCondition()], now: () => Date.parse('2026-11-10T00:00:00Z') });
  assert.throws(() => premiumSpeechText({ references: expired, conversation, message }), { code: 'speech_source_expired' });
  const changedRecord = studyCondition();
  changedRecord.sections.find(section => section.id === 'management').text = 'Updated mock management text for the same source key.';
  const changed = createStudyCurriculum({ records: [changedRecord], now: () => STUDY_NOW });
  assert.throws(() => premiumSpeechText({ references: changed, conversation, message }), { code: 'speech_source_check' });
});

test('client readout refuses imported, malformed or expired library metadata', () => {
  for (const mutate of [
    message => { message.importedEvidence = true; },
    message => { message.voiceTranscript = true; },
    message => { message.sourceVerified = true; },
    message => { message.libraryGrounding.sourceSpanBindings = []; },
    message => { message.libraryGrounding.sourceChunkIds = []; },
    message => { message.spokenText += ' Changed.'; },
    message => { message.citations[0].expiresAt = '2000-01-01'; },
  ]) {
    const { message } = fixture(); mutate(message);
    assert.equal(readout.allowed(message), false);
    assert.equal(readout.text(message), '');
  }
});

test('library follow-ups rehydrate current passages without promoting earlier AI prose to evidence', () => {
  const { references, conversation, message } = fixture();
  conversation.messages.push({ id: 'u2', role: 'user', content: 'Explain that simply.' });
  assert.equal(conversationalEvidence(references, conversation, 'Explain that simply.')[0].key, 'asthma:management');
  assert.equal(studyDialogueHistory(conversation)[1].trust, 'untrusted-history');
  message.voicePlayback = { status: 'interrupted', clientReported: true, completedChunks: 0, presentedText: '' };
  const history = studyDialogueHistory(conversation)[1];
  assert.doesNotMatch(history.content, /Mock management fact/);
  assert.equal(history.presentation.heard, 'unknown');
  message.importedEvidence = true;
  assert.deepEqual(conversationalEvidence(references, conversation, 'Explain that simply.'), []);
});

test('social library replies preserve pending quizzes and remain speakable without invented citations', () => {
  const seed = fixture();
  const quiz = seed.references.quiz(seed.evidence).studyQuestion;
  const { references, conversation, message } = fixture({ social: true, pendingQuestion: quiz });
  assert.deepEqual(pendingStudyQuestion(conversation, ['asthma']), quiz);
  assert.equal(pendingStudyQuestion(conversation, ['diabetes']), null);
  assert.equal(premiumSpeechText({ references, conversation, message }), message.spokenText);
  assert.equal(readout.allowed(message), true);
  assert.deepEqual(message.citations, []);
  assert.match(evidenceUi(message), /No independent model review/);
  const imported = structuredClone(conversation); imported.messages.at(-1).importedEvidence = true;
  assert.equal(pendingStudyQuestion(imported, ['asthma']), null);
});
