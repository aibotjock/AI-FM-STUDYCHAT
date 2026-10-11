import { createConversationAgent } from '/packages/conversation-agent/src/conversation-core.js';

export const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name.startsWith('on') && typeof value === 'function') node.addEventListener(name.slice(2).toLowerCase(), value);
    else if (name === 'class') node.className = value;
    else if (name === 'text') node.textContent = value;
    else if (name === 'value') node.value = value;
    else if (value === true) node.setAttribute(name, '');
    else if (value !== false && value != null) node.setAttribute(name, value);
  }
  node.append(...children.flat().filter(child => child != null).map(child => typeof child === 'string' ? document.createTextNode(child) : child));
  return node;
};
export async function api(path, options = {}) {
  const controller = new AbortController(), timeout = setTimeout(() => controller.abort(), Math.min(60000, Math.max(1000, Number(options.timeoutMs) || 25000)));
  try {
    const response = await fetch(path, { credentials: 'same-origin', ...options,
      signal: options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      body: options.body && typeof options.body !== 'string' ? JSON.stringify(options.body) : options.body });
    let value;
    try { value = await response.json(); } catch { throw new Error('The server returned an unreadable response.'); }
    if (!response.ok) { if (response.status === 401) logoutLocal(); throw new Error(value.error?.message || value.error || value.message || `Request failed (${response.status}).`); }
    return value;
  } catch (error) { if (controller.signal.aborted) throw new Error('The connection timed out. Check saved state before repeating an action.'); throw error; }
  finally { clearTimeout(timeout); }
}
export const actionId = () => crypto.randomUUID();
export const notice = (text, type = '') => el('div', { class: `notice ${type}`, role: type === 'error' ? 'alert' : 'status', text });
export const field = (label, input) => { const id = input.id || actionId(); input.id = id; return el('div', { class: 'field' }, el('label', { for: id, text: label }), input); };
export const pageIntro = (label, title, description, action) => el('div', { class: 'page-intro' }, el('div', {}, el('div', { class: 'eyebrow', text: label }), el('h1', { text: title }), el('p', { text: description })), action);

