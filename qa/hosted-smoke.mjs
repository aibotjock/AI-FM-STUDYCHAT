import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const origin = new URL(process.env.SMOKE_URL).origin;
const token = process.env.STUDY_ACCESS_TOKEN;
const checkpoint = process.env.HOSTED_CHECKPOINT;
const phase = process.env.HOSTED_PHASE || 'before-restart';
if (!origin.startsWith('https://') || !token || !checkpoint) throw new Error('Set HTTPS SMOKE_URL, STUDY_ACCESS_TOKEN, and a private HOSTED_CHECKPOINT path.');
const checks = [];
assert.equal((await fetch(`${origin}/health`, { signal: AbortSignal.timeout(20000) })).status, 200);
assert.equal((await fetch(`${origin}/api/cards`, { signal: AbortSignal.timeout(20000) })).status, 401);
const login = await fetch(`${origin}/api/login`, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }), signal: AbortSignal.timeout(20000) });
assert.equal(login.status, 200); assert.match(login.headers.get('set-cookie'), /Secure/);
const headers = { Cookie: login.headers.get('set-cookie').split(';')[0], Origin: origin, 'Content-Type': 'application/json' };
async function api(path, body) {
  const response = await fetch(origin + path, { headers, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000) });
  const result = await response.json();
  assert.equal(response.status, 200, `${path}: ${JSON.stringify(result)}`); return result;
}
checks.push('health, private API authentication, secure session cookie');
if (phase === 'before-restart') {
  const original = await api('/api/backup');
  const card = (await api('/api/cards', { action: 'create', actionId: randomUUID(), front: 'Hosted persistence fixture', back: 'Synthetic test data' })).card;
  await api('/api/settings', { actionId: randomUUID(), sessionMinutes: 20 });
  const due = await api('/api/review');
  assert.ok(due.cards.length); await api('/api/review', { actionId: randomUUID(), cardId: due.cards[0].id, rating: 'good' });
  const practice = await api('/api/practice', { action: 'start', actionId: randomUUID(), mode: 'mixed', count: 10, timed: false });
  assert.ok(practice.sessionId); await api('/api/practice', { action: 'answer', actionId: randomUUID(), sessionId: practice.sessionId, questionKey: practice.question.key, choiceId: 'A' });
  await api('/api/practice', { action: 'finish', actionId: randomUUID(), sessionId: practice.sessionId });
  const refs = await api('/api/references?q=AHRQ'); assert.ok(refs.references.length); assert.equal(refs.references[0].consulted, false);
  const blocked = await fetch(`${origin}/api/references/consult`, { method: 'POST', headers, body: JSON.stringify({ referenceIds: [refs.references[0].id] }), signal: AbortSignal.timeout(20000) });
  assert.equal(blocked.status, 501);
  const settings = await api('/api/settings');
  writeFileSync(checkpoint, JSON.stringify({ original, cardId: card.id, settings, reviews: (await api('/api/backup')).state.reviews.length }) + '\n', { mode: 0o600 });
  checks.push('personal card save, preferences, review rating, practice grading, directory links and unavailable consultation');
} else if (phase === 'after-restart') {
  const saved = JSON.parse(readFileSync(checkpoint, 'utf8'));
  assert.ok((await api('/api/cards')).cards.some(card => card.id === saved.cardId));
  assert.deepEqual(await api('/api/settings'), saved.settings);
  assert.equal((await api('/api/backup')).state.reviews.length, saved.reviews);
  const practice = await api('/api/practice?action=history'); assert.ok(practice);
  checks.push('new-volume cards, preferences, reviews, and practice records survive restart');
  await api('/api/backup', saved.original);
  assert.equal((await api('/api/cards')).cards.some(card => card.id === saved.cardId), false);
  checks.push('original clean workspace restored; synthetic study records removed');
} else throw new Error('Use before-restart or after-restart.');
const result = { date: new Date().toISOString(), origin, phase, checks, actualModel: false };
if (process.env.HOSTED_RESULTS) writeFileSync(process.env.HOSTED_RESULTS, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
