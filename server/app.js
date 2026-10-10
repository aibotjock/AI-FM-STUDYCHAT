import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAuth } from './auth.js';
import { HttpError } from './errors.js';
import { validChatId } from './chat.js';

const ROOT = new URL('../', import.meta.url);
const browserModules = new Set(['conversation-core.js', 'browser-audio.js', 'voice-circle.js']);
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' };

export async function readBody(req, limit, json = true) {
  if (json && !(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
  if (Number(req.headers['content-length']) > limit) throw new HttpError(413, 'Request is too large.');
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks);
  if (!json) return bytes;
  try { const value = JSON.parse(bytes.toString()); if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(); return value; }
  catch { throw new HttpError(400, 'Request must contain a JSON object.'); }
}

export function createApp({ config, chat, study, references, voice, backup, models, telemetry, onLogout } = {}) {
  const auth = createAuth(config);
  const sessionWork = new Map();
  const track = (session, controller) => { if (!sessionWork.has(session)) sessionWork.set(session, new Set()); sessionWork.get(session).add(controller); return () => { const work = sessionWork.get(session); work?.delete(controller); if (!work?.size) sessionWork.delete(session); }; };
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Permissions-Policy', 'microphone=(self)');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; media-src 'self' blob:; worker-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    const json = (data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
    try {
      const url = new URL(req.url, 'http://localhost'); const path = url.pathname;
      if (path === '/health' && req.method === 'GET') return json({ status: 'ok' });
      if (path === '/api/session' && req.method === 'GET') { const authenticated = !!auth.session(req), settings = authenticated ? study?.settings() : null; return json({ authenticated, aiAvailable: !!(config.apiKey || config.anthropicApiKey), model: config.model, selected: authenticated ? { provider: settings?.aiProvider || 'openai', model: settings?.aiModel || (settings?.aiProvider === 'anthropic' ? config.anthropicModel : config.model) } : undefined, voices: config.voices, limits: { chatTimeoutMs: config.chatTimeoutMs, maxInputChars: config.maxInputChars } }); }
      if (path.startsWith('/api/')) {
        if (!['GET', 'POST', 'DELETE'].includes(req.method)) throw new HttpError(405, 'Method is not supported.');
        if (req.method !== 'GET') auth.checkOrigin(req);
        if (path === '/api/login' && req.method === 'POST') { const body = await readBody(req, 4096); const login = auth.login(req, body.token); res.setHeader('Set-Cookie', login.cookie); return json({ authenticated: true }); }
        const session = auth.requireSession(req);
        if (telemetry && path === '/api/telemetry' && req.method === 'GET') return json(telemetry.status());
        if (models && path === '/api/models' && req.method === 'GET') { const settings = study?.settings() || {}; return json({ ...await models.catalogue(), selected: { provider: settings.aiProvider || 'openai', model: settings.aiModel || ((settings.aiProvider === 'anthropic') ? config.anthropicModel : config.model) } }); }
        if (path === '/api/logout' && req.method === 'POST') {
          for (const controller of sessionWork.get(session) || []) controller.abort(); sessionWork.delete(session); voice?.invalidate({ ownerKey: session }); onLogout?.(session);
          const logout = auth.logout(req); res.setHeader('Set-Cookie', logout.cookie); return json({ authenticated: false });
        }
        if (path === '/api/conversations' && req.method === 'GET') return json({ conversations: chat.conversations() });
        const conversation = path.match(/^\/api\/conversations\/([^/]+)$/);
        let conversationId;
        if (conversation) { try { conversationId = validChatId(decodeURIComponent(conversation[1]), 'conversation ID'); } catch { throw new HttpError(400, 'Conversation ID is invalid.'); } }
        if (conversation && req.method === 'GET') return json(chat.history(conversationId, { beforeSeq: url.searchParams.has('beforeSeq') ? Number(url.searchParams.get('beforeSeq')) : undefined }));
        if (conversation && req.method === 'DELETE') { const id = conversationId; voice?.invalidate({ conversationId: id }); chat.removeConversation(id); study?.removeConversation?.(id); return json({ removed: true }); }
        if (path === '/api/chat/cancel' && req.method === 'POST') { const body = await readBody(req, config.jsonBytes); return json(chat.cancel(body)); }
        if (path === '/api/chat' && req.method === 'POST') {
          const body = await readBody(req, config.jsonBytes);
          if (references) { try { references.resolveIds(body.referenceIds || []); } catch (error) { if (error.code !== 'source_unavailable') throw error; } }
          voice?.invalidate({ conversationId: body.conversationId, speechOnly: true });
          const controller = new AbortController(); const untrack = track(session, controller);
          let ended = false;
          res.on('close', () => { if (!ended) controller.abort(); });
          res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store, no-transform', 'X-Accel-Buffering': 'no' }); res.flushHeaders();
          const emit = event => { if (!res.destroyed && !res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`); };
          try { await chat.submit(body, emit, { signal: controller.signal }); }
          catch (error) { emit({ type: 'error', attemptId: body.attemptId, turnId: body.turnId, status: 'failed', error: error.status ? error.message : 'The request could not complete. Please retry.', code: error.code || 'chat_failed' }); }
          finally { ended = true; untrack(); res.end(); }
          return;
        }
        if (study) {
          if (path === '/api/study' && req.method === 'GET') return json(study.summary());
          if (path === '/api/library' && req.method === 'GET') return json(study.library(url.searchParams.get('q') || '', Number(url.searchParams.get('page') || 1)));
          if (path === '/api/question' && req.method === 'GET') return json(study.question(url.searchParams.get('key'), url.searchParams.get('reveal') === 'true'));
          if (path === '/api/practice') { const body = req.method === 'GET' ? {} : await readBody(req, config.jsonBytes); return json(study.practice(req.method === 'GET' ? (url.searchParams.get('action') || 'view') : body.action, body)); }
          if (path === '/api/cards' && req.method === 'GET') return json(study.cards('list', { query: url.searchParams.get('q') || '' }));
          if (path === '/api/cards' && req.method === 'POST') { const body = await readBody(req, config.jsonBytes); return json(study.cards(body.action, body)); }
          if (path === '/api/review' && req.method === 'GET') return json(study.due());
          if (path === '/api/review' && req.method === 'POST') return json(study.review(await readBody(req, config.jsonBytes)));
          if (path === '/api/settings') { if (req.method === 'GET') return json(study.settings()); const body = await readBody(req, config.jsonBytes); if (models && (body.aiProvider !== undefined || body.aiModel !== undefined)) { const saved = study.settings(); const provider = body.aiProvider ?? saved.aiProvider; await models.resolveSelection({ provider, model: (body.aiModel ?? saved.aiModel) || (provider === 'anthropic' ? config.anthropicModel : config.model) }); } return json(study.settings(body)); }
          if (path === '/api/progress' && req.method === 'GET') return json(study.progress());
          if (path === '/api/cases') return json(study.cases(req.method === 'GET' ? undefined : await readBody(req, config.jsonBytes)));
          if (path === '/api/worksheets' && req.method === 'GET') return json(study.worksheets());
        }
        if (references && path === '/api/references' && req.method === 'GET') return json(references.search(url.searchParams.get('q') || '', Number(url.searchParams.get('page') || 1)));
        if (references && path === '/api/references/consult' && req.method === 'POST') { const body = await readBody(req, config.jsonBytes); references.resolveIds(body.referenceIds || []); throw new HttpError(501, 'Exact source reading is unavailable. Directory links are not consulted evidence.', 'source_reading_unavailable'); }
        if (backup && path === '/api/backup' && req.method === 'GET') { res.setHeader('Content-Disposition', 'attachment; filename="studychat-backup.json"'); return json(backup.export()); }
        if (backup && path === '/api/backup' && req.method === 'POST') { const result = backup.import(await readBody(req, config.backupBytes)); voice?.invalidate(); return json(result); }
        if (voice && path === '/api/voice' && req.method === 'GET') return json(voice.options());
        if (voice && path.startsWith('/api/voice/') && req.method === 'POST') {
          const controller = new AbortController(); const untrack = track(session, controller); let ended = false;
          res.on('close', () => { if (!ended) controller.abort(); });
          try {
            const limit = path === '/api/voice/transcribe' ? Math.ceil(config.audioBytes / 3) * 4 + 4096 : config.jsonBytes;
            const body = await readBody(req, limit);
            const input = { ...body, ownerKey: session, signal: controller.signal, authorize: () => auth.session(req) === session };
            if (path === '/api/voice/start') return json(voice.start(input));
            if (path === '/api/voice/end') return json(voice.end(input));
            if (path === '/api/voice/transcribe') return json(await voice.transcribe(input));
            if (path === '/api/voice/speech') { const result = await voice.speech(input); res.writeHead(200, { 'Content-Type': result.contentType || 'audio/mpeg', 'Cache-Control': 'no-store' }); res.end(result.audio); return; }
            if (path === '/api/voice/cancel') return json(voice.cancel(input));
          } finally { ended = true; untrack(); }
        }
        throw new HttpError(404, 'API endpoint was not found.');
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Method is not supported.');
      let file;
      const module = path.match(/^\/packages\/conversation-agent\/src\/([^/]+)$/);
      if (module && browserModules.has(module[1])) file = new URL(`packages/conversation-agent/src/${module[1]}`, ROOT);
      else if (path === '/packages/conversation-agent/voice-circle.css') file = new URL('packages/conversation-agent/voice-circle.css', ROOT);
      else if (['/', '/index.html', '/app.js', '/styles.css', '/voice.js', '/study.js', '/manifest.webmanifest', '/sw.js', '/icon.svg', '/icon-192.png', '/icon-512.png'].includes(path)) file = new URL(`public/${path === '/' ? 'index.html' : path.slice(1)}`, ROOT);
      else throw new HttpError(404, 'Page was not found.');
      let content; try { content = await readFile(file); } catch (error) { if (error.code === 'ENOENT') throw new HttpError(404, 'Page was not found.'); throw error; }
      const ext = fileURLToPath(file).match(/\.[^.]+$/)?.[0];
      res.writeHead(200, { 'Content-Type': `${MIME[ext] || 'application/octet-stream'}${['.html', '.js', '.css'].includes(ext) ? '; charset=utf-8' : ''}`, 'Cache-Control': 'no-cache' }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) { if (!res.headersSent) json({ error: error.status ? error.message : 'The request could not complete.', code: error.code || 'request_failed' }, error.status || 500); else res.end(); }
  });
  server.requestTimeout = 60000; server.headersTimeout = 15000;
  return { server, auth, close() { for (const work of sessionWork.values()) for (const controller of work) controller.abort(); return new Promise(resolve => server.close(resolve)); } };
}