const root = document.querySelector('#app');
const tabs = [['coach', 'Coach', '◌'], ['practice', 'Practice', '▤'], ['review', 'Review', '↻'], ['library', 'Library', '▥'], ['progress', 'Progress', '▥'], ['settings', 'Settings', '⚙']];
let session = {}, currentTab = 'coach', page, globalNotice, agent, currentConversation = null, conversations = [], log, input, chatStatus, stopButton, nextTurnId = null, active = null, conversationReadOnly = false;
let studyModule = null, voiceModule = null, voiceOpening = false, navigationVersion = 0;
let selectedModel = null, modelCataloguePromise = null, modelController = null, modelSaveQueue = Promise.resolve();
let deviceVoiceModulePromise = null, installPrompt = null;
const installPanels = new Set();
const installedApp = () => window.matchMedia?.('(display-mode: standalone)').matches || navigator.standalone === true;
window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); installPrompt = event; for (const panel of installPanels) panel.refresh(); });
window.addEventListener('appinstalled', () => { installPrompt = null; for (const panel of installPanels) panel.refresh(); });
export function loadDeviceVoice() { deviceVoiceModulePromise ||= import('/device-voice.js').catch(error => { deviceVoiceModulePromise = null; throw error; }); return deviceVoiceModulePromise; }
const megabytes = bytes => `${(Math.max(0, Number(bytes) || 0) / 1000000).toLocaleString(undefined, { maximumFractionDigits: 1 })} MB`;
export function createDeviceInstallPanel({ compact = false, autoInstall = false } = {}) {
  let status = null, controller = null, loading = false, refreshGeneration = 0;
  const message = el('p', { class: 'bottom-note', role: 'status', 'aria-live': 'polite', text: 'Checking voice files on this device…' });
  const progress = el('progress', { max: '1', value: '0', hidden: true, 'aria-label': 'Voice download progress' });
  const download = el('button', { type: 'button', class: compact ? 'subtle' : 'primary', text: 'Download app + voices', disabled: true, onclick: () => { void downloadPack(); } });
  const cancel = el('button', { type: 'button', class: 'subtle', text: 'Cancel download', hidden: true, onclick: () => controller?.abort() });
  const nativeInstall = el('button', { type: 'button', class: 'subtle', text: 'Install app', hidden: true, onclick: async () => {
    const event = installPrompt; if (!event) return;
    nativeInstall.disabled = true;
    try { await event.prompt(); const result = await event.userChoice; installPrompt = null; message.textContent = result.outcome === 'accepted' ? 'App installation requested. Voice files are ready on this device.' : 'Voice files are ready. You can install the app later from your browser menu.'; }
    catch { message.textContent = 'Voice files are ready. Use your browser menu to install the app or add it to your Home Screen.'; }
    finally { nativeInstall.disabled = false; nativeInstall.hidden = true; }
  } });
  const panel = el('div', { class: compact ? 'device-install compact' : 'device-install', 'data-device-install': '' }, compact ? null : el('h3', { text: 'App download with voices' }), message, progress, el('div', { class: 'row' }, download, cancel, nativeInstall));
  const refreshButtons = () => {
    download.disabled = loading || !status?.supported;
    download.hidden = Boolean(status?.installed && !status?.updateAvailable);
    download.textContent = status?.updateAvailable ? 'Update app voices' : 'Download app + voices';
    cancel.hidden = !loading;
    nativeInstall.hidden = loading || !status?.installed || installedApp() || !installPrompt;
  };
  const installedMessage = () => status?.updateAvailable ? `Voices are installed on this device. Updated voice files are available (${megabytes(status.totalBytes)}).` : installedApp() ? 'Voices are installed on this device. They run locally when you start voice chat.' : installPrompt ? 'Voice files are ready on this device. Choose Install app to finish.' : 'Voice files are ready. Use your browser menu to install the app. On iPhone or iPad, open Safari, tap Share, then Add to Home Screen.';
  async function refresh() {
    if (loading) return;
    const epoch = ++refreshGeneration;
    try { const module = await loadDeviceVoice(), next = await module.getDeviceVoiceStatus(); if (!panel.isConnected || loading || epoch !== refreshGeneration) return; status = next; message.textContent = status.reason ? `${status.reason} Typed chat remains available.` : !status.supported ? 'On-device voice is unavailable in this browser. Typed chat remains available.' : status.installed ? installedMessage() : `Download ${megabytes(status.totalBytes)} of voice files with the app. Your microphone stays off; typed chat remains available.`; refreshButtons(); }
    catch (error) { if (panel.isConnected && !loading && epoch === refreshGeneration) { message.textContent = `Voice files could not be checked. ${error.message} Typed chat remains available.`; download.disabled = false; } }
  }
  async function downloadPack() {
    if (loading) return;
    refreshGeneration++;
    controller = new AbortController(); loading = true; refreshButtons(); progress.hidden = false; message.textContent = 'Downloading voices to this device. Your microphone is off.';
    try {
      const module = await loadDeviceVoice();
      status = await module.installDeviceVoice({ signal: controller.signal, onProgress: value => {
        if (!panel.isConnected || controller.signal.aborted) return;
        const total = Number(value.totalBytes) || status?.totalBytes || 1, downloaded = Number(value.downloadedBytes) || 0;
        progress.max = total; progress.value = Math.min(total, downloaded);
        message.textContent = `${value.stage === 'verifying' ? 'Checking' : 'Downloading'} voice files: ${megabytes(downloaded)} of ${megabytes(total)}. Your microphone is off.`;
      } });
      if (controller.signal.aborted) return;
      message.textContent = installedMessage();
      panel.dispatchEvent(new CustomEvent('devicevoiceinstalled', { bubbles: true }));
      for (const entry of installPanels) entry.refresh();
    } catch (error) { if (panel.isConnected) message.textContent = controller.signal.aborted ? `Voice download cancelled. Choose ${status?.updateAvailable ? 'Update app voices' : 'Download app + voices'} to try again. ${status?.installed ? 'Installed voices remain available.' : 'Typed chat is ready.'}` : `Voice download did not finish. ${error.message} Typed chat remains available.`; }
    finally { controller = null; loading = false; progress.hidden = true; refreshButtons(); }
  }
  function onHidden() { if (document.hidden) controller?.abort(); }
  document.addEventListener('visibilitychange', onHidden);
  const entry = { refresh, destroy() { refreshGeneration++; controller?.abort(); installPanels.delete(entry); document.removeEventListener('visibilitychange', onHidden); } };
  installPanels.add(entry);
  panel.dispose = () => entry.destroy();
  queueMicrotask(async () => { await refresh(); if (autoInstall && panel.isConnected && installedApp() && status?.supported && !status.installed) void downloadPack(); });
  return panel;
}
function disposeInstallPanels(container) { for (const panel of container?.querySelectorAll?.('[data-device-install]') || []) panel.dispose?.(); }
const requests = new Map();
const brand = () => el('div', { class: 'brand' }, el('span', { class: 'brand-mark', 'aria-hidden': 'true', text: '+' }), el('div', {}, 'StudyChat', el('small', { text: 'FAMILY MEDICINE' })));
function voiceIcon() {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  for (const [name, value] of Object.entries({ viewBox: '0 0 24 24', width: '24', height: '24', 'aria-hidden': 'true', focusable: 'false' })) svg.setAttribute(name, value);
  [8, 16, 22, 14, 6].forEach((height, index) => {
    const bar = document.createElementNS(svg.namespaceURI, 'rect');
    for (const [name, value] of Object.entries({ x: 2 + index * 4, y: (24 - height) / 2, width: 2.5, height, rx: 1.25, fill: 'currentColor' })) bar.setAttribute(name, String(value));
    svg.append(bar);
  });
  return svg;
}
const navigation = className => el('nav', { class: className, 'aria-label': 'Main navigation' }, tabs.map(([id, label, symbol]) => el('button', { type: 'button', 'data-tab': id, 'aria-current': currentTab === id ? 'page' : null, onclick: () => navigate(id) }, el('span', { class: 'nav-icon', 'aria-hidden': 'true', text: symbol }), label)));
function showStatus(text, busy = false) { if (chatStatus) { chatStatus.textContent = text; chatStatus.classList.toggle('loading', busy); } if (stopButton) stopButton.classList.toggle('hidden', !busy); }
function logoutLocal() { agent?.destroy(); agent = null; voiceModule?.cleanup?.(); disposeInstallPanels(root); modelController?.abort(); modelController = null; modelCataloguePromise = null; selectedModel = null; modelSaveQueue = Promise.resolve(); session = { authenticated: false }; currentConversation = null; nextTurnId = null; active = null; showLogin(); }
export function showGlobalError(error) { if (globalNotice) globalNotice.replaceChildren(notice(error?.message || String(error), 'error')); }
export function clearGlobalError() { globalNotice?.replaceChildren(); }
async function boot() {
  root.replaceChildren(el('div', { class: 'login' }, brand(), el('div', { class: 'loading', role: 'status', text: 'Opening your study workspace…' })));
  try { session = await api('/api/session'); session.authenticated ? await showWorkspace() : showLogin(); }
  catch (error) { showLogin(error.message); }
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
}
function showLogin(error = '') {
  disposeInstallPanels(root);
  const token = el('input', { type: 'password', name: 'token', autocomplete: 'current-password', required: true, placeholder: 'Your private study token', maxlength: '500' });
  const feedback = el('div', { role: 'status' }, error ? notice(error, 'error') : null);
  const button = el('button', { class: 'primary full-width', type: 'submit', text: 'Open workspace' });
  const form = el('form', { onsubmit: async event => { event.preventDefault(); if (button.disabled) return; button.disabled = true; feedback.replaceChildren(); try { await api('/api/login', { method: 'POST', body: { token: token.value } }); token.value = ''; session = await api('/api/session'); await showWorkspace(); } catch (err) { feedback.replaceChildren(notice(err.message, 'error')); button.disabled = false; } } }, field('Study access token', token), button, feedback);
  root.replaceChildren(el('main', { class: 'login', id: 'main' }, brand(), el('div', { class: 'eyebrow', text: 'Your private study space' }), el('h1', { class: 'preserve-lines', text: 'Small steps.\nStronger reasoning.' }), el('p', { class: 'muted', text: 'A focused workspace for family medicine. Converse, practice, and return to what matters.' }), el('div', { class: 'panel' }, form), el('p', { class: 'bottom-note', text: 'Study support only. Your access token is separate from your AI API key.' })));
}
async function showWorkspace() {
  disposeInstallPanels(root);
  modelController?.abort(); modelController = new AbortController(); modelCataloguePromise = null;
  selectedModel = session.selected || { provider: 'openai', model: session.model };
  globalNotice = el('div'); page = el('main', { id: 'main', class: 'page', tabindex: '-1' });
  const status = el('span', { class: `tag ${session.aiAvailable ? 'good' : 'alert'}`, text: session.aiAvailable ? 'AI connected' : 'AI unavailable' });
  root.replaceChildren(el('div', { class: 'layout' }, el('aside', { class: 'sidebar' }, brand(), navigation('nav'), el('div', { class: 'sidebar-foot' }, el('div', { class: 'owner-tag' }, el('span', { class: 'status-dot' }), 'Private workspace'), el('div', { class: 'muted', text: 'Clinical reasoning, one useful step at a time.' }), el('button', { class: 'subtle', onclick: logout, text: 'Sign out' }))), el('div', { class: 'workspace' }, el('header', { class: 'topbar' }, el('div', { class: 'mobile-brand' }, brand()), el('div', {}, el('div', { class: 'topbar-title', text: 'A little practice, every day' }), el('div', { class: 'date-label', text: new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()) })), status), createDeviceInstallPanel({ compact: true, autoInstall: true }), globalNotice, page), navigation('tabbar')));
  studyModule ||= await import('/study.js');
  await loadConversations({ selectLatest: true }); await navigate('coach');
}
async function logout() { agent?.stop('Signed out. Your microphone is off.'); voiceModule?.cleanup?.(); try { await api('/api/logout', { method: 'POST', body: {} }); } catch {} logoutLocal(); }
async function loadConversations({ selectLatest = false } = {}) { try { const result = await api('/api/conversations'); conversations = result.conversations || []; if (selectLatest && !currentConversation && conversations.length) currentConversation = conversations[0].id;
  const picker = document.querySelector('#conversation-picker'); if (picker) { picker.replaceChildren(el('option', { value: '', text: 'New conversation' }), conversations.map(conversation => el('option', { value: conversation.id, text: conversation.title || 'Study conversation' }))); picker.value = currentConversation || ''; }
} catch (error) { showGlobalError(error); } }
export async function navigate(id) {
  navigationVersion++;
  studyModule?.cleanup?.();
  voiceModule?.cleanup?.();
  disposeInstallPanels(page);
  currentTab = id; clearGlobalError();
  document.querySelectorAll('[data-tab]').forEach(button => button.setAttribute('aria-current', button.dataset.tab === id ? 'page' : 'false'));
  if (id !== 'coach') agent?.stop('Conversation paused.');
  const nextPage = el('main', { id: 'main', class: 'page', tabindex: '-1' }); page.replaceWith(nextPage); page = nextPage;
  if (id === 'coach') return renderCoach();
  page.replaceChildren(pageIntro('Focused study', tabs.find(item => item[0] === id)[1], 'Your study tools are being connected.'), el('div', { class: 'panel empty' }, el('p', { text: 'Typed Coach is ready. The study tools will appear here when their integration is complete.' })));
  if (studyModule) { try { await studyModule.render(id, page); } catch (error) { showGlobalError(error); } }
}
function bubble(role, text, status = '') {
  const body = el('div', { class: 'message-body', text });
  const state = el('div', { class: 'message-state', text: status });
  const sources = el('div', { class: 'message-sources' });
  const node = el('article', { class: `message ${role}`, 'aria-label': role === 'user' ? 'Your message' : 'Coach response' }, el('div', { class: 'message-label', text: role === 'user' ? 'You' : 'Coach' }), body, sources, state);
  return { node, body, state, sources };
}
function scrollLog() { if (log && log.scrollHeight - log.scrollTop - log.clientHeight < 200) log.scrollTop = log.scrollHeight; }
function sourceLabels(target, list = []) {
  target.replaceChildren();
  for (const source of list) { if (!source.url || !/^https:\/\//i.test(source.url)) continue; target.append(el('a', { href: source.url, target: '_blank', rel: 'noopener noreferrer', text: `${source.label || (source.consulted ? 'Consulted source' : 'Reference link')}: ${source.title || source.id || 'Source'}` })); }
}
function renderCitations(body, text, sources) {
  const citations = sources.filter(source => source.label === 'Live search citation' && /^https:\/\//i.test(source.url) && Number.isInteger(source.startIndex) && Number.isInteger(source.endIndex) && source.startIndex >= 0 && source.endIndex >= source.startIndex && source.endIndex <= text.length).sort((a,b) => a.startIndex - b.startIndex);
  if (!citations.length) return;
  body.replaceChildren(); let cursor = 0;
  citations.forEach((source,index) => {
    if (source.startIndex < cursor) return;
    body.append(document.createTextNode(text.slice(cursor,source.startIndex)), el('a',{ href: source.url, target: '_blank', rel: 'noopener noreferrer', text: source.endIndex > source.startIndex && !text.slice(source.startIndex,source.endIndex).includes('') ? text.slice(source.startIndex,source.endIndex) : `[${index + 1}]`, 'aria-label': source.title || 'Search citation' }));
    cursor = source.endIndex;
  });
  body.append(document.createTextNode(text.slice(cursor)));
}
function finishBubble(item, value) {
  if (value.content && item.bubble.body.textContent !== value.content) item.bubble.body.textContent = value.content;
  const status = value.status || 'completed'; item.status = status;
  item.bubble.state.classList.toggle('error', status !== 'completed');
  const modelLabel = value.model && value.provider ? ` · ${value.provider === 'openai' ? 'OpenAI' : value.provider === 'anthropic' ? 'Anthropic' : value.provider} ${value.model}` : '';
  item.bubble.state.textContent = status === 'completed' ? `Saved${modelLabel}` : `${status[0].toUpperCase() + status.slice(1)}${value.error || value.message ? ` · ${value.error?.message || value.error || value.message}` : ''}${item.bubble.body.textContent ? ' · Partial response' : ''}`;
  if (status === 'completed' && value.label) item.bubble.state.append(` · ${value.label}`);
  renderCitations(item.bubble.body,value.content || item.bubble.body.textContent,value.sources || []);
  sourceLabels(item.bubble.sources, value.sources || value.references || []);
  if (['pending', 'running'].includes(status)) {
    item.bubble.state.textContent = 'This saved request is still running. Reload history to recover its outcome, or stop it.';
    item.bubble.state.append(' ', el('button', { type: 'button', class: 'button-link', text: 'Reload history', onclick: () => history().catch(showGlobalError) }), ' ', el('button', { type: 'button', class: 'button-link', text: 'Stop request', onclick: async () => { try { await api('/api/chat/cancel', { method: 'POST', body: { conversationId: currentConversation, attemptId: item.attemptId } }); await history(); } catch (error) { showGlobalError(error); } } }));
  } else if (status !== 'completed') item.bubble.state.append(' ', el('button', { type: 'button', class: 'button-link', text: 'Retry this turn', onclick: () => retryTurn(item) }));
  if (active === item) { active = null; showStatus(status === 'completed' ? 'Ready for your next question.' : 'No automatic retry was made.'); }
  scrollLog();
}
async function history() {
  if (!currentConversation) return;
  const conversationForPage = currentConversation, logForPage = log;
  const result = await api(`/api/conversations/${encodeURIComponent(conversationForPage)}`);
  if (currentTab !== 'coach' || currentConversation !== conversationForPage || log !== logForPage) return;
  conversationReadOnly = Boolean(result.readOnly || result.conversation?.readOnly);
  if (input) { input.readOnly = conversationReadOnly; input.placeholder = conversationReadOnly ? 'Imported history is read only. Start a new chat to continue.' : 'Ask Coach, or just start a conversation…'; }
  log.replaceChildren();
  for (const record of result.legacyMessages || []) { const message = bubble(record.role === 'user' ? 'user' : 'assistant', record.content || record.text || '', 'Imported history · sources unverified'); log.append(message.node); }
  for (const turn of result.turns || []) log.append(savedTurn(turn));
  if (result.page?.hasOlder) {
    const loaded = new Set((result.turns || []).map(turn => turn.turnId)), conversationId = currentConversation; let beforeSeq = result.page.beforeSeq;
    const older = el('button', { type: 'button', class: 'subtle full-width', text: 'Load older messages', onclick: async () => {
      if (older.disabled) return; older.disabled = true;
      try {
        const previous = await api(`/api/conversations/${encodeURIComponent(conversationId)}?beforeSeq=${encodeURIComponent(beforeSeq)}`);
        if (conversationId !== currentConversation || currentTab !== 'coach' || log !== logForPage) return;
        const fragment = document.createDocumentFragment();
        for (const turn of previous.turns || []) if (!loaded.has(turn.turnId)) { fragment.append(savedTurn(turn)); loaded.add(turn.turnId); }
        const oldHeight = log.scrollHeight, oldTop = log.scrollTop; older.after(fragment); log.scrollTop = oldTop + log.scrollHeight - oldHeight;
        beforeSeq = previous.page?.beforeSeq; if (!previous.page?.hasOlder) older.remove();
      } catch (error) { showGlobalError(error); } finally { older.disabled = false; }
    } }); log.prepend(older);
  }
  if (result.legacyRecords?.length) {
    const archive = el('details', { class: 'list-item' }, el('summary', { text: `${result.legacyRecords.length} archived imported messages` }));
    for (const record of result.legacyRecords) { const message = bubble(record.role === 'user' ? 'user' : 'assistant', record.content || record.text || '', 'Imported archive · original record retained'); archive.append(message.node); }
    log.append(archive);
  }
  if (!log.children.length) welcome();
  if (conversationReadOnly) showStatus('Read-only imported history. Start a new conversation to use Coach.');
  log.scrollTop = log.scrollHeight;
}
function savedTurn(turn) {
  const user = bubble('user', turn.input || turn.userContent || ''), answer = bubble('assistant', turn.content || ''), fragment = document.createDocumentFragment();
  user.node.dataset.turnId = turn.turnId || turn.id; answer.node.dataset.turnId = turn.turnId || turn.id;
  finishBubble({ bubble: answer, turnId: turn.turnId || turn.id, input: turn.input || turn.userContent, attemptId: turn.attemptId }, turn);
  fragment.append(user.node, answer.node); return fragment;
}
const selectionKey = selection => JSON.stringify([selection.provider, selection.model || selection.id]);
export function getModelCatalogue({ refresh = false } = {}) {
  if (refresh) modelCataloguePromise = null;
  modelCataloguePromise ||= api('/api/models', { signal: modelController?.signal });
  return modelCataloguePromise;
}
export function modelSelector(location = 'coach') {
  const selectedAtMount = selectedModel || session.selected || { provider: 'openai', model: session.model };
  const picker = el('select', { id: `chat-model-${location}`, 'aria-label': 'Chat model' }, el('option', { value: selectionKey(selectedAtMount), text: selectedAtMount.model || 'Configured default model' }));
  picker.value = selectionKey(selectedAtMount);
  const detail = el('small', { class: 'model-limit', role: 'status', text: 'Loading available models. Your saved model remains selected.' });
  const widget = el('div', { class: `model-controls ${location === 'settings' ? 'model-settings' : ''}` }, el('div', { class: 'model-picker-row' }, el('label', { for: picker.id, text: 'Chat model' }), picker), detail);
  let catalogue = null;
  function updateDetail() {
    const choice = catalogue?.models?.find(model => selectionKey(model) === selectionKey(selectedModel || selectedAtMount));
    detail.classList.toggle('limited', choice?.tier === 'limited');
    const provider = catalogue?.providers?.find(value => value.id === (selectedModel || selectedAtMount).provider);
    if (choice && !choice.available) { detail.textContent = `${provider?.label || choice.provider} is unavailable. Configure its server key or choose an available model.`; return; }
    const caps = [];
    if (choice?.limits?.maxPromptBytes) caps.push(`${Math.round(choice.limits.maxPromptBytes / 1024)} KiB prompt`);
    if (choice?.limits?.maxOutputTokens) caps.push(`${choice.limits.maxOutputTokens.toLocaleString()} output tokens`);
    const budgetLabel = choice?.tier === 'limited' ? choice.priceKnown === false ? 'Price unconfirmed · limited budget' : 'Higher-cost model · limited budget' : 'Standard model budget';
    detail.textContent = `${budgetLabel}${caps.length ? `: ${caps.join(' · ')}` : ''}. ${choice?.webSearchSupported ? 'Live guideline search available · up to 2 search calls per reply; provider search fees apply.' : 'Live search unavailable for this model.'} Changes apply to the next attempt; the current reply keeps its model.${choice?.availability === 'unconfirmed' ? ' Account access unconfirmed; the live model list could not be loaded.' : ''}`;
  }
  async function load(refresh = false) {
    try {
      catalogue = await getModelCatalogue({ refresh });
      if (!widget.isConnected || !session.authenticated) return;
      // The session endpoint supplies the effective saved selection; directory loading cannot replace a newer user choice.
      selectedModel ||= catalogue.selected || catalogue.defaultSelection || selectedAtMount;
      const groups = (catalogue.providers || []).map(provider => {
        const group = el('optgroup', { label: `${provider.label}${provider.configured ? '' : ' · key unavailable'}` });
        for (const model of (catalogue.models || []).filter(value => value.provider === provider.id)) group.append(el('option', { value: selectionKey(model), disabled: !model.available, text: `${model.label || model.id}${model.tier === 'limited' ? ' · limited' : ''}${model.available ? '' : ' · unavailable'}` }));
        return group;
      });
      if (!(catalogue.models || []).some(model => selectionKey(model) === selectionKey(selectedModel))) groups.unshift(el('option', { value: selectionKey(selectedModel), text: `${selectedModel.model} · saved selection` }));
      picker.replaceChildren(...groups); picker.value = selectionKey(selectedModel); updateDetail();
    } catch (error) {
      if (!widget.isConnected || !session.authenticated) return;
      detail.replaceChildren('Model list unavailable. Your saved model remains selected. ', el('button', { type: 'button', class: 'button-link', text: 'Try loading models again', onclick: () => load(true) }));
    }
  }
  picker.addEventListener('change', () => {
    const choice = catalogue?.models?.find(model => selectionKey(model) === picker.value);
    if (!choice?.available) { picker.value = selectionKey(selectedModel || selectedAtMount); showGlobalError(new Error('Choose a model whose provider is configured and available.')); return; }
    const previous = selectedModel, selection = { provider: choice.provider, model: choice.id }, signal = modelController?.signal;
    selectedModel = selection; updateDetail();
    // Serialize preference writes only. Chat requests are independent and snapshot the visible choice immediately.
    modelSaveQueue = modelSaveQueue.catch(() => {}).then(async () => {
      if (signal?.aborted) return;
      try { const saved = await api('/api/settings', { method: 'POST', signal, body: { actionId: actionId(), aiProvider: selection.provider, aiModel: selection.model } }); session.settings = { ...session.settings, ...saved }; session.selected = selection; }
      catch (error) { if (signal?.aborted) return; if (selectionKey(selectedModel) === selectionKey(selection)) { selectedModel = session.selected || previous; picker.value = selectionKey(selectedModel); updateDetail(); } showGlobalError(new Error(`The model preference could not be saved. ${error.message}`)); }
    });
  });
  queueMicrotask(() => load()); return widget;
}
function modelSnapshot() { return { ...(selectedModel || session.selected || { provider: 'openai', model: session.model }) }; }
function welcome() {
  log.replaceChildren(el('div', { class: 'chat-welcome' }, el('div', { class: 'coach-symbol', 'aria-hidden': 'true', text: '✦' }), el('div', { class: 'eyebrow', text: 'Meet your study coach' }), el('h2', { text: 'Where would you like to begin?' }), el('p', { text: 'Think through a concept, plan a focused session, or talk through what feels difficult. A source match is never required to start a conversation.' }), el('div', { class: 'suggestions' }, ['Plan an 18-minute session', 'Help me reason through a case', 'Explain a concept simply'].map(text => el('button', { type: 'button', text, onclick: () => { input.value = text; input.focus(); } })))));
}
function setupAgent(voiceAdapters = null) {
  agent?.destroy();
  agent = createConversationAgent({
    input: voiceAdapters?.input, playback: voiceAdapters?.playback,
    createId: () => { const id = nextTurnId; nextTurnId = null; return id || actionId(); },
    host: { ...voiceAdapters?.host, startSession: voiceAdapters?.host?.startSession || (() => ({ conversationId: currentConversation })), sendTurn: sendTurn,
      cancel: value => { const item = requests.get(value.turnId); if (item && item.status === 'running') { finishBubble(item, { status: 'cancelled', message: 'You stopped this request.' }); void api('/api/chat/cancel', { method: 'POST', body: { conversationId: item.conversationId, attemptId: item.attemptId } }).catch(() => {}); } void voiceAdapters?.host?.cancel?.(value); } },
    onState: state => { if (active && state.outputState === 'generating') showStatus('Coach is responding…', true); voiceAdapters?.onState?.(state); },
  });
  return agent;
}
async function renderCoach() {
  const picker = el('select', { id: 'conversation-picker', 'aria-label': 'Saved conversation', onchange: async () => { agent?.stop('Conversation changed.'); voiceModule?.cleanup?.(); currentConversation = picker.value || null; conversationReadOnly = false; input.readOnly = false; setupAgent(); if (!currentConversation) welcome(); try { await history(); } catch (error) { showGlobalError(error); } } }, el('option', { value: '', text: 'New conversation' }), conversations.map(conversation => el('option', { value: conversation.id, text: conversation.title || 'Study conversation' })));
  picker.value = currentConversation || '';
  log = el('div', { class: 'chat-log', id: 'chat-log', 'aria-label': 'Conversation history' });
  input = el('textarea', { id: 'chat-input', rows: '2', placeholder: 'Ask Coach, or just start a conversation…', 'aria-label': 'Message Coach', maxlength: String(session.limits?.maxInputChars || 8000), onkeydown: event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); submit(); } } });
  stopButton = el('button', { type: 'button', class: 'subtle danger hidden', text: 'Stop', onclick: () => { agent?.interrupt(); voiceModule?.stopPlayback?.(); showStatus('Cancelled. Your typed input is ready.'); } });
  chatStatus = el('div', { class: 'chat-status', role: 'status', 'aria-live': 'polite', text: 'Ready for your next question.' });
  const voiceButton = el('button', { type: 'button', class: 'voice-launch', id: 'voice-start', title: 'Start voice conversation', 'aria-label': 'Start voice conversation', 'aria-haspopup': 'dialog', onclick: () => { clearGlobalError(); openVoice().catch(showGlobalError); } }, voiceIcon());
  page.replaceChildren(pageIntro('Coach · clinical reasoning', 'Make room for understanding.', 'A concise tutor for thoughtful practice and useful conversation.'), !session.aiAvailable ? notice('AI is unavailable. Your messages receive a clear service outcome; practice, cards, and review remain available.') : document.createDocumentFragment(),
    el('section', { class: 'panel chat-card', 'aria-label': 'Coach' }, el('div', { class: 'chat-toolbar' }, picker, el('div', { class: 'row' }, el('button', { type: 'button', class: 'subtle', text: '+ New chat', onclick: () => { agent?.stop('New conversation.'); voiceModule?.cleanup?.(); currentConversation = null; conversationReadOnly = false; input.readOnly = false; input.placeholder = 'Ask Coach, or just start a conversation…'; picker.value = ''; setupAgent(); welcome(); showStatus('New conversation.'); } }))), modelSelector(), log,
      el('form', { class: 'composer', onsubmit: event => { event.preventDefault(); submit(); } }, el('div', { class: 'composer-box' }, input, el('button', { class: 'primary', type: 'submit', title: 'Send message', 'aria-label': 'Send message', text: '↑' }), voiceButton), el('div', { class: 'composer-footer' }, chatStatus, stopButton), el('div', { class: 'composer-footer' }, el('small', { text: 'Enter to send · Shift + Enter for a new line' }), el('small', { text: 'Private study workspace' })))), el('p', { class: 'bottom-note', text: 'For education and reflection. Coach can be wrong; reference links are distinguished from material actually consulted.' }));
  setupAgent(); welcome();
  if (currentConversation) { try { await history(); } catch (error) { showGlobalError(error); } }
  if (voiceModule) voiceButton.classList.remove('hidden');
}
async function submit() {
  if (conversationReadOnly) { showStatus('Start a new chat to continue. Imported messages remain read only.'); return; }
  const text = input?.value.trim(); if (!text) { input?.focus(); return; }
  if (document.querySelector('.chat-welcome')) log.replaceChildren();
  currentConversation ||= actionId();
  const user = bubble('user', text); const answer = bubble('assistant', '', 'Connecting…'); log.append(user.node, answer.node); input.value = '';
  const item = { conversationId: currentConversation, turnId: actionId(), attemptId: actionId(), input: text, bubble: answer, status: 'running', selection: modelSnapshot() }; nextTurnId = item.turnId; requests.set(item.turnId, item);
  log.scrollTop = log.scrollHeight; await agent.sendText(text);
}
async function retryTurn(item) {
  if (active || !item.input || !item.turnId) return;
  const last = log.querySelector('.message.assistant:last-child');
  if (last !== item.bubble.node) { showStatus('Only the most recent unsuccessful turn can be retried. Send a new message to revisit an older question.'); return; }
  const retry = { ...item, conversationId: currentConversation, attemptId: actionId(), retry: true, status: 'running', selection: modelSnapshot() }; nextTurnId = retry.turnId; requests.set(retry.turnId, retry);
  item.bubble.state.replaceChildren('Retrying…'); await agent.sendText(item.input);
}
async function sendTurn({ text, turnId, signal }) {
  let item = requests.get(turnId);
  if (!item) {
    if (document.querySelector('.chat-welcome')) log.replaceChildren();
    currentConversation ||= actionId(); const user = bubble('user', text), answer = bubble('assistant', '', 'Connecting…'); log.append(user.node, answer.node);
    item = { conversationId: currentConversation, turnId, attemptId: actionId(), input: text, bubble: answer, status: 'running', selection: modelSnapshot() };
    log.scrollTop = log.scrollHeight;
  }
  active = item; item.status = 'running'; requests.set(turnId, item);
  const timerController = new AbortController();
  const timeout = setTimeout(() => timerController.abort(new Error('Response timed out.')), (session.limits?.chatTimeoutMs || 90000) + 5000);
  const combined = AbortSignal.any([signal, timerController.signal]);
  let terminal = null;
  try {
    const response = await fetch('/api/chat', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ conversationId: item.conversationId, turnId: item.turnId, attemptId: item.attemptId, input: text, retry: Boolean(item.retry), referenceIds: [], provider: item.selection?.provider, model: item.selection?.model }), signal: combined });
    if (!response.ok) { let value = {}; try { value = await response.json(); } catch {} throw new Error(value.error?.message || value.error || value.message || `Chat request failed (${response.status}).`); }
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new Error('The chat stream was not available.');
    const reader = response.body.getReader(), decoder = new TextDecoder(); let buffer = '', content = '';
    while (!terminal) {
      const next = await reader.read(); if (next.done) break;
      buffer += decoder.decode(next.value, { stream: true }).replace(/\r\n/g, '\n');
      if (buffer.length > 128000) throw new Error('A chat event exceeded the allowed size.');
      let boundary;
      while ((boundary = buffer.indexOf('\n\n')) >= 0 && !terminal) {
        const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
        const raw = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (!raw) continue;
        let event; try { event = JSON.parse(raw); } catch { throw new Error('The chat stream contained an unreadable event.'); }
        if (event.attemptId && event.attemptId !== item.attemptId) continue;
        const type = event.type || block.split('\n').find(line => line.startsWith('event:'))?.slice(6).trim();
        if (item.status !== 'running') continue;
        if (type === 'delta') { const delta = event.delta ?? event.text; if (typeof delta !== 'string') throw new Error('The chat stream contained an invalid text event.'); content += delta; if (content.length > 50000) throw new Error('The reply exceeded the allowed size.'); if (item.bubble.body.textContent !== content) item.bubble.body.textContent = content; showStatus('Coach is responding…', true); scrollLog(); }
        else if (type === 'search') { item.bubble.state.textContent = 'Checking current sources…'; showStatus('Checking current sources…', true); }
        else if (type === 'done' || type === 'error') { terminal = { ...event, content: event.content ?? content, status: event.status || (type === 'done' ? 'completed' : 'failed') }; }
        else if (type !== 'start') throw new Error('The chat stream contained an unknown event.');
      }
    }
    if (!terminal) throw new Error('The connection ended before Coach completed the reply.');
    if (terminal.status === 'completed' && !terminal.content?.trim()) throw new Error('Coach returned an empty reply.');
    finishBubble(item, terminal);
    if (terminal.status !== 'completed') throw new Error(terminal.error?.message || terminal.error || terminal.message || 'Your message did not complete.');
    return { content: terminal.content, conversationId: item.conversationId, messageId: terminal.messageId || item.attemptId, readoutAllowed: true };
  } catch (error) {
    if (item.status === 'running') finishBubble(item, { status: signal.aborted ? 'cancelled' : 'failed', message: timerController.signal.aborted ? 'The client timeout was reached. Retry when ready.' : error.message });
    if (timerController.signal.aborted) void api('/api/chat/cancel', { method: 'POST', body: { conversationId: item.conversationId, attemptId: item.attemptId } }).catch(() => {});
    throw error;
  } finally { clearTimeout(timeout); if (active === item) active = null; if (requests.get(turnId) === item) requests.delete(turnId); if (session.authenticated) void loadConversations(); }
}
async function openVoice() {
  if (voiceOpening) return;
  if (conversationReadOnly) throw new Error('Start a new chat to use voice. Imported history remains read only.');
  if (active) throw new Error('Stop the current reply before starting voice. Your text remains visible.');
  currentConversation ||= actionId(); const conversationId = currentConversation, version = navigationVersion;
  const isCurrent = () => currentTab === 'coach' && currentConversation === conversationId && session.authenticated && navigationVersion === version;
  voiceOpening = true;
  try { voiceModule ||= await import('/voice.js'); if (!isCurrent()) return;
    await voiceModule.open({ conversationId, api, setAgent: setupAgent, isBusy: () => Boolean(active), isCurrent, onError: showGlobalError });
  } finally { voiceOpening = false; }
}

