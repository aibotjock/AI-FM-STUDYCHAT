const ENDPOINT = 'https://mzmtbauuqywucgssckwx.supabase.co/functions/v1/studychat-test-events';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MODEL = /^[A-Za-z0-9_.:-]{1,200}$/;
const ERROR_CODES = new Set(['provider_auth', 'provider_rate_limit', 'provider_http', 'provider_network', 'provider_error', 'timeout', 'empty_output', 'early_close', 'malformed_stream', 'incomplete_response', 'output_limit', 'cancelled']);
const TERMINAL_HTTP = new Set([400, 401, 403, 409]);
const MAX_ROWS = 500;
const DEADLINE_MS = 5000;

// Construct the payload field by field. Prompt text, learner IDs, headers and
// arbitrary provider metadata cannot become telemetry by object spreading.
function eventPayload(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const count = (value, limit) => value == null ? null : Number.isSafeInteger(value) && value >= 0 && value <= limit ? value : undefined;
  const model = value => typeof value === 'string' && MODEL.test(value);
  const inputTokens = count(input.inputTokens, 10_000_000), outputTokens = count(input.outputTokens, 2_000_000);
  const usage = { inputTokens, outputTokens, cachedInputTokens: count(input.cachedInputTokens, inputTokens ?? 10_000_000),
    cacheWriteInputTokens: count(input.cacheWriteInputTokens, inputTokens ?? 10_000_000), reasoningOutputTokens: count(input.reasoningOutputTokens, outputTokens ?? 2_000_000) };
  if (Object.values(usage).some(value => value === undefined) || (usage.inputTokens === null) !== (usage.outputTokens === null)) return null;
  const source = input.source ?? 'app_observed', errorCode = input.errorCode ?? null, returnedModel = input.returnedModel ?? null, estimatedCostUsd = input.estimatedCostUsd ?? null;
  if (!UUID.test(input.requestId) || !['openai', 'anthropic'].includes(input.provider) || !model(input.requestedModel)
    || (returnedModel !== null && !model(returnedModel)) || !(input.provider === 'anthropic' ? input.endpoint === 'messages' : ['chat', 'responses'].includes(input.endpoint))
    || !Number.isInteger(input.statusCode) || input.statusCode < 100 || input.statusCode > 599
    || (errorCode !== null && !ERROR_CODES.has(errorCode)) || !Number.isInteger(input.latencyMs) || input.latencyMs < 0 || input.latencyMs > 3_600_000
    || (estimatedCostUsd !== null && (inputTokens === null || !Number.isFinite(estimatedCostUsd) || estimatedCostUsd < 0 || estimatedCostUsd > 10_000))
    || typeof input.occurredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(input.occurredAt)
    || !Number.isFinite(Date.parse(input.occurredAt)) || new Date(input.occurredAt).toISOString() !== input.occurredAt
    || !['app_observed', 'client_simulated'].includes(source)
    || (source === 'client_simulated' && (Object.values(usage).some(value => value !== null) || estimatedCostUsd !== null))) return null;
  return { requestId: input.requestId, provider: input.provider, requestedModel: input.requestedModel, returnedModel,
    endpoint: input.endpoint, statusCode: input.statusCode, errorCode, latencyMs: input.latencyMs, ...usage, estimatedCostUsd, occurredAt: input.occurredAt, source };
}

function abortable(promise, signal) {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason || new DOMException('Cancelled', 'AbortError'));
    if (signal.aborted) { abort(); return; }
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
async function acknowledgement(response, signal, requestId) {
  if (!response.body?.getReader) return false;
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    for (;;) {
      const next = await abortable(reader.read(), signal); if (next.done) break;
      bytes += next.value.byteLength; if (bytes > 4096) return false; chunks.push(next.value);
    }
    let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return false; }
    return value?.accepted === true && value.requestId === requestId && typeof value.duplicate === 'boolean'
      && Object.keys(value).length === 3;
  } finally { void reader.cancel().catch(() => {}); try { reader.releaseLock(); } catch {} }
}

