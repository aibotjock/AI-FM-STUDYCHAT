import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStore } from '../server/store.js';
import { createChatService } from '../server/chat.js';
import { createStudyService } from '../server/study.js';
import { createBackupService } from '../server/backup.js';
import { createCard, scheduleReview } from '../packages/spaced-review-engine/index.js';

const bank = JSON.parse(readFileSync(new URL('../content/medical-question-bank.json', import.meta.url)));
const NOW = Date.parse('2026-10-10T12:00:00Z');
function workspace(t) {
  const store = createStore({ filename: ':memory:' });
  let calls = 0;
  const provider = { available: true, async generate({ onDelta }) { calls++; onDelta('A saved reply.'); return { content: 'A saved reply.', model: 'mock', usage: { input_tokens: 1, output_tokens: 4 } }; } };
  const chat = createChatService({ db: store.db, provider });
  const study = createStudyService({ store, bank, now: () => NOW });
  const backup = createBackupService({ store, chat, study, now: () => NOW });
  t.after(() => { chat.close(); store.close(); });
  return { store, chat, study, backup, calls: () => calls };
}
function scheduledCard() {
  return scheduleReview(createCard({ front: 'A retrieval question?', back: 'A learner-authored answer.', topic: 'Reflection' }, { now: NOW - 86400000, id: 'card-one' }), 'good', NOW);
}

test('logical backup round trip restores learner records and marks imported chat untrusted without secrets', async t => {
  const original = workspace(t), restored = workspace(t);
  const { card, review } = scheduledCard();
  original.store.updateState(state => {
    state.cards = [{ ...card, apiKey: 'secret-card-key' }]; state.reviews = [review];
    state.settings.style = 'concise'; state.settings.OPENAI_API_KEY = 'secret-settings-key';
    state.serviceSecrets = { STUDY_ACCESS_TOKEN: 'secret-study-token' };
  });
  await original.chat.submit({ conversationId: 'conversation-one', turnId: 'turn-one', attemptId: 'attempt-one', input: 'Hello' });
  const snapshot = original.backup.export();
  assert.equal(snapshot.version, 2); assert.equal(snapshot.format, 'studychat-no-rag');
  assert.doesNotMatch(JSON.stringify(snapshot), /secret-card-key|secret-settings-key|secret-study-token|OPENAI_API_KEY|STUDY_ACCESS_TOKEN/);
  const result = restored.backup.import(snapshot);
  assert.equal(result.restored, true); assert.equal(result.cards, 1); assert.equal(result.reviews, 1);
  const state = restored.store.getState();
  assert.equal(state.cards[0].front, card.front); assert.equal(state.cards[0].dueAt, card.dueAt); assert.equal(state.cards[0].verified, false);
  assert.deepEqual(state.reviews, [review]); assert.equal(state.settings.style, 'concise');
  const history = restored.chat.history('conversation-one');
  assert.equal(history.turns[0].content, 'A saved reply.'); assert.equal(history.turns[0].imported, true);
  assert.deepEqual(history.turns[0].sources, []); assert.equal(restored.calls(), 0);
  assert.deepEqual(restored.backup.export().state, state);
});

test('malformed study or chat backup leaves all saved learner data unchanged', async t => {
  const app = workspace(t);
  const { card, review } = scheduledCard();
  app.store.updateState(state => { state.cards = [card]; state.reviews = [review]; });
  await app.chat.submit({ conversationId: 'original-conversation', turnId: 'original-turn', attemptId: 'original-attempt', input: 'Keep this saved history' });
  const before = app.backup.export();
  const badCard = structuredClone(before); badCard.state.cards[0].back = '';
  assert.throws(() => app.backup.import(badCard));
  assert.deepEqual(app.backup.export(), before);
  const badChat = structuredClone(before); badChat.chat.attempts[0].turn_id = 'missing-turn';
  assert.throws(() => app.backup.import(badChat));
  assert.deepEqual(app.backup.export(), before);
  assert.throws(() => app.backup.import({ ...before, version: 99 }));
  assert.deepEqual(app.backup.export(), before);
});

test('version 1 backup migrates on a fresh database with source status and assistant-only history preserved as archives', t => {
  const app = workspace(t);
  const { card, review } = scheduledCard();
  const legacyConversation = { id: 'legacy conversation ID', title: 'Original source-linked conversation', mode: 'coach', createdAt: NOW - 1000,
    messages: [{ id: 'assistant-only', role: 'assistant', content: 'Original historical response.', createdAt: NOW,
      sourceVerified: true, humanReview: false, current: true, grounded: true,
      citations: [{ id: 'old-source', title: 'Historical source', url: 'https://www.ahrq.gov/', edition: 'Historical edition' }],
      pendingStudyQuestion: { key: 'old-condition:question-one', fingerprint: 'a'.repeat(64) } }] };
  const oldPractice = { schemaVersion: 1, active: { id: 'old-session', recordedChoices: [{ questionId: 'question-one', choiceId: 'B' }] }, history: [] };
  const legacy = { version: 1, exportedAt: NOW, cards: [{ ...card, verified: true, sourceVerified: true, humanReview: true,
    curriculumConditionId: 'old-condition', curriculumQuestionId: 'question-one', sourceCheckedAt: '2026-10-10', sourceExpiresAt: '2026-11-09' }],
    reviews: [review], conversations: [legacyConversation], boardPractice: oldPractice,
    settings: { focus: 'exam', coachStyle: 'direct', dailyMinutes: 25, newCardsPerDay: 7, timeZone: 'America/New_York', voiceId: 'cedar', voiceEnabled: true, competencyRatings: { PC: 3, MK: 2 } } };
  const originalCopy = structuredClone(legacy);
  assert.equal(app.backup.import(legacy).restored, true);
  assert.deepEqual(legacy, originalCopy);
  const state = app.store.getState();
  assert.equal(state.settings.focus, 'exam-preparation'); assert.equal(state.settings.style, 'concise');
  assert.equal(state.settings.sessionMinutes, 25); assert.equal(state.settings.newCardLimit, 7); assert.equal(state.settings.voice, 'cedar');
  assert.deepEqual(state.historicalSelfAssessments.competencyRatings, { PC: 3, MK: 2 });
  assert.equal(state.cards[0].sourceVerified, false); assert.equal(state.cards[0].humanReview, false);
  assert.deepEqual(state.cards[0].importedSourceStatus, { verified: true, sourceVerified: true, humanReview: true });
  assert.equal(state.boardPractice.active, null); assert.deepEqual(state.legacyStudyRecords.boardPractice, oldPractice);
  assert.deepEqual(state.chatStudy, {});
  const exported = app.backup.export();
  assert.deepEqual(exported.chat.legacyRecords, [legacyConversation]);
  const archived = app.chat.history('legacy-archive-0');
  assert.equal(archived.conversation.readOnly, true); assert.deepEqual(archived.legacyMessages, legacyConversation.messages);
  assert.equal(app.calls(), 0);
  const second = workspace(t); second.backup.import(exported);
  assert.deepEqual(second.backup.export().chat.legacyRecords, [legacyConversation]);
});