// Study and microphone modules are enabled only after the typed-chat gate passes.
export async function enableStudy() { studyModule = await import('/study.js'); await navigate(currentTab); }
export async function enableVoice() { voiceModule = await import('/voice.js'); document.querySelector('#voice-start')?.classList.remove('hidden'); }
export const getSession = () => session;
export const getPage = () => page;
export const updateSession = value => { session = { ...session, ...value }; };
export function getVoiceChoices(options = {}) {
  const voices = Array.isArray(options.voices) ? [...new Set(options.voices.filter(id => typeof id === 'string' && id))] : [];
  return voices.map(id => {
    const choice = options.voiceChoices?.find?.(value => value?.id === id);
    const label = choice?.label || options.voiceLabels?.[id] || id;
    return { id, label: typeof label === 'string' ? label : id };
  });
}
export async function startCase(scenarioId) {
  agent?.stop('A new case is ready.'); voiceModule?.cleanup?.(); currentConversation = actionId(); conversationReadOnly = false;
  const result = await api('/api/cases', { method: 'POST', body: { actionId: actionId(), conversationId: currentConversation, scenarioId } });
  await navigate('coach');
  input.value = `Let's work through ${result.scenario?.title || 'the selected case'} with guided questions.`;
  showStatus('Case selected. Send your message when ready.'); input.focus();
}
void boot();