/** A small durable outbox. Recording is synchronous; delivery is never part of
 * the learner's response. Each retry reuses the original observation UUID. */
export function createIngeniumTelemetry({ db, config = {}, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  const configured = Boolean(config.ingeniumKey && config.ingeniumOrganizationId);
  if (!configured) return { record: () => false, status: () => ({ configured: false, organizationId: null, pending: 0, delivered: 0, rejected: 0, dropped: 0, lastDeliveryAt: null, lastError: null, retainedEvents: 0 }), close() {} };
  db.exec(`CREATE TABLE IF NOT EXISTS ingenium_outbox (
    request_id TEXT PRIMARY KEY, payload TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('pending','delivered','rejected')),
    attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  ); CREATE TABLE IF NOT EXISTS ingenium_state (
    id INTEGER PRIMARY KEY CHECK(id=1), delivered INTEGER NOT NULL DEFAULT 0,
    rejected INTEGER NOT NULL DEFAULT 0, dropped INTEGER NOT NULL DEFAULT 0,
    last_delivery_at TEXT, last_error TEXT
  ); INSERT OR IGNORE INTO ingenium_state(id) VALUES(1);`);
  let closed = false, scheduled = false, pumping = false, timer = null, controller = null, authBlocked = false;
  const time = () => Math.trunc(now());
  const lastError = code => db.prepare('UPDATE ingenium_state SET last_error=? WHERE id=1').run(code);
  function transaction(fn) {
    db.exec('BEGIN IMMEDIATE');
    try { fn(); db.exec('COMMIT'); } catch (error) { db.exec('ROLLBACK'); throw error; }
  }
  const pruneDelivered = () => db.exec("DELETE FROM ingenium_outbox WHERE request_id IN (SELECT request_id FROM ingenium_outbox WHERE status='delivered' ORDER BY created_at DESC, rowid DESC LIMIT -1 OFFSET 100)");
  function schedule() {
    if (closed || scheduled || pumping || authBlocked) return;
    if (timer) { clearTimeout(timer); timer = null; }
    scheduled = true;
    queueMicrotask(() => { scheduled = false; if (!closed && !authBlocked) void pump(); });
  }
  function retry(row, code) {
    const attempts = row.attempts + 1, delay = Math.min(60_000, 1000 * 2 ** Math.min(attempts - 1, 6));
    db.prepare('UPDATE ingenium_outbox SET attempts=?,next_attempt_at=? WHERE request_id=? AND status=\'pending\'').run(attempts, time() + delay, row.request_id);
    lastError(code);
  }
  async function deliver(row) {
    controller = new AbortController();
    const activeController = controller, deadline = setTimeout(() => activeController.abort(new Error('delivery_timeout')), DEADLINE_MS);
    try {
      const response = await abortable(fetchImpl(ENDPOINT, { method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json',
        'x-ingenium-key': config.ingeniumKey, 'x-ingenium-organization': config.ingeniumOrganizationId }, body: row.payload, signal: activeController.signal }), activeController.signal);
      activeController.signal.throwIfAborted();
      if (!response.ok) {
        void response.body?.cancel().catch(() => {});
        if (TERMINAL_HTTP.has(response.status)) {
          transaction(() => {
            db.prepare("UPDATE ingenium_outbox SET status='rejected',attempts=attempts+1 WHERE request_id=? AND status='pending'").run(row.request_id);
            db.prepare('UPDATE ingenium_state SET rejected=rejected+1,last_error=? WHERE id=1').run([401, 403].includes(response.status) ? 'receiver_auth' : 'receiver_rejected');
          });
          if ([401, 403].includes(response.status)) authBlocked = true;
        } else retry(row, 'receiver_http');
      } else if (await acknowledgement(response, activeController.signal, row.request_id)) {
        transaction(() => {
          db.prepare("UPDATE ingenium_outbox SET status='delivered',attempts=attempts+1 WHERE request_id=? AND status='pending'").run(row.request_id);
          db.prepare('UPDATE ingenium_state SET delivered=delivered+1,last_delivery_at=?,last_error=NULL WHERE id=1').run(new Date(time()).toISOString());
          pruneDelivered();
        });
      } else retry(row, 'receiver_ack');
    } catch {
      if (!closed) retry(row, activeController.signal.aborted ? 'receiver_timeout' : 'receiver_network');
    } finally { clearTimeout(deadline); if (controller === activeController) controller = null; }
  }
  async function pump() {
    if (pumping || closed || authBlocked) return; pumping = true;
    try {
      for (let count = 0; count < 20 && !closed && !authBlocked; count++) {
        const row = db.prepare("SELECT * FROM ingenium_outbox WHERE status='pending' AND next_attempt_at<=? ORDER BY created_at,rowid LIMIT 1").get(time());
        if (!row) break;
        await deliver(row);
      }
    } catch { if (!closed) { try { lastError('outbox_storage'); } catch {} } }
    finally {
      pumping = false;
      if (!closed && !authBlocked) {
        const row = db.prepare("SELECT MIN(next_attempt_at) AS due FROM ingenium_outbox WHERE status='pending'").get();
        if (row.due !== null) { timer = setTimeout(() => { timer = null; schedule(); }, Math.max(0, Math.min(60_000, row.due - time()))); timer.unref?.(); }
      }
    }
  }
  function record(metadata) {
    if (closed) return false;
    try {
      const payload = eventPayload(metadata);
      if (!payload) { db.prepare("UPDATE ingenium_state SET dropped=dropped+1,last_error='invalid_event' WHERE id=1").run(); return false; }
      const serialized = JSON.stringify(payload), existing = db.prepare('SELECT payload FROM ingenium_outbox WHERE request_id=?').get(payload.requestId);
      if (existing) { if (existing.payload !== serialized) { db.prepare("UPDATE ingenium_state SET dropped=dropped+1,last_error='request_id_conflict' WHERE id=1").run(); return false; } schedule(); return true; }
      pruneDelivered();
      if (db.prepare('SELECT COUNT(*) AS count FROM ingenium_outbox').get().count >= MAX_ROWS) {
        db.exec("DELETE FROM ingenium_outbox WHERE request_id IN (SELECT request_id FROM ingenium_outbox WHERE status!='pending' ORDER BY created_at,rowid LIMIT 1)");
        if (db.prepare('SELECT COUNT(*) AS count FROM ingenium_outbox').get().count >= MAX_ROWS) { db.prepare("UPDATE ingenium_state SET dropped=dropped+1,last_error='outbox_full' WHERE id=1").run(); return false; }
      }
      const created = time();
      db.prepare("INSERT INTO ingenium_outbox(request_id,payload,status,next_attempt_at,created_at) VALUES(?,?,'pending',?,?)").run(payload.requestId, serialized, created, created);
      schedule(); return true;
    } catch { try { lastError('outbox_storage'); } catch {} return false; }
  }
  function status() {
    const state = db.prepare('SELECT * FROM ingenium_state WHERE id=1').get(), counts = db.prepare("SELECT COUNT(*) AS retained,SUM(status='pending') AS pending FROM ingenium_outbox").get();
    return { configured: true, organizationId: config.ingeniumOrganizationId, pending: counts.pending || 0,
      delivered: state.delivered, rejected: state.rejected, dropped: state.dropped, lastDeliveryAt: state.last_delivery_at,
      lastError: state.last_error, retainedEvents: counts.retained };
  }
  schedule();
  return { record, status, close() { closed = true; if (timer) clearTimeout(timer); timer = null; controller?.abort(new Error('closed')); } };
}
