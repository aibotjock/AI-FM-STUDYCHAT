// Operator-enabled, single-model connection check. Durable /api/model-test
// request IDs prevent another paid call after a restart or uncertain outcome.
export async function runIngeniumConnectionCheck({ baseUrl, env = process.env, fetchImpl = globalThis.fetch, flushTelemetry = async () => {} } = {}) {
  if (env.INGENIUM_INITIAL_CONNECTION_CHECK !== 'ready-v1') return { skipped: true };
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Connection checks require the local app listener.');
  let cookie = '';
  const request = async (path, body) => {
    const response = await fetchImpl(new URL(path, base), {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      signal: AbortSignal.timeout(55000),
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return response;
  };
  try {
    const statusResponse = await request('/api/status');
    if (!statusResponse.ok) return { failed: true, stage: 'status' };
    const status = await statusResponse.json();
    if (!status.aiConfigured || status.providerId !== 'openai' || status.model !== 'gpt-4.1-mini') return { skipped: true, reason: 'baseline_model_not_active' };
    if (!env.INGENIUM_TELEMETRY_KEY || !env.INGENIUM_TELEMETRY_ORGANIZATION_ID) return { skipped: true, reason: 'telemetry_not_configured' };
    const login = await request('/api/login', { token: env.STUDY_ACCESS_TOKEN || '' });
    if (!login.ok) return { failed: true, stage: 'sign_in' };
    cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const tested = await request('/api/model-test', { requestId: 'ingenium-registration-ready-v1-gpt-4.1-mini' });
    if (!tested.ok) return { failed: true, authenticated: true, stage: 'model_connection', status: tested.status };
    const result = await tested.json();
    await flushTelemetry();
    const delivery = await request('/api/ingenium-status');
    const telemetry = delivery.ok ? await delivery.json() : null;
    return { authenticated: true, connected: result.connectionPassed === true, instructionPassed: result.instructionPassed === true, model: result.returnedModel || result.requestedModel, cached: result.cached === true, estimatedCostUsd: result.estimatedCostUsd ?? null, delivered: telemetry?.delivered ?? null, pending: telemetry?.pending ?? null };
  } catch { return { failed: true, stage: 'connection_check' }; }
  finally { if (cookie) { try { await request('/api/logout', {}); } catch { /* No credentials or remote errors are logged. */ } } }
}
