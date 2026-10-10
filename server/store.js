import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { HttpError } from './errors.js';

export const DEFAULT_SETTINGS = Object.freeze({ focus: 'clinical-reasoning', style: 'guided-questions', sessionMinutes: 18, newCardLimit: 5, timeZone: 'America/New_York', voice: 'marin', voiceEnabled: false, aiProvider: 'openai', aiModel: '' });

export function validateSettings(input, base = DEFAULT_SETTINGS) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'Settings must be an object.');
  const next = { ...base };
  for (const [key, values] of Object.entries({ focus: ['clinical-reasoning', 'exam-preparation', 'balanced'], style: ['guided-questions', 'concise', 'detailed'], voice: ['marin', 'cedar', 'coral', 'sage', 'ash'], aiProvider: ['openai', 'anthropic'] })) {
    if (input[key] !== undefined) { if (!values.includes(input[key])) throw new HttpError(400, `Invalid ${key}.`); next[key] = input[key]; }
  }
  for (const [key, min, max] of [['sessionMinutes', 5, 120], ['newCardLimit', 0, 100]]) {
    if (input[key] !== undefined) { if (!Number.isInteger(input[key]) || input[key] < min || input[key] > max) throw new HttpError(400, `Invalid ${key}.`); next[key] = input[key]; }
  }
  if (input.timeZone !== undefined) {
    try { if (typeof input.timeZone !== 'string' || input.timeZone.length > 100) throw new Error(); new Intl.DateTimeFormat('en', { timeZone: input.timeZone }).format(); }
    catch { throw new HttpError(400, 'Invalid timezone.'); }
    next.timeZone = input.timeZone;
  }
  if (input.voiceEnabled !== undefined) { if (typeof input.voiceEnabled !== 'boolean') throw new HttpError(400, 'Invalid voice setting.'); next.voiceEnabled = input.voiceEnabled; }
  if (input.aiModel !== undefined) { if (typeof input.aiModel !== 'string' || (input.aiModel !== '' && !/^[A-Za-z0-9_.:-]{1,200}$/.test(input.aiModel))) throw new HttpError(400, 'Invalid AI model.'); next.aiModel = input.aiModel; }
  return next;
}

export function createStore({ dataDir, filename, seed = {}, maxBytes = 16 * 1024 * 1024 } = {}) {
  if (!filename) { mkdirSync(dataDir, { recursive: true, mode: 0o700 }); filename = resolve(dataDir, 'studychat.sqlite'); }
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000; CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY); INSERT OR IGNORE INTO schema_version VALUES(1); CREATE TABLE IF NOT EXISTS workspace (id INTEGER PRIMARY KEY CHECK(id=1), payload TEXT NOT NULL); CREATE TABLE IF NOT EXISTS study_actions (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload TEXT NOT NULL, result TEXT NOT NULL, created_at INTEGER NOT NULL);');
  const schema = db.prepare('SELECT MAX(version) AS version FROM schema_version').get().version;
  if (schema > 3) { db.close(); throw new Error('This database schema is newer than this app.'); }
  const put = db.prepare('INSERT INTO workspace(id,payload) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload');
  if (!db.prepare('SELECT id FROM workspace WHERE id=1').get()) put.run(JSON.stringify({ settings: { ...DEFAULT_SETTINGS }, cards: [], reviews: [], ...structuredClone(seed) }));
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); if (result?.then) throw new Error('A database transaction cannot await network work.'); db.exec('COMMIT'); return result; }
    catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const getState = () => JSON.parse(db.prepare('SELECT payload FROM workspace WHERE id=1').get().payload);
  function saveState(state) {
    const text = JSON.stringify(state);
    if (Buffer.byteLength(text) > maxBytes) throw new HttpError(413, 'Study storage is full. Export a backup and remove older records.');
    put.run(text);
  }
  function updateState(fn) { return transaction(() => { const state = getState(); const result = fn(state); saveState(state); return result; }); }
  function action(id, kind, payload, fn) {
    if (typeof payload === 'function') { fn = payload; payload = {}; }
    if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new HttpError(400, 'A valid action ID is required.');
    const serialized = JSON.stringify(payload);
    return transaction(() => {
      const saved = db.prepare('SELECT kind,payload,result FROM study_actions WHERE id=?').get(id);
      if (saved) { if (saved.kind !== kind || saved.payload !== serialized) throw new HttpError(409, 'This action ID was already used for a different request.'); return JSON.parse(saved.result); }
      const state = getState(); const result = fn(state); saveState(state);
      db.prepare('INSERT INTO study_actions VALUES(?,?,?,?,?)').run(id, kind, serialized, JSON.stringify(result ?? null), Date.now());
      return result;
    });
  }
  return { db, getState, saveState, transaction, updateState, action, replace(state) { return transaction(() => { saveState(state); db.exec('DELETE FROM study_actions'); }); }, close() { db.close(); } };
}
