import { HttpError } from '../index.js';

const number = (env, key, fallback, minimum = 0) => {
  const value = env[key] === undefined || env[key] === '' ? fallback : Number(env[key]);
  if (!Number.isFinite(value) || value < minimum) throw new Error(`Invalid ${key}.`);
  return value;
};

/** Costs are stored as integer millionths of a dollar; reservations survive restart. */
export function createUsage({ db, env = {}, now = Date.now }) {
  const inputRate = number(env, 'AI_INPUT_USD_PER_MILLION', 0.75);
  const outputRate = number(env, 'AI_OUTPUT_USD_PER_MILLION', 4.50);
  const monthlyBudget = Math.floor(number(env, 'AI_MONTHLY_BUDGET_USD', 1) * 1e6);
  const trialBudget = Math.floor(number(env, 'AI_TRIAL_BUDGET_USD', 0.15) * 1e6);
  const globalBudget = Math.floor(number(env, 'AI_GLOBAL_MONTHLY_BUDGET_USD', 20) * 1e6);
  const monthlyTurns = Math.floor(number(env, 'AI_MONTHLY_TURN_LIMIT', 200, 1));
  const dailyTurns = Math.floor(number(env, 'AI_DAILY_TURN_LIMIT', 20, 1));
  db.exec(`CREATE TABLE IF NOT EXISTS ai_requests (user_id TEXT NOT NULL, request_id TEXT NOT NULL, fingerprint TEXT NOT NULL, period TEXT NOT NULL, global_period TEXT NOT NULL, day TEXT NOT NULL, trial INTEGER NOT NULL, cost_micros INTEGER NOT NULL, status TEXT NOT NULL, result TEXT, created_at INTEGER NOT NULL, PRIMARY KEY(user_id,request_id));`);
  const utc = () => new Date(now()).toISOString();
  const countCost = (sql, ...args) => db.prepare(sql).get(...args);
  return {
    rates: { inputUsdPerMillion: inputRate, outputUsdPerMillion: outputRate },
    reserve({ userId, requestId, fingerprint, isTrial, period, inputTokens, outputTokens }) {
      if (!Number.isInteger(inputTokens) || inputTokens < 0 || inputTokens > 8000 || !Number.isInteger(outputTokens) || outputTokens < 1 || outputTokens > 600) throw new HttpError(400, 'Shorten this study conversation before asking another question.');
      const stamp = utc(), globalPeriod = stamp.slice(0, 7), day = stamp.slice(0, 10);
      const reservation = Math.ceil(inputTokens * inputRate + outputTokens * outputRate);
      db.exec('BEGIN IMMEDIATE');
      try {
        const prior = db.prepare('SELECT * FROM ai_requests WHERE user_id=? AND request_id=?').get(userId, requestId);
        if (prior) {
          if (prior.fingerprint !== fingerprint) throw new HttpError(409, 'This request ID belongs to a different study request.');
          if (prior.status === 'complete') { db.exec('COMMIT'); return { replay: JSON.parse(prior.result) }; }
          throw new HttpError(409, 'This request was already attempted. Use a new request ID after checking its outcome.');
        }
        const used = countCost('SELECT COALESCE(SUM(cost_micros),0) AS cost, COUNT(*) AS turns FROM ai_requests WHERE user_id=? AND period=?', userId, period);
        const calendarUsed = countCost('SELECT COALESCE(SUM(cost_micros),0) AS cost, COUNT(*) AS turns FROM ai_requests WHERE user_id=? AND global_period=?', userId, globalPeriod);
        const trialUsed = countCost('SELECT COALESCE(SUM(cost_micros),0) AS cost FROM ai_requests WHERE user_id=? AND trial=1', userId);
        const dayUsed = countCost('SELECT COUNT(*) AS turns FROM ai_requests WHERE user_id=? AND day=?', userId, day);
        const globalUsed = countCost('SELECT COALESCE(SUM(cost_micros),0) AS cost FROM ai_requests WHERE global_period=?', globalPeriod);
        // A changed expiry (renewal/grace adjustment) cannot reset calendar caps.
        if (used.turns >= monthlyTurns || calendarUsed.turns >= monthlyTurns || dayUsed.turns >= dailyTurns || used.cost + reservation > monthlyBudget || calendarUsed.cost + reservation > monthlyBudget || (isTrial && trialUsed.cost + reservation > trialBudget)) throw new HttpError(429, 'Your AI coaching allowance has been reached. Card reviews and export remain available.');
        if (globalUsed.cost + reservation > globalBudget) throw new HttpError(503, 'AI coaching is temporarily at its service allowance. Card reviews remain available.');
        db.prepare('INSERT INTO ai_requests(user_id,request_id,fingerprint,period,global_period,day,trial,cost_micros,status,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(userId, requestId, fingerprint, period, globalPeriod, day, isTrial ? 1 : 0, reservation, 'reserved', now());
        db.exec('COMMIT');
        return { reservedMicros: reservation };
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    complete({ userId, requestId, usage, result }) {
      const valid = Number.isInteger(usage?.prompt_tokens) && usage.prompt_tokens >= 0 && Number.isInteger(usage?.completion_tokens) && usage.completion_tokens >= 0;
      const prior = db.prepare('SELECT cost_micros FROM ai_requests WHERE user_id=? AND request_id=?').get(userId, requestId);
      if (!prior) throw new HttpError(410, 'This account or request is unavailable.');
      const cost = valid ? Math.ceil(usage.prompt_tokens * inputRate + usage.completion_tokens * outputRate) : prior.cost_micros;
      db.prepare('UPDATE ai_requests SET cost_micros=?,status=?,result=? WHERE user_id=? AND request_id=?').run(cost, 'complete', JSON.stringify(result), userId, requestId);
    },
    failed(userId, requestId) { db.prepare("UPDATE ai_requests SET status='uncertain' WHERE user_id=? AND request_id=?").run(userId, requestId); },
    summary(userId) {
      const used = countCost('SELECT COALESCE(SUM(cost_micros),0) AS cost,COUNT(*) AS turns FROM ai_requests WHERE user_id=? AND global_period=?', userId, utc().slice(0, 7));
      return { usedUsd: used.cost / 1e6, turns: used.turns, monthlyBudgetUsd: monthlyBudget / 1e6, trialBudgetUsd: trialBudget / 1e6, monthlyTurnLimit: monthlyTurns, dailyTurnLimit: dailyTurns, budgetPeriod: 'UTC calendar month and verified subscription expiry period; both limits apply', voiceIncluded: 'Device dictation only; no paid realtime audio' };
    }
  };
}
