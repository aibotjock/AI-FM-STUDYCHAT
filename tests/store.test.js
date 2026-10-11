import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, validateSettings } from '../server/store.js';
import { loadConfig } from '../server/config.js';

test('state changes and duplicate study actions commit once', () => {
  const store = createStore({ filename: ':memory:' });
  const mutate = state => { state.reviews.push({ id: 'review1' }); return { count: state.reviews.length }; };
  assert.deepEqual(store.action('action1', 'review', { cardId: 'card1' }, mutate), { count: 1 });
  assert.deepEqual(store.action('action1', 'review', { cardId: 'card1' }, mutate), { count: 1 });
  assert.equal(store.getState().reviews.length, 1);
  assert.throws(() => store.action('action1', 'review', { cardId: 'card2' }, mutate), /different request/);
  store.close();
});
test('settings validate timezone and remote configuration refuses exposed empty tokens', () => {
  assert.equal(validateSettings({ timeZone: 'America/Los_Angeles', newCardLimit: 0 }).newCardLimit, 0);
  assert.throws(() => validateSettings({ timeZone: 'made-up-zone' }), /timezone/);
  assert.throws(() => loadConfig({ HOST: '0.0.0.0' }), /STUDY_ACCESS_TOKEN/);
  assert.equal(loadConfig({ OPENAI_MODEL: 'gpt-6-astra' }).model, 'gpt-6-astra');
  assert.throws(() => loadConfig({ LIMITED_OUTPUT_TOKENS: 99999 }), /LIMITED_OUTPUT_TOKENS/);
});
