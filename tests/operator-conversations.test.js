import test from 'node:test';
import assert from 'node:assert/strict';
import { isOperatorConversation, isOperatorTitle, learnerState, preserveOperatorConversations } from '../server/operator-conversations.js';

const legacy = { id: 'operator-legacy', title: 'Operator conversation check · synthetic study', mode: 'coach', messages: [{ role: 'user', requestId: 'study-dialogue-v3-followup-gpt-4.1-mini', content: 'Synthetic study.' }, { role: 'assistant', content: 'A saved source-gap reply.' }] };
const learner = { id: 'learner', title: 'Study chat', mode: 'coach', messages: [{ role: 'user', content: 'Hello.' }] };
const emptyOperator = { id: 'operator-new', title: 'Operator natural conversation check · synthetic study', internalCheck: true, messages: [] };

test('only exact durable operator protocols are hidden; similarly named learner chats remain', () => {
  assert.equal(isOperatorConversation(legacy), true);
  assert.equal(isOperatorConversation(emptyOperator), true);
  assert.equal(isOperatorConversation(learner), false);
  assert.equal(isOperatorConversation({ ...learner, title: legacy.title }), false);
  assert.equal(isOperatorConversation({ ...legacy, title: 'Operator homework notes' }), false);
  assert.equal(isOperatorConversation({ ...legacy, messages: [...legacy.messages, { role: 'user', content: 'My own chat.' }] }), false);
  assert.equal(isOperatorConversation({ ...legacy, messages: [...legacy.messages, { role: 'assistant', importedEvidence: true, content: 'Imported untrusted text.' }] }), false);
  assert.equal(isOperatorTitle(emptyOperator.title), true);
  assert.equal(isOperatorConversation({ ...emptyOperator, messages: [{ role: 'user', requestId: 'natural-dialogue-v1-context-gpt-4.1-mini' }] }), true);
  assert.equal(isOperatorConversation({ ...emptyOperator, messages: [{ role: 'user', requestId: 'natural-dialogue-v2-study-gpt-4.1-mini' }] }), true);
  assert.equal(isOperatorConversation({ ...emptyOperator, messages: [{ role: 'user', requestId: 'natural-dialogue-v3-study-gpt-4.1-mini' }] }), true);
  assert.equal(isOperatorConversation({ ...legacy, messages: [{ role: 'user', requestId: 'study-dialogue-v3-plan-gpt-4.1-mini' }] }), false);
});

test('learner state and backup projections leave durable internal records untouched', () => {
  const state = { settings: { dailyMinutes: 18 }, conversations: [legacy, learner, emptyOperator], cards: [] };
  const projected = learnerState(state);
  assert.deepEqual(projected.conversations, [learner]);
  assert.equal(state.conversations.length, 3);
  assert.equal(projected.settings, state.settings);
});

test('learner restore preserves internal identities and rejects collisions or forged reserved records', () => {
  const current = { conversations: [legacy, learner, emptyOperator] };
  const imported = { conversations: [{ ...learner, id: 'restored' }], cards: [] };
  const merged = preserveOperatorConversations(current, imported);
  assert.deepEqual(merged.conversations.map(x => x.id), ['restored', 'operator-legacy', 'operator-new']);
  assert.throws(() => preserveOperatorConversations(current, { conversations: [{ ...learner, id: legacy.id }] }), /cannot replace/);
  assert.throws(() => preserveOperatorConversations(current, { conversations: [{ ...learner, title: emptyOperator.title }] }), /cannot replace/);
  assert.throws(() => preserveOperatorConversations(current, { conversations: Array.from({ length: 499 }, (_, i) => ({ ...learner, id: `copy-${i}` })) }), /limit/);
});
