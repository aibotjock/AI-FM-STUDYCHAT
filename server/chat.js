import { coachMessages } from './coach-prompt.js';

const ACTIVE = new Set(['pending', 'running']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled', 'interrupted']);
const idPattern = /^[A-Za-z0-9_.:-]{1,128}$/;
function fail(message, code = 'invalid_submission', status = 400) { const error = new Error(message); error.code = code; error.status = status; throw error; }
export function validChatId(id, field = 'ID') {
  if (typeof id !== 'string' || !idPattern.test(id) || ['.', '..', '__proto__', 'constructor', 'prototype'].includes(id)) fail(`Invalid ${field}.`);
  return id;
}
const validId = validChatId;
function parse(value, fallback) { try { return JSON.parse(value); } catch { return fallback; } }

export function createChatService({ db, provider, config = {}, getContext = () => null, resolveTurn = () => null, getSelection = () => ({ provider: 'openai', model: config.model || 'gpt-4.1-mini' }) } = {}) {
  const maxInput = config.maxInputChars || 8000, maxOutput = config.maxOutputChars || 20000;
  const maxHistory = config.maxHistoryMessages ?? 12, timeoutMs = config.chatTimeoutMs || 90000;
  const active = new Map();
  db.exec(`CREATE TABLE IF NOT EXISTS chat_conversations (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_turns (seq INTEGER PRIMARY KEY AUTOINCREMENT, turn_id TEXT NOT NULL UNIQUE,
    conversation_id TEXT NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
    input TEXT NOT NULL, reference_ids TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS chat_attempts (attempt_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL REFERENCES chat_turns(turn_id) ON DELETE CASCADE,
    status TEXT NOT NULL, content TEXT NOT NULL DEFAULT '', error TEXT, error_code TEXT, started_at INTEGER NOT NULL,
    finished_at INTEGER, model TEXT, usage TEXT, first_text_ms INTEGER, total_ms INTEGER,
    sources TEXT NOT NULL DEFAULT '[]', label TEXT, imported INTEGER NOT NULL DEFAULT 0, imported_metadata TEXT);
    CREATE TABLE IF NOT EXISTS chat_legacy_records (position INTEGER PRIMARY KEY, data TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS chat_turn_conversation ON chat_turns(conversation_id, seq);
    CREATE INDEX IF NOT EXISTS chat_attempt_turn ON chat_attempts(turn_id, started_at);`);
  if (!db.prepare('PRAGMA table_info(chat_attempts)').all().some(row => row.name === 'imported_metadata')) db.exec('ALTER TABLE chat_attempts ADD COLUMN imported_metadata TEXT');
  for (const column of ['request_provider', 'request_model', 'provider']) if (!db.prepare('PRAGMA table_info(chat_attempts)').all().some(row => row.name === column)) db.exec(`ALTER TABLE chat_attempts ADD COLUMN ${column} TEXT`);
  db.prepare("UPDATE chat_attempts SET status='interrupted', error='Generation interrupted by server restart. Retry explicitly.', error_code='interrupted', finished_at=? WHERE status IN ('pending','running')").run(Date.now());
  const findConversation = db.prepare('SELECT * FROM chat_conversations WHERE id=?');
  const findTurn = db.prepare('SELECT * FROM chat_turns WHERE turn_id=?');
  const findAttempt = db.prepare('SELECT * FROM chat_attempts WHERE attempt_id=?');
  const latestAttempt = db.prepare('SELECT * FROM chat_attempts WHERE turn_id=? ORDER BY rowid DESC LIMIT 1');
  const latestTurn = db.prepare('SELECT * FROM chat_turns WHERE conversation_id=? ORDER BY seq DESC LIMIT 1');

  function outcome(row, turn, extra = {}) {
    return { conversationId: turn.conversation_id, turnId: turn.turn_id, attemptId: row.attempt_id,
      status: row.status, content: row.content, error: row.error, code: row.error_code, sources: parse(row.sources, []),
      label: row.label, model: row.model, provider: row.provider, selection: { provider: row.request_provider, model: row.request_model }, usage: parse(row.usage, null), firstTextMs: row.first_text_ms,
      durationMs: row.total_ms, imported: Boolean(row.imported), historicalMetadata: parse(row.imported_metadata, null), ...extra };
  }
  function eventFor(result) { return { type: result.status === 'completed' || ACTIVE.has(result.status) ? 'done' : 'error', ...result }; }
  function notify(item, value) { try { item.emit(value); } catch { finish(item, 'cancelled', { error: 'Connection closed.', code: 'cancelled' }); } }
  function finish(item, status, extra = {}) {
    const existing = findAttempt.get(item.attemptId);
    if (!existing || !ACTIVE.has(existing.status)) return existing ? outcome(existing, item.turn) : null;
    const finished = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      db.prepare(`UPDATE chat_attempts SET status=?, content=?, error=?, error_code=?, finished_at=?,
        model=?, usage=?, first_text_ms=?, total_ms=?, sources=?, label=?, provider=? WHERE attempt_id=? AND status IN ('pending','running')`)
        .run(status, item.content, extra.error || null, extra.code || null, finished, extra.model || null,
          extra.usage ? JSON.stringify(extra.usage) : null, item.firstTextMs ?? null, finished - item.startedAt,
          JSON.stringify(extra.sources || []), extra.label || null, extra.provider || null, item.attemptId);
      db.prepare('UPDATE chat_conversations SET updated_at=? WHERE id=?').run(finished, item.turn.conversation_id);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    const result = outcome(findAttempt.get(item.attemptId), item.turn);
    if (active.get(item.turn.conversation_id) === item) active.delete(item.turn.conversation_id);
    if (status !== 'completed') item.controller.abort(new DOMException(result.error || status, 'AbortError'));
    if (!item.terminalSent) { item.terminalSent = true; try { item.emit(eventFor(result)); } catch {} }
    return result;
  }
  function cancel({ conversationId, attemptId } = {}) {
    const item = active.get(conversationId);
    if (!item || (attemptId && item.attemptId !== attemptId)) return { cancelled: false };
    return { cancelled: true, ...finish(item, 'cancelled', { error: 'Response cancelled.', code: 'cancelled' }) };
  }
  function conversations() {
    const current = db.prepare('SELECT id,title,created_at AS createdAt,updated_at AS updatedAt FROM chat_conversations ORDER BY updated_at DESC').all();
    for (const row of db.prepare('SELECT position,data FROM chat_legacy_records ORDER BY position').all()) {
      const record = JSON.parse(row.data), id = `legacy-archive-${row.position}`;
      // Preserve a read-only route even when the original conversation cannot be paired into turns.
      current.push({ id, title: `${record.title || record.name || 'Imported conversation'} (archive)`, imported: true, readOnly: true });
    }
    return current;
  }
  function history(conversationId, { beforeSeq } = {}) {
    const before = beforeSeq == null ? Number.MAX_SAFE_INTEGER : Number(beforeSeq);
    if (!Number.isSafeInteger(before) || before < 1) fail('Invalid history cursor.');
    const archived = /^legacy-archive-(\d+)$/.exec(conversationId);
    if (archived) {
      const row = db.prepare('SELECT data FROM chat_legacy_records WHERE position=?').get(Number(archived[1]));
      if (row) {
        const original = JSON.parse(row.data);
        return { conversation: { id: conversationId, title: original.title || original.name || 'Imported conversation', readOnly: true }, turns: [], page: { hasOlder: false, beforeSeq: null }, legacyMessages: original.messages || [], legacyRecord: original, label: 'Historical imported records; source status unverified' };
      }
    }
    const conversation = findConversation.get(conversationId);
    if (!conversation) return { conversation: null, turns: [], page: { hasOlder: false, beforeSeq: null } };
    const rows = db.prepare('SELECT * FROM chat_turns WHERE conversation_id=? AND seq<? ORDER BY seq DESC LIMIT 101').all(conversationId, before);
    const hasOlder = rows.length > 100, selected = rows.slice(0, 100).reverse();
    const turns = selected.map(turn => {
      const attempts = db.prepare('SELECT * FROM chat_attempts WHERE turn_id=? ORDER BY rowid').all(turn.turn_id);
      const latest = attempts.at(-1);
      return { seq: turn.seq, turnId: turn.turn_id, input: turn.input, createdAt: turn.created_at, referenceIds: parse(turn.reference_ids, []),
        ...(latest ? outcome(latest, turn) : { status: 'interrupted', content: '', error: 'No recorded attempt.' }),
        attempts: attempts.map(row => outcome(row, turn)) };
    });
    return { conversation: { id: conversation.id, title: conversation.title, createdAt: conversation.created_at, updatedAt: conversation.updated_at }, turns,
      page: { hasOlder, beforeSeq: hasOlder ? selected[0].seq : null } };
  }
  function completedContext(conversationId) {
    const turns = db.prepare(`SELECT t.input,a.content FROM chat_turns t JOIN chat_attempts a ON a.rowid=(
      SELECT rowid FROM chat_attempts WHERE turn_id=t.turn_id ORDER BY rowid DESC LIMIT 1)
      WHERE t.conversation_id=? AND a.status='completed' AND a.imported=0 ORDER BY t.seq DESC LIMIT ?`).all(conversationId, Math.floor(maxHistory / 2));
    return turns.reverse().flatMap(turn => [{ role: 'user', content: turn.input }, { role: 'assistant', content: turn.content }]);
  }
  async function submit(request, emit = () => {}, { signal } = {}) {
    const { conversationId, turnId, attemptId, input, retry = false, referenceIds = [] } = request || {};
    validId(conversationId, 'conversation ID'); validId(turnId, 'turn ID'); validId(attemptId, 'attempt ID');
    if (/^legacy-archive-/.test(conversationId)) fail('Historical archives are read-only. Start a new conversation.', 'read_only_archive', 409);
    if (typeof input !== 'string' || !input.trim() || input.length > maxInput) fail(`Message must contain 1–${maxInput} characters.`);
    if (typeof retry !== 'boolean' || !Array.isArray(referenceIds) || referenceIds.length > 5 || referenceIds.some(id => typeof id !== 'string' || id.length > 200)) fail('Invalid retry or reference IDs.');
    const references = JSON.stringify([...new Set(referenceIds)].sort());
    let turn = findTurn.get(turnId);
    const attempt = findAttempt.get(attemptId);
    const fallback = attempt?.request_provider && request.provider === undefined && request.model === undefined ? { provider: attempt.request_provider, model: attempt.request_model } : getSelection();
    const selection = { provider: request.provider ?? fallback.provider, model: request.model ?? (request.provider && request.provider !== fallback.provider ? (request.provider === 'anthropic' ? config.anthropicModel : config.model) : fallback.model) };
    if (!['openai', 'anthropic'].includes(selection.provider) || typeof selection.model !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(selection.model)) fail('Choose a valid provider and model.', 'invalid_model');
    if (attempt && attempt.turn_id !== turnId) fail('Attempt ID already belongs to another turn.', 'payload_mismatch', 409);
    if (attempt?.request_provider && (attempt.request_provider !== selection.provider || attempt.request_model !== selection.model)) fail('Attempt ID was reused with a different provider or model. Use a new attempt ID.', 'payload_mismatch', 409);
    if (turn) {
      if (turn.conversation_id !== conversationId || turn.input !== input || turn.reference_ids !== references) fail('Turn ID was reused with a different submission.', 'payload_mismatch', 409);
      const latest = latestAttempt.get(turnId);
      if (attempt || !retry || latest?.status === 'completed' || ACTIVE.has(latest?.status)) {
        const result = outcome(attempt || latest, turn, { duplicate: true }); emit(eventFor(result)); return result;
      }
      if (latestTurn.get(conversationId)?.turn_id !== turnId) fail('Only the most recent unfinished turn can be retried. Submit a new turn instead.', 'older_retry', 409);
    } else if (retry) fail('There is no saved turn to retry.', 'invalid_retry', 409);
    if (!findConversation.get(conversationId) && db.prepare('SELECT (SELECT COUNT(*) FROM chat_conversations)+(SELECT COUNT(*) FROM chat_legacy_records) AS count').get().count >= 500) fail('Conversation limit reached. Export a backup and remove older conversations.', 'conversation_limit', 409);

    cancel({ conversationId });
    const now = Date.now();
    db.exec('BEGIN IMMEDIATE');
    try {
      if (!findConversation.get(conversationId)) db.prepare('INSERT INTO chat_conversations VALUES (?,?,?,?)').run(conversationId, input.trim().slice(0, 70), now, now);
      if (!turn) db.prepare('INSERT INTO chat_turns(turn_id,conversation_id,input,reference_ids,created_at) VALUES (?,?,?,?,?)').run(turnId, conversationId, input, references, now);
      db.prepare("INSERT INTO chat_attempts(attempt_id,turn_id,status,started_at,request_provider,request_model) VALUES (?,?,'running',?,?,?)").run(attemptId, turnId, now, selection.provider, selection.model);
      db.prepare('UPDATE chat_conversations SET updated_at=? WHERE id=?').run(now, conversationId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    turn = findTurn.get(turnId);
    const item = { turn, attemptId, startedAt: now, content: '', firstTextMs: null, lastSaveAt: 0, savedChars: 0, controller: new AbortController(), emit, terminalSent: false };
    active.set(conversationId, item);
    const onAbort = () => finish(item, 'cancelled', { error: 'Response cancelled.', code: 'cancelled' });
    signal?.addEventListener('abort', onAbort, { once: true });
    notify(item, { type: 'start', conversationId, turnId, attemptId, status: 'running' });
    if (signal?.aborted) onAbort();
    let timer;
    const aborted = new Promise((_, reject) => {
      if (item.controller.signal.aborted) reject(item.controller.signal.reason);
      else item.controller.signal.addEventListener('abort', () => reject(item.controller.signal.reason), { once: true });
    });
    const deadline = new Promise((_, reject) => { timer = setTimeout(() => {
      const error = new Error('AI request timed out. You can retry this turn.'); error.code = 'timeout'; reject(error);
    }, timeoutMs); });
    function delta(text) {
      if (item.controller.signal.aborted || active.get(conversationId) !== item || !ACTIVE.has(findAttempt.get(attemptId)?.status)) return;
      if (typeof text !== 'string' || item.content.length + text.length > maxOutput) { const error = new Error('AI response exceeded the configured size limit.'); error.code = 'output_limit'; throw error; }
      if (!text) return;
      item.firstTextMs ??= Date.now() - now; item.content += text;
      const changedAt = Date.now();
      if (changedAt - item.lastSaveAt >= 250 || item.content.length - item.savedChars >= 512) {
        db.prepare("UPDATE chat_attempts SET content=?,first_text_ms=? WHERE attempt_id=? AND status='running'").run(item.content, item.firstTextMs, attemptId);
        item.lastSaveAt = changedAt; item.savedChars = item.content.length;
      }
      notify(item, { type: 'delta', conversationId, turnId, attemptId, delta: text });
    }
    try {
      const work = Promise.resolve().then(async () => {
        item.controller.signal.throwIfAborted();
        const resolved = await resolveTurn({ ...request, text: input, signal: item.controller.signal });
        item.controller.signal.throwIfAborted();
        if (resolved) return resolved;
        const context = await getContext({ ...request, text: input, signal: item.controller.signal });
        item.controller.signal.throwIfAborted();
        return provider.generate({ messages: coachMessages({ history: completedContext(conversationId), input, context }), selection, signal: item.controller.signal, onDelta: delta, onSearch: () => { if (!item.controller.signal.aborted && ACTIVE.has(findAttempt.get(attemptId)?.status)) notify(item,{ type: 'search', conversationId, turnId, attemptId }); } });
      });
      const result = await Promise.race([work, deadline, aborted]);
      if (!ACTIVE.has(findAttempt.get(attemptId)?.status)) return outcome(findAttempt.get(attemptId), turn);
      if (typeof result?.content !== 'string' || !result.content.trim()) { const error = new Error('AI returned no text. You can retry this turn.'); error.code = 'empty_output'; throw error; }
      if (result.content.length > maxOutput) { const error = new Error('AI response exceeded the configured size limit.'); error.code = 'output_limit'; throw error; }
      if (!item.content) delta(result.content);
      else if (item.content !== result.content) { const error = new Error('AI final text did not match its stream.'); error.code = 'malformed_stream'; throw error; }
      return finish(item, 'completed', result);
    } catch (error) {
      const row = findAttempt.get(attemptId);
      if (row && !ACTIVE.has(row.status)) return outcome(row, turn);
      const allowed = new Set(['ai_unavailable','provider_auth','provider_rate_limit','provider_http','provider_network','provider_error','timeout','empty_output','early_close','malformed_stream','incomplete_response','output_limit','source_unavailable','invalid_model','model_unavailable','context_limit','chat_busy']);
      const code = allowed.has(error?.code) ? error.code : 'provider_error';
      const message = allowed.has(error?.code) ? error.message : 'Could not complete this response. You can retry this turn.';
      return finish(item, 'failed', { error: message, code });
    } finally {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      if (active.get(conversationId) === item) active.delete(conversationId);
    }
  }
  function removeConversation(id) {
    const archived = /^legacy-archive-(\d+)$/.exec(id);
    if (archived) return db.prepare('DELETE FROM chat_legacy_records WHERE position=?').run(Number(archived[1])).changes > 0;
    cancel({ conversationId: id });
    db.prepare('DELETE FROM chat_attempts WHERE turn_id IN (SELECT turn_id FROM chat_turns WHERE conversation_id=?)').run(id);
    db.prepare('DELETE FROM chat_turns WHERE conversation_id=?').run(id);
    return db.prepare('DELETE FROM chat_conversations WHERE id=?').run(id).changes > 0;
  }
  function exportData() {
    return { version: 1, conversations: db.prepare('SELECT * FROM chat_conversations').all(),
      turns: db.prepare('SELECT * FROM chat_turns ORDER BY seq').all(), attempts: db.prepare('SELECT * FROM chat_attempts ORDER BY rowid').all(),
      legacyRecords: db.prepare('SELECT data FROM chat_legacy_records ORDER BY position').all().map(row => JSON.parse(row.data)) };
  }
  function validateImport(data) {
    if (data?.version !== 1 || !Array.isArray(data.conversations) || !Array.isArray(data.turns) || !Array.isArray(data.attempts) || data.conversations.length > 500 || data.turns.length > 50000 || data.attempts.length > 100000) fail('Invalid chat backup.');
    const copy = structuredClone(data), ids = new Set(), turns = new Set(), attempts = new Set(), paired = new Set();
    copy.legacyRecords ??= [];
    if (!Array.isArray(copy.legacyRecords) || copy.legacyRecords.length + copy.conversations.length > 500 || Buffer.byteLength(JSON.stringify(copy.legacyRecords)) > 16 * 1024 * 1024 || copy.legacyRecords.some(row => !row || typeof row !== 'object' || Array.isArray(row))) fail('Invalid legacy chat archive.');
    for (const row of copy.conversations) {
      validId(row.id, 'conversation ID'); if (ids.has(row.id) || typeof row.title !== 'string' || row.title.length > 200 || !Number.isSafeInteger(row.created_at) || row.created_at < 0 || !Number.isSafeInteger(row.updated_at) || row.updated_at < 0) fail('Invalid conversation backup.'); ids.add(row.id);
    }
    for (const row of copy.turns) {
      validId(row.turn_id, 'turn ID'); const refs = parse(row.reference_ids, null);
      if (turns.has(row.turn_id) || !ids.has(row.conversation_id) || typeof row.input !== 'string' || !row.input.trim() || row.input.length > maxInput || !Number.isSafeInteger(row.created_at) || row.created_at < 0 || !Array.isArray(refs) || refs.length > 5 || refs.some(id => typeof id !== 'string' || id.length > 200)) fail('Invalid turn backup.');
      turns.add(row.turn_id); row.reference_ids = JSON.stringify([...new Set(refs)].sort());
    }
    for (const row of copy.attempts) {
      validId(row.attempt_id, 'attempt ID');
      if (attempts.has(row.attempt_id) || !turns.has(row.turn_id) || ![...TERMINAL,...ACTIVE].includes(row.status) || typeof row.content !== 'string' || row.content.length > maxOutput || !Number.isSafeInteger(row.started_at) || row.started_at < 0 || (row.error != null && typeof row.error !== 'string') || (row.error_code != null && typeof row.error_code !== 'string') || (row.finished_at != null && (!Number.isSafeInteger(row.finished_at) || row.finished_at < 0))) fail('Invalid attempt backup.');
      if (row.imported_metadata != null && (typeof row.imported_metadata !== 'string' || !parse(row.imported_metadata, null) || row.imported_metadata.length > 131072)) fail('Invalid historical attempt metadata.');
      if (row.sources != null && (typeof row.sources !== 'string' || !Array.isArray(parse(row.sources, null)))) fail('Invalid source metadata.');
      if (row.model != null && typeof row.model !== 'string') fail('Invalid historical model metadata.');
      if (row.provider != null && !['openai','anthropic'].includes(row.provider)) fail('Invalid historical provider metadata.');
      if (row.request_provider != null && !['openai','anthropic'].includes(row.request_provider)) fail('Invalid requested provider metadata.');
      if (row.request_model != null && (typeof row.request_model !== 'string' || !/^[A-Za-z0-9_.:-]{1,200}$/.test(row.request_model))) fail('Invalid requested model metadata.');
      if (row.usage != null && (typeof row.usage !== 'string' || !parse(row.usage, null))) fail('Invalid historical usage metadata.');
      attempts.add(row.attempt_id); paired.add(row.turn_id);
      row.imported_metadata ??= JSON.stringify({ status: row.status, sources: row.sources || '[]', label: row.label || null,
        model: row.model || null, provider: row.provider || null, usage: row.usage || null, first_text_ms: row.first_text_ms ?? null, total_ms: row.total_ms ?? null });
      if (ACTIVE.has(row.status)) { row.status = 'interrupted'; row.error = 'Imported unfinished response. Retry explicitly.'; row.error_code = 'interrupted'; row.finished_at = Date.now(); }
      // Imported text and links have not been rechecked; no consulted-source evidence is imported.
      row.sources = '[]'; row.label = row.status === 'completed' ? 'Imported history; sources unverified' : null; row.imported = 1;
      row.usage = null; row.model = null; row.provider = null; row.first_text_ms = null; row.total_ms = null;
    }
    if (copy.turns.some(row => !paired.has(row.turn_id))) fail('Backup turn has no attempt.');
    return copy;
  }
  function importData(data) {
    const valid = validateImport(data);
    if (active.size) fail('Stop active chat before restoring a backup.', 'chat_busy', 409);
    db.exec('DELETE FROM chat_attempts; DELETE FROM chat_turns; DELETE FROM chat_conversations; DELETE FROM chat_legacy_records;');
    for (const row of valid.conversations) db.prepare('INSERT INTO chat_conversations VALUES (?,?,?,?)').run(row.id,row.title,row.created_at,row.updated_at);
    for (const row of valid.turns) db.prepare('INSERT INTO chat_turns(turn_id,conversation_id,input,reference_ids,created_at) VALUES (?,?,?,?,?)').run(row.turn_id,row.conversation_id,row.input,row.reference_ids,row.created_at);
    for (const row of valid.attempts) db.prepare('INSERT INTO chat_attempts(attempt_id,turn_id,status,content,error,error_code,started_at,finished_at,model,usage,first_text_ms,total_ms,sources,label,imported,imported_metadata,request_provider,request_model,provider) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(row.attempt_id,row.turn_id,row.status,row.content,row.error || null,row.error_code || null,row.started_at,row.finished_at || null,row.model,row.usage,row.first_text_ms,row.total_ms,row.sources,row.label,row.imported,row.imported_metadata,row.request_provider || null,row.request_model || null,row.provider || null);
    valid.legacyRecords.forEach((row,index) => db.prepare('INSERT INTO chat_legacy_records VALUES (?,?)').run(index,JSON.stringify(row)));
    return { conversations: valid.conversations.length, turns: valid.turns.length };
  }
  return { submit, cancel, conversations, history, removeConversation, exportData, validateImport, importData,
    cancelAll() { for (const conversationId of active.keys()) cancel({ conversationId }); },
    close() { for (const conversationId of active.keys()) cancel({ conversationId }); }, hasActiveWork() { return active.size > 0; },
    get available() { return provider?.available !== false; } };
}
