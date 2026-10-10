import { randomBytes, timingSafeEqual } from 'node:crypto';
import { HttpError } from './errors.js';

export function createAuth(config) {
  const sessions = new Map();
  const attempts = new Map();
  const local = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
  const automatic = local && !config.accessToken;
  const cookieName = 'study_session';
  function session(req) {
    if (automatic) return 'local';
    const cookies = Object.fromEntries((req.headers.cookie || '').split(';').map(part => part.trim().split('=')));
    const id = cookies[cookieName];
    const expiry = sessions.get(id);
    if (!expiry || expiry < Date.now()) { sessions.delete(id); return null; }
    return id;
  }
  function requireSession(req) { const id = session(req); if (!id) throw new HttpError(401, 'Sign in to continue.', 'authentication_required'); return id; }
  function origin(req) {
    const protocol = req.socket.encrypted || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    return config.appOrigin || `${protocol}://${req.headers.host}`;
  }
  function checkOrigin(req) {
    if (req.headers.origin !== origin(req)) throw new HttpError(403, 'Request origin is not allowed.', 'origin_rejected');
    if (req.headers['sec-fetch-site'] === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.', 'origin_rejected');
  }
  function cookie(req, value, clear = false) {
    const secure = origin(req).startsWith('https:') ? '; Secure' : '';
    return `${cookieName}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${clear ? 0 : Math.floor(config.sessionMs / 1000)}${secure}`;
  }
  function login(req, token) {
    const now = Date.now();
    const address = req.socket.remoteAddress || 'unknown';
    for (const [key, entry] of attempts) if (entry.until < now) attempts.delete(key);
    const entry = attempts.get(address) || { count: 0, until: now + 15 * 60 * 1000 };
    if (entry.count >= 5) throw new HttpError(429, 'Too many sign-in attempts. Try again in 15 minutes.', 'login_throttled');
    const provided = Buffer.from(typeof token === 'string' ? token : '');
    const expected = Buffer.from(config.accessToken);
    if (!automatic && (!expected.length || provided.length !== expected.length || !timingSafeEqual(provided, expected))) {
      entry.count++; attempts.set(address, entry);
      if (attempts.size > 1000) attempts.delete(attempts.keys().next().value);
      throw new HttpError(401, 'Study access token is incorrect.', 'invalid_token');
    }
    attempts.delete(address);
    for (const [id, expiry] of sessions) if (expiry < now) sessions.delete(id);
    if (sessions.size >= 100) sessions.delete(sessions.keys().next().value);
    const id = randomBytes(32).toString('hex'); sessions.set(id, now + config.sessionMs);
    return { id, cookie: cookie(req, id) };
  }
  function logout(req) { const id = session(req); sessions.delete(id); return { id, cookie: cookie(req, '', true) }; }
  return { session, requireSession, checkOrigin, login, logout };
}
