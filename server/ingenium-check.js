// Operator-enabled connection checks. Durable /api/model-test
// request IDs prevent another paid call after a restart or uncertain outcome.
export async function runIngeniumConnectionCheck({ baseUrl, env = process.env, fetchImpl = globalThis.fetch, flushTelemetry = async () => {} } = {}) {
  const gate = env.INGENIUM_INITIAL_CONNECTION_CHECK;
  if (!['ready-v1', 'luna6-terra56-ready-v1'].includes(gate)) return { skipped: true };
  const base = new URL(baseUrl);
  if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Connection checks require the local app listener.');
  let cookie = '';
  const request = async (path, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetchImpl(new URL(path, base), {
      method, redirect: 'error',
      signal: AbortSignal.timeout(55000),
      headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    });
    return response;
  };
  if (gate === 'luna6-terra56-ready-v1') return runModelComparison({ env, request, setCookie: value => { cookie = value; }, flushTelemetry });
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

async function runModelComparison({ env, request, setCookie, flushTelemetry }) {
  const comparison = 'luna6-terra56-ready-v1';
  const targets = ['gpt-5.6-terra', 'gpt-6-luna'];
  if ((env.APP_MODE || 'personal') !== 'personal' || (env.AI_PROVIDER || 'openai').trim().toLowerCase() !== 'openai') return { skipped: true, reason: 'personal_openai_only', comparison };
  if (![env.STUDY_ACCESS_TOKEN, env.INGENIUM_TELEMETRY_KEY, env.INGENIUM_TELEMETRY_ORGANIZATION_ID].every(value => typeof value === 'string' && value.trim())) return { skipped: true, reason: 'operator_credentials_not_configured', comparison };
  const result = { comparison, authenticated: false, clinicalAccuracy: 'Not evaluated', results: [], activeModel: null, lunaActive: false, delivered: null, pending: null };
  let stage = 'status', signedIn = false, lunaSelected = false;
  const count = (value, limit) => Number.isSafeInteger(value) && value >= 0 && value <= limit ? value : null;
  const active = (status, model) => status.aiConfigured === true && status.providerId === 'openai' && status.modelSelectionEnabled === true && status.model === model;
  const fail = (failureStage, status) => Object.assign(result, { failed: true, stage: failureStage, ...(status === undefined ? {} : { status }) });
  try {
    const initial = await request('/api/status');
    if (!initial.ok) { fail(stage, initial.status); return result; }
    const status = await initial.json();
    if (status.aiConfigured !== true || status.providerId !== 'openai' || status.modelSelectionEnabled !== true || status.authRequired !== true) return { skipped: true, reason: 'authenticated_personal_openai_not_active', comparison };
    stage = 'sign_in';
    const login = await request('/api/login', { token: env.STUDY_ACCESS_TOKEN });
    if (!login.ok) { fail(stage, login.status); return result; }
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    if (!/^studychat_session=[^;\s]+$/.test(cookie)) { fail(stage); return result; }
    setCookie(cookie);
    signedIn = true;
    result.authenticated = true;
    stage = 'account_catalog';
    const catalogResponse = await request('/api/models');
    if (!catalogResponse.ok) { fail(stage, catalogResponse.status); return result; }
    const catalog = await catalogResponse.json();
    if (catalog.source !== 'account' || catalog.stale !== false || !Array.isArray(catalog.models) || !targets.every(model => catalog.models.some(item => item?.id === model))) {
      fail('fresh_candidate_access_unconfirmed');
      return result;
    }
    for (const model of targets) {
      const requestId = `ingenium-${comparison}-${model}`;
      stage = 'model_selection';
      const selected = await request('/api/model', { model }, 'PUT');
      if (!selected.ok) { fail(stage, selected.status); result.failedModel = model; break; }
      if ((await selected.json()).model !== model) { fail('model_identity'); result.failedModel = model; break; }
      stage = 'selected_model_status';
      const readback = await request('/api/status');
      if (!readback.ok) { fail(stage, readback.status); result.failedModel = model; break; }
      if (!active(await readback.json(), model)) { fail('model_identity'); result.failedModel = model; break; }
      if (model === 'gpt-6-luna') lunaSelected = true;
      stage = 'model_connection';
      const tested = await request('/api/model-test', { requestId });
      if (!tested.ok) {
        result.results.push({ requestedModel: model, requestId, failed: true, stage, status: tested.status });
        result.failed = true;
        // Only the other explicitly requested candidate may follow. The failed
        // or uncertain request ID is never retried, including on a restart.
        continue;
      }
      const testedResult = await tested.json();
      if (testedResult.requestedModel !== model || testedResult.returnedModel !== model) { fail('model_identity'); result.failedModel = model; break; }
      const inputTokens = count(testedResult.usage?.prompt_tokens, 10000000);
      const outputTokens = count(testedResult.usage?.completion_tokens, 10000000);
      const cost = testedResult.estimatedCostUsd;
      result.results.push({
        requestId, requestedModel: model, returnedModel: model,
        connectionPassed: testedResult.connectionPassed === true,
        instructionPassed: testedResult.instructionPassed === true,
        cached: testedResult.cached === true,
        latencyMs: count(testedResult.latencyMs, 3600000), inputTokens, outputTokens,
        estimatedCostUsd: inputTokens !== null && outputTokens !== null && Number.isFinite(cost) && cost >= 0 && cost <= 1000 ? cost : null
      });
    }
    stage = 'active_model_status';
    const finalStatus = await request('/api/status');
    if (finalStatus.ok) {
      const status = await finalStatus.json();
      result.activeModel = targets.find(model => active(status, model)) || null;
      result.lunaActive = lunaSelected && result.activeModel === 'gpt-6-luna';
    } else fail(stage, finalStatus.status);
    return result;
  } catch { fail(stage); return result; }
  finally {
    if (signedIn) {
      try {
        await flushTelemetry();
        const delivery = await request('/api/ingenium-status');
        if (delivery.ok) {
          const telemetry = await delivery.json();
          result.delivered = count(telemetry.delivered, 1000000000);
          result.pending = count(telemetry.pending, 500);
        } else result.deliveryStatus = delivery.status;
      } catch { result.deliveryUnconfirmed = true; }
      try { const logout = await request('/api/logout', {}); if (!logout.ok) result.logoutUnconfirmed = true; }
      catch { result.logoutUnconfirmed = true; }
    }
  }
}
