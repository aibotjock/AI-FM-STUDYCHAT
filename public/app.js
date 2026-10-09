import { getDueCards, previewIntervals, studyStats } from '/shared/scheduler.js';
import { SCENARIOS, COMPETENCIES } from '/shared/content.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const icons = {
  today:'<rect x="4" y="4" width="16" height="16" rx="4"/><path d="M8 10h8m-8 4h5"/>',
  coach:'<path d="M20 11.5a8 8 0 0 1-8 8H5l-3 3V11.5a9 9 0 0 1 18 0Z"/><path d="M7 10h8m-8 4h5"/>',
  review:'<rect x="6" y="5" width="14" height="16" rx="3"/><path d="M4 17V5a3 3 0 0 1 3-3h9m-6 9h6m-6 4h4"/>',
  library:'<path d="M3 5c3-1 6 0 9 2 3-2 6-3 9-2v14c-3-1-6 0-9 2-3-2-6-3-9-2V5Z"/><path d="M12 7v14"/>',
  progress:'<path d="M4 20h17M7 16V9m5 7V4m5 12v-5"/>',
  plus:'<path d="M12 5v14M5 12h14"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>',
  send:'<path d="m5 12 7-7 7 7m-7 7V5"/>',
  mic:'<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3m-4 0h8"/>',
  history:'<path d="M3 11a9 9 0 1 1 2.5 7M3 4v7h7m2-4v6l4 2"/>',
  edit:'<path d="m14 5 5 5M4 20l1-6L17 2l5 5L10 19l-6 1Z"/>',
  trash:'<path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>',
  check:'<path d="m5 12 4 4L19 6"/>',
  streak:'<path d="M12 2c0 5 5 5 5 9a3 3 0 0 1-3 3c2-4-3-4-3-7-3 3-6 6-6 9a7 7 0 0 0 14 0c0-5-3-6-7-14Z"/>',
  target:'<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
  pause:'<path d="M8 5v14m8-14v14"/>',
  play:'<path d="m8 4 12 8-12 8V4Z"/>',
  voice:'<path d="M11 4 5 9H2v6h3l6 5V4Zm5 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.coach}</svg>`;
const navItems = [['today', 'Today'], ['coach', 'Coach'], ['review', 'Review'], ['library', 'Library'], ['progress', 'Progress']];
const state = { cards: [], reviews: [], conversations: [], settings: { focus: 'clinical-reasoning', coachStyle: 'socratic', dailyMinutes: 18, newCardsPerDay: 5, competencyRatings: {} } };
let status = { authenticated: false, aiConfigured: false, authRequired: false };
let screen = ['today','coach','review','library','progress'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'coach';
let currentConversationId = null;
let libraryTab = 'cards';
let searchTerm = '';
let topicFilter = '';
let chatBusy = false;
let chatDraft = '';
let chatError = '';
let pendingChatRequest = null;
let accountFormMode = 'login';
let billingProducts = [];
let billingLoading = false;
let billingMessage = '';
let billingDialogOpen = false;
const verifyingPurchases = new Set();
let pendingDeletionPrompt = new URLSearchParams(location.search).get('account') === 'delete';
let reviewSession = null;
let answerVisible = false;
let reviewBusy = false;
let toastTimer;
let recognition;
let recording = false;
let recognitionBase = '';
let draftCards = [];
let draftsOffline = false;
let formBusy = false;
let isLoaded = false;
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

function notify(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, 4500);
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') { status.authenticated = false; renderLogin(); }
    throw new Error(payload.error || payload.message || `The request failed (${response.status}). Please try again.`);
  }
  return payload;
}
function mutate(path, method, body) { return api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }); }

async function refreshState() {
  const data = await api('/api/state');
  state.cards = Array.isArray(data.cards) ? data.cards : [];
  state.reviews = Array.isArray(data.reviews) ? data.reviews : [];
  state.conversations = Array.isArray(data.conversations) ? data.conversations.sort((a,b) => (b.messages?.at(-1)?.createdAt || b.createdAt || 0) - (a.messages?.at(-1)?.createdAt || a.createdAt || 0)) : [];
  state.settings = { ...state.settings, ...data.settings };
  if (!currentConversationId && state.conversations.length) currentConversationId = state.conversations[0].id;
  if (!state.conversations.some(item => item.id === currentConversationId)) currentConversationId = null;
  isLoaded = true;
}

