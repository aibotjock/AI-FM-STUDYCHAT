import { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { HttpError } from '../index.js';

const derive = promisify(scrypt);
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const COOKIE = 'family_medicine_session';
const SESSION_MS = 7 * 86400000;
const credentials = (email, password) => {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) throw new HttpError(400, 'Enter a valid email address.');
  if (typeof password !== 'string' || password.length < 12 || password.length > 128 || password.includes('\0')) throw new HttpError(400, 'Use a password with 12 to 128 characters.');
  return { email: email.trim().toLowerCase(), password };
};
const passwordKey = (password, salt) => derive(password, salt, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });

/** Private-pilot account authentication. Email verification and recovery remain launch gates. */
export function createAccounts({ db, now = Date.now, maxAccounts = 1000 }) {
  db.exec(`CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT NOT NULL, salt TEXT NOT NULL, created_at INTEGER NOT NULL, deleted_at INTEGER);
    CREATE TABLE IF NOT EXISTS account_sessions (hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES accounts(id), expires_at INTEGER NOT NULL);`);
  const publicAccount = row => ({ id: row.id, email: row.email, obfuscatedAccountId: sha256(row.id) });
  const fromCookie = req => /(?:^|;\s*)family_medicine_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
  let pending = 0;
  async function boundedPassword(password, salt) {
    if (pending >= 16) throw new HttpError(503, 'Sign-in is busy. Please try again shortly.');
    pending++;
    try { return await passwordKey(password, salt); } finally { pending--; }
  }
  function issue(row) {
    if (!row || row.deleted_at !== null) throw new HttpError(401, 'Account is unavailable.');
    const token = randomBytes(32).toString('hex');
    db.prepare('DELETE FROM account_sessions WHERE expires_at <= ?').run(now());
    const active = db.prepare('SELECT COUNT(*) AS count FROM account_sessions WHERE user_id=?').get(row.id).count;
    if (active >= 10) db.prepare('DELETE FROM account_sessions WHERE hash IN (SELECT hash FROM account_sessions WHERE user_id=? ORDER BY expires_at ASC,rowid ASC LIMIT ?)').run(row.id, active - 9);
    db.prepare('INSERT INTO account_sessions(hash,user_id,expires_at) VALUES(?,?,?)').run(sha256(token), row.id, now() + SESSION_MS);
    return { account: publicAccount(row), token };
  }
  return {
    async register(email, password) {
      const input = credentials(email, password);
      if (db.prepare('SELECT COUNT(*) AS count FROM accounts WHERE deleted_at IS NULL').get().count >= maxAccounts) throw new HttpError(503, 'Pilot registration is currently full.');
      if (db.prepare('SELECT id FROM accounts WHERE email=?').get(input.email)) throw new HttpError(409, 'An account already exists. Sign in instead.');
      const salt = randomBytes(32).toString('hex');
      const key = await boundedPassword(input.password, salt);
      const row = { id: randomUUID(), email: input.email, password_hash: key.toString('hex'), salt, created_at: now(), deleted_at: null };
      try { db.prepare('INSERT INTO accounts(id,email,password_hash,salt,created_at) VALUES(?,?,?,?,?)').run(row.id, row.email, row.password_hash, row.salt, row.created_at); }
      catch (error) { if (String(error.message).includes('UNIQUE')) throw new HttpError(409, 'An account already exists. Sign in instead.'); throw error; }
      return issue(row);
    },
    async login(email, password) {
      const input = credentials(email, password);
      const row = db.prepare('SELECT * FROM accounts WHERE email=? AND deleted_at IS NULL').get(input.email);
      const key = await boundedPassword(input.password, row?.salt || '0'.repeat(64));
      const expected = Buffer.from(row?.password_hash || '0'.repeat(128), 'hex');
      if (!timingSafeEqual(key, expected) || !row) throw new HttpError(401, 'Email or password is incorrect.');
      return issue(db.prepare('SELECT * FROM accounts WHERE id=?').get(row.id));
    },
    authenticate(req) {
      const token = fromCookie(req);
      if (!token) return null;
      const row = db.prepare('SELECT a.* FROM accounts a JOIN account_sessions s ON s.user_id=a.id WHERE s.hash=? AND s.expires_at>? AND a.deleted_at IS NULL').get(sha256(token), now());
      return row ? publicAccount(row) : null;
    },
    logout(req) { const token = fromCookie(req); if (token) db.prepare('DELETE FROM account_sessions WHERE hash=?').run(sha256(token)); },
    isActive(userId) { return Boolean(db.prepare('SELECT id FROM accounts WHERE id=? AND deleted_at IS NULL').get(userId)); },
    delete(userId) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('UPDATE accounts SET email=?,password_hash=?,salt=?,deleted_at=? WHERE id=? AND deleted_at IS NULL').run(`deleted-${userId}@invalid.local`, '', '', now(), userId);
        db.prepare('DELETE FROM account_sessions WHERE user_id=?').run(userId);
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    cookie(token, secure) { return `${COOKIE}=${token || ''}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${token ? SESSION_MS / 1000 : 0}${secure ? '; Secure' : ''}`; }
  };
}