function stats() { return studyStats(state.cards, state.reviews, Date.now(), { timeZone: state.settings.timeZone, newLimit: state.settings.newCardsPerDay }); }
function dueCards() { return getDueCards(state.cards, { now: Date.now(), newLimit: state.settings.newCardsPerDay, reviews: state.reviews, timeZone: state.settings.timeZone }); }
function conversation() { return state.conversations.find(item => item.id === currentConversationId); }
function dateString(value) { return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Not reviewed'; }
function safeUrl(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function sourceHtml(card) { const url = safeUrl(card.sourceUrl); return url ? `<a class="source-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(card.sourceTitle || 'Reference')} ↗</a>` : `<span>${esc(card.sourceTitle || 'Personal study note')}</span>`; }
function todayLabel() { return new Date().toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' }); }
function styleLabel() { return ({ socratic: 'Socratic · one question at a time', 'teach-quiz': 'Teach, then quiz', direct:'Clear, direct explanations' })[state.settings.coachStyle] || 'Socratic coaching'; }
function focusLabel() { return ({ 'clinical-reasoning': 'Clinical reasoning', exam:'Exam preparation', balanced:'Balanced study' })[state.settings.focus] || 'Clinical reasoning'; }

function renderNav() {
  const count = isLoaded ? dueCards().length : 0;
  const html = navItems.map(([id, label]) => `<a href="#${id}" class="nav-link ${id === screen ? 'active' : ''}" ${id === screen ? 'aria-current="page"' : ''}>${icon(id)}<span>${label}</span>${id === 'review' && count ? `<span class="count">${count}</span>` : ''}</a>`).join('');
  $('#desktop-nav').innerHTML = html;
  $('#bottom-nav').innerHTML = html;
  const badge = $('#connection-badge');
  badge.textContent = !navigator.onLine ? 'Offline' : status.privatePilot ? 'Private phone pilot' : status.aiConfigured ? 'AI configured' : 'Guided practice';
  badge.classList.toggle('live', status.aiConfigured && navigator.onLine);
  $('#network-notice').hidden = navigator.onLine;
}

function navigate(next) {
  if (!navItems.some(([id]) => id === next)) return;
  if (recording) stopDictation();
  if ($('#chat-input')) chatDraft = $('#chat-input').value;
  screen = next;
  if (location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`);
  if (screen === 'review' && !reviewSession) beginReview();
  render();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function render() {
  renderNav();
  if (status.authRequired && !status.authenticated) return renderLogin();
  if (!isLoaded) return;
  $('#main').innerHTML = ({ today: renderToday, coach: renderCoach, review: renderReview, library: renderLibrary, progress: renderProgress })[screen]();
  if (screen === 'coach') { scrollChat(); resizeComposer(); }
}

function pageHead(eyebrow, title, subtitle, action = '') {
  return `<div class="page-head"><div><span class="eyebrow">${esc(eyebrow)}</span><h1>${esc(title)}</h1><p class="subtitle">${esc(subtitle)}</p></div>${action}</div>`;
}

function metric(label, value, foot, name, suffix = '') {
  return `<div class="metric"><div class="metric-label">${esc(label)}${icon(name)}</div><span class="metric-value">${esc(value)}${suffix ? `<small>${esc(suffix)}</small>` : ''}</span><span class="metric-foot">${esc(foot)}</span></div>`;
}

function renderToday() {
  const s = stats();
  const due = dueCards().length;
  const weak = s.weakTopics.slice(0, 4);
  return `${pilotNotice()}${pageHead(todayLabel(), 'Small steps. Lasting knowledge.', 'A focused daily rhythm for clearer clinical reasoning.')}
    <section class="hero"><div><span class="eyebrow">YOUR NEXT ${esc(state.settings.dailyMinutes)} MINUTES, MADE INTENTIONAL</span><h2 class="hero-title">Turn what you know into<br>what you can recall.</h2><p>${due ? `${due} cards are ready. Start with recall, then work through one clinical question with your coach.` : 'Your reviews are complete. Strengthen your reasoning with one thoughtful conversation.'}</p><button class="button gold" data-action="${due ? 'start-review' : 'navigate'}" data-screen="coach">${due ? 'Start today’s reviews' : 'Talk with your coach'} ${icon('arrow')}</button></div><div class="hero-number">${due}<span>CARDS READY</span></div></section>
    <div class="metrics">${metric('Your daily rhythm', s.streak, s.streak ? 'Keep the habit growing' : 'Your first review starts it', 'streak', s.streak === 1 ? 'day' : 'days')}${metric('Reviewed today', s.reviewedToday, `Up to ${state.settings.newCardsPerDay} new cards each day`, 'review')}${metric('Recall success', s.recallRate === null ? '—' : `${s.recallRate}%`, s.totalReviews ? 'Self-rated Good or Easy' : 'Appears after your first review', 'target')}</div>
    <div class="today-grid"><section class="card"><div class="section-head"><h2>Your daily study plan</h2><span class="pill gold">${esc(state.settings.dailyMinutes)} min</span></div>
      <div class="daily-step"><span class="step-icon">${icon('review')}</span><div><h3>Recall before you reveal</h3><p>${due} cards ready · ${s.newRemaining} new available</p></div><button class="text-button" data-action="start-review">Review ↗</button></div>
      <div class="daily-step"><span class="step-icon">${icon('coach')}</span><div><h3>Think through a clinical problem</h3><p>Make your reasoning visible, one question at a time</p></div><button class="text-button" data-action="starter" data-prompt="Coach me through a complex family medicine patient. Ask me one question at a time, and help me synthesize the key problems.">Start ↗</button></div>
      <div class="daily-step"><span class="step-icon">${icon('library')}</span><div><h3>Keep the insight that matters</h3><p>Turn a learning point into a focused recall card</p></div><button class="text-button" data-action="new-card">Add card ↗</button></div>
    </section><section class="card"><div class="section-head"><h2>Worth another look</h2><button class="text-button" data-action="navigate" data-screen="progress">Progress ↗</button></div>
    ${weak.length ? weak.map(item => `<div class="weak-row"><div><strong>${esc(item.topic)}</strong><small>${item.reviews} self-rated reviews</small></div><button class="pill ${item.recallRate < 70 ? 'gold' : 'green'}" data-action="topic-coach" data-topic="${esc(item.topic)}">${Math.round(item.recallRate)}% recall ↗</button></div>`).join('') : `<p class="subtitle" style="font-size:12px;margin:18px 0">Your reviews will reveal the topics that need more practice. Begin with an honest recall rating.</p><div class="focus-strip"><span class="topic-pill">Clinical synthesis</span><span class="topic-pill">Differential diagnosis</span><span class="topic-pill">Next best step</span></div>`}
    </section></div><p class="footer-note">${focusLabel()} · ${styleLabel()} · Study data is saved on your app’s server. Educational use only; verify clinical details with current authoritative references.</p>`;
}

function renderCoach() {
  const current = conversation();
  const messages = current?.messages || [];
  const lastAssistant = messages.filter(item => item.role === 'assistant').at(-1);
  return `<div class="chat-page"><div class="chat-header"><div><span class="eyebrow">A SPACE TO THINK OUT LOUD</span><h1>Your study coach</h1><p class="subtitle">${esc(focusLabel())} · ${esc(state.settings.dailyMinutes)} minutes at your pace</p></div><div class="chat-title-tools"><button class="icon-button" data-action="history" aria-label="Open conversation history" title="Conversation history">${icon('history')}</button><button class="icon-button" data-action="new-chat" aria-label="Start a new conversation" title="New conversation">${icon('plus')}</button></div></div>
    ${pilotNotice(true)}${status.mode === 'commercial' && !status.entitlement?.active ? '<div class="notice info" style="margin-bottom:13px">Your study cards are ready. Enable coaching with a verified Google Play subscription.<button class="text-button" data-action="billing">View subscription ↗</button></div>' : ''}
    ${!status.aiConfigured && !status.privatePilot ? '<div class="notice info coach-setup-notice" style="margin-bottom:13px">Guided practice is ready. AI coaching is not configured yet.</div>' : ''}
    <section class="chat-window" aria-label="Coach conversation"><div class="chat-toolbar"><div class="coach-id"><span class="coach-avatar">✦</span><div><strong>${esc(current?.title || 'Study coach')}</strong><small>${status.aiConfigured ? 'Personalized coaching' : 'Guided practice · scripted coaching'}</small></div></div><span class="chat-mode">${esc(current?.mode === 'simulation' ? 'Clinical case' : current?.mode === 'practice' ? 'Active recall' : styleLabel())}</span></div>
    <div id="chat-messages" class="chat-messages" role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions">
    ${messages.length ? messages.map(renderMessage).join('') : `<div class="chat-intro"><span class="intro-symbol" aria-hidden="true">✦</span><h1>Let’s make the next<br>clinical decision clearer.</h1><p>Choose a starting point, or bring a topic, a fictional case, or a question.</p><div class="prompt-grid">${[
      ['Help me synthesize a complex patient', 'Coach me through synthesizing a complex family medicine patient. Use a fictional case and ask me one question at a time.'],
      ['Quiz me on my weak topics', 'Quiz me on the topics I need to strengthen. Ask one active recall question at a time, wait for my answer, and give specific feedback.'],
      ['Walk through a differential', 'Give me a fictional clinical presentation and coach me through a prioritized differential diagnosis, one question at a time.'],
      ['Teach, then test my understanding', 'Help me learn a family medicine topic. Ask which topic I want first, teach it clearly, and then test my understanding.'],
    ].map(([label,prompt]) => `<button class="prompt-chip" data-action="starter" data-prompt="${esc(prompt)}">${esc(label)}<span>↗</span></button>`).join('')}</div></div>`}
    ${chatBusy ? '<div class="message assistant"><div class="avatar">✦</div><div class="message-body"><div class="message-label">Coach is thinking</div><div class="typing" role="status" aria-label="Coach is thinking"><i></i><i></i><i></i></div></div></div>' : ''}
    </div><div class="chat-compose">${chatError ? `<div class="notice error" style="margin-bottom:10px">${esc(chatError)} <button class="text-button" data-action="dismiss-chat-error">Dismiss</button></div>` : ''}<form id="chat-form"><div class="compose-row"><label class="screen-reader" for="chat-input">Message your study coach</label><textarea id="chat-input" name="content" rows="1" placeholder="Ask your coach…" ${chatBusy || !canChat() ? 'disabled' : ''} maxlength="12000">${esc(chatDraft)}</textarea>${voiceDictationSupported() ? `<button type="button" class="icon-button mic-button ${recording ? 'recording' : ''}" data-action="dictate" aria-label="${recording ? 'Stop dictation' : 'Dictate a message'}" title="${recording ? 'Stop dictation' : 'Dictate a message'}" ${chatBusy || !canChat() ? 'disabled' : ''}>${icon('mic')}</button>` : ''}<button type="submit" class="icon-button send-button" aria-label="Send message" ${chatBusy || !canChat() ? 'disabled' : ''}>${icon('send')}</button></div><div class="composer-note"><span id="voice-status">${recording ? 'Listening… tap the microphone to stop.' : voiceDictationSupported() ? 'Type or tap mic. Review before sending.' : 'Type or use your phone keyboard’s microphone.'}</span><span>Enter to send · Shift + Enter for a new line</span></div></form></div></section>
    <div class="chat-under"><small>Use fictional or de-identified cases. Verify clinical advice before applying it.</small><button class="text-button" data-action="draft-cards" ${!lastAssistant || chatBusy || !canChat() ? 'disabled' : ''}>Create recall cards ↗</button></div></div>`;
}

function renderMessage(message) {
  const role = message.role === 'user' ? 'user' : 'assistant';
  return `<div class="message ${role}" data-message-id="${esc(message.id)}"><div class="avatar">${role === 'user' ? 'YOU' : '✦'}</div><div class="message-body"><div class="message-label">${role === 'user' ? 'You' : 'Study coach'}</div><div class="message-text">${esc(message.content)}</div>${role === 'assistant' ? renderAnswerEvidence(message) : ''}${role === 'assistant' ? `<div class="message-actions">${'speechSynthesis' in window ? `<button data-action="read-message" data-id="${esc(message.id)}">Read aloud</button>` : ''}<button data-action="card-from-message" data-id="${esc(message.id)}">Save as a card</button><button data-action="copy-message" data-id="${esc(message.id)}">Copy</button>${status.mode === 'commercial' ? `<button data-action="report-message" data-id="${esc(message.id)}">Report answer</button>` : ''}</div>` : ''}</div></div>`;
}

function beginReview() {
  const queue = dueCards().map(card => card.id);
  reviewSession = { queue, total: queue.length, completed: 0, good: 0 };
  answerVisible = false;
}
function renderReview() {
  if (!reviewSession) beginReview();
  const current = state.cards.find(card => card.id === reviewSession.queue[0]);
  if (!current) return `<div class="review-layout">${pageHead('DAILY ACTIVE RECALL', 'Make it stick.', 'A little effort now makes retrieval easier later.')}<section class="review-complete"><span class="completion-symbol">${reviewSession.completed ? '✦' : '✓'}</span><h1>${reviewSession.completed ? 'That’s a good day’s work.' : 'You’re up to date.'}</h1><p>${reviewSession.completed ? `You completed ${reviewSession.completed} reviews. ${reviewSession.good} answers felt clear on recall.` : 'There are no cards ready right now. Add a useful insight or keep thinking with your coach.'}</p><button class="button gold" data-action="starter" data-prompt="Coach me through a brief fictional family medicine case. Ask me one question at a time.">Practice with your coach ${icon('arrow')}</button><div><button class="text-button" style="color:#bdcbd3;margin-top:15px" data-action="reload-review">Check for more due cards</button></div></section><p class="footer-note">Again cards return after their short learning interval. Reviews reflect your own recall ratings, not a formal competency assessment.</p></div>`;
  const intervals = previewIntervals(current, Date.now());
  return `<div class="review-layout">${pageHead('DAILY ACTIVE RECALL', 'Recall. Reflect. Repeat.', 'Try your answer before turning the card over.')}<div class="review-topline"><span>${reviewSession.completed + 1} of ${reviewSession.total} cards</span><span>${esc(current.state === 'new' ? 'New learning' : 'Scheduled review')}</span></div><div class="progress-track"><div class="progress-fill" style="width:${reviewSession.total ? reviewSession.completed / reviewSession.total * 100 : 0}%"></div></div><section class="review-card"><div class="section-head"><span class="pill gold">${esc(current.topic)}</span><button class="text-button" data-action="edit-card" data-id="${esc(current.id)}">Edit card ↗</button></div><h2 class="card-question">${esc(current.front)}</h2>${answerVisible ? `<div class="answer"><span class="answer-label">Compare with your answer</span>${esc(current.back)}</div><div class="source-link">${sourceHtml(current)}${current.verified ? ' · Marked verified by you' : ' · Verify this learning point'}</div>` : `<p class="recall-prompt">Say it out loud, write it down, or form a complete answer in your mind. The effort of retrieving is the useful part.</p><button class="button full reveal-button" data-action="reveal-answer">Reveal answer ${icon('arrow')}</button>`}</section>${answerVisible ? `<div class="ratings" aria-label="Rate your recall">${[['again','Again'],['hard','Hard'],['good','Good'],['easy','Easy']].map(([rating,label]) => `<button class="rating-button ${rating}" data-action="rate-card" data-rating="${rating}" ${reviewBusy ? 'disabled' : ''}>${label}<small>${esc(intervals[rating])}</small></button>`).join('')}</div><p class="rating-help">Again: missed it · Hard: recalled with difficulty<br>Good: correct with effort · Easy: immediate, confident recall</p>` : '<p class="rating-help">On a keyboard, press Space to reveal the answer.</p>'}${current.lapses >= 8 ? '<div class="notice" style="margin-top:18px">This card has repeated lapses. Try splitting it into smaller questions or ask your coach to explain the concept.</div>' : ''}</div>`;
}

function renderLibrary() {
  return `${pageHead('BUILD YOUR KNOWLEDGE BASE', 'Your learning library.', 'Focused recall cards and cases to turn knowledge into judgment.', `<button class="button" data-action="new-card">${icon('plus')} Add card</button>`)}
    <div class="segmented" aria-label="Library section"><button data-action="library-tab" data-tab="cards" class="${libraryTab === 'cards' ? 'active' : ''}" aria-pressed="${libraryTab === 'cards'}">Recall cards</button><button data-action="library-tab" data-tab="cases" class="${libraryTab === 'cases' ? 'active' : ''}" aria-pressed="${libraryTab === 'cases'}">Clinical cases</button><button data-action="library-tab" data-tab="practice" class="${libraryTab === 'practice' ? 'active' : ''}" aria-pressed="${libraryTab === 'practice'}">Practice</button></div>
    ${libraryTab === 'cards' ? renderCards() : libraryTab === 'cases' ? renderCases() : renderPractice()}`;
}

function renderCards() {
  const topics = [...new Set(state.cards.map(card => card.topic))].sort();
  const filtered = state.cards.filter(card => (!topicFilter || card.topic === topicFilter) && `${card.front} ${card.back} ${card.topic}`.toLowerCase().includes(searchTerm.toLowerCase()));
  return `<div class="library-tools"><label class="screen-reader" for="card-search">Search recall cards</label><input id="card-search" class="search-input" placeholder="Search your cards…" value="${esc(searchTerm)}" type="search"><label class="screen-reader" for="topic-filter">Filter cards by topic</label><select id="topic-filter" class="filter-select"><option value="">All topics</option>${topics.map(topic => `<option value="${esc(topic)}" ${topic === topicFilter ? 'selected' : ''}>${esc(topic)}</option>`).join('')}</select></div><div class="library-summary"><span>${filtered.length} cards · ${state.cards.filter(card => card.suspended).length} suspended</span><button class="text-button" data-action="import-cards">Import cards ↗</button></div><div id="card-results">${renderCardResults(filtered)}</div><p class="footer-note">Starter cards are educational summaries. References help you check details; your verified flag records your own review. Edit cards as guidance changes.</p>`;
}

function renderCardResults(cards) {
  return cards.length ? `<div class="card-list">${cards.map(card => `<article class="library-card ${card.suspended ? 'suspended' : ''}"><div class="card-info"><div class="card-meta"><span class="pill">${esc(card.topic)}</span>${card.suspended ? '<span>Suspended</span>' : `<span>${card.state === 'new' ? 'New' : `Due ${dateString(card.dueAt)}`}</span>`}${card.lapses >= 8 ? '<span class="pill red">Consider rewriting</span>' : ''}</div><span class="card-front">${esc(card.front)}</span><details><summary class="text-button" style="padding-left:0;display:list-item;width:fit-content">Answer & reference</summary><p class="card-back">${esc(card.back)}</p><div class="card-meta">${sourceHtml(card)}<span>${card.verified ? 'Verified by you' : 'Verification recommended'}</span></div></details></div><div class="card-actions"><button class="icon-button" data-action="edit-card" data-id="${esc(card.id)}" aria-label="Edit card">${icon('edit')}</button><button class="icon-button" data-action="suspend-card" data-id="${esc(card.id)}" aria-label="${card.suspended ? 'Resume' : 'Suspend'} card" title="${card.suspended ? 'Resume' : 'Suspend'} card">${icon(card.suspended ? 'play' : 'pause')}</button><button class="icon-button" data-action="delete-card" data-id="${esc(card.id)}" aria-label="Delete card">${icon('trash')}</button></div></article>`).join('')}</div>` : `<div class="empty-state"><h2>${state.cards.length ? 'No cards match yet.' : 'Keep one useful insight.'}</h2><p>${state.cards.length ? 'Try a broader search or choose another topic.' : 'A good card asks one clear question and gives one focused answer.'}</p><button class="button secondary" data-action="new-card">Create a recall card</button></div>`;
}

function renderCases() {
  return `<div class="notice info" style="margin-bottom:20px">These are fictional educational cases. Your coach helps you explain your thinking; it does not assess your real clinical competence.</div><div class="scenario-grid">${SCENARIOS.map(scenario => `<article class="scenario-card"><div class="scenario-top"><span class="pill gold">${esc(scenario.category)}</span><span class="pill">${esc(scenario.difficulty)}</span></div><h3>${esc(scenario.title)}</h3><p>${esc(scenario.description)}</p><div class="scenario-bottom"><small>${esc(scenario.estimatedMinutes || 10)} minute practice</small><button class="button secondary" data-action="start-case" data-id="${esc(scenario.id)}">Work through case ${icon('arrow')}</button></div></article>`).join('')}</div>`;
}

function renderPractice() {
  return `<section class="practice-card"><span class="eyebrow">MAKE YOUR THINKING VISIBLE</span><h2>Practice the decisions behind the answer.</h2><p>Choose an exercise. Explain your reasoning before your coach gives feedback. Use specific cases and repeat the areas that feel uncertain.</p><div class="practice-options">${[
    ['Clinical synthesis', 'Help me practice clinical synthesis with a fictional complex family medicine patient. Ask for my concise problem representation, then challenge my prioritization, one question at a time.'],
    ['Differential diagnosis', 'Give me a fictional family medicine case to practice differential diagnosis. Ask me to prioritize diagnoses and explain evidence for and against each, one question at a time.'],
    ['Next best step', 'Quiz me on next best steps in family medicine. Present one fictional case, ask for my next step and reasoning, and wait for my answer.'],
    ['Teach-back', 'Ask me to choose a family medicine concept and explain it in my own words. Identify gaps in my understanding and help me correct them with a short follow-up question.'],
  ].map(([label,prompt]) => `<button class="button" data-action="practice-prompt" data-prompt="${esc(prompt)}">${esc(label)} ↗</button>`).join('')}</div></section><div class="card"><h2>Build a useful study loop</h2><p class="subtitle" style="font-size:13px">Try a question without help. Explain why your answer fits. Compare it with reliable guidance. Save a small recall card for the gap you found, then revisit it when due.</p><button class="button secondary" data-action="starter" data-prompt="Help me plan a ${esc(state.settings.dailyMinutes)} minute study session focused on ${esc(focusLabel().toLowerCase())}. Start with one question to identify what I should work on.">Plan a study session ${icon('arrow')}</button></div>`;
}

function renderProgress() {
  const s = stats();
  const activity = s.activity.slice(-14);
  const max = Math.max(1, ...activity.map(item => item.count));
  return `${pageHead('LEARN FROM YOUR OWN PATTERNS', 'Progress you can see.', 'Honest recall, consistent practice, and a clearer view of what needs attention.')}
    <div class="metrics progress-metrics">${metric('Total reviews',s.totalReviews,'Every effort to retrieve counts','review')}${metric('Recall success',s.recallRate === null ? '—' : `${s.recallRate}%`,'Self-rated Good or Easy','target')}${metric('Current streak',s.streak,'Days with at least one review','streak',s.streak === 1 ? 'day' : 'days')}</div>
    <div class="grid two"><section class="card"><div class="section-head"><h2>Your review rhythm</h2><span class="pill">Last 14 days</span></div><div class="chart-bars" role="img" aria-label="Review activity: ${esc(activity.map(item => `${item.date}: ${item.count} reviews`).join('; '))}">${activity.map((item,index) => `<div class="chart-day"><span class="chart-count">${item.count || ''}</span><div class="chart-bar ${index === activity.length - 1 ? 'today' : ''}" style="height:${Math.max(3,item.count/max*85)}px"></div><small>${esc(new Date(`${item.date}T12:00:00`).toLocaleDateString(undefined,{weekday:'narrow'}))}</small></div>`).join('')}</div><p class="footer-note" style="margin-bottom:0">Consistency creates more chances to retrieve. There’s no requirement for a perfect streak.</p></section>
    <section class="card"><div class="section-head"><h2>Topics to revisit</h2><span class="pill">Recall ratings</span></div>${s.weakTopics.length ? s.weakTopics.slice(0,4).map(topic => `<div class="weak-row"><div><strong>${esc(topic.topic)}</strong><small>${topic.reviews} reviews · ${topic.lapses} Again ratings</small></div><button class="text-button" data-action="topic-coach" data-topic="${esc(topic.topic)}">${Math.round(topic.recallRate)}% ↗</button></div>`).join('') : '<p class="subtitle" style="font-size:12px;margin-top:20px">Your first reviews will start to show your strengths and gaps. These statistics measure self-rated card recall.</p>'}</section></div>
    <div class="section-head" style="margin-top:30px"><h2>Reflect on your practice</h2><span class="pill">Self-assessment</span></div><div class="notice info">These six broad competency areas are prompts for reflection. Your personal confidence ratings are educational and are not ACGME milestone levels, board readiness, or an official clinical assessment.</div>
    <div class="competency-list">${COMPETENCIES.map(item => `<section class="competency-card"><div class="competency-top"><span class="competency-abbr">${esc(item.abbr)}</span><h3>${esc(item.name)}</h3></div><p>${esc(item.description)}</p><label class="confidence-label" for="confidence-${esc(item.id)}">My confidence in deliberate practice</label><select id="confidence-${esc(item.id)}" class="confidence-select" data-competency="${esc(item.id)}"><option value="">Choose your confidence</option>${[[1,'Starting to explore'],[2,'I need frequent support'],[3,'I can explain with support'],[4,'I can explain consistently'],[5,'I can teach my reasoning']].map(([value,label]) => `<option value="${value}" ${Number(state.settings.competencyRatings?.[item.id]) === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select><button class="text-button" style="padding-left:0" data-action="starter" data-prompt="Help me practice ${esc(item.name.toLowerCase())} through a fictional family medicine scenario. Ask me one question at a time, then provide specific educational feedback.">Practice this area ↗</button></section>`).join('')}</div>
    <p class="footer-note">${s.leeches ? `${s.leeches} card${s.leeches === 1 ? '' : 's'} has repeated lapses. Rewrite these into smaller, clearer questions. ` : ''}Scheduling supports practice; it cannot guarantee durable learning or safe clinical performance.</p>`;
}

function dialog(title, subtitle, body, footer = '') {
  $('#dialog-content').innerHTML = `<div class="dialog-head"><div><h2 id="dialog-title">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ''}`;
  if (!$('#app-dialog').open) $('#app-dialog').showModal();
}
function closeDialog() { if (formBusy) return; $('#app-dialog').close(); }

function settingsDialog() {
  const s = state.settings;
  dialog('A study rhythm that fits.', 'Adjust your coach and your daily learning load.', `<form id="settings-form"><div class="form-field"><label for="study-focus">Study focus</label><select id="study-focus" name="focus">${[['clinical-reasoning','Clinical reasoning & synthesis'],['exam','Exam preparation'],['balanced','Balanced learning']].map(([value,label]) => `<option value="${value}" ${s.focus === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="form-field"><label for="coach-style">Coaching style</label><select id="coach-style" name="coachStyle">${[['socratic','Socratic: one question at a time'],['teach-quiz','Explain first, then quiz me'],['direct','Give clear, direct explanations']].map(([value,label]) => `<option value="${value}" ${s.coachStyle === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="form-row"><div class="form-field"><label for="daily-minutes">Minutes per day</label><input id="daily-minutes" name="dailyMinutes" type="number" min="5" max="120" required value="${s.dailyMinutes}"></div><div class="form-field"><label for="new-limit">New cards per day</label><input id="new-limit" name="newCardsPerDay" type="number" min="0" max="50" required value="${s.newCardsPerDay}"></div></div><div class="form-field"><label for="study-timezone">Study timezone</label><input id="study-timezone" name="timeZone" value="${esc(s.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone)}" required><small>Used for daily limits and streaks. Example: America/New_York.</small></div><div class="notice info">${status.aiConfigured ? `AI coaching is configured${status.mode !== 'commercial' && status.model ? ` using ${esc(status.model)}` : ''}. ${status.mode === 'commercial' ? 'Answer sources and review dates appear when available.' : 'Your API key stays on the server.'}` : status.mode === 'commercial' ? 'AI coaching is being prepared. Guided practice supports learning habits while the app is tested.' : 'Guided practice is available now. To enable conversational AI, configure the server with OPENAI_API_KEY. Keys are never entered in this browser.'}</div><div id="settings-error" class="form-error" role="alert"></div></form><div class="form-section"><h3>Take your learning with you</h3><div class="inline-actions"><button class="button secondary" data-action="export">Export backup</button><button class="button secondary" data-action="import-backup">Restore backup</button></div><p class="footer-note" style="margin-bottom:0">Backups include your cards, review history, conversations, and preferences. Keep the file private.</p></div><div class="form-section"><h3>Use it from your phone</h3><p class="subtitle" style="font-size:12px">Open your hosted app’s HTTPS address. On Android, choose “Install app” or “Add to Home screen” in your browser menu. On iPhone, open Safari, tap Share, then “Add to Home Screen”.</p><p class="footer-note" style="margin:0">${voiceDictationSupported() ? 'The microphone button uses your browser’s speech recognition service. Review dictated text before sending.' : 'Use your phone keyboard’s microphone to dictate. Read-aloud is available where your browser supports it.'} Chat and saved progress require a connection.</p></div>${status.mode === 'commercial' ? commercialSettings() : ''}${status.authRequired ? '<div class="form-section"><button class="button secondary" data-action="logout">Lock study space</button></div>' : ''}`, '<button class="button secondary" data-action="close-dialog">Cancel</button><button type="submit" form="settings-form" class="button">Save preferences</button>');
}

function cardDialog(card = null, preset = {}) {
  const data = card || preset;
  dialog(card ? 'Make this card clearer.' : 'Keep one useful insight.', 'One focused question. One answer you can check.', `<form id="card-form" data-id="${esc(card?.id || '')}"><div class="form-field"><label for="card-front">Question / prompt</label><textarea id="card-front" name="front" required maxlength="2000" placeholder="What should I be able to recall?">${esc(data.front)}</textarea></div><div class="form-field"><label for="card-back">Answer</label><textarea id="card-back" name="back" required maxlength="8000" placeholder="A focused answer, in your own words.">${esc(data.back)}</textarea></div><div class="form-field"><label for="card-topic">Topic</label><input id="card-topic" name="topic" required maxlength="100" placeholder="e.g. Clinical synthesis" value="${esc(data.topic || 'Family medicine')}"></div><div class="form-field"><label for="source-title">Reference title</label><input id="source-title" name="sourceTitle" maxlength="300" value="${esc(data.sourceTitle)}" placeholder="Guideline, textbook, or personal study note"></div><div class="form-field"><label for="source-url">Reference link</label><input id="source-url" name="sourceUrl" type="url" maxlength="2000" value="${esc(data.sourceUrl)}" placeholder="https://…"><small>Check source details and the current recommendation before clinical use.</small></div><label class="check-field"><input type="checkbox" name="verified" ${data.verified ? 'checked' : ''}>I checked this answer against a reliable source</label><div id="card-error" class="form-error" role="alert"></div></form>`, '<button class="button secondary" data-action="close-dialog">Cancel</button><button class="button" type="submit" form="card-form">Save recall card</button>');
}

function historyDialog() {
  dialog('Your conversations.', 'Return to a thought or start fresh.', `<div class="history-list">${state.conversations.length ? state.conversations.map(item => `<div class="history-item"><button data-action="select-conversation" data-id="${esc(item.id)}">${esc(item.title || 'Study conversation')}<small>${esc(dateString(item.updatedAt || item.createdAt))} · ${(item.messages || []).length} messages</small></button><button class="icon-button" data-action="delete-conversation" data-id="${esc(item.id)}" aria-label="Delete ${esc(item.title || 'conversation')}">${icon('trash')}</button></div>`).join('') : '<p class="subtitle" style="font-size:12px">Your conversations will appear here after your first message.</p>'}</div>`, '<button class="button" data-action="new-chat">Start a new conversation</button>');
}

function confirmDialog(title, message, action, id, label = 'Delete') {
  dialog(title, message, '<p class="subtitle" style="font-size:13px">This action cannot be undone from within the app. Export a backup first if you need a copy.</p>', `<button class="button secondary" data-action="close-dialog">Keep it</button><button class="button danger" data-action="${esc(action)}" data-id="${esc(id)}">${esc(label)}</button>`);
}

async function createConversation(options = {}) {
  const result = await mutate('/api/conversations', 'POST', { title: 'Study conversation', mode: 'coach', ...options });
  const item = result.conversation || result;
  await refreshState();
  currentConversationId = item.id;
  chatDraft = '';
  chatError = '';
  navigate('coach');
  return item;
}

async function sendMessage(content) {
  if (!content.trim() || chatBusy) return;
  if (!canChat()) return status.entitlement?.active && !status.aiConfigured ? notify('AI coaching is not configured for this pilot. Your cards and reviews are ready.') : subscriptionDialog();
  if (!navigator.onLine) { notify('Reconnect to send a message. Your draft is still here.'); return; }
  stopDictation();
  const submitted = content.trim();
  chatBusy = true;
  render();
  try {
    if (!conversation()) await createConversation({ title: submitted.length > 55 ? `${submitted.slice(0,52)}…` : submitted });
    chatBusy = true;
    chatError = '';
    chatDraft = '';
    const activeConversationId = currentConversationId;
    if (!pendingChatRequest || pendingChatRequest.conversationId !== activeConversationId || pendingChatRequest.content !== submitted) pendingChatRequest = { conversationId: activeConversationId, content: submitted, requestId: crypto.randomUUID() };
    const current = conversation();
    current.messages = [...(current.messages || []), { id: `pending-${Date.now()}`, role: 'user', content: submitted }];
    render();
    const result = await mutate('/api/chat', 'POST', { ...pendingChatRequest });
    if (result.conversation) {
      const index = state.conversations.findIndex(item => item.id === activeConversationId);
      if (index >= 0) state.conversations[index] = result.conversation;
    } else await refreshState();
    pendingChatRequest = null;
    if (status.mode === 'commercial') status = await api('/api/status').catch(() => status);
  } catch (error) {
    chatError = error.message;
    chatDraft = submitted;
    await refreshState().catch(() => {});
  } finally {
    chatBusy = false;
    render();
    if (screen === 'coach') $('#chat-input')?.focus({ preventScroll:true });
  }
}

function scrollChat() { const log = $('#chat-messages'); if (log) log.scrollTop = conversation()?.messages?.length ? log.scrollHeight : 0; }
function resizeComposer() { const input = $('#chat-input'); if (!input) return; input.style.height = 'auto'; input.style.height = `${Math.min(140, Math.max(38,input.scrollHeight))}px`; }

function startDictation() {
  if (!voiceDictationSupported()) { notify('Use the microphone on your phone’s keyboard to dictate.'); return; }
  if (!window.isSecureContext) { notify('Dictation needs HTTPS. You can also use your phone keyboard’s microphone.'); return; }
  if (recording) return stopDictation();
  recognition = new SpeechRecognition();
  recognition.lang = navigator.language || 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognitionBase = $('#chat-input')?.value || chatDraft;
  recognition.onresult = event => {
    const transcript = Array.from(event.results).map(result => result[0].transcript).join(' ');
    chatDraft = `${recognitionBase}${recognitionBase && transcript ? ' ' : ''}${transcript}`.slice(0,12000);
    const input = $('#chat-input');
    if (input) { input.value = chatDraft; resizeComposer(); }
  };
  recognition.onerror = event => { notify(event.error === 'not-allowed' ? 'Microphone access wasn’t granted. Use typing or your keyboard’s microphone.' : 'Dictation stopped. You can keep typing or try the microphone again.'); stopDictation(); };
  recognition.onend = () => { recording = false; updateDictationUI(); };
  try { recognition.start(); recording = true; updateDictationUI(); } catch { notify('Dictation is unavailable right now. Use your phone keyboard’s microphone.'); }
}
function stopDictation() { if (recognition && recording) recognition.stop(); recording = false; updateDictationUI(); }
function updateDictationUI() {
  const button = $('.mic-button');
  if (button) { button.classList.toggle('recording', recording); button.setAttribute('aria-label', recording ? 'Stop dictation' : 'Dictate a message'); }
  if ($('#voice-status')) $('#voice-status').textContent = recording ? 'Listening… tap the microphone to stop.' : voiceDictationSupported() ? 'Type or tap mic. Review before sending.' : 'Type or use your phone keyboard’s microphone.';
}
function readMessage(id) {
  const message = conversation()?.messages?.find(item => item.id === id);
  if (!message || !('speechSynthesis' in window)) return;
  if (speechSynthesis.speaking) { speechSynthesis.cancel(); notify('Read-aloud stopped.'); return; }
  const speech = new SpeechSynthesisUtterance(message.content);
  speech.lang = navigator.language || 'en-US';
  speech.rate = .95;
  speech.onerror = () => notify('Read-aloud is unavailable on this browser.');
  speechSynthesis.speak(speech);
}

async function ratingAction(rating) {
  if (!answerVisible || reviewBusy || !reviewSession.queue.length) return;
  reviewBusy = true;
  render();
  try {
    await mutate('/api/reviews','POST',{ cardId:reviewSession.queue[0],rating });
    await refreshState();
    reviewSession.queue.shift();
    reviewSession.completed++;
    if (rating === 'good' || rating === 'easy') reviewSession.good++;
    answerVisible = false;
  } catch (error) { notify(error.message); }
  finally { reviewBusy = false; render(); }
}

async function generateCards() {
  if (!conversation() || chatBusy) return;
  dialog('Keep the useful learning points.', status.aiConfigured ? 'Drafting focused recall cards from this conversation…' : 'Preparing guided practice worksheet cards…', '<div class="loading-line"><span class="spinner"></span>Preparing cards to review</div>');
  try {
    const result = await mutate('/api/chat/cards','POST',{conversationId:currentConversationId});
    draftCards = result.cards || [];
    draftsOffline = result.offline === true;
    if (!draftCards.length) return dialog('No cards suggested yet.', 'Add more learning points to your conversation first.', '<p class="subtitle">Continue studying, then try creating cards again.</p>', '<button class="button" data-action="close-dialog">Keep studying</button>');
    renderDraftDialog();
  } catch (error) { dialog('Cards couldn’t be created.', 'Your conversation is still saved.', `<div class="notice error">${esc(error.message)}</div>`, '<button class="button secondary" data-action="close-dialog">Close</button>'); }
}
function renderDraftDialog() {
  dialog(draftsOffline ? 'Keep a useful study habit.' : 'Keep the useful learning points.', draftsOffline ? 'Guided practice worksheets; edit them to fit your learning.' : 'Review every draft. Check clinical facts before you accept it.', `<div class="notice" style="margin-bottom:20px">${draftsOffline ? 'These are reusable worksheet prompts, not AI-generated summaries of your chat. Review the suggested answers and adapt them to your learning before saving.' : 'AI drafts may contain errors. Edit each question and answer, then add a reliable reference. Accepted drafts remain unverified until you check them.'}</div><form id="draft-form">${draftCards.map((card,index) => `<div class="draft-card" data-draft="${index}"><p class="draft-label">DRAFT CARD ${index + 1}</p><label class="check-field"><input type="checkbox" name="accept-${index}" checked>Keep this card</label><div class="form-field"><label for="draft-front-${index}">Question</label><textarea id="draft-front-${index}" name="front-${index}" maxlength="2000">${esc(card.front)}</textarea></div><div class="form-field"><label for="draft-back-${index}">Answer</label><textarea id="draft-back-${index}" name="back-${index}" maxlength="8000">${esc(card.back)}</textarea></div><div class="form-field"><label for="draft-topic-${index}">Topic</label><input id="draft-topic-${index}" name="topic-${index}" value="${esc(card.topic || 'Family medicine')}" maxlength="100"></div><div class="form-field"><label for="draft-source-${index}">Reference link (optional)</label><input type="url" id="draft-source-${index}" name="sourceUrl-${index}" value="${esc(card.sourceUrl || '')}" maxlength="2000"></div></div>`).join('')}<div id="draft-error" class="form-error" role="alert"></div></form>`, '<button class="button secondary" data-action="close-dialog">Cancel</button><button class="button" type="submit" form="draft-form">Save selected cards</button>');
}

function importCardsDialog() {
  dialog('Bring your recall cards.', 'Paste a JSON array of cards, or select a JSON file.', `<form id="import-cards-form"><div class="form-field"><label for="import-json">Cards as JSON</label><textarea id="import-json" name="json" rows="8" placeholder='[{"front":"Your question","back":"Your answer","topic":"Family medicine"}]'></textarea><small>Each card needs front and back. Optional fields: topic, sourceTitle, sourceUrl, verified.</small></div><label class="button secondary" for="cards-file">Choose JSON file</label><input id="cards-file" class="import-file" type="file" accept="application/json,.json"><div id="import-error" class="form-error" role="alert" style="margin-top:15px"></div></form>`, '<button class="button secondary" data-action="close-dialog">Cancel</button><button class="button" type="submit" form="import-cards-form">Import cards</button>');
}

async function exportBackup() {
  try {
    const backup = await api('/api/export');
    const blob = new Blob([JSON.stringify(backup,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href=url; link.download=`fm-study-coach-backup-${new Date().toISOString().slice(0,10)}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
    notify('Your private study backup is ready.');
  } catch(error) { notify(error.message); }
}

function importBackupDialog() {
  dialog('Restore your study backup.', 'This replaces the saved study data on this server.', `<div class="notice" style="margin-bottom:18px">Export your current data first if you want to keep it. Restoring a backup replaces cards, reviews, conversations, and preferences.</div><form id="restore-form"><div class="form-field"><label for="backup-file">Choose your backup JSON file</label><input id="backup-file" name="backup" type="file" accept="application/json,.json" required></div><label class="check-field"><input type="checkbox" name="confirmed" required>I understand this will replace my current study data</label><div id="restore-error" class="form-error" role="alert"></div></form>`, '<button class="button secondary" data-action="close-dialog">Cancel</button><button class="button" type="submit" form="restore-form">Restore backup</button>');
}

function renderLogin() {
  renderNav();
  if (status.mode === 'commercial') return renderAccountLogin();
  $('#main').innerHTML = `<section class="card auth-card"><span class="eyebrow">YOUR PRIVATE STUDY SPACE</span><h1>Welcome back.</h1><p class="subtitle">Unlock your coach, recall cards, and learning history.</p><form id="login-form"><div class="form-field"><label for="access-token">App access token</label><input id="access-token" name="token" type="password" autocomplete="current-password" required placeholder="Enter your access token"></div><div id="login-error" class="form-error" role="alert"></div><button class="button full" type="submit">Open study space ${icon('arrow')}</button></form><p class="signin-note">Use the access token configured by your app’s owner. Your browser keeps a secure session after you unlock.</p></section>`;
}

function canChat() { return status.mode !== 'commercial' || (status.authenticated && status.entitlement?.active === true && status.aiConfigured === true); }
function voiceDictationSupported() { return Boolean(SpeechRecognition) && !billingBridge(); }
function pilotNotice(compact=false) { return status.privatePilot ? compact ? `<div class="notice pilot-notice compact-pilot"><strong>Free private phone pilot</strong><span>${status.aiConfigured ? 'Practice and test your coach.' : 'Cards and reviews are ready. AI coaching is not configured yet.'} No subscription trial has started.</span></div>` : '<div class="notice pilot-notice"><strong>Private phone pilot</strong><span>Practice, chat, and review while we test the app. This free pilot is separate from a paid subscription or subscription trial.</span></div>' : ''; }

function renderAnswerEvidence(message) {
  const sources = Array.isArray(message.citations) ? message.citations : [];
  const sourceList = sources.map(source => {
    const url=safeUrl(source.url);
    const title=url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(source.title || 'Reviewed source')} ↗</a>` : esc(source.title || 'Reviewed source');
    const reviewed=source.reviewedAt ? new Date(source.reviewedAt).toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'}) : '';
    return `<li>${title}<small>${source.edition ? `Edition: ${esc(source.edition)}` : ''}${source.edition && reviewed ? ' · ' : ''}${reviewed ? `Reviewed ${esc(reviewed)}` : ''}</small></li>`;
  }).join('');
  return `${message.unsupported === true ? '<div class="answer-abstention">Verification needed: reviewed teaching evidence did not support an answer to this question.</div>' : ''}${sourceList ? `<details class="answer-sources"><summary>${sources.length === 1 ? 'Reviewed teaching source' : `${sources.length} reviewed teaching sources`}</summary><ul>${sourceList}</ul><p>Reviewed excerpts support this teaching response; they are not a complete guideline or patient-specific advice.</p></details>` : ''}`;
}

function renderAccountLogin() {
  const signup=accountFormMode==='register';
  $('#main').innerHTML=`<section class="card auth-card commercial-auth"><span class="eyebrow">${status.privatePilot ? 'YOUR PRIVATE PHONE PILOT' : 'FAMILY MEDICINE STUDY COACH'}</span><h1>${signup ? 'Make room for learning.' : 'Welcome back.'}</h1><p class="subtitle">${status.privatePilot ? 'Create a private test account to keep your cards, conversations, and progress together.' : 'Your coach, recall cards, and study history in one place.'}</p><div class="segmented"><button data-action="account-mode" data-mode="login" class="${!signup ? 'active' : ''}" aria-pressed="${!signup}">Sign in</button><button data-action="account-mode" data-mode="register" class="${signup ? 'active' : ''}" aria-pressed="${signup}">Create account</button></div><form id="account-form"><div class="form-field"><label for="account-email">Email</label><input id="account-email" name="email" type="email" autocomplete="username" maxlength="254" required placeholder="you@example.com"></div>${signup && status.registrationRestricted ? '<div class="form-field"><label for="pilot-invite">Private pilot invite</label><input id="pilot-invite" name="inviteToken" type="password" autocomplete="off" required placeholder="Invite provided by the app owner"><small>Your test invite is separate from your personal password.</small></div>' : ''}<div class="form-field"><label for="account-password">Password</label><input id="account-password" name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="12" maxlength="128" required placeholder="At least 12 characters">${signup ? '<small>Use a unique password with at least 12 characters.</small>' : ''}</div><div id="account-error" class="form-error" role="alert"></div><button class="button full" type="submit">${signup ? 'Create study account' : 'Open study space'} ${icon('arrow')}</button></form><p class="signin-note">${status.privatePilot ? 'This is a free private test. Creating an account does not start a paid subscription or a three-day subscription trial.' : 'Subscription pricing and any eligible trial are shown by Google Play before purchase.'}</p><div class="legal-links"><a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy</a><a href="/account-deletion.html" target="_blank" rel="noopener noreferrer">Account deletion</a></div></section>`;
}

function usageHtml() {
  if(status.mode!=='commercial' || !status.usage) return '';
  const usage=status.usage;
  const limited=status.entitlement?.isTrial === true;
  const trial=limited && status.entitlement?.trialPhaseKnown === true;
  const budget=usage.monthlyBudgetUsd;
  const used=Number(usage.usedUsd) || 0;
  const percentage=Number(budget)>0 ? Math.min(100,used/Number(budget)*100) : 0;
  return `<div class="usage-summary"><div class="section-head"><strong>Included coaching allowance</strong><span>${esc(usage.turns || 0)} study turns this month</span></div><div class="progress-track"><div class="progress-fill" style="width:${percentage}%"></div></div><p>Estimated AI use: $${used.toFixed(2)} of $${Number(budget || 0).toFixed(2)} monthly allowance.</p><small>Up to ${esc(usage.dailyTurnLimit || 20)} turns per UTC day and ${esc(usage.monthlyTurnLimit || 200)} per usage period, within the AI budget. Saved cards and reviews remain available when coaching limits are reached.${limited ? ` ${trial ? 'Verified trial access' : 'An unconfirmed offer phase'} also has a $${Number(usage.trialBudgetUsd || 0).toFixed(2)} lifetime initial allowance.` : ''}</small></div>`;
}

function commercialSettings() {
  const entitled=status.entitlement?.active===true;
  return `<div class="form-section"><h3>Your study account</h3><p class="account-email">${esc(status.account?.email || '')}</p>${status.privatePilot ? '<div class="notice info">Private phone pilot: free testing access. This is not a paid subscription or Google Play trial.</div>' : `<p class="subtitle" style="font-size:12px">${entitled ? `Subscription access is active${status.entitlement.isTrial && status.entitlement.trialPhaseKnown ? ' during your verified trial' : ''}.` : 'A verified subscription is needed for coaching.'}</p>`}${usageHtml()}<div class="inline-actions"><button class="button secondary" data-action="billing">${status.privatePilot ? 'Subscription details' : 'View subscription'}</button><button class="button secondary" data-action="manage-subscription">Manage on Google Play</button></div></div><div class="form-section"><h3>Privacy & account controls</h3><div class="legal-links"><a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy policy</a><a href="/account-deletion.html" target="_blank" rel="noopener noreferrer">Deletion information</a></div><button class="text-button delete-account-link" data-action="delete-account">Delete my account</button></div>`;
}

function billingBridge() { return window.FMNativeBilling && typeof window.FMNativeBilling.getProductDetails==='function' ? window.FMNativeBilling : null; }
function billingPeriod(value) {
  const match=/^P(\d+)(D|W|M|Y)$/.exec(String(value || ''));
  if(!match) return String(value || 'billing period');
  const unit={D:'day',W:'week',M:'month',Y:'year'}[match[2]];
  return `${match[1]} ${unit}${match[1]==='1' ? '' : 's'}`;
}
function phaseDescription(phase) {
  const price=phase.formattedPrice || `${phase.priceCurrencyCode || ''} price unavailable`;
  const period=billingPeriod(phase.billingPeriod);
  if(Number(phase.recurrenceMode)===1) return `${price} every ${period}`;
  const cycles=Number(phase.billingCycleCount);
  return `${price} for ${period}${cycles>1 ? `, repeated ${cycles} times` : ''}`;
}

function subscriptionDialog(load=true) {
  billingDialogOpen=true;
  const bridge=billingBridge();
  const offers=billingProducts.flatMap((product,productIndex)=>(product.offers || []).map((offer,offerIndex)=>({product,offer,productIndex,offerIndex}))).filter(({product,offer})=>product.productId==='family_medicine_monthly' && offer.offerToken && offer.pricingPhases?.length);
  const body=`${status.privatePilot ? '<div class="notice info" style="margin-bottom:18px">Your free private phone pilot is active. A subscription purchase is separate and is not required to test this pilot.</div>' : status.entitlement?.active ? `<div class="notice info" style="margin-bottom:18px">${status.entitlement.isTrial && status.entitlement.trialPhaseKnown ? 'Verified trial access' : 'Verified subscription access'} is active${status.entitlement.expiresAt ? ` through ${esc(new Date(status.entitlement.expiresAt).toLocaleDateString())}` : ''}.</div>` : '<p class="subtitle" style="font-size:13px">Coaching access requires a verified Google Play subscription. You can continue using your saved cards and reviews.</p>'}${usageHtml()}${offers.length ? `<div class="billing-offers">${offers.map(({product,offer,productIndex,offerIndex})=>`<section class="billing-offer"><h3>${esc(product.title || 'Family Medicine coaching')}</h3><p>${offer.pricingPhases.map(phaseDescription).map(esc).join(' → ')}</p><small>Google Play shows your eligible offer, renewal terms, and final confirmation before charging.</small><button class="button full" data-action="native-purchase" data-product="${productIndex}" data-offer="${offerIndex}">Continue with Google Play</button></section>`).join('')}</div>` : bridge ? `<div class="loading-line">${billingLoading ? '<span class="spinner"></span>Loading current Google Play pricing…' : 'Current Google Play pricing has not loaded.'}</div>` : '<div class="notice">Subscription purchase and eligible pricing are available inside the installed Android app. No payment is started from this browser.</div>'}${billingMessage ? `<div class="notice info" style="margin-top:14px">${esc(billingMessage)}</div>` : ''}<div class="legal-links"><a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy</a><a href="/account-deletion.html" target="_blank" rel="noopener noreferrer">Account deletion</a></div>`;
  dialog('Your coaching access.', 'Pricing comes directly from Google Play.',body,`<button class="button secondary" data-action="native-restore" ${!bridge ? 'disabled' : ''}>Restore purchases</button><button class="button secondary" data-action="manage-subscription">Manage subscription</button><button class="button" data-action="close-dialog">Done</button>`);
  if(load && bridge && !billingLoading) { billingLoading=true;bridge.getProductDetails();subscriptionDialog(false); }
}

function purchaseOffer(productIndex,offerIndex) {
  const product=billingProducts[productIndex];
  const offer=product?.offers?.[offerIndex];
  const bridge=billingBridge();
  if(!bridge || !product || !offer?.offerToken) return notify('Load current pricing inside the Android app first.');
  if(!status.authenticated || !status.account?.obfuscatedAccountId) return notify('Sign in to your study account before purchasing.');
  bridge.purchase(JSON.stringify({productId:product.productId,offerToken:offer.offerToken,accountId:status.account.obfuscatedAccountId}));
}
function restorePurchases() { const bridge=billingBridge();if(!bridge) return notify('Restore purchases inside the installed Android app.');billingMessage='Checking Google Play purchases…';bridge.restore();subscriptionDialog(false); }
function manageSubscriptions() { const bridge=billingBridge();if(bridge && typeof bridge.manageSubscriptions==='function') bridge.manageSubscriptions();else window.open('https://play.google.com/store/account/subscriptions','_blank','noopener,noreferrer'); }

async function handleBillingEvent(event) {
  let detail=event.detail;
  if(typeof detail==='string') {try{detail=JSON.parse(detail);}catch{return;}}
  if(!detail || typeof detail!=='object') return;
  switch(detail.type) {
    case 'native-ready': nativeReady();break;
    case 'billing-ready': if(billingDialogOpen && $('#app-dialog').open) subscriptionDialog();break;
    case 'product-details': billingLoading=false;billingProducts=Array.isArray(detail.products)?detail.products:[];billingMessage=billingProducts.length ? '' : 'Google Play has no eligible subscription offer available right now.';if(billingDialogOpen && $('#app-dialog').open) subscriptionDialog(false);break;
    case 'purchase':
      if(detail.purchaseState!=='PURCHASED') {billingMessage='Your purchase is pending in Google Play. Coaching unlocks after payment and server verification.';if(billingDialogOpen && $('#app-dialog').open) subscriptionDialog(false);return;}
      if(!detail.purchaseToken || !status.authenticated || verifyingPurchases.has(detail.purchaseToken)) return;
      verifyingPurchases.add(detail.purchaseToken);
      billingMessage='Verifying your purchase securely…';if(billingDialogOpen && $('#app-dialog').open) subscriptionDialog(false);
      try {await mutate('/api/billing/verify','POST',{purchaseToken:detail.purchaseToken});status=await api('/api/status');billingMessage=status.entitlement?.active ? 'Your coaching access has been verified.' : 'Verification completed; coaching access is not active yet.';render();if(billingDialogOpen && $('#app-dialog').open) subscriptionDialog(false);notify(billingMessage);}
      catch(error){billingMessage=error.message;if(billingDialogOpen && $('#app-dialog').open) subscriptionDialog(false);notify('Purchase verification needs attention. Restore purchases to try again.');}
      finally { verifyingPurchases.delete(detail.purchaseToken); }break;
    case 'purchase-canceled': billingMessage='Purchase canceled.';break;
    case 'restore-complete': if(!status.entitlement?.active) billingMessage='Restore check completed. Active coaching access requires server verification.';break;
    case 'billing-error': case 'billing-unavailable': billingLoading=false;billingMessage=detail.message || 'Google Play billing is unavailable right now.';break;
  }
  if(billingDialogOpen && $('#app-dialog').open && !['purchase','native-ready','billing-ready','product-details'].includes(detail.type)) subscriptionDialog(false);
}
window.addEventListener('fm-native-billing',event=>{handleBillingEvent(event).catch(error=>notify(error.message));});
window.addEventListener('fm-native-ready',nativeReady);
function nativeReady() {
  if ($('#chat-input')) chatDraft = $('#chat-input').value;
  if (recording) stopDictation();
  if (isLoaded) render();
  const bridge = billingBridge();
  if (bridge) { bridge.getProductDetails(); if (status.authenticated && status.mode === 'commercial') bridge.restore(); }
  if (billingDialogOpen && $('#app-dialog').open) subscriptionDialog(false);
}
function maybePromptAccountDeletion() {
  if (pendingDeletionPrompt && isLoaded && status.mode === 'commercial' && status.authenticated) {
    pendingDeletionPrompt = false;
    const url = new URL(location.href); url.searchParams.delete('account'); history.replaceState(null, '', url);
    accountDeletionDialog();
  }
}
$('#app-dialog').addEventListener('close',()=>{billingDialogOpen=false;});

function reportDialog(messageId) {
  const current=conversation();
  if(!current?.messages?.some(message=>message.id===messageId)) return;
  dialog('Help improve this answer.', 'Reports are saved for app-owner review; they are not an emergency channel.', `<form id="report-form" data-conversation="${esc(current.id)}" data-message="${esc(messageId)}"><div class="form-field"><label for="report-reason">What should we review?</label><textarea id="report-reason" name="reason" maxlength="2000" required placeholder="Describe the incorrect statement, source issue, or coaching concern."></textarea><small>Keep your report free of identifying patient information.</small></div><div id="report-error" class="form-error" role="alert"></div></form>`,'<button class="button secondary" data-action="close-dialog">Cancel</button><button class="button" type="submit" form="report-form">Save report</button>');
}
function accountDeletionDialog() {
  dialog('Delete your study account?', 'This permanently removes your account and stored study content.', `<div class="notice" style="margin-bottom:18px">Deleting your account does not cancel a Google Play subscription. Manage or cancel it in Google Play first if needed.</div><button class="button secondary" data-action="manage-subscription">Manage Google Play subscription</button><p class="subtitle" style="font-size:12px;margin-top:18px">Export a backup before deleting if you want to keep your cards, conversations, and review history.</p><form id="delete-account-form"><div class="form-field"><label for="delete-confirmation">Type DELETE to confirm</label><input id="delete-confirmation" name="confirmation" autocomplete="off" required pattern="DELETE" placeholder="DELETE"></div><div id="delete-account-error" class="form-error" role="alert"></div></form>`,'<button class="button secondary" data-action="close-dialog">Keep my account</button><button class="button danger" type="submit" form="delete-account-form">Permanently delete account</button>');
}

async function handleAction(button) {
  const {action,id,rating,prompt,topic,tab} = button.dataset;
  if (action === 'billing') return subscriptionDialog();
  if (action === 'native-purchase') return purchaseOffer(Number(button.dataset.product), Number(button.dataset.offer));
  if (action === 'native-restore') return restorePurchases();
  if (action === 'manage-subscription') return manageSubscriptions();
  if (action === 'account-mode') { accountFormMode = button.dataset.mode; return renderLogin(); }
  if (action === 'report-message') return reportDialog(id);
  if (action === 'delete-account') return accountDeletionDialog();
  if (chatBusy && ['new-chat','history','select-conversation','start-case','practice-prompt','starter','topic-coach'].includes(action)) return notify('Wait for your coach’s reply before starting another conversation.');
  switch(action) {
    case 'navigate': return navigate(button.dataset.screen);
    case 'settings': if (isLoaded) settingsDialog(); return;
    case 'close-dialog': return closeDialog();
    case 'start-review': beginReview(); return navigate('review');
    case 'reload-review': await refreshState(); beginReview(); return render();
    case 'reveal-answer': answerVisible = true; return render();
    case 'rate-card': return ratingAction(rating);
    case 'new-card': return cardDialog();
    case 'edit-card': return cardDialog(state.cards.find(card => card.id === id));
    case 'delete-card': return confirmDialog('Delete this recall card?', 'The card will be removed from your library. Historical review statistics are retained.', 'confirm-delete-card',id);
    case 'confirm-delete-card': await mutate(`/api/cards/${encodeURIComponent(id)}`,'DELETE'); closeDialog(); await refreshState(); if(reviewSession) reviewSession.queue = reviewSession.queue.filter(cardId => cardId !== id); render(); return notify('Recall card deleted.');
    case 'suspend-card': { const card=state.cards.find(item=>item.id===id); await mutate(`/api/cards/${encodeURIComponent(id)}`,'PUT',{suspended:!card.suspended}); await refreshState(); render(); return notify(card.suspended ? 'Card resumed.' : 'Card suspended.'); }
    case 'library-tab': libraryTab=tab; return render();
    case 'starter': navigate('coach'); return sendMessage(prompt);
    case 'practice-prompt': await createConversation({ title:prompt.slice(0,50),mode:'practice' }); return sendMessage(prompt);
    case 'topic-coach': navigate('coach'); return sendMessage(`Help me strengthen my understanding of ${topic}. Ask one active recall question at a time, wait for my answer, and help me correct gaps in my reasoning.`);
    case 'start-case': { const scenario=SCENARIOS.find(item=>item.id===id); await createConversation({ title:scenario.title,mode:'simulation',scenarioId:id }); return sendMessage('Start this fictional case. Ask me one question at a time and wait for my answer before giving feedback.'); }
    case 'new-chat': closeDialog(); await createConversation(); return notify('A fresh study conversation is ready.');
    case 'history': return historyDialog();
    case 'select-conversation': currentConversationId=id; chatDraft=''; chatError=''; closeDialog(); return navigate('coach');
    case 'delete-conversation': return confirmDialog('Delete this conversation?', 'All messages in this conversation will be removed.', 'confirm-delete-conversation',id);
    case 'confirm-delete-conversation': await mutate(`/api/conversations/${encodeURIComponent(id)}`,'DELETE'); await refreshState(); closeDialog(); render(); return notify('Conversation deleted.');
    case 'dictate': return startDictation();
    case 'dismiss-chat-error': chatError=''; return render();
    case 'read-message': return readMessage(id);
    case 'copy-message': { const message=conversation()?.messages?.find(item=>item.id===id); if(message) { try { await navigator.clipboard.writeText(message.content); notify('Learning point copied.'); } catch { notify('Copy is unavailable on this browser. Select the message text to copy it.'); } } return; }
    case 'card-from-message': { const message=conversation()?.messages?.find(item=>item.id===id); return cardDialog(null,{back:message?.content || '',topic:'Family medicine'}); }
    case 'draft-cards': return generateCards();
    case 'import-cards': return importCardsDialog();
    case 'export': return exportBackup();
    case 'import-backup': return importBackupDialog();
    case 'logout': await mutate('/api/logout','POST'); closeDialog(); status.authenticated=false; isLoaded=false; state.cards=[];state.conversations=[];state.reviews=[]; return renderLogin();
  }
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-action]');
  if (!button || button.disabled) return;
  event.preventDefault();
  handleAction(button).catch(error=>notify(error.message));
});

document.addEventListener('submit', async event => {
  event.preventDefault();
  const form=event.target;
  if(form.id==='chat-form') return sendMessage($('#chat-input').value);
  if(formBusy) return;
  const data=new FormData(form);
  const submit=event.submitter;
  formBusy=true;
  if(submit) submit.disabled=true;
  let errorId;
  try {
    if (form.id === 'account-form') {
      errorId = 'account-error';
      await mutate(accountFormMode === 'register' ? '/api/register' : '/api/login', 'POST', { email: data.get('email').trim().toLowerCase(), password: data.get('password'), ...(accountFormMode === 'register' ? { inviteToken: data.get('inviteToken') || '' } : {}) });
      status = await api('/api/status'); currentConversationId = null; reviewSession = null;
      await refreshState(); render(); maybePromptAccountDeletion(); if (billingBridge()) billingBridge().restore(); notify(status.privatePilot ? 'Your private phone pilot is ready.' : 'Your study account is open.');
    } else if (form.id === 'report-form') {
      errorId = 'report-error';
      await mutate('/api/reports', 'POST', { conversationId: form.dataset.conversation, messageId: form.dataset.message, reason: data.get('reason').trim() });
      $('#app-dialog').close(); notify('Your report was saved for review.');
    } else if (form.id === 'delete-account-form') {
      errorId = 'delete-account-error';
      if (data.get('confirmation') !== 'DELETE') throw new Error('Type DELETE exactly to confirm account deletion.');
      await mutate('/api/account/delete', 'POST', { confirmation: 'DELETE' });
      $('#app-dialog').close(); state.cards=[];state.reviews=[];state.conversations=[];state.settings={};isLoaded=false;currentConversationId=null;
      status=await api('/api/status'); accountFormMode='login';renderLogin();notify('Your account and saved study content were deleted.');
    } else if(form.id==='login-form') {
      errorId='login-error';
      await mutate('/api/login','POST',{token:data.get('token')});
      status=await api('/api/status');
      await refreshState();render();
    } else if(form.id==='settings-form') {
      errorId='settings-error';
      await mutate('/api/settings','PUT',{focus:data.get('focus'),coachStyle:data.get('coachStyle'),dailyMinutes:Number(data.get('dailyMinutes')),newCardsPerDay:Number(data.get('newCardsPerDay')),timeZone:data.get('timeZone').trim()});
      await refreshState();reviewSession=null;$('#app-dialog').close();render();notify('Your study preferences are saved.');
    } else if(form.id==='card-form') {
      errorId='card-error';
      const payload={front:data.get('front').trim(),back:data.get('back').trim(),topic:data.get('topic').trim(),sourceTitle:data.get('sourceTitle').trim(),sourceUrl:data.get('sourceUrl').trim(),verified:data.get('verified')==='on'};
      if(!payload.front || !payload.back) throw new Error('Add a focused question and answer before saving.');
      if(payload.sourceUrl && !safeUrl(payload.sourceUrl)) throw new Error('Use an http:// or https:// reference link.');
      await mutate(form.dataset.id ? `/api/cards/${encodeURIComponent(form.dataset.id)}` : '/api/cards',form.dataset.id?'PUT':'POST',payload);
      await refreshState();$('#app-dialog').close();render();notify('Recall card saved.');
    } else if(form.id==='draft-form') {
      errorId='draft-error';
      const selected=draftCards.map((card,index)=>({card,index})).filter(({index})=>data.get(`accept-${index}`)==='on').map(({card,index})=>({front:data.get(`front-${index}`).trim(),back:data.get(`back-${index}`).trim(),topic:data.get(`topic-${index}`).trim() || 'Family medicine',sourceTitle:card.sourceTitle || 'AI draft — verify against a reliable source',sourceUrl:data.get(`sourceUrl-${index}`).trim(),verified:false}));
      if(!selected.length) throw new Error('Select at least one draft to save.');
      if(selected.some(card=>!card.front || !card.back)) throw new Error('Each selected card needs a question and answer.');
      await mutate('/api/cards/import','POST',{cards:selected});
      await refreshState();$('#app-dialog').close();render();notify(`${selected.length} recall cards saved for review.`);
    } else if(form.id==='import-cards-form') {
      errorId='import-error';
      const parsed=JSON.parse(data.get('json'));
      const cards=Array.isArray(parsed)?parsed:parsed.cards;
      if(!Array.isArray(cards) || !cards.length) throw new Error('Paste a JSON array with at least one card.');
      await mutate('/api/cards/import','POST',{cards});
      await refreshState();$('#app-dialog').close();render();notify(`${cards.length} cards imported.`);
    } else if(form.id==='restore-form') {
      errorId='restore-error';
      const file=data.get('backup');
      if(!file?.size) throw new Error('Choose a backup JSON file first.');
      if(file.size>10*1024*1024) throw new Error('The backup is too large. The maximum is 10 MB.');
      const backup=JSON.parse(await file.text());
      await mutate('/api/import','POST',backup);
      currentConversationId=null;reviewSession=null;await refreshState();$('#app-dialog').close();render();notify('Your study backup is restored.');
    }
  } catch(error) {
    const target=errorId && document.getElementById(errorId);
    if(target) target.textContent=error instanceof SyntaxError ? 'This JSON is not valid. Check the file or pasted content and try again.' : error.message;
    else notify(error.message);
  } finally { formBusy=false;if(submit) submit.disabled=false; }
});

document.addEventListener('input', event=>{
  if(event.target.id==='chat-input') {chatDraft=event.target.value;resizeComposer();}
  if(event.target.id==='card-search') { searchTerm=event.target.value;const filtered=state.cards.filter(card=>(!topicFilter || card.topic===topicFilter) && `${card.front} ${card.back} ${card.topic}`.toLowerCase().includes(searchTerm.toLowerCase()));$('#card-results').innerHTML=renderCardResults(filtered);$('.library-summary span').textContent=`${filtered.length} cards · ${state.cards.filter(card=>card.suspended).length} suspended`; }
});
document.addEventListener('change',async event=>{
  try {
    if(event.target.id==='topic-filter') {topicFilter=event.target.value;render();}
    if(event.target.id==='cards-file') {const file=event.target.files[0];if(file) {if(file.size>2*1024*1024) throw new Error('Card imports must be under 2 MB.');$('#import-json').value=await file.text();}}
    if(event.target.dataset.competency) { const ratings={...state.settings.competencyRatings};if(event.target.value) ratings[event.target.dataset.competency]=Number(event.target.value);else delete ratings[event.target.dataset.competency]; await mutate('/api/settings','PUT',{competencyRatings:ratings});await refreshState();notify('Your reflection is saved.'); }
  } catch(error) {notify(error.message);}
});
document.addEventListener('keydown',event=>{
  if(event.target.id==='chat-input' && event.key==='Enter' && !event.shiftKey && !event.isComposing && !navigator.maxTouchPoints) {event.preventDefault();sendMessage(event.target.value);}
  if(screen==='review' && !$('#app-dialog').open && !['INPUT','TEXTAREA','SELECT','BUTTON'].includes(event.target.tagName)) {
    if(event.code==='Space' && !answerVisible) {event.preventDefault();answerVisible=true;render();}
    else if(answerVisible && ['1','2','3','4'].includes(event.key)) {event.preventDefault();ratingAction(['again','hard','good','easy'][Number(event.key)-1]);}
  }
});
$('#app-dialog').addEventListener('cancel',event=>{if(formBusy) event.preventDefault();});
$('#app-dialog').addEventListener('click',event=>{if(event.target===$('#app-dialog')) {const rect=$('#app-dialog').getBoundingClientRect();if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) closeDialog();}});
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
window.addEventListener('online',()=>{renderNav();notify('Connected again. Your study space is ready.');});
window.addEventListener('offline',()=>{renderNav();notify('You’re offline. Reconnect to chat or save progress.');});

async function initialize() {
  renderNav();
  try {
    status=await api('/api/status');
    if(status.authRequired && !status.authenticated) return renderLogin();
    await refreshState();
    if(!state.settings.timeZone) { await mutate('/api/settings','PUT',{timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});await refreshState(); }
    render();
    maybePromptAccountDeletion();
    if (billingBridge() && status.mode === 'commercial' && status.authenticated) { billingBridge().getProductDetails(); billingBridge().restore(); }
  } catch(error) {
    $('#main').innerHTML=`<div class="empty-state"><h1>Your study space is waiting.</h1><p>${esc(error.message)} Reconnect and reload to open your saved cards and conversations.</p><button class="button" id="retry-load">Try again</button></div>`;
    $('#retry-load').addEventListener('click',initialize);
  }
  if('serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('/sw.js').catch(()=>{});
}
initialize();
