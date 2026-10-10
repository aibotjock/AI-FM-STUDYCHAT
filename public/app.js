import { getDueCards, previewIntervals, studyStats } from '/shared/scheduler.js';
import { ABFM_BLUEPRINT } from '/shared/blueprint.js';
import { SCENARIOS, COMPETENCIES } from '/shared/content.js';
import { createStudyConversationAgent, conversationAudioSupported, mountVoiceCircle } from '/conversation-agent-adapter.js';
import { COACH_VOICES, DEFAULT_COACH_VOICE, createPremiumSpeechPlayer } from '/premium-speech.js';
const voiceSupported = () => conversationAudioSupported() && voiceOptions?.conversationAgent?.enabled === true && premiumVoiceAvailable() && !window.FMNativeBilling;

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
const state = { cards: [], reviews: [], conversations: [], settings: { focus: 'clinical-reasoning', coachStyle: 'socratic', dailyMinutes: 18, newCardsPerDay: 5, competencyRatings: {}, voiceId: DEFAULT_COACH_VOICE } };
let status = { authenticated: false, aiConfigured: false, authRequired: false };
let screen = ['today','coach','review','library','progress','board'].includes(location.hash.slice(1)) ? location.hash.slice(1) : 'coach';
let currentConversationId = null;
let libraryTab = 'guidelines';
let curriculumCatalog = null;
let curriculumLoading = false;
let curriculumError = '';
let curriculumSearch = '';
let curriculumDomain = '';
let curriculumRequest = 0;
let curriculumSearchTimer;
let curriculumConditionId = null;
let curriculumCondition = null;
let curriculumDetailLoading = false;
let curriculumDetailError = '';
let curriculumDetailRequest = 0;
let curriculumQuestionIndex = 0;
let curriculumChoiceId = null;
let curriculumGrading = false;
let curriculumGradeError = '';
const curriculumAnswers = new Map();
const curriculumSavedCards = new Set();
let curriculumSavingCard = false;
let curriculumSessionRevision = 0;
let boardCatalog = null;
let boardHistory = [];
let boardActiveSummary = null;
let boardActiveError = null;
let boardSession = null;
let boardResults = null;
let boardLoading = false;
let boardBusy = false;
let boardError = '';
let boardChoiceId = null;
let boardCount = 20;
let boardMode = 'mixed';
let boardDomain = '';
let boardTimed = false;
let boardMinutes = 30;
let boardFeedback = 'immediate';
let boardRequest = 0;
let boardCardBusy = '';
const boardSavedCards = new Set();
const chatSavedCards = new Set();
let searchTerm = '';
let topicFilter = '';
let chatBusy = false, chatStartedAt = 0, chatWaitTimer = null;
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
let recognitionSuffix = '';
let recognitionSegments = new Map();
let recognitionIgnoredBefore = 0;
let recognitionLastTranscript = '';
let recognitionLastWritten = '';
let draftCards = [];
let draftsOffline = false;
let formBusy = false;
let isLoaded = false;
let availableModels = [];
let lastModelTest = null;
let dialogRevision = 0;
let startVoiceBusy = false;
let voiceCircle = null, voiceCircleContainer = null;
let voiceOptions = null, voiceOptionsLoading = null, voiceOptionsGeneration = 0;
let premiumState = { phase: 'idle', active: false, kind: null, voice: DEFAULT_COACH_VOICE, audioBlocked: false, message: '' };
const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
let voiceState = { phase: 'idle', active: false, message: 'Start voice for a spoken conversation.', muted: false, audioBlocked: false, userCaption: '', assistantCaption: '', warning: '' };
const premiumSpeech = createPremiumSpeechPlayer({
  getVoice: () => selectedVoice(),
  onState: next => { const timingOnly=next.phase===premiumState.phase&&next.message===premiumState.message&&next.active===premiumState.active&&next.audioBlocked===premiumState.audioBlocked;premiumState=next;updateVoiceUI(timingOnly); },
  onUnauthorized: () => endStudySession(),
});
const voiceCoach = createStudyConversationAgent({
  api,
  speechPlayer: premiumSpeech,
  onState: next => { const timingOnly=next.phase===voiceState.phase&&next.active===voiceState.active&&next.inputState===voiceState.inputState&&next.outputState===voiceState.outputState&&next.message===voiceState.message&&next.muted===voiceState.muted&&next.audioBlocked===voiceState.audioBlocked&&next.userCaption===voiceState.userCaption&&next.assistantCaption===voiceState.assistantCaption&&next.warning===voiceState.warning;voiceState=next;updateVoiceUI(timingOnly); },
  sendTurn: async ({ content, conversationId, sessionId, requestId, signal }) => {
    const linkedCondition=state.conversations.find(item=>item.id===conversationId)?.curriculumConditionId;
    const result=await api('/api/chat',{method:'POST',body:JSON.stringify({conversationId,content,requestId,...(sessionId?{voiceSessionId:sessionId}:{}),...(linkedCondition?{conditionIds:[linkedCondition]}:{})}),signal});
    if(signal.aborted || currentConversationId!==conversationId) return {content:'',sourceVerified:false};
    const item=result.conversation;
    if(item){const index=state.conversations.findIndex(value=>value.id===item.id);if(index>=0)state.conversations[index]=item;}
    const message=result.message || item?.messages?.findLast(value=>value.role==='assistant');
    if(screen==='coach')render();
    return {conversationId,messageId:message?.id,content:message?.content || '',spokenText:studySpokenText(message),readoutAllowed:readoutMessageAllowed(message)};
  },
});

function selectedVoice() { return COACH_VOICES.some(voice => voice.id === state.settings.voiceId) ? state.settings.voiceId : DEFAULT_COACH_VOICE; }
function premiumVoiceAvailable() { return voiceOptions?.enabled === true && Boolean(window.Audio); }
function voiceTextBlocked() { return voiceState.active && !voiceState.muted && !['off','unavailable'].includes(voiceState.inputState); }
function voiceSelectHtml(id, value = selectedVoice()) {
  return `<label for="${id}">Coach voice</label><select id="${id}" name="voiceId">${COACH_VOICES.map(voice=>`<option value="${voice.id}" ${voice.id===value?'selected':''}>${voice.label}</option>`).join('')}</select>`;
}
async function loadVoiceOptions() {
  if (voiceOptions) return;
  if (!voiceOptionsLoading) {
    const generation = voiceOptionsGeneration;
    const pending = Promise.all([api('/api/voice/options'),api('/api/conversation-agent/options').catch(()=>({enabled:false}))]).then(([data,conversationAgent])=>{if(generation===voiceOptionsGeneration)voiceOptions={...data,conversationAgent};}).catch(()=>{}).finally(()=>{if(generation===voiceOptionsGeneration && voiceOptionsLoading===pending){voiceOptionsLoading=null;updateVoiceUI();}});
    voiceOptionsLoading = pending;
  }
  await voiceOptionsLoading;
}
function resetVoiceOptions() { voiceOptionsGeneration++; voiceOptions=null; voiceOptionsLoading=null; }
function stopPremiumAudio(clearCache = true) { premiumSpeech.stop({ clearCache }); if (clearCache) voiceCoach.clearCaptions(); }
function endStudySession() {
  status.authenticated = false; resetVoiceOptions();
  stopDictation(); voiceCoach.stop('Voice stopped because your study session ended. Sign in again to continue.');
  stopPremiumAudio(); resetCurriculumState(); resetBoardState(); renderLogin();
}

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
    if (response.status === 401 && path !== '/api/login') endStudySession();
    const error = new Error(payload.error || payload.message || `The request failed (${response.status}). Please try again.`); error.details=payload; throw error;
  }
  return payload;
}
function mutate(path, method, body) { return api(path, { method, body: body === undefined ? undefined : JSON.stringify(body) }); }

async function refreshState() {
  const data = await api('/api/state');
  state.cards = Array.isArray(data.cards) ? data.cards : [];
  state.reviews = Array.isArray(data.reviews) ? data.reviews : [];
  state.conversations = Array.isArray(data.conversations) ? data.conversations.filter(item=>item.internalCheck!==true).sort((a,b) => (b.messages?.at(-1)?.createdAt || b.createdAt || 0) - (a.messages?.at(-1)?.createdAt || a.createdAt || 0)) : [];
  state.settings = { ...state.settings, ...data.settings };
  await loadVoiceOptions();
  if (reviewSession) {
    const previousCardId = reviewSession.queue[0];
    const activeCardIds = new Set(state.cards.filter(card => !card.suspended).map(card => card.id));
    reviewSession.queue = reviewSession.queue.filter(id => activeCardIds.has(id));
    reviewSession.total = reviewSession.completed + reviewSession.queue.length;
    if (reviewSession.queue[0] !== previousCardId) answerVisible = false;
  }
  if (!state.conversations.some(item => item.id === currentConversationId)) currentConversationId = null;
  if (!currentConversationId && state.conversations.length) currentConversationId = state.conversations[0].id;
  isLoaded = true;
}

function stats() { return studyStats(state.cards, state.reviews, Date.now(), { timeZone: state.settings.timeZone, newLimit: state.settings.newCardsPerDay }); }
function dueCards() { return getDueCards(state.cards, { now: Date.now(), newLimit: state.settings.newCardsPerDay, reviews: state.reviews, timeZone: state.settings.timeZone }); }
function conversation() { return state.conversations.find(item => item.id === currentConversationId); }
function dateString(value) { return value ? new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Not reviewed'; }
function safeUrl(value) { try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : ''; } catch { return ''; } }
function sourceHtml(card) { const url = safeUrl(card.sourceUrl); return url ? `<a class="source-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(card.sourceTitle || 'Reference')} ↗</a>` : `<span>${esc(card.sourceTitle || 'Personal study note')}</span>`; }
function cardSourceStatusHtml(card) {
  if (!card.curriculumConditionId && !card.sourceCheckedAt) return '';
  const checkedAt = typeof card.sourceCheckedAt === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(card.sourceCheckedAt) ? card.sourceCheckedAt : '';
  const expiry = card.sourceExpiresAt || card.expiresAt;
  const expiresAt = typeof expiry === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(expiry) ? expiry : '';
  const stale = expiresAt && Date.parse(`${expiresAt}T00:00:00Z`) <= Date.now();
  return `<div class="card-source-status ${stale ? 'stale' : ''}"><strong>${stale ? 'Saved source-check window expired' : card.importedEvidence || card.importedSource ? 'Imported source metadata · not reverified' : 'Saved source-linked study card'}</strong><span>${checkedAt ? `Saved source check ${esc(checkedAt)}` : 'Source-check date unavailable'}${expiresAt ? ` · Check due ${esc(expiresAt)}` : ''} · ${card.humanReview === true ? 'Clinician review recorded' : 'Clinician review pending'}</span><small>Saved cards do not update automatically. Check the current official reference before relying on a learning point.</small>${card.curriculumConditionId ? `<button class="text-button" data-action="curriculum-card-condition" data-id="${esc(card.curriculumConditionId)}">Open current study summary ↗</button>` : ''}</div>`;
}
function domainLabel(value) { return ({acute:'Acute care',chronic:'Chronic care',emergent:'Emergent and urgent care',preventive:'Preventive care',foundations:'Foundations of care'})[value] || value; }

function todayLabel() { return new Date().toLocaleDateString(undefined, { weekday:'long', month:'long', day:'numeric' }); }
function styleLabel() { return 'Conversational study'; }
function focusLabel() { return ({ 'clinical-reasoning': 'Clinical reasoning', exam:'Exam preparation', balanced:'Balanced study' })[state.settings.focus] || 'Clinical reasoning'; }

function renderNav() {
  const count = isLoaded ? dueCards().length : 0;
  const navScreen = screen === 'board' ? 'library' : screen;
  const html = navItems.map(([id, label]) => `<a href="#${id}" class="nav-link ${id === navScreen ? 'active' : ''}" ${id === navScreen ? 'aria-current="page"' : ''}>${icon(id)}<span>${label}</span>${id === 'review' && count ? `<span class="count">${count}</span>` : ''}</a>`).join('');
  $('#desktop-nav').innerHTML = html;
  $('#bottom-nav').innerHTML = html;
  const badge = $('#connection-badge');
  badge.textContent = !navigator.onLine ? 'Offline' : status.privatePilot ? 'Private phone pilot' : status.aiConfigured ? 'Study coach connected' : 'Study questions ready';
  badge.classList.toggle('live', status.aiConfigured && navigator.onLine);
  $('#network-notice').hidden = navigator.onLine;
}

function navigate(next) {
  if (next !== 'board' && !navItems.some(([id]) => id === next)) return;
  if (recording) stopDictation();
  if (next !== 'coach') stopPremiumAudio();
  if (next !== 'coach' && voiceCoach.active()) voiceCoach.stop('Voice stopped when you left Coach. Your microphone is off.');
  if ($('#chat-input')) chatDraft = $('#chat-input').value;
  screen = next;
  if (location.hash !== `#${next}`) history.replaceState(null, '', `#${next}`);
  if (screen === 'review' && !reviewSession) beginReview();
  render();
  if (screen === 'library' && libraryTab === 'guidelines' && !curriculumCatalog && !curriculumLoading) loadCurriculum();
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function render() {
  renderNav();
  if (status.authRequired && !status.authenticated) return renderLogin();
  if (!isLoaded) return;
  $('#main').innerHTML = ({ today: renderToday, coach: renderCoach, review: renderReview, library: renderLibrary, progress: renderProgress, board: renderBoard })[screen]();
  if (screen === 'coach') { scrollChat(); resizeComposer(); updateVoiceCircle(); }
  else { voiceCircle?.destroy(); voiceCircle=null;voiceCircleContainer=null; }
  if (screen === 'board' && !boardCatalog && !boardLoading && !boardError) loadBoard();
  if (screen === 'library' && libraryTab === 'guidelines' && !curriculumCatalog && !curriculumLoading && !curriculumError) loadCurriculum();
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
  return `${studyOnlyNotice()}${pilotNotice()}${pageHead(todayLabel(), 'Small steps. Lasting knowledge.', 'A daily loop for family medicine board exam study.')}
    <section class="hero"><div><span class="eyebrow">YOUR NEXT ${esc(state.settings.dailyMinutes)} MINUTES, MADE INTENTIONAL</span><h2 class="hero-title">Turn what you know into<br>what you can recall.</h2><p>${due ? `${due} cards are ready. Start with recall, then practice one original board-style question.` : 'Your reviews are complete. Strengthen your reasoning with one thoughtful conversation.'}</p><button class="button gold" data-action="${due ? 'start-review' : 'navigate'}" data-screen="coach">${due ? 'Start today’s reviews' : 'Talk with your coach'} ${icon('arrow')}</button></div><div class="hero-number">${due}<span>CARDS READY</span></div></section>
    <div class="metrics">${metric('Your daily rhythm', s.streak, s.streak ? 'Keep the habit growing' : 'Your first review starts it', 'streak', s.streak === 1 ? 'day' : 'days')}${metric('Reviewed today', s.reviewedToday, `Up to ${state.settings.newCardsPerDay} new cards each day`, 'review')}${metric('Recall success', s.recallRate === null ? '—' : `${s.recallRate}%`, s.totalReviews ? 'Self-rated Good or Easy' : 'Appears after your first review', 'target')}</div>
    <div class="today-grid"><section class="card"><div class="section-head"><h2>Your daily study plan</h2><span class="pill gold">${esc(state.settings.dailyMinutes)} min</span></div>
      <div class="daily-step"><span class="step-icon">${icon('review')}</span><div><h3>Recall before you reveal</h3><p>${due} cards ready · ${s.newRemaining} new available</p></div><button class="text-button" data-action="start-review">Review ↗</button></div>
      <div class="daily-step"><span class="step-icon">${icon('target')}</span><div><h3>Practice board-style questions</h3><p>Blueprint-based sessions, feedback and missed-question review</p></div><button class="text-button" data-action="navigate" data-screen="board">Practice ↗</button></div>
      <div class="daily-step"><span class="step-icon">${icon('library')}</span><div><h3>Keep the insight that matters</h3><p>Turn a learning point into a focused recall card</p></div><button class="text-button" data-action="new-card">Add card ↗</button></div>
    </section><section class="card"><div class="section-head"><h2>Worth another look</h2><button class="text-button" data-action="navigate" data-screen="progress">Progress ↗</button></div>
    ${weak.length ? weak.map(item => `<div class="weak-row"><div><strong>${esc(item.topic)}</strong><small>${item.reviews} self-rated reviews</small></div><button class="pill ${item.recallRate < 70 ? 'gold' : 'green'}" data-action="topic-coach" data-topic="${esc(item.topic)}">${Math.round(item.recallRate)}% recall ↗</button></div>`).join('') : `<p class="subtitle" style="font-size:12px;margin:18px 0">Your reviews will reveal the topics that need more practice. Begin with an honest recall rating.</p><div class="focus-strip"><span class="topic-pill">Clinical synthesis</span><span class="topic-pill">Differential diagnosis</span><span class="topic-pill">Next best step</span></div>`}
    </section></div><p class="footer-note">${focusLabel()} · ${styleLabel()} · Study data is saved on your app’s server. Study only; not medical advice or for clinical use.</p>`;
}

function renderCoach() {
  const current = conversation();
  const messages = current?.messages || [];
  const lastAssistant = messages.filter(item => item.role === 'assistant').at(-1);
  return `<div class="chat-page"><div class="chat-header"><div><span class="eyebrow">A SPACE TO THINK OUT LOUD</span><h1>Talk with your study coach</h1><p class="subtitle">${esc(focusLabel())} · ${esc(state.settings.dailyMinutes)} minutes at your pace</p></div><div class="chat-title-tools"><button class="icon-button" data-action="history" aria-label="Open conversation history" title="Conversation history">${icon('history')}</button><button class="icon-button" data-action="new-chat" aria-label="Start a new conversation" title="New conversation">${icon('plus')}</button></div></div>
    ${studyOnlyNotice()}${pilotNotice(true)}${status.mode === 'commercial' && !status.entitlement?.active ? '<div class="notice info" style="margin-bottom:13px">Your study cards are ready. Enable coaching with a verified Google Play subscription.<button class="text-button" data-action="billing">View subscription ↗</button></div>' : ''}
    ${!status.aiConfigured && !status.privatePilot ? '<div class="notice info coach-setup-notice" style="margin-bottom:13px">Source-linked questions and study guidance are ready. Connect OpenAI for context-aware coaching.</div>' : ''}
    <section class="chat-window" aria-label="Coach conversation"><div class="chat-toolbar"><div class="coach-id"><span class="coach-avatar">✦</span><div><strong>${esc(current?.title || 'Study coach')}</strong><small>${status.aiConfigured ? 'AI conversation · Source-linked study' : 'Study guidance · Cited questions'}</small></div></div><span class="chat-mode">${esc(current?.mode === 'simulation' ? 'Fictional study case' : current?.mode === 'practice' ? 'Active recall' : styleLabel())}</span></div>
    <div id="chat-messages" class="chat-messages" role="log" aria-label="Conversation messages" aria-live="polite" aria-relevant="additions">
    ${messages.length ? messages.map(renderMessage).join('') : `<div class="chat-intro"><span class="intro-symbol" aria-hidden="true">✦</span><h1>What’s on your<br>mind today?</h1><p>We can chat first, set a study goal, or work through a family medicine question. Ask follow-ups in your own words. Study explanations include links to their sources.</p><div class="prompt-grid">${[
      ['Just chat a moment', "Hi. I'm not ready to study yet. Can we just chat?"],
      ['Plan my study session', 'I have 20 minutes today. Help me choose a topic and plan a family medicine board study session.'],
      ['Ask me a board-style question', 'Quiz me on hypertension for family medicine board study. Ask one original question and wait for my answer.'],
      ['Work through a learning point', 'I want to study atrial fibrillation. Help me work through the source-linked summary and ask which part I find unclear.'],
    ].map(([label,prompt]) => `<button class="prompt-chip" data-action="starter" data-prompt="${esc(prompt)}">${esc(label)}<span>↗</span></button>`).join('')}</div></div>`}
    ${chatBusy ? `<div class="message assistant"><div class="avatar">✦</div><div class="message-body"><div class="message-label">Preparing and checking your reply</div><div class="typing" role="status" aria-label="Preparing and checking your reply"><i></i><i></i><i></i></div><small class="chat-wait-time">${Math.max(0,(performance.now()-chatStartedAt)/1000).toFixed(0)} s elapsed</small></div></div>` : ''}
    </div><div class="chat-compose">${messages.length ? coachFollowupActionsHtml() : ''}<div id="voice-controls" class="voice-controls">${voiceControlsHtml()}</div>${chatError ? `<div class="notice error" style="margin-bottom:10px">${esc(chatError)} <button class="text-button" data-action="dismiss-chat-error">Dismiss</button></div>` : ''}<form id="chat-form"><div class="compose-row"><label class="screen-reader" for="chat-input">Message your study coach</label><textarea id="chat-input" name="content" rows="1" placeholder="${voiceTextBlocked() ? 'Mute voice to type a message…' : 'Say hello, talk it through, or ask a study question…'}" ${chatBusy || voiceTextBlocked() || !canChat() ? 'disabled' : ''} maxlength="12000">${esc(chatDraft)}</textarea>${voiceDictationSupported() ? `<button type="button" class="icon-button mic-button ${recording ? 'recording' : ''}" data-action="dictate" aria-label="${recording ? 'Stop dictation' : 'Dictate a message'}" title="${recording ? 'Stop dictation' : 'Dictate text; review before sending'}" ${chatBusy || voiceState.active || !canChat() ? 'disabled' : ''}>${icon('mic')}</button>` : ''}<button type="submit" class="icon-button send-button" aria-label="Send message" ${chatBusy || voiceTextBlocked() || !canChat() ? 'disabled' : ''}>${icon('send')}</button></div><div class="composer-note"><span id="voice-status">${recording ? 'Dictating text… tap the mic to stop, then review and send.' : voiceDictationSupported() ? 'Type or dictate text. Review before sending.' : 'Type or use your phone keyboard’s microphone.'}</span><span>Enter to send · Shift + Enter for a new line</span></div></form></div></section>
    <div class="chat-under"><small>Study only. No medical advice or clinical use. Use fictional cases.</small><button class="text-button" data-action="draft-cards" ${!lastAssistant || chatBusy || !canChat() ? 'disabled' : ''}>Create recall cards ↗</button></div></div>`;
}

function coachFollowupActionsHtml() {
  return `<div class="coach-followups" role="group" aria-label="Continue your study conversation">${[
    ['Explain this', 'Explain this.'],
    ['Ask me a question', 'Ask me an original board-style question.'],
    ['Help me plan', 'Help me plan a study session based on my goals and available time. Ask me one question at a time.'],
  ].map(([label,prompt])=>`<button class="button secondary" data-action="coach-followup" data-prompt="${esc(prompt)}" ${chatBusy || voiceTextBlocked() || !canChat() ? 'disabled' : ''}>${label}</button>`).join('')}</div>`;
}

function audioTimingText() {
  if (!premiumState.active) return '';
  const time = value => `${Math.floor(value/60)}:${String(Math.floor(value%60)).padStart(2,'0')}`;
  const part = premiumState.chunkCount ? ` · Part ${premiumState.chunkIndex+1} of ${premiumState.chunkCount}` : '';
  if (premiumState.firstAudioMs === null) return `${(Math.max(0,premiumState.elapsedMs || 0)/1000).toFixed(0)} s ${premiumState.phase==='loading'?'preparing audio':'waiting for playback'}${part}`;
  return `Playback started after ${(premiumState.firstAudioMs/1000).toFixed(1)} s${part}${premiumState.duration ? ` · ${time(premiumState.currentTime || 0)} / ${time(premiumState.duration)}` : ''}`;
}
function replyTimingText() {
  if(!voiceState.active)return '';
  if(voiceState.phase==='thinking')return `${(Math.max(0,voiceState.replyWaitMs || 0)/1000).toFixed(0)} s preparing and checking reply`;
  return premiumState.active&&voiceState.assistantCaption ? `Reply checked in ${(Math.max(0,voiceState.replyWaitMs || 0)/1000).toFixed(1)} s` : '';
}
function updateAudioTiming() {
  for (const item of document.querySelectorAll('.audio-timing')) item.textContent=audioTimingText();
  for (const item of document.querySelectorAll('.reply-timing')) item.textContent=replyTimingText();
}
function premiumAudioControlsHtml() {
  return `${!voiceState.active && premiumState.audioBlocked ? '<button class="button secondary" data-action="premium-resume">Play audio</button>' : ''}${!voiceState.active && premiumState.active ? '<button class="button secondary" data-action="premium-stop">Stop audio</button>' : ''}<p class="premium-audio-status" role="status" aria-live="polite">${esc(premiumState.message)}</p><p class="audio-timing">${esc(audioTimingText())}</p>`;
}
function voiceControlsHtml() {
  const active = voiceState.active, label = COACH_VOICES.find(voice=>voice.id===selectedVoice()).label;
  return `<div class="conversation-voice-panel"><div id="conversation-circle" class="conversation-circle-host"></div><div class="conversation-voice-guidance"><strong>${active ? 'Speak naturally. You can interrupt Coach.' : 'Tap the circle to talk with Coach.'}</strong><span>${active ? voiceState.muted ? 'Microphone muted. Unmute to speak.' : voiceState.inputState === 'unavailable' ? 'Microphone unavailable. Type below, or end voice and try again.' : ['starting','off'].includes(voiceState.inputState) ? 'Microphone is off while the session starts.' : 'Microphone on. Speak when you are ready.' : 'One tap starts a conversation, with source links kept in chat.'}</span></div></div><div class="coach-voice-picker"><div class="form-field">${voiceSelectHtml('coach-voice')}</div><button class="button secondary" data-action="voice-preview" ${active || !premiumVoiceAvailable() ? 'disabled' : ''}>Preview voice</button><span class="pill ai-voice-badge">AI voice · ${label}</span></div><div class="voice-actions">${active ? `<button class="button secondary" data-action="voice-mute" aria-pressed="${voiceState.muted}">${voiceState.muted ? 'Unmute microphone' : 'Mute microphone'}</button><button class="button" data-action="voice-stop">End conversation</button><details class="voice-recovery"><summary>Audio controls</summary><button class="button secondary" data-action="voice-interrupt" ${voiceState.phase === 'starting' ? 'disabled' : ''}>Interrupt audio</button></details>` : ''}${premiumAudioControlsHtml()}</div><p class="reply-timing">${esc(replyTimingText())}</p><details class="voice-details"><summary>Voice, privacy and audio help</summary><p class="audio-output-hint">Hard to hear? Check your phone’s media volume and whether sound is routed to Bluetooth or headphones.</p><p class="voice-note">These five voices are AI-generated by OpenAI. ${voiceSupported() ? 'While unmuted, your microphone captures short turns, including interruptions. Each completed turn is sent through this app’s authenticated server to OpenAI for transcription. Keep this page visible; sessions end after 10 minutes.' : premiumVoiceAvailable() ? 'Hands-free voice needs HTTPS, microphone permission and supported browser audio. Use typing, dictation or Read aloud if unavailable.' : 'AI voice is not configured. Type or use your phone keyboard microphone.'} Only server-authorized replies can be spoken. The app keeps short audio buffers in memory, saves no microphone recordings, and does not use them for model training. OpenAI’s own processing and retention settings apply separately. Check transcription, especially medical terms and numbers. <a href="/privacy.html" target="_blank" rel="noopener noreferrer">Privacy details</a>.</p></details>`;
}
function updateVoiceCircle() {
  const container = $('#conversation-circle');
  if (!container) return;
  if (voiceCircleContainer !== container) {
    voiceCircle?.destroy();
    voiceCircleContainer = container;
    voiceCircle = mountVoiceCircle({ container, agent: { active: () => voiceCoach.active(), state: () => voiceCoach.state(), start: () => startVoice(), stop: () => voiceCoach.stop(), playAudio: () => voiceCoach.playAudio() }, getStartOptions: () => ({ conversationId: currentConversationId }), showComposer: false });
  }
  voiceCircle.update(voiceState);
  voiceCircle.button.disabled = startVoiceBusy || chatBusy || (!voiceState.active && (!voiceSupported() || !canChat()));
  const select = $('#coach-voice'); if (select) select.disabled = voiceState.active || startVoiceBusy;
}
function updateVoiceUI(timingOnly = false) {
  if(timingOnly){updateAudioTiming();updateVoiceCircle();return;}
  const controls = $('#voice-controls');
  if (controls) {
    const focus = controls.contains(document.activeElement) ? { id:document.activeElement.id, action:document.activeElement.dataset?.action, circle:voiceCircle?.element?.contains(document.activeElement) } : null;
    const existingCircle = $('#conversation-circle');
    controls.innerHTML = voiceControlsHtml();
    if (existingCircle && voiceCircleContainer === existingCircle) $('#conversation-circle').replaceWith(existingCircle);
    updateVoiceCircle();
    const target = focus?.circle ? voiceCircle?.button : focus?.id ? document.getElementById(focus.id) : focus?.action ? controls.querySelector(`[data-action="${focus.action}"]`) : null;
    if (target && !target.disabled) target.focus({preventScroll:true});
  }
  const input = $('#chat-input'); if (input) input.disabled = chatBusy || voiceTextBlocked() || !canChat();
  for (const button of document.querySelectorAll('#chat-form button,.chat-study-choices button,.coach-followups button')) button.disabled = chatBusy || voiceTextBlocked() || !canChat() || (button.dataset.action==='dictate' && (premiumState.active || voiceState.active));
  const settingsAudio = $('#settings-audio-controls'); if (settingsAudio) settingsAudio.innerHTML = premiumAudioControlsHtml();
}
async function startVoice() {
  if (chatBusy || startVoiceBusy || voiceCoach.active()) return;
  if (!voiceSupported()) return notify('Hands-free Coach needs configured OpenAI voice, HTTPS and browser microphone audio. Use typing, dictation or Read aloud.');
  if (!canChat()) return subscriptionDialog();
  if (!navigator.onLine) return notify('Reconnect before starting voice.');
  startVoiceBusy = true; updateVoiceUI();
  try {
    stopDictation(); stopPremiumAudio(false); if ('speechSynthesis' in window) speechSynthesis.cancel();
    if ($('#chat-input')) chatDraft = $('#chat-input').value;
    if (!conversation()) await createConversation({ title: 'Voice study conversation' });
    await voiceCoach.start({ conversationId: currentConversationId });
    if (voiceCoach.state().inputState === 'unavailable') await voiceCoach.stop('Microphone unavailable. Type a message below, or check permission and start voice again.', true);
  } catch (error) { await voiceCoach.stop(error.message, true); notify(error.message); }
  finally { startVoiceBusy = false; updateVoiceUI(); }
}

function trustedStudySpeech(message) {
  if(!message || message.sourceVerified!==true || message.importedEvidence || message.voiceTranscript) return false;
  if(message.spokenText!==undefined && (message.canonicalSpokenText!==true || typeof message.spokenText!=='string' || !message.spokenText.trim() || message.spokenText.length>24000)) return false;
  if((message.studyDialogue?.learnerQuotePresent===true || message.studyDialogue?.learnerQuote===true) && (message.canonicalSpokenText!==true || typeof message.spokenText!=='string')) return false;
  if(message.canonicalStudyProcess===true) return true;
  return message.curriculum===true && message.grounded===true && message.current===true && Array.isArray(message.citations) && message.citations.length>0 && message.citations.every(source=>typeof source.expiresAt==='string' && Date.parse(`${source.expiresAt.slice(0,10)}T00:00:00Z`)>Date.now());
}
function reviewedConversationSpeech(message) {
  const review=message?.groundingReview;
  if(!message || message.reviewedDialogue!==true || message.sourceVerified!==false || message.canonicalSpokenText!==false || message.importedEvidence || message.importedReview || message.voiceTranscript || review?.version!==1 || review.status!=='passed') return false;
  if(typeof message.spokenText!=='string' || !message.spokenText.trim() || message.spokenText.length>24000 || !Number.isInteger(review.externalClaimCount) || review.externalClaimCount<0 || !Number.isInteger(review.medicalClaimCount) || review.medicalClaimCount<0 || review.medicalClaimCount>review.externalClaimCount) return false;
  if(review.externalClaimCount===0) return review.medicalClaimCount===0;
  return message.current===true && Array.isArray(review.sourceChunkIds) && review.sourceChunkIds.length>0 && Array.isArray(message.citations) && message.citations.length>0 && message.citations.every(source=>typeof source.expiresAt==='string' && Date.parse(`${source.expiresAt.slice(0,10)}T00:00:00Z`)>Date.now());
}
function readoutMessageAllowed(message) { return !message?.studyRejection && !message?.internalCheck && (reviewedConversationSpeech(message) || trustedStudySpeech(message)); }
function studySpokenText(message) {
  if (!readoutMessageAllowed(message)) return '';
  return typeof message.spokenText === 'string' ? message.spokenText : message.content || '';
}
function renderMessage(message) {
  const role = message.role === 'user' ? 'user' : 'assistant';
  return `<div class="message ${role}" data-message-id="${esc(message.id)}"><div class="avatar">${role === 'user' ? 'YOU' : '✦'}</div><div class="message-body"><div class="message-label">${role === 'user' ? 'You' : 'Study coach'}</div><div class="message-text">${esc(message.content)}</div>${message.voiceTranscript ? '<small class="model-metadata">Voice caption · check transcription; interrupted replies may include unplayed words.</small>' : ''}${role === 'assistant' ? renderStudyQuestionControls(message) + renderAnswerEvidence(message) + renderModelMetadata(message) : ''}${role === 'assistant' ? `<div class="message-actions">${premiumVoiceAvailable() && readoutMessageAllowed(message) ? `<button data-action="read-message" data-id="${esc(message.id)}">Read aloud</button>` : ''}${message.studyAnswer && !message.studyAnswer.imported && trustedStudySpeech(message) ? `<button data-action="chat-study-card" data-id="${esc(message.id)}" ${chatSavedCards.has(message.studyAnswer.key) ? 'disabled' : ''}>${chatSavedCards.has(message.studyAnswer.key) ? 'Added to recall cards' : 'Save sourced recall card'}</button>` : `<button data-action="card-from-message" data-id="${esc(message.id)}">Save as a card</button>`}<button data-action="copy-message" data-id="${esc(message.id)}">Copy</button>${status.mode === 'commercial' ? `<button data-action="report-message" data-id="${esc(message.id)}">Report answer</button>` : ''}</div>` : ''}</div></div>`;
}

function renderStudyQuestionControls(message) {
  const question = message.studyQuestion;
  const messages=conversation()?.messages || [];
  const last=messages.filter(item=>item.role==='assistant').at(-1);
  const pending=last?.pendingStudyQuestion || last?.studyDialogue?.pendingQuestion;
  const stillPending=last?.id===message.id || (readoutMessageAllowed(last) && pending?.key===question?.key && pending?.fingerprint===question?.fingerprint);
  if (!question || question.imported || !trustedStudySpeech(message) || !stillPending) return '';
  const answered = conversation()?.messages?.some(item=>item.studyAnswer?.key === question.key && item.studyAnswer?.fingerprint === question.fingerprint);
  if (answered) return '';
  return `<div class="chat-study-choices" role="group" aria-label="Answer this original board-style question">${['A','B','C','D','E'].map(choice=>`<button class="button secondary" data-action="chat-study-answer" data-id="${esc(message.id)}" data-choice="${choice}" ${chatBusy || voiceTextBlocked() ? 'disabled' : ''}>${choice}</button>`).join('')}</div><small class="curriculum-limits">Choose A–E or type your answer. Feedback comes from the source-linked question bank.</small>`;
}
async function saveChatStudyCard(id) {
  const message = conversation()?.messages?.find(item=>item.id === id);
  const answer = message?.studyAnswer;
  if (!answer || answer.imported || !trustedStudySpeech(message) || chatSavedCards.has(answer.key)) return;
  const [conditionId,questionId] = answer.key.split(':');
  await mutate(`/api/curriculum/${encodeURIComponent(conditionId)}/card`,'POST',{questionId});
  chatSavedCards.add(answer.key); await refreshState(); render(); notify('Sourced recall card added.');
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
  return `<div class="review-layout">${pageHead('DAILY ACTIVE RECALL', 'Recall. Reflect. Repeat.', 'Try your answer before turning the card over.')}<div class="review-topline"><span>${reviewSession.completed + 1} of ${reviewSession.total} cards</span><span>${esc(current.state === 'new' ? 'New learning' : 'Scheduled review')}</span></div><div class="progress-track"><div class="progress-fill" style="width:${reviewSession.total ? reviewSession.completed / reviewSession.total * 100 : 0}%"></div></div><section class="review-card"><div class="section-head"><span class="pill gold">${esc(current.topic)}</span><button class="text-button" data-action="edit-card" data-id="${esc(current.id)}">Edit card ↗</button></div><h2 class="card-question">${esc(current.front)}</h2>${cardSourceStatusHtml(current)}${answerVisible ? `<div class="answer"><span class="answer-label">Compare with your answer</span>${esc(current.back)}</div><div class="source-link">${sourceHtml(current)}${current.verified ? ' · Marked verified by you' : ' · Verify this learning point'}</div>` : `<p class="recall-prompt">Say it out loud, write it down, or form a complete answer in your mind. The effort of retrieving is the useful part.</p><button class="button full reveal-button" data-action="reveal-answer">Reveal answer ${icon('arrow')}</button>`}</section>${answerVisible ? `<div class="ratings" aria-label="Rate your recall">${[['again','Again'],['hard','Hard'],['good','Good'],['easy','Easy']].map(([rating,label]) => `<button class="rating-button ${rating}" data-action="rate-card" data-rating="${rating}" ${reviewBusy ? 'disabled' : ''}>${label}<small>${esc(intervals[rating])}</small></button>`).join('')}</div><p class="rating-help">Again: missed it · Hard: recalled with difficulty<br>Good: correct with effort · Easy: immediate, confident recall</p>` : '<p class="rating-help">On a keyboard, press Space to reveal the answer.</p>'}${current.lapses >= 8 ? '<div class="notice" style="margin-top:18px">This card has repeated lapses. Try splitting it into smaller questions or ask your coach to explain the concept.</div>' : ''}</div>`;
}

function studyOnlyNotice() { return '<div class="notice info study-only-notice"><strong>Board exam study only · No medical advice or clinical use</strong><span>For family medicine board learning and practice. Do not use this app to diagnose, treat, triage, or make decisions for a real patient.</span></div>'; }

function renderLibrary() {
  const tabs = [['guidelines','Guidelines & boards'],['cards','Recall cards'],['cases','Fictional cases'],['practice','Study exercises']];
  return `${pageHead('BUILD YOUR KNOWLEDGE BASE', 'Your learning library.', 'Source-linked guideline summaries, original board practice and spaced repetition.', `<button class="button" data-action="new-card">${icon('plus')} Add card</button>`)}
    ${studyOnlyNotice()}<section class="card board-entry"><div><h2>Family medicine board practice</h2><p>Build a question session, resume your work and review missed learning points.</p></div><button class="button" data-action="navigate" data-screen="board">Start board practice ${icon('arrow')}</button></section><div class="segmented library-tabs" aria-label="Library section">${tabs.map(([id,label])=>`<button data-action="library-tab" data-tab="${id}" class="${libraryTab === id ? 'active' : ''}" aria-pressed="${libraryTab === id}">${label}</button>`).join('')}</div>
    ${libraryTab === 'guidelines' ? renderCurriculum() : libraryTab === 'cards' ? renderCards() : libraryTab === 'cases' ? renderCases() : renderPractice()}`;
}

function resetCurriculumState() {
  curriculumSessionRevision++;curriculumRequest++;curriculumDetailRequest++;clearTimeout(curriculumSearchTimer);curriculumCatalog=null;curriculumCondition=null;curriculumConditionId=null;curriculumLoading=false;curriculumDetailLoading=false;curriculumError='';curriculumDetailError='';curriculumGrading=false;curriculumSavingCard=false;curriculumAnswers.clear();curriculumSavedCards.clear();
}
function curriculumIsVisible() { return screen === 'library' && libraryTab === 'guidelines' && (!status.authRequired || status.authenticated); }
function curriculumSources(sources = [], { compact = false } = {}) {
  return `<ul class="guideline-sources ${compact ? 'compact' : ''}">${sources.map(source=> {
    const url = safeUrl(source.url);
    return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(source.title || source.id || 'Official source')} ↗</a>` : `<strong>${esc(source.title || source.id || 'Official source')}</strong>`}<small>${[source.publisher,source.jurisdiction,source.kind ? ({'clinical-guideline':'Formal guideline','official-recommendation':'Official recommendation','official-clinical-reference':'Official clinical reference'})[source.kind] || source.kind : '',source.edition ? `Edition: ${source.edition}` : '',source.checkedAt ? `Source checked ${String(source.checkedAt).slice(0,10)}` : ''].filter(Boolean).map(esc).join(' · ')}</small>${source.locator ? `<small>Reference section: ${esc(source.locator)}</small>` : ''}${source.limitations ? `<small>Source limitation: ${esc(source.limitations)}</small>` : ''}</li>`;
  }).join('')}</ul>`;
}
function curriculumReviewNotice(item) {
  return `<div class="curriculum-quality"><span class="pill ${item.current === true ? 'green' : item.current === false ? 'red' : ''}">${item.current === true ? 'Within source-check window' : item.current === false ? 'Update needed' : 'Freshness not provided'}</span><span>${item.sourceVerified === true ? 'Official sources checked' : 'Source check needed'} · ${item.humanReview === true ? 'Clinician review recorded' : 'Clinician review pending'}</span>${item.formalGuideline === false ? '<span class="pill">Official reference · Formal guideline not recorded</span>' : item.formalGuideline === true ? '<span class="pill">Formal guideline or official recommendation</span>' : ''}</div><p class="curriculum-limits">These are original educational summaries and questions. A checked source is not a guarantee that every statement is correct or that a guideline remains unchanged.</p>`;
}
function curriculumCatalogCount() { return curriculumLoading ? 'Loading conditions…' : `${curriculumCatalog?.conditions?.length || 0} conditions shown${curriculumCatalog?.total ? ` · ${curriculumCatalog.total} in the library` : ''}${curriculumCatalog?.questionCount ? ` · ${curriculumCatalog.questionCount} original questions in the library` : ''}`; }
function renderCurriculumCatalogResults() {
  if (curriculumLoading) return '<div class="loading-line" role="status"><span class="spinner"></span> Finding study conditions…</div>';
  if (curriculumError) return `<div class="notice error" role="alert">${esc(curriculumError)} <button class="text-button" data-action="curriculum-retry">Try again</button></div>`;
  const conditions = curriculumCatalog?.conditions || [];
  if (!conditions.length) return '<div class="empty-state"><h2>No conditions match.</h2><p>Try another term or clear the filters.</p><button class="button secondary" data-action="curriculum-clear">Clear filters</button></div>';
  return `<div class="condition-grid">${conditions.map(item=>`<article class="condition-card"><span class="pill">${esc(domainLabel(item.domain))}</span><h2>${esc(item.title || item.name)}</h2><p>${esc(item.summary || '')}</p><small>${Number(item.questionCount) || 0} original practice questions · ${item.humanReview === true ? 'Clinician review recorded' : 'Clinician review pending'}</small><button class="button secondary" data-action="curriculum-open" data-id="${esc(item.id)}">Study condition ${icon('arrow')}</button></article>`).join('')}</div>`;
}
function renderCurriculum() {
  if (curriculumConditionId) return renderCurriculumCondition();
  const domains = curriculumCatalog?.domains || [];
  return `<section class="curriculum-intro"><h2>Guidelines & board practice</h2><p>Explore high-yield family medicine conditions using verified official source links and original summaries. Questions practice board-style reasoning; they are not official ABFM questions or endorsed by ABFM.</p></section><div class="library-tools curriculum-tools"><label class="screen-reader" for="condition-search">Search study conditions</label><input id="condition-search" class="search-input" type="search" maxlength="120" value="${esc(curriculumSearch)}" placeholder="Search conditions or aliases…"><label class="screen-reader" for="condition-domain">Filter by study domain</label><select id="condition-domain" class="filter-select"><option value="">All domains</option>${domains.map(domain=>`<option value="${esc(typeof domain === 'string' ? domain : domain.id)}" ${curriculumDomain === (typeof domain === 'string' ? domain : domain.id) ? 'selected' : ''}>${esc(typeof domain === 'string' ? domainLabel(domain) : domain.title || domain.name)}</option>`).join('')}</select><button class="text-button" data-action="curriculum-clear">Clear filters</button></div><div class="library-summary"><span id="condition-count" role="status" aria-live="polite">${curriculumCatalogCount()}</span><span>Study summaries · Source-linked</span></div><div id="condition-results">${renderCurriculumCatalogResults()}</div><p class="footer-note">Official sources are checked monthly. New or changed recommendations need review before teaching content is marked clinician reviewed. Follow each source link for full context, exceptions and the latest publication.</p>`;
}
function updateCurriculumCatalogUI() {
  if (!curriculumIsVisible() || curriculumConditionId) return;
  const results = $('#condition-results');
  if (results) results.innerHTML = renderCurriculumCatalogResults();
  const count = $('#condition-count');
  if (count) count.textContent = curriculumCatalogCount();
  const domains = $('#condition-domain');
  if (domains) domains.innerHTML = '<option value="">All domains</option>' + (curriculumCatalog?.domains || []).map(domain=> {
    const id = typeof domain === 'string' ? domain : domain.id;
    return `<option value="${esc(id)}" ${id === curriculumDomain ? 'selected' : ''}>${esc(typeof domain === 'string' ? domainLabel(domain) : domain.title || domain.name)}</option>`;
  }).join('');
}
async function loadCurriculum() {
  clearTimeout(curriculumSearchTimer);
  const request = ++curriculumRequest;
  curriculumLoading = true; curriculumError = ''; updateCurriculumCatalogUI();
  try {
    const query = new URLSearchParams(); if (curriculumSearch.trim()) query.set('q',curriculumSearch.trim()); if (curriculumDomain) query.set('domain',curriculumDomain);
    const catalog = await api(`/api/curriculum${query.size ? `?${query}` : ''}`);
    if (request !== curriculumRequest) return;
    curriculumCatalog = catalog;
  } catch (error) { if (request === curriculumRequest) curriculumError = error.message; }
  finally { if (request === curriculumRequest) { curriculumLoading = false; updateCurriculumCatalogUI(); } }
}
async function openCurriculumCondition(id) {
  const request = ++curriculumDetailRequest;
  curriculumConditionId = id; curriculumCondition = null; curriculumDetailLoading = true; curriculumDetailError = ''; curriculumQuestionIndex = 0; curriculumChoiceId = null; curriculumGradeError = ''; render();
  window.scrollTo({top:0,behavior:'instant'});
  try { const data = await api(`/api/curriculum/${encodeURIComponent(id)}`); if (request !== curriculumDetailRequest) return; curriculumCondition = data.condition; }
  catch(error) { if (request === curriculumDetailRequest) curriculumDetailError = error.message; }
  finally { if (request === curriculumDetailRequest) { curriculumDetailLoading = false; if (curriculumIsVisible()) render(); } }
}
function curriculumQuestion() { return curriculumCondition?.questions?.[curriculumQuestionIndex]; }
function curriculumQuestionKey() { return `${curriculumConditionId}:${curriculumQuestion()?.id || ''}`; }
function renderCurriculumCondition() {
  const back = '<button class="button secondary condition-back" data-action="curriculum-back">← All conditions</button>';
  if (curriculumDetailLoading) return `${back}<div class="loading-line" role="status"><span class="spinner"></span> Opening source-linked study material…</div>`;
  if (curriculumDetailError || !curriculumCondition) return `${back}<div class="notice error" role="alert">${esc(curriculumDetailError || 'This condition could not be loaded.')} <button class="text-button" data-action="curriculum-detail-retry">Try again</button></div>`;
  const item = curriculumCondition;
  const sources = item.sources || [];
  const objectives = Array.isArray(item.learningObjectives) ? item.learningObjectives : [];
  const redFlags = Array.isArray(item.redFlags) ? item.redFlags : [];
  return `${back}<section class="condition-header"><span class="eyebrow">${esc(domainLabel(item.domain))}</span><h2>${esc(item.title || item.name)}</h2><p>${esc(item.summary || '')}</p>${curriculumReviewNotice(item)}<div class="inline-actions"><button class="button" data-action="curriculum-quiz">Practice board questions ${icon('arrow')}</button><button class="button secondary" data-action="curriculum-coach" data-id="${esc(item.id)}">Study with Coach ${icon('coach')}</button></div></section>${objectives.length ? `<section class="card condition-section"><h3>Learning objectives</h3><ul>${objectives.map(text=>`<li>${esc(text)}</li>`).join('')}</ul></section>` : ''}<div class="condition-sections">${(item.chunks || []).map(chunk=>`<section class="card condition-section"><h3>${esc(chunk.heading || chunk.section || 'Study summary')}</h3><p>${esc(chunk.text || '')}</p>${curriculumSources(sources.filter(source=>chunk.sourceIds?.includes(source.id)),{compact:true})}</section>`).join('')}</div>${redFlags.length ? `<section class="notice condition-red-flags"><strong>Red flags to recognize in exam cases</strong><ul>${redFlags.map(text=>`<li>${esc(text)}</li>`).join('')}</ul></section>` : ''}${renderCurriculumQuestion()}<section class="card condition-section"><h3>Official reference sources</h3>${curriculumSources(sources)}<p class="curriculum-limits">Original paraphrases are provided for study; full guideline text is not reproduced here. Check the current official document for complete recommendations.</p></section>`;
}
function renderCurriculumQuestion() {
  const question = curriculumQuestion();
  if (!question) return '<section class="card condition-section"><h3>Board practice</h3><p>Practice questions are not available for this condition.</p></section>';
  const result = curriculumAnswers.get(curriculumQuestionKey());
  const questions = curriculumCondition.questions;
  const selected = result?.selectedChoiceId || curriculumChoiceId;
  const resultChoices = result?.choices || [];
  const answeredCount = questions.filter(item=>curriculumAnswers.has(`${curriculumConditionId}:${item.id}`)).length;
  return `<section class="card board-question" id="board-question" aria-labelledby="board-question-heading"><span class="eyebrow">ORIGINAL BOARD-STYLE PRACTICE · NOT AN ABFM QUESTION</span><div class="section-head"><h3 id="board-question-heading">Question ${curriculumQuestionIndex + 1} of ${questions.length}</h3><small>${answeredCount} answered</small></div><p class="question-stem">${esc(question.stem)}</p><div class="question-choices" role="group" aria-label="Choose one answer">${(question.choices || []).map((choice,index)=>`<button class="question-choice ${selected === choice.id ? 'selected' : ''} ${result?.correctChoiceId === choice.id ? 'correct' : ''} ${result && selected === choice.id && !result.correct ? 'incorrect' : ''}" data-action="curriculum-choice" data-id="${esc(choice.id)}" aria-pressed="${selected === choice.id}" ${result || curriculumGrading ? 'disabled' : ''}><span class="choice-letter">${String.fromCharCode(65+index)}</span><span>${esc(choice.text)}</span>${result?.correctChoiceId === choice.id ? '<span class="choice-mark">Correct</span>' : ''}</button>`).join('')}</div>${curriculumGradeError ? `<div class="notice error" role="alert">${esc(curriculumGradeError)}</div>` : ''}${result ? `<div class="question-feedback ${result.correct ? 'correct' : 'incorrect'}" role="status"><h4>${result.correct ? 'Correct.' : 'Review this learning point.'}</h4><p>${esc(result.rationale || '')}</p><h4>Why each option fits or does not fit</h4><ul>${resultChoices.map((choice,index)=>`<li><strong>${String.fromCharCode(65+index)}. ${esc(choice.text)}</strong><p>${esc(choice.explanation || '')}</p></li>`).join('')}</ul>${curriculumSources(result.sources || [],{compact:true})}<p class="curriculum-limits">Source-linked educational explanation · ${result.humanReview === true ? 'Clinician review recorded' : 'Clinician review pending'}${result.current === false ? ' · Source-check window expired' : ''}</p></div>` : `<p class="curriculum-limits">Choose the single best answer before revealing the explanation.</p>`}<div class="question-actions">${result ? `<button class="button secondary" data-action="curriculum-card" ${curriculumSavingCard || curriculumSavedCards.has(curriculumQuestionKey()) ? 'disabled' : ''}>${curriculumSavedCards.has(curriculumQuestionKey()) ? 'Added to recall cards' : curriculumSavingCard ? 'Saving recall card…' : 'Save sourced recall card'}</button>` : `<button class="button" data-action="curriculum-answer" ${!curriculumChoiceId || curriculumGrading ? 'disabled' : ''}>${curriculumGrading ? 'Checking answer…' : 'Check answer'}</button>`}<button class="button secondary" data-action="curriculum-next" ${curriculumGrading || curriculumQuestionIndex >= questions.length-1 ? 'disabled' : ''}>${result ? 'Next question' : 'Skip question'} ${icon('arrow')}</button>${curriculumQuestionIndex > 0 ? `<button class="text-button" data-action="curriculum-previous" ${curriculumGrading ? 'disabled' : ''}>← Previous question</button>` : ''}</div><p class="footer-note">Original questions practice clinical reasoning and ABFM blueprint topic areas. They do not predict an exam score and are not affiliated with, endorsed by, or copied from ABFM.</p></section>`;
}
function updateCurriculumQuestionUI({scroll = false} = {}) {
  if (!curriculumIsVisible()) return;
  const container = $('#board-question');
  if (container) container.outerHTML = renderCurriculumQuestion();
  if (scroll) $('#board-question')?.scrollIntoView({block:'start',behavior:'smooth'});
}
async function answerCurriculumQuestion() {
  const question = curriculumQuestion();
  if (!question || !curriculumChoiceId || curriculumGrading || curriculumAnswers.has(curriculumQuestionKey())) return;
  const key = curriculumQuestionKey(), id = curriculumConditionId, choiceId = curriculumChoiceId, revision = curriculumSessionRevision;
  curriculumGrading = true; curriculumGradeError = ''; updateCurriculumQuestionUI();
  try {
    const result = await mutate(`/api/curriculum/${encodeURIComponent(id)}/answer`,'POST',{questionId:question.id,choiceId});
    if (revision === curriculumSessionRevision) curriculumAnswers.set(key,{...result,selectedChoiceId:choiceId});
  } catch(error) { if (revision === curriculumSessionRevision && key === curriculumQuestionKey()) curriculumGradeError = error.message; }
  finally { if (revision === curriculumSessionRevision) {curriculumGrading = false; if (key === curriculumQuestionKey()) updateCurriculumQuestionUI();} }
}
async function saveCurriculumCard() {
  const question = curriculumQuestion(), key = curriculumQuestionKey(), revision = curriculumSessionRevision;
  if (!question || !curriculumAnswers.has(key) || curriculumSavingCard || curriculumSavedCards.has(key)) return;
  curriculumSavingCard = true; updateCurriculumQuestionUI();
  try { const result = await mutate(`/api/curriculum/${encodeURIComponent(curriculumConditionId)}/card`,'POST',{questionId:question.id}); if (revision !== curriculumSessionRevision) return; curriculumSavedCards.add(key); await refreshState(); notify(result.cached ? 'This sourced recall card is already in your library.' : 'Sourced recall card saved for spaced repetition.'); }
  finally { if (revision === curriculumSessionRevision) {curriculumSavingCard = false; if (key === curriculumQuestionKey()) updateCurriculumQuestionUI();} }
}
async function coachCurriculumCondition() {
  if (!curriculumCondition || chatBusy) return;
  const item = curriculumCondition;
  await createConversation({title:`Study: ${item.title || item.name}`,mode:'practice',conditionId:item.id});
  return sendMessage(`Quiz me on ${item.title || item.name} using the app’s source-linked study summaries. Ask one original board-practice question at a time and explain the source-supported learning point after I answer. This is board study only, no medical advice or clinical use.`);
}

function renderCards() {
  const topics = [...new Set(state.cards.map(card => card.topic))].sort();
  const filtered = state.cards.filter(card => (!topicFilter || card.topic === topicFilter) && `${card.front} ${card.back} ${card.topic}`.toLowerCase().includes(searchTerm.toLowerCase()));
  return `<div class="library-tools"><label class="screen-reader" for="card-search">Search recall cards</label><input id="card-search" class="search-input" placeholder="Search your cards…" value="${esc(searchTerm)}" type="search"><label class="screen-reader" for="topic-filter">Filter cards by topic</label><select id="topic-filter" class="filter-select"><option value="">All topics</option>${topics.map(topic => `<option value="${esc(topic)}" ${topic === topicFilter ? 'selected' : ''}>${esc(topic)}</option>`).join('')}</select></div><div class="library-summary"><span>${filtered.length} cards · ${state.cards.filter(card => card.suspended).length} suspended</span><button class="text-button" data-action="import-cards">Import cards ↗</button></div><div id="card-results">${renderCardResults(filtered)}</div><p class="footer-note">Starter cards are educational summaries. References help you check details; your verified flag records your own review. Edit cards as guidance changes.</p>`;
}

function renderCardResults(cards) {
  return cards.length ? `<div class="card-list">${cards.map(card => `<article class="library-card ${card.suspended ? 'suspended' : ''}"><div class="card-info"><div class="card-meta"><span class="pill">${esc(card.topic)}</span>${card.suspended ? '<span>Suspended</span>' : `<span>${card.state === 'new' ? 'New' : `Due ${dateString(card.dueAt)}`}</span>`}${card.lapses >= 8 ? '<span class="pill red">Consider rewriting</span>' : ''}</div><span class="card-front">${esc(card.front)}</span><details><summary class="text-button" style="padding-left:0;display:list-item;width:fit-content">Answer & reference</summary><p class="card-back">${esc(card.back)}</p><div class="card-meta">${sourceHtml(card)}<span>${card.verified ? 'Verified by you' : 'Verification recommended'}</span></div></details>${cardSourceStatusHtml(card)}</div><div class="card-actions"><button class="icon-button" data-action="edit-card" data-id="${esc(card.id)}" aria-label="Edit card">${icon('edit')}</button><button class="icon-button" data-action="suspend-card" data-id="${esc(card.id)}" aria-label="${card.suspended ? 'Resume' : 'Suspend'} card" title="${card.suspended ? 'Resume' : 'Suspend'} card">${icon(card.suspended ? 'play' : 'pause')}</button><button class="icon-button" data-action="delete-card" data-id="${esc(card.id)}" aria-label="Delete card">${icon('trash')}</button></div></article>`).join('')}</div>` : `<div class="empty-state"><h2>${state.cards.length ? 'No cards match yet.' : 'Keep one useful insight.'}</h2><p>${state.cards.length ? 'Try a broader search or choose another topic.' : 'A good card asks one clear question and gives one focused answer.'}</p><button class="button secondary" data-action="new-card">Create a recall card</button></div>`;
}

function resetBoardState() {
  boardRequest++; boardCatalog=null;boardHistory=[];boardActiveSummary=null;boardActiveError=null;boardSession=null;boardResults=null;boardLoading=false;boardBusy=false;boardError='';boardChoiceId=null;boardSavedCards.clear();chatSavedCards.clear();
}
function boardDomains() {
  return (boardCatalog?.domains || boardCatalog?.blueprint || ABFM_BLUEPRINT).map(item=>({ ...ABFM_BLUEPRINT.find(domain=>domain.id === (item.id || item.domain)),...item,id:item.id || item.domain,title:item.title || item.name || domainLabel(item.id || item.domain) }));
}
function boardDomainTitle(id) { return boardDomains().find(item=>item.id === id)?.title || domainLabel(id); }
function boardSessionId(item = boardSession) { return item?.sessionId || item?.id; }
function boardAvailableSizes() { return boardCatalog?.availableSizes || [10,20,40,80,100]; }
function boardSizeAvailable(count) {
  const sizes=boardAvailableSizes();
  if(boardMode !== 'mixed') return true;
  return sizes.some(item=>typeof item === 'number' ? item === count : (item.count || item.size) === count && item.available !== false);
}
function boardTimeLeft() {
  if (!boardSession?.timed) return null;
  const started=typeof boardSession.createdAt==='number'?boardSession.createdAt:Date.parse(boardSession.createdAt);
  const deadline=boardSession.deadlineAt || (Number.isFinite(started) && boardSession.timeLimitSeconds ? started + boardSession.timeLimitSeconds*1000 : null);
  if(deadline) return Math.max(0,Math.ceil((typeof deadline === 'number' ? deadline : Date.parse(deadline)) / 1000 - Date.now()/1000));
  return Number.isFinite(boardSession.remainingSeconds) ? Math.max(0,boardSession.remainingSeconds) : null;
}
function boardClock(seconds) { return `${Math.floor(seconds/60)}:${String(Math.floor(seconds%60)).padStart(2,'0')}`; }
function boardFeedbackHtml(feedback) {
  if (!feedback) return '';
  return `<div class="question-feedback ${feedback.correct ? 'correct' : 'incorrect'}" role="status"><h3>${feedback.correct ? 'Correct.' : 'Review this learning point.'}</h3><p>${esc(feedback.rationale || feedback.explanation || '')}</p><details class="board-option-explanations"><summary>Review all answer explanations</summary><ul>${(feedback.choices || []).map(choice=>`<li><strong>${esc(choice.id)}. ${esc(choice.text)}</strong><p>${esc(choice.explanation || '')}</p></li>`).join('')}</ul></details>${curriculumSources(feedback.sources || [],{compact:true})}<p class="curriculum-limits">Source-linked original educational explanation · Source checked ${esc(feedback.checkedAt || 'date unavailable')} · Check due ${esc(feedback.expiresAt || 'date unavailable')}. Clinician review pending; not medical advice or for clinical use.</p></div>`;
}
function renderBoard() {
  let body;
  if(boardLoading && !boardCatalog) body='<div class="loading-line" role="status"><span class="spinner"></span> Opening board practice…</div>';
  else if(boardResults) body=renderBoardResults();
  else if(boardSession?.question) body=renderBoardSession();
  else body=renderBoardSetup();
  return `<div class="board-page">${pageHead('FAMILY MEDICINE BOARD EXAM STUDY','Board practice.','Original questions, sourced explanations and a study loop you can repeat.','<button class="button secondary" data-action="navigate" data-screen="library">← Library</button>')}${studyOnlyNotice()}${boardError ? `<div class="notice error" role="alert">${esc(boardError)}<button class="text-button" data-action="board-dismiss-error">Dismiss</button>${!boardCatalog ? '<button class="text-button" data-action="board-retry">Try again</button>' : ''}</div>` : ''}${boardActiveError?`<div class="notice" role="status">${esc(boardActiveError.error || 'The saved session needs current source checks.')} Start a replacement study session with current questions below.</div>`:''}${body}<p class="footer-note">Original practice, not an official ABFM examination. This question bank supports study but does not cover every exam objective or predict a passing score. Source-linked summaries and automated checks are not clinician review.</p></div>`;
}
function renderBoardSetup() {
  const domains=boardDomains();
  return `${boardActiveSummary?`<section class="notice info board-resume-notice"><div><strong>Unfinished study session</strong><span>${boardActiveSummary.answeredCount || 0} of ${boardActiveSummary.count || 0} answered${boardActiveSummary.timed?' · Practice timer continues':''}</span></div><button class="button secondary" data-action="board-resume" data-id="${esc(boardSessionId(boardActiveSummary))}">Resume session</button></section>`:''}<section class="card board-setup"><h2>Build a study session</h2><p class="subtitle">Mixed sessions use the current ABFM content blueprint with rounded question counts. A focused domain session or missed-question drill follows your own study needs.</p><form id="board-start-form"><div class="form-row"><div class="form-field"><label for="board-mode">Session type</label><select id="board-mode" name="mode"><option value="mixed" ${boardMode==='mixed'?'selected':''}>Blueprint-based mixed practice</option><option value="domain" ${boardMode==='domain'?'selected':''}>Focus on one domain</option><option value="missed" ${boardMode==='missed'?'selected':''}>Previously missed questions</option></select></div><div class="form-field"><label for="board-count">Questions</label><select id="board-count" name="count">${[10,20,40,80,100].map(count=>`<option value="${count}" ${boardCount===count?'selected':''} ${boardSizeAvailable(count)?'':'disabled'}>${count}${boardSizeAvailable(count)?'':' · needs more current questions'}</option>`).join('')}</select></div></div>${boardMode==='domain'?`<div class="form-field"><label for="board-domain">Study domain</label><select id="board-domain" name="domain" required>${domains.map(domain=>`<option value="${esc(domain.id)}" ${boardDomain===domain.id?'selected':''}>${esc(domain.title)}${Number.isFinite(domain.questionCount || domain.available) ? ` · ${domain.questionCount || domain.available} questions` : ''}</option>`).join('')}</select></div>`:''}<div class="form-field"><label for="board-feedback">Explanation timing</label><select id="board-feedback" name="feedback"><option value="immediate" ${boardFeedback==='immediate'?'selected':''}>After each answer</option><option value="end" ${boardFeedback==='end'?'selected':''}>At the end of the session</option></select></div><label class="check-field"><input id="board-timed" name="timed" type="checkbox" ${boardTimed?'checked':''}>Use a practice timer</label>${boardTimed?`<div class="form-field"><label for="board-minutes">Practice time limit in minutes</label><input id="board-minutes" name="minutes" type="number" min="1" max="240" value="${boardMinutes}" required><small>Your own practice setting, not official ABFM examination timing. The timer continues if you leave this page.</small></div>`:'<p class="curriculum-limits">Untimed by default. Pause and return when your schedule allows.</p>'}<button class="button full" type="submit" ${boardBusy || !boardCatalog?'disabled':''}>${boardBusy?'Starting session…':boardActiveSummary || boardActiveError?'Replace unfinished session':'Start original board practice'}</button>${boardActiveSummary || boardActiveError?'<p class="curriculum-limits">Starting a replacement discards the unfinished session. Completed session history is kept.</p>':''}</form></section><section class="card board-blueprint"><h2>Question bank and content blueprint</h2><div class="board-domain-grid">${domains.map(domain=>`<div><strong>${esc(domain.title)}</strong><span>${esc(domain.percent ?? domain.weight ?? '')}% of mixed practice${Number.isFinite(domain.questionCount ?? domain.available) ? ` · ${domain.questionCount ?? domain.available} current questions` : ''}</span></div>`).join('')}</div><p class="curriculum-limits">Bank size and source coverage differ by domain. A session that needs unavailable or expired questions is blocked, rather than silently changing the requested blueprint mix. A small study bank may repeat questions across sessions.</p></section>${boardHistory.length?`<section class="card board-history"><h2>Your study sessions</h2>${boardHistory.slice(0,12).map(item=>`<div class="weak-row"><div><strong>${esc(item.mode==='mixed'?'Mixed board practice':item.mode==='missed'?'Missed-question drill':boardDomainTitle(item.domain))}</strong><small>${Number(item.count || item.total)||0} questions · ${item.trusted===false?'Imported summary · not reverified':esc(item.status || 'saved')} · ${esc(dateString(item.updatedAt || item.startedAt || item.createdAt))}</small></div>${item.trusted===false?'<span class="pill">Historical summary only</span>':`<button class="button secondary" data-action="board-resume" data-id="${esc(boardSessionId(item))}">${['completed','expired'].includes(item.status)?'Review results':'Resume'}</button>`}</div>`).join('')}</section>`:''}`;
}
function renderBoardSession() {
  const item=boardSession,q=item.question,selected=item.selectedChoiceId || boardChoiceId;
  const graded=Boolean(item.selectedChoiceId),left=boardTimeLeft(),expired=left===0;
  const feedback=item.feedback;
  return `<section class="card board-session" aria-labelledby="board-session-heading" data-time-expired="${expired}"><div class="review-topline"><span>Question ${(item.position || 0)+1} of ${item.count}</span><span>${item.answeredCount || 0} answered${left===null?'':` · <strong id="board-clock" role="timer">${boardClock(left)}</strong>`}</span></div><div class="progress-track"><div class="progress-fill" style="width:${item.count?(item.answeredCount || 0)/item.count*100:0}%"></div></div><span class="eyebrow">ORIGINAL QUESTION · ${esc(boardDomainTitle(q.domain))}</span><h2 id="board-session-heading">${esc(q.conditionTitle || 'Family medicine study')}</h2><p class="question-stem">${esc(q.stem)}</p><div class="question-choices" role="group" aria-label="Choose one answer">${(q.choices || []).map(choice=>`<button class="question-choice ${selected===choice.id?'selected':''} ${feedback?.correctChoiceId===choice.id?'correct':''} ${feedback && selected===choice.id && !feedback.correct?'incorrect':''}" data-action="board-choice" data-id="${esc(choice.id)}" aria-pressed="${selected===choice.id}" ${graded || boardBusy || expired?'disabled':''}><span class="choice-letter">${esc(choice.id)}</span><span>${esc(choice.text)}</span>${feedback?.correctChoiceId===choice.id?'<span class="choice-mark">Correct</span>':''}</button>`).join('')}</div>${expired?'<div class="notice" role="status">Practice time is up. Finish to review the questions and explanations.</div>':graded&&!feedback?'<div class="notice info" role="status">Answer saved. Explanations will appear when you finish this practice session.</div>':''}${boardFeedbackHtml(feedback)}<div class="question-actions">${!graded?`<button class="button" data-action="board-answer" ${!boardChoiceId || boardBusy || expired?'disabled':''}>${boardBusy?'Saving answer…':'Submit answer'}</button>`:feedback?`<button class="button secondary" data-action="board-save-card" data-key="${esc(q.key)}" ${boardCardBusy || boardSavedCards.has(q.key)?'disabled':''}>${boardSavedCards.has(q.key)?'Added to recall cards':'Save sourced recall card'}</button>`:''}${item.position>0?`<button class="button secondary" data-action="board-position" data-index="${item.position-1}" ${boardBusy?'disabled':''}>← Previous</button>`:''}${item.position<item.count-1?`<button class="button secondary" data-action="board-position" data-index="${item.position+1}" ${boardBusy?'disabled':''}>${graded?'Next question':'Skip for now'} ${icon('arrow')}</button>`:''}<button class="button ${graded&&item.position===item.count-1?'':'secondary'}" data-action="board-finish" ${boardBusy?'disabled':''}>Finish & review</button><button class="text-button" data-action="board-home" ${boardBusy?'disabled':''}>Save & leave session</button></div><p class="curriculum-limits">Answers save on the server. Source check ${esc(q.checkedAt || 'date unavailable')} · Check due ${esc(q.expiresAt || 'date unavailable')}. Educational practice only.</p></section>`;
}
function renderBoardResults() {
  const result=boardResults,questions=result.questions || [],missed=questions.filter(item=>!item.feedback?.correct);
  const domains=result.domainResults || [];
  return `<section class="card board-result-summary"><span class="eyebrow">YOUR STUDY SESSION RESULTS</span><h2>${result.correct || 0} correct of ${result.total || result.count || questions.length} questions</h2><p>${result.answered || 0} answered · ${result.skipped || 0} unanswered${Number.isFinite(result.accuracy)?` · ${Math.round(result.accuracy)}% of answered questions`:''}</p><p class="curriculum-limits">This describes your answers in this original study bank. It is not an official score, a clinical assessment or a prediction of passing ABFM.</p><div class="inline-actions"><button class="button" data-action="board-home">Build another session</button><button class="button secondary" data-action="board-missed">Practice previously missed questions</button></div></section><section class="card"><h2>Study performance by domain</h2><div class="board-domain-results">${domains.map(domain=>`<div class="weak-row"><div><strong>${esc(boardDomainTitle(domain.domain || domain.id))}</strong><small>${domain.correct || 0} correct of ${domain.total || domain.answered || 0} questions${Number.isFinite(domain.accuracy)?` · ${Math.round(domain.accuracy)}% of answered`:''}</small></div><button class="button secondary" data-action="board-focus" data-domain="${esc(domain.domain || domain.id)}">Practice domain</button></div>`).join('')}</div></section><section class="board-result-review"><h2>Review missed or unanswered learning points (${missed.length})</h2>${missed.length?'':'<div class="notice info">You answered every question correctly in this session. Continue spaced recall and use other study resources to cover objectives outside this bank.</div>'}${questions.map((q,index)=>`<details class="card board-result-question" ${!q.feedback?.correct?'open':''}><summary><span class="pill ${q.feedback?.correct?'green':'gold'}">${q.selectedChoiceId?q.feedback?.correct?'Correct':'Missed':'Unanswered'}</span> ${index+1}. ${esc(q.conditionTitle || boardDomainTitle(q.domain))}</summary><p class="question-stem">${esc(q.stem)}</p><ol class="board-result-choices" type="A">${(q.choices || []).map(choice=>`<li>${esc(choice.text)}${q.selectedChoiceId===choice.id?' · Your answer':''}${q.feedback?.correctChoiceId===choice.id?' · Correct answer':''}</li>`).join('')}</ol>${boardFeedbackHtml(q.feedback)}<button class="button secondary" data-action="board-save-card" data-key="${esc(q.key)}" ${boardCardBusy || boardSavedCards.has(q.key)?'disabled':''}>${boardSavedCards.has(q.key)?'Added to recall cards':'Save sourced recall card'}</button></details>`).join('')}</section>`;
}
function applyBoardResponse(data) {
  const view=data.view || data.active || data;
  if(view.questions || ['completed','expired'].includes(view.status) && !view.question){boardResults=view;boardSession=null;boardActiveSummary=null;}
  else {boardSession=view;boardResults=null;boardActiveSummary=view;}
  boardChoiceId=null;boardError='';boardActiveError=null;
}
async function loadBoard() {
  const request=++boardRequest;boardLoading=true;boardError='';if(screen==='board')render();
  try{const data=await api('/api/board-practice');if(request!==boardRequest)return;boardCatalog=data.catalog;boardHistory=data.history || [];boardActiveSummary=data.active || null;boardActiveError=data.activeError || null;}
  catch(error){if(request===boardRequest)boardError=error.message;}
  finally{if(request===boardRequest){boardLoading=false;if(screen==='board')render();}}
}
async function startBoardSession(form) {
  if(boardBusy)return;const data=new FormData(form);boardCount=Number(data.get('count'));boardMode=data.get('mode');boardDomain=data.get('domain') || boardDomain;boardTimed=data.get('timed')==='on';boardMinutes=Number(data.get('minutes') || boardMinutes);boardFeedback=data.get('feedback');
  boardBusy=true;boardError='';render();const request=boardRequest;
  try{const result=await mutate(`/api/board-practice/${boardActiveSummary || boardActiveError?'restart':'start'}`,'POST',{count:boardCount,mode:boardMode,...(boardMode==='domain'?{domain:boardDomain}:{}),timed:boardTimed,...(boardTimed?{timeLimitSeconds:boardMinutes*60}:{}),feedback:boardFeedback});if(request!==boardRequest)return;applyBoardResponse(result);}
  catch(error){if(request===boardRequest)boardError=error.details?.code==='INSUFFICIENT_COVERAGE' ? `${error.message} ${error.details.gaps?.map(gap=>`${boardDomainTitle(gap.domain)}: ${gap.available} available, ${gap.required} needed`).join('; ') || ''}` : error.message;}
  finally{if(request===boardRequest){boardBusy=false;render();window.scrollTo({top:0,behavior:'instant'});}}
}
async function openBoardSession(id,index) {
  if(boardBusy)return;boardBusy=true;boardError='';if(screen==='board')render();const request=boardRequest;
  try{const result=await api(`/api/board-practice/${encodeURIComponent(id)}${Number.isInteger(index)?`?index=${index}`:''}`);if(request!==boardRequest)return;applyBoardResponse(result);}
  catch(error){if(request===boardRequest)boardError=error.message;}
  finally{if(request===boardRequest){boardBusy=false;if(screen==='board')render();}}
}
async function answerBoardSession() {
  if(!boardChoiceId || boardBusy || !boardSession?.question)return;const id=boardSessionId(),key=boardSession.question.key,choiceId=boardChoiceId,request=boardRequest;
  boardBusy=true;boardError='';render();
  try{const result=await mutate(`/api/board-practice/${encodeURIComponent(id)}/answer`,'POST',{questionKey:key,choiceId});if(request!==boardRequest)return;applyBoardResponse(result);}
  catch(error){if(request===boardRequest)boardError=error.message;}
  finally{if(request===boardRequest){boardBusy=false;render();}}
}
function finishBoardPrompt() {
  if(!boardSession || boardBusy)return;
  const remaining=boardSession.count-(boardSession.answeredCount || 0);
  if(remaining>0 && boardTimeLeft()!==0) return dialog('Finish this study session?',`${remaining} question${remaining===1?' is':'s are'} unanswered. You can review all explanations after finishing.`, '<p class="subtitle">Unanswered questions are recorded as skipped. You can start a new missed-question drill afterward.</p>','<button class="button secondary" data-action="close-dialog">Keep practicing</button><button class="button" data-action="board-confirm-finish">Finish & review</button>');
  return finishBoardSession();
}
async function finishBoardSession() {
  if(!boardSession || boardBusy)return;const id=boardSessionId(),request=boardRequest;$('#app-dialog').close();boardBusy=true;boardError='';render();
  try{const result=await mutate(`/api/board-practice/${encodeURIComponent(id)}/finish`,'POST',{});if(request!==boardRequest)return;applyBoardResponse(result);}
  catch(error){if(request===boardRequest)boardError=error.message;}
  finally{if(request===boardRequest){boardBusy=false;render();window.scrollTo({top:0,behavior:'instant'});}}
}
async function saveBoardCard(key) {
  if(boardCardBusy || boardSavedCards.has(key))return;
  const [conditionId,questionId]=key.split(':');boardCardBusy=key;render();const request=boardRequest;
  try{await mutate(`/api/curriculum/${encodeURIComponent(conditionId)}/card`,'POST',{questionId});if(request!==boardRequest)return;boardSavedCards.add(key);await refreshState();notify('Sourced recall card added to spaced review.');}
  catch(error){if(request===boardRequest)boardError=error.message;}
  finally{if(request===boardRequest){boardCardBusy='';render();}}
}
setInterval(()=>{if(screen!=='board' || !boardSession?.question)return;const clock=$('#board-clock'),left=boardTimeLeft();if(clock && left!==null){clock.textContent=boardClock(left);if(left===0 && $('.board-session')?.dataset.timeExpired!=='true')render();}},1000);

function renderCases() {
  return `<div class="notice info" style="margin-bottom:20px">These fictional prompts are optional study reflection worksheets. Use current Library or Board practice questions for sourced facts and graded answers. Written reasoning and clinical competence are not assessed.</div><div class="scenario-grid">${SCENARIOS.map(scenario => `<article class="scenario-card"><div class="scenario-top"><span class="pill gold">${esc(scenario.category)}</span><span class="pill">${esc(scenario.difficulty)}</span></div><h3>${esc(scenario.title)}</h3><p>${esc(scenario.description)}</p><div class="scenario-bottom"><small>${esc(scenario.estimatedMinutes || 10)} minute practice</small><button class="button secondary" data-action="start-case" data-id="${esc(scenario.id)}">Open study instructions ${icon('arrow')}</button></div></article>`).join('')}</div>`;
}

function renderPractice() {
  return `<section class="practice-card"><span class="eyebrow">MAKE YOUR THINKING VISIBLE</span><h2>Use a structured study worksheet.</h2><p>These optional exercises provide scripted study instructions. For graded answers, choose a source-linked question in Library or Board practice. Your written reasoning is not graded.</p><div class="practice-options">${[
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
    <div class="section-head" style="margin-top:30px"><h2>Reflect on your study</h2><span class="pill">Self-assessment</span></div><div class="notice info">These six broad competency areas are prompts for reflection. Your personal confidence ratings are educational and are not ACGME milestone levels, board readiness, or an official clinical assessment.</div>
    <div class="competency-list">${COMPETENCIES.map(item => `<section class="competency-card"><div class="competency-top"><span class="competency-abbr">${esc(item.abbr)}</span><h3>${esc(item.name)}</h3></div><p>${esc(item.description)}</p><label class="confidence-label" for="confidence-${esc(item.id)}">My confidence explaining this study topic</label><select id="confidence-${esc(item.id)}" class="confidence-select" data-competency="${esc(item.id)}"><option value="">Choose your confidence</option>${[[1,'Starting to explore'],[2,'I need frequent support'],[3,'I can explain with support'],[4,'I can explain consistently'],[5,'I can teach my reasoning']].map(([value,label]) => `<option value="${value}" ${Number(state.settings.competencyRatings?.[item.id]) === value ? 'selected' : ''}>${esc(label)}</option>`).join('')}</select><button class="text-button" style="padding-left:0" data-action="starter" data-prompt="Help me practice ${esc(item.name.toLowerCase())} through a fictional family medicine scenario. Ask me one question at a time, then provide specific educational feedback.">Open study instructions ↗</button></section>`).join('')}</div>
    <p class="footer-note">${s.leeches ? `${s.leeches} card${s.leeches === 1 ? '' : 's'} has repeated lapses. Rewrite these into smaller, clearer questions. ` : ''}Scheduling supports practice; it cannot guarantee durable learning or a passing board score.</p>`;
}

function dialog(title, subtitle, body, footer = '') {
  dialogRevision++;
  $('#dialog-content').innerHTML = `<div class="dialog-head"><div><h2 id="dialog-title">${esc(title)}</h2><p>${esc(subtitle)}</p></div><button class="icon-button" data-action="close-dialog" aria-label="Close dialog">${icon('close')}</button></div><div class="dialog-body">${body}</div>${footer ? `<div class="dialog-footer">${footer}</div>` : ''}`;
  if (!$('#app-dialog').open) $('#app-dialog').showModal();
}
function closeDialog() { if (formBusy) return; $('#app-dialog').close(); }

function settingsDialog() {
  const s = state.settings;
  dialog('A study rhythm that fits.', 'Save your study goals and daily learning load.', `<form id="settings-form"><div class="form-field"><label for="study-focus">Saved study goal</label><select id="study-focus" name="focus">${[['clinical-reasoning','Clinical reasoning & synthesis'],['exam','Exam preparation'],['balanced','Balanced learning']].map(([value,label]) => `<option value="${value}" ${s.focus === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><div class="form-field"><label for="coach-style">Saved study approach</label><select id="coach-style" name="coachStyle">${[['socratic','Question-first study goal'],['teach-quiz','Read, then practice goal'],['direct','Reference-first study goal']].map(([value,label]) => `<option value="${value}" ${s.coachStyle === value ? 'selected' : ''}>${label}</option>`).join('')}</select></div><p class="curriculum-limits">These preferences guide the study conversation and daily learning load. Medical teaching stays tied to cited summaries. Answer choices are checked against the original question bank; free-text reasoning is discussed, not scored as clinical competence.</p><div class="form-field coach-voice-preference">${voiceSelectHtml('settings-voice', s.voiceId || DEFAULT_COACH_VOICE)}<small>These five Coach voices are AI-generated by OpenAI. Your choice applies to Talk with Coach and Read aloud.</small><button type="button" class="button secondary" data-action="voice-preview" ${!premiumVoiceAvailable() ? 'disabled' : ''}>Preview voice</button><div id="settings-audio-controls">${premiumAudioControlsHtml()}</div></div><div class="form-row"><div class="form-field"><label for="daily-minutes">Minutes per day</label><input id="daily-minutes" name="dailyMinutes" type="number" min="5" max="120" required value="${s.dailyMinutes}"></div><div class="form-field"><label for="new-limit">New cards per day</label><input id="new-limit" name="newCardsPerDay" type="number" min="0" max="50" required value="${s.newCardsPerDay}"></div></div><div class="form-field"><label for="study-timezone">Study timezone</label><input id="study-timezone" name="timeZone" value="${esc(s.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone)}" required><small>Used for daily limits and streaks. Example: America/New_York.</small></div><div class="notice info">${status.aiConfigured ? `Study coaching is configured with ${esc(status.provider || 'your selected provider')}${status.model ? ` (${esc(status.model)})` : ''}. ${status.mode === 'commercial' ? 'Answer sources and review dates appear when available.' : 'The coach uses conversation context to guide your study; cited learning points remain source-linked. Provider access is managed by the app owner.'}` : status.mode === 'commercial' ? 'AI coaching is being prepared by the app owner. Cards and reviews are available while the app is tested.' : 'Source-linked questions and study guidance are available now. Connecting OpenAI enables context-aware coaching around the cited learning material.'}</div><div id="settings-error" class="form-error" role="alert"></div></form>${status.modelSelectionEnabled ? modelSettingsHtml() : ''}<div class="form-section"><h3>Take your learning with you</h3><div class="inline-actions"><button class="button secondary" data-action="export">Export backup</button><button class="button secondary" data-action="import-backup">Restore backup</button></div><p class="footer-note" style="margin-bottom:0">Backups include your cards, review history, conversations, preferences and practice history. Keep the file private.</p></div><div class="form-section"><h3>Use it from your phone</h3><p class="subtitle" style="font-size:12px">Open your hosted app’s HTTPS address. On Android, choose “Install app” or “Add to Home screen” in your browser menu. On iPhone, open Safari, tap Share, then “Add to Home Screen”.</p><p class="footer-note" style="margin:0">Talk with Coach uses your selected AI voice for the checked conversation, then listens for your next turn. The microphone stays off during audio generation and playback. Source links stay visible. Use Interrupt readout, Mute or Stop; hiding the app stops recognition and audio. Browser speech recognition support varies. Use your phone keyboard microphone and AI Read aloud if unavailable. The composer mic dictates text for review before sending. Chat and saved progress require a connection.</p></div>${status.mode === 'commercial' ? commercialSettings() : ''}${status.authRequired ? '<div class="form-section"><button class="button secondary" data-action="logout">Lock study space</button></div>' : ''}`, '<button class="button secondary" data-action="close-dialog">Cancel</button><button type="submit" form="settings-form" class="button">Save preferences</button>');
}

function modelSettingsHtml() {
  return `<div class="form-section"><h3>Your OpenAI model</h3><p class="subtitle model-id">${esc(status.model || 'OpenAI is not connected yet')}</p>${status.modelWarning ? `<div class="notice error">${esc(status.modelWarning)}</div>` : ''}<button class="button secondary" data-action="models">Choose or test a model</button><p class="footer-note">Owner controls only. Astra is prohibited. Model checks do not validate clinical accuracy.</p></div>`;
}
function modelProfileHtml(id) {
  const model=availableModels.find(item=>item.id===id);
  if(!model) return '<p class="footer-note">No supported account models are available.</p>';
  return `<p class="footer-note">${model.rates ? `Standard price per million tokens: $${esc(model.rates.inputUsdPerMillion)} input / $${esc(model.rates.outputUsdPerMillion)} output. Cache discounts are excluded from estimates.` : 'The verified price for this snapshot is unavailable; cost will be shown as unknown.'} ${model.api==='responses' ? 'This Pro model uses Responses and may take up to three minutes. A capped answer can be incomplete.' : 'This model uses text Chat Completions.'}${model.shutdownDate ? ` Announced shutdown: ${esc(new Date(model.shutdownDate).toLocaleDateString())}.` : ''}</p>`;
}
function modelTestHtml() {
  if(!lastModelTest || lastModelTest.requestedModel!==status.model) return '';
  return `<div class="notice info model-test-result"><strong>${lastModelTest.cached ? 'Saved connection result' : 'Connection result'}: ${lastModelTest.connectionPassed ? 'connected' : 'unconfirmed'}</strong><p>${lastModelTest.instructionPassed ? 'The model returned the expected READY response.' : 'The model responded, but did not follow the expected READY instruction.'}</p><p>${esc(lastModelTest.returnedModel || lastModelTest.requestedModel)} · ${Number(lastModelTest.latencyMs/1000).toFixed(2)} s · ${lastModelTest.estimatedCostUsd===null ? 'Cost unknown' : `Estimated $${Number(lastModelTest.estimatedCostUsd).toFixed(6)}`}</p><small>${esc(lastModelTest.usage?.prompt_tokens ?? '?')} input / ${esc(lastModelTest.usage?.completion_tokens ?? '?')} billed output tokens. Clinical accuracy was not evaluated.</small></div>`;
}
async function modelDialog() {
  if(!status.modelSelectionEnabled || !isLoaded) return;
  dialog('Choose your study model.', 'Compare supported OpenAI text models available to your API account.', '<div class="loading-line"><span class="spinner"></span>Loading model choices</div>');
  const revision = dialogRevision;
  try {
    const catalog=await api('/api/models');
    if(revision!==dialogRevision || !$('#app-dialog').open) return;
    availableModels=catalog.models || [];
    const selected=availableModels.some(item=>item.id===status.model) ? status.model : availableModels[0]?.id;
    dialog('Choose your study model.', 'Use a model, then test its connection or study with it in Coach.', `${catalog.warning ? `<div class="notice info">${esc(catalog.warning)}</div>` : ''}<form id="model-form"><div class="form-field"><label for="openai-model">OpenAI text model</label><select id="openai-model" name="model" required>${availableModels.map(item=>`<option value="${esc(item.id)}" ${item.id===selected ? 'selected' : ''}>${esc(item.label)}${item.deprecated ? ' · retiring' : ''}</option>`).join('')}</select></div><div id="model-profile">${modelProfileHtml(selected)}</div><div id="model-error" class="form-error" role="alert"></div></form><div class="inline-actions"><button class="button secondary" id="test-model-button" data-action="model-test" ${!status.aiConfigured || selected!==status.model ? 'disabled' : ''}>Test model connection</button><button class="button secondary" data-action="model-results-export">Export model results</button></div><div id="model-test-result">${modelTestHtml()}</div><p class="footer-note">The connection check is a paid API call capped at 512 billed output tokens. Passed checks are reused; it does not test medicine. Coach conversations and card drafts make their own calls. Astra and unverified model aliases are blocked. Ingenium routing is not connected yet.</p>`, '<button class="button secondary" data-action="close-dialog">Close</button><button class="button" type="submit" form="model-form">Use selected model</button>');
  } catch(error) { if(revision===dialogRevision && $('#app-dialog').open) dialog('Model choices could not load.', 'Your study data is still saved.', `<div class="notice error">${esc(error.message)}</div>`, '<button class="button secondary" data-action="close-dialog">Close</button>'); }
}
async function testSelectedModel(button) {
  if($('#openai-model')?.value!==status.model) return notify('Use the selected model before testing it.');
  button.disabled=true;
  const revision=dialogRevision, errorField=$('#model-error'), resultField=$('#model-test-result');
  errorField.textContent='';
  try {
    lastModelTest=await mutate('/api/model-test','POST',{requestId:crypto.randomUUID()});
    if(revision===dialogRevision && resultField.isConnected && $('#app-dialog').open) resultField.innerHTML=modelTestHtml();
  } catch(error) { if(revision===dialogRevision && errorField.isConnected && $('#app-dialog').open) errorField.textContent=error.message; }
  finally { if(button.isConnected) button.disabled=false; }
}
async function exportModelResults() {
  const results=await api('/api/model-results');
  const url=URL.createObjectURL(new Blob([JSON.stringify(results,null,2)],{type:'application/json'}));
  const link=document.createElement('a'); link.href=url; link.download='fm-study-model-results.json'; link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000); notify('Your model test results are ready.');
}
function renderModelMetadata(message) {
  const metadata=message.ai;
  if(!metadata) return '';
  if (metadata.endpoint === 'realtime') return `<small class="model-metadata">${metadata.imported ? 'Imported voice record · ' : ''}${esc(metadata.returnedModel || metadata.requestedModel)} · Client-reported voice transcript · Usage and cost unverified${message.voiceInterrupted ? ' · Interrupted reply' : ''}</small>`;
  const totals=message.aiTotal?.calls===2 ? message.aiTotal : metadata;
  return `<small class="model-metadata">${metadata.imported ? 'Imported model record · ' : ''}${esc(metadata.returnedModel || metadata.requestedModel)} · ${Number(totals.latencyMs/1000).toFixed(1)} s · ${totals.estimatedCostUsd===null ? 'Cost unknown' : `Estimated $${Number(totals.estimatedCostUsd).toFixed(6)}${totals===metadata ? '' : ' total'}`}${totals.usage ? ` · ${esc(totals.usage.prompt_tokens)} input / ${esc(totals.usage.completion_tokens)} billed output tokens` : ''}</small>`;
}

function cardDialog(card = null, preset = {}) {
  const data = card || preset;
  dialog(card ? 'Make this card clearer.' : 'Keep one useful insight.', 'One focused question. One answer you can check.', `<form id="card-form" data-id="${esc(card?.id || '')}"><div class="form-field"><label for="card-front">Question / prompt</label><textarea id="card-front" name="front" required maxlength="2000" placeholder="What should I be able to recall?">${esc(data.front)}</textarea></div><div class="form-field"><label for="card-back">Answer</label><textarea id="card-back" name="back" required maxlength="8000" placeholder="A focused answer, in your own words.">${esc(data.back)}</textarea></div><div class="form-field"><label for="card-topic">Topic</label><input id="card-topic" name="topic" required maxlength="100" placeholder="e.g. Clinical synthesis" value="${esc(data.topic || 'Family medicine')}"></div><div class="form-field"><label for="source-title">Reference title</label><input id="source-title" name="sourceTitle" maxlength="300" value="${esc(data.sourceTitle)}" placeholder="Guideline, textbook, or personal study note"></div><div class="form-field"><label for="source-url">Reference link</label><input id="source-url" name="sourceUrl" type="url" maxlength="2000" value="${esc(data.sourceUrl)}" placeholder="https://…"><small>Check the current official source when studying this answer. This app is not for clinical use.</small></div><label class="check-field"><input type="checkbox" name="verified" ${data.verified ? 'checked' : ''}>I checked this answer against a reliable source</label><div id="card-error" class="form-error" role="alert"></div></form>`, '<button class="button secondary" data-action="close-dialog">Cancel</button><button class="button" type="submit" form="card-form">Save recall card</button>');
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
  if (voiceCoach.active()) {
    if (!canChat()) return subscriptionDialog();
    chatDraft = ''; const input = $('#chat-input'); if (input) input.value = '';
    return voiceCoach.sendText(content.trim());
  }
  if (!canChat()) return status.entitlement?.active && !status.aiConfigured ? notify('AI coaching is not configured for this pilot. Your cards and reviews are ready.') : subscriptionDialog();
  if (!navigator.onLine) { notify('Reconnect to send a message. Your draft is still here.'); return; }
  stopDictation();
  const submitted = content.trim();
  chatBusy = true; chatStartedAt=performance.now();clearInterval(chatWaitTimer);chatWaitTimer=setInterval(()=>{const label=$('.chat-wait-time');if(label)label.textContent=`${Math.max(0,(performance.now()-chatStartedAt)/1000).toFixed(0)} s elapsed`;},1000);
  render();
  try {
    if (!conversation()) await createConversation({ title: submitted.length > 55 ? `${submitted.slice(0,52)}…` : submitted });
    chatBusy = true;
    chatError = '';
    chatDraft = '';
    const activeConversationId = currentConversationId;
    const linkedCondition = conversation()?.curriculumConditionId;
    if (!pendingChatRequest || pendingChatRequest.conversationId !== activeConversationId || pendingChatRequest.content !== submitted) pendingChatRequest = { conversationId: activeConversationId, content: submitted, requestId: crypto.randomUUID(), ...(linkedCondition ? {conditionIds:[linkedCondition]} : {}) };
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
    chatBusy = false;clearInterval(chatWaitTimer);chatWaitTimer=null;
    render();
    if (screen === 'coach') $('#chat-input')?.focus({ preventScroll:true });
  }
}

function scrollChat() { const log = $('#chat-messages'); if (log) log.scrollTop = conversation()?.messages?.length ? log.scrollHeight : 0; }
function resizeComposer() { const input = $('#chat-input'); if (!input) return; input.style.height = 'auto'; input.style.height = `${Math.min(140, Math.max(38,input.scrollHeight))}px`; }

function startDictation() {
  if (voiceCoach.active() || premiumState.active) return notify('Stop audio and voice before dictating a typed message.');
  if (!voiceDictationSupported()) { notify('Use the microphone on your phone’s keyboard to dictate.'); return; }
  if (!window.isSecureContext) { notify('Dictation needs HTTPS. You can also use your phone keyboard’s microphone.'); return; }
  if (recording) return stopDictation();
  recognition = new SpeechRecognition();
  const currentRecognition = recognition;
  recognition.lang = navigator.language || 'en-US';
  recognition.continuous = true;
  recognition.interimResults = true;
  recognitionBase = $('#chat-input')?.value || chatDraft;
  recognitionSuffix = ''; recognitionSegments = new Map(); recognitionIgnoredBefore = 0; recognitionLastTranscript = ''; recognitionLastWritten = recognitionBase;
  recognition.onresult = event => {
    if (recognition !== currentRecognition) return;
    // Web Speech results are cumulative; revisions replace a stable result index.
    // Replaying a final result must never append that spoken phrase again.
    const start = Math.max(recognitionIgnoredBefore, Number.isInteger(event.resultIndex) ? event.resultIndex : 0);
    if (!recording) return;
    // Browsers can remove a rejected trailing interim hypothesis entirely.
    for (const index of recognitionSegments.keys()) if (index >= event.results.length) recognitionSegments.delete(index);
    for (let index = start; index < event.results.length; index++) {
      const text = event.results[index]?.[0]?.transcript;
      if (typeof text === 'string') recognitionSegments.set(index, text.trim());
    }
    const transcript = [...recognitionSegments.entries()].sort((a,b) => a[0] - b[0]).map(([,text]) => text).filter(Boolean).join(' ');
    recognitionLastTranscript = transcript;
    chatDraft = `${recognitionBase}${recognitionBase && transcript && !/\s$/.test(recognitionBase) ? ' ' : ''}${transcript}${recognitionSuffix}`.slice(0,12000);
    recognitionLastWritten = chatDraft;
    const input = $('#chat-input');
    if (input) { input.value = chatDraft; resizeComposer(); }
  };
  recognition.onerror = event => { if (recognition !== currentRecognition) return; notify(event.error === 'not-allowed' ? 'Microphone access wasn’t granted. Use typing or your keyboard’s microphone.' : 'Dictation stopped. You can keep typing or try the microphone again.'); stopDictation(); };
  recognition.onend = () => { if (recognition !== currentRecognition) return; recording = false; updateDictationUI(); };
  try { recognition.start(); recording = true; updateDictationUI(); } catch { notify('Dictation is unavailable right now. Use your phone keyboard’s microphone.'); }
}
function stopDictation() { if (recognition && recording) recognition.stop(); recording = false; updateDictationUI(); }
function updateDictationUI() {
  const button = $('.mic-button');
  if (button) { button.classList.toggle('recording', recording); button.setAttribute('aria-label', recording ? 'Stop dictation' : 'Dictate a message'); }
  if ($('#voice-status')) $('#voice-status').textContent = recording ? 'Dictating text… tap the mic to stop, then review and send.' : voiceDictationSupported() ? 'Type or dictate text. Review before sending.' : 'Type or use your phone keyboard’s microphone.';
}
function preserveDictationEdits(value) {
  if (!recording || value === recognitionLastWritten) return;
  if (recognitionLastTranscript) {
    const start = value.indexOf(recognitionLastTranscript);
    if (start >= 0) {
      recognitionBase = value.slice(0, start); recognitionSuffix = value.slice(start + recognitionLastTranscript.length); recognitionLastWritten = value; return;
    }
  }
  // Editing the dictated words commits the edited text and ends recognition;
  // a later cumulative browser event cannot overwrite the learner's correction.
  recognitionBase = value; recognitionLastWritten = value; stopDictation();
}
async function previewVoice() {
  if (!premiumVoiceAvailable()) return notify('AI voice is not configured yet.');
  if (voiceCoach.active()) await voiceCoach.stop();
  stopDictation();
  const voice = $('#settings-voice')?.value || selectedVoice();
  await premiumSpeech.preview({ voice, onError: error=>notify(error.message) });
}
async function readMessage(id) {
  const message = conversation()?.messages?.find(item => item.id === id);
  if (!message || !premiumVoiceAvailable()) return;
  if (!readoutMessageAllowed(message)) return notify('AI readout requires a checked conversation or current source-linked learning point.');
  if (voiceCoach.active()) await voiceCoach.stop('Conversation ended for Read aloud. Tap the circle to start another voice session.');
  stopDictation();
  await premiumSpeech.play({ conversationId: currentConversationId, messageId: message.id, onError: error=>notify(error.message) });
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
  const sourceLinkedDrafts = draftCards.some(card=>card.curriculumConditionId && card.curriculumQuestionId);
  dialog(draftsOffline ? 'Keep a useful study habit.' : 'Keep the useful learning points.', sourceLinkedDrafts ? 'Original source-linked study cards; clinician review pending.' : draftsOffline ? 'Guided practice worksheets; edit them to fit your learning.' : 'Review every draft. Check clinical facts before you accept it.', `<div class="notice" style="margin-bottom:20px">${sourceLinkedDrafts ? 'These original recall cards come from the sourced condition library. Source checks are not clinician approval. Unchanged cards retain their source dates; edited drafts become personal unverified notes.' : draftsOffline ? 'These are reusable worksheet prompts, not AI-generated summaries of your chat. Review the suggested answers and adapt them to your learning before saving.' : 'AI drafts may contain errors. Edit each question and answer, then add a reliable reference. Accepted drafts remain unverified until you check them.'}</div><form id="draft-form">${draftCards.map((card,index) => `<div class="draft-card" data-draft="${index}"><p class="draft-label">DRAFT CARD ${index + 1}</p><label class="check-field"><input type="checkbox" name="accept-${index}" checked>Keep this card</label><div class="form-field"><label for="draft-front-${index}">Question</label><textarea id="draft-front-${index}" name="front-${index}" maxlength="2000">${esc(card.front)}</textarea></div><div class="form-field"><label for="draft-back-${index}">Answer</label><textarea id="draft-back-${index}" name="back-${index}" maxlength="8000">${esc(card.back)}</textarea></div><div class="form-field"><label for="draft-topic-${index}">Topic</label><input id="draft-topic-${index}" name="topic-${index}" value="${esc(card.topic || 'Family medicine')}" maxlength="100"></div><div class="form-field"><label for="draft-source-${index}">Reference link (optional)</label><input type="url" id="draft-source-${index}" name="sourceUrl-${index}" value="${esc(card.sourceUrl || '')}" maxlength="2000"></div></div>`).join('')}<div id="draft-error" class="form-error" role="alert"></div></form>`, '<button class="button secondary" data-action="close-dialog">Cancel</button><button class="button" type="submit" form="draft-form">Save selected cards</button>');
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
  dialog('Restore your study backup.', 'This replaces the saved study data on this server.', `<div class="notice" style="margin-bottom:18px">Export your current data first if you want to keep it. Restoring a backup replaces cards, reviews, conversations, preferences and saved board practice. Restored practice summaries and references remain unverified.</div><form id="restore-form"><div class="form-field"><label for="backup-file">Choose your backup JSON file</label><input id="backup-file" name="backup" type="file" accept="application/json,.json" required></div><label class="check-field"><input type="checkbox" name="confirmed" required>I understand this will replace my current study data</label><div id="restore-error" class="form-error" role="alert"></div></form>`, '<button class="button secondary" data-action="close-dialog">Cancel</button><button class="button" type="submit" form="restore-form">Restore backup</button>');
}

function renderLogin() {
  voiceCircle?.destroy(); voiceCircle=null; voiceCircleContainer=null;
  renderNav();
  if (status.mode === 'commercial') return renderAccountLogin();
  $('#main').innerHTML = `<section class="card auth-card"><span class="eyebrow">YOUR PRIVATE STUDY SPACE</span><h1>Welcome back.</h1><p class="subtitle">Unlock your coach, recall cards, and learning history.</p><form id="login-form"><div class="form-field"><label for="access-token">Study access code</label><input id="access-token" name="token" type="password" autocomplete="current-password" autocapitalize="none" spellcheck="false" required placeholder="Paste your STUDY_ACCESS_TOKEN value"><button type="button" class="text-button" data-action="show-access-code" aria-controls="access-token" aria-pressed="false">Show code</button></div><div id="login-error" class="form-error" role="alert"></div><button class="button full" type="submit">Open study space ${icon('arrow')}</button></form><p class="signin-note">Copy the value of STUDY_ACCESS_TOKEN from Railway → private-test → family-medicine-phone-test → Variables. This study code is separate from OPENAI_API_KEY. Your browser keeps a secure session after you unlock.</p></section>`;
}

function canChat() { return status.mode !== 'commercial' || (status.authenticated && status.entitlement?.active === true && status.aiConfigured === true); }
function voiceDictationSupported() { return Boolean(SpeechRecognition) && !billingBridge(); }
function pilotNotice(compact=false) { return status.privatePilot ? compact ? `<div class="notice pilot-notice compact-pilot"><strong>Free private phone pilot</strong><span>${status.aiConfigured ? 'Practice and test your coach.' : 'Cards and reviews are ready. AI coaching is not configured yet.'} No subscription trial has started.</span></div>` : '<div class="notice pilot-notice"><strong>Private phone pilot</strong><span>Practice, chat, and review while we test the app. This free pilot is separate from a paid subscription or subscription trial.</span></div>' : ''; }

function renderAnswerEvidence(message) {
  const sources = Array.isArray(message.citations) ? message.citations : [];
  const sourceList = sources.map(source => {
    const url = safeUrl(source.url), title = source.title || 'Source reference';
    const checked = source.checkedAt || source.reviewedAt;
    return `<li>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(title)} ↗</a>` : esc(title)}<small>${[source.edition ? `Edition: ${source.edition}` : '',checked ? `Source checked ${String(checked).slice(0,10)}` : ''].filter(Boolean).map(esc).join(' · ')}</small></li>`;
  }).join('');
  const curriculum = message.curriculum === true || message.evidence?.curriculum === true;
  const grounded = message.grounded === true || message.evidence?.grounded === true;
  const humanReviewed = message.humanReview === true || message.evidence?.humanReview === true;
  const imported = message.importedEvidence === true;
  const currentStudyText=readoutMessageAllowed(message);
  const reviewed=message.reviewedDialogue===true && message.groundingReview?.version===1 && message.groundingReview.status==='passed' && !imported && !message.importedReview;
  const legacyWarning=!currentStudyText ? reviewed ? '<small class="evidence-status unverified-study-text">Source checks are needed before this study explanation can be read aloud.</small>' : '<small class="evidence-status unverified-study-text">Unverified AI, imported or historical study text. Use current source-linked questions for guideline facts; not for clinical use.</small>' : '';
  const explanation = imported ? 'Imported references have not been reverified against the current corpus.' : reviewed ? 'Sources linked to this study explanation. Automated source check; not clinician reviewed.' : curriculum ? `${grounded ? 'Retrieved summaries support this study reply.' : 'Source-linked study response.'} ${humanReviewed ? 'Clinician review recorded.' : 'Clinician review pending; a citation does not guarantee correctness.'}` : 'References support educational review. Verify their applicability and currency.';
  const dialogue=message.studyDialogue?.version===1 && !imported;
  const dialogueStatus=dialogue ? '<small class="study-dialogue-status">Conversational study coaching · Medical learning points use cited summaries.</small>' : '';
  const quoteStatus=dialogue && (message.studyDialogue.learnerQuotePresent===true || message.studyDialogue.learnerQuote===true) ? '<small class="learner-quote-status">Your quoted reasoning is unverified. Compare it with the cited learning points; readout skips learner quotes.</small>' : '';
  const conversationStatus=reviewed ? `<small class="evidence-status ai-conversation-status">${sources.length ? 'Source-linked study explanation · Automated source check; not clinician reviewed.' : 'AI conversation'}</small>` : '';
  return `${legacyWarning}${conversationStatus}${dialogueStatus}${quoteStatus}${message.unsupported === true ? '<div class="answer-abstention">The available study evidence does not support an answer. Check a current official source.</div>' : ''}${curriculum && !reviewed ? `<small class="evidence-status">${grounded ? 'Grounded in retrieved study summaries' : 'Evidence coverage limited'} · ${humanReviewed ? 'Clinician review recorded' : 'Clinician review pending'}</small>` : ''}${sourceList ? `<details class="answer-sources"><summary>${imported ? 'Imported' : 'Source-linked'} study references (${sources.length})</summary><ul>${sourceList}</ul><p>${esc(explanation)} Study only; no medical advice or clinical use.</p></details>` : ''}`;
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
  if (action === 'account-mode') { stopPremiumAudio(); accountFormMode = button.dataset.mode; return renderLogin(); }
  if (action === 'report-message') return reportDialog(id);
  if (action === 'delete-account') { await voiceCoach.stop(); stopPremiumAudio(); return accountDeletionDialog(); }
  if (voiceCoach.active() && ['new-chat','history','select-conversation','start-case','practice-prompt','starter','topic-coach','curriculum-coach','confirm-delete-conversation','logout','import-backup','draft-cards','read-message','settings','voice-preview'].includes(action)) await voiceCoach.stop('Voice stopped. Your microphone is off.');
  if (['new-chat','history','select-conversation','start-case','practice-prompt','starter','topic-coach','curriculum-coach','confirm-delete-conversation','logout','import-backup','draft-cards','read-message','settings'].includes(action)) stopPremiumAudio();
  if (chatBusy && ['new-chat','history','select-conversation','start-case','practice-prompt','starter','topic-coach','curriculum-coach'].includes(action)) return notify('Wait for your coach’s reply before starting another conversation.');
  switch(action) {
    case 'navigate': return navigate(button.dataset.screen);
    case 'chat-study-answer': { const message=conversation()?.messages?.find(item=>item.id===id); if(!message?.studyQuestion || message.studyQuestion.imported || message.importedEvidence) return; return sendMessage(button.dataset.choice); }
    case 'chat-study-card': return saveChatStudyCard(id);
    case 'board-retry': return loadBoard();
    case 'board-dismiss-error': boardError='';return render();
    case 'board-resume': return openBoardSession(id);
    case 'board-choice': if(!boardBusy && !boardSession?.selectedChoiceId){boardChoiceId=id;boardError='';render();}return;
    case 'board-answer': return answerBoardSession();
    case 'board-position': return openBoardSession(boardSessionId(),Number(button.dataset.index));
    case 'board-finish': return finishBoardPrompt();
    case 'board-confirm-finish': return finishBoardSession();
    case 'board-save-card': return saveBoardCard(button.dataset.key);
    case 'board-home': boardSession=null;boardResults=null;boardChoiceId=null;boardError='';await loadBoard();return render();
    case 'board-focus': boardMode='domain';boardDomain=button.dataset.domain;boardSession=null;boardResults=null;boardChoiceId=null;return render();
    case 'board-missed': boardMode='missed';boardSession=null;boardResults=null;boardChoiceId=null;return render();
    case 'settings': if (isLoaded) settingsDialog(); return;
    case 'models': return modelDialog();
    case 'model-test': return testSelectedModel(button);
    case 'model-results-export': return exportModelResults();
    case 'show-access-code': { const input=$('#access-token'); const visible=input.type==='password'; input.type=visible?'text':'password'; button.textContent=visible?'Hide code':'Show code'; button.setAttribute('aria-pressed',String(visible)); return; }
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
    case 'library-tab': libraryTab=tab; render(); if (tab === 'guidelines' && !curriculumCatalog && !curriculumLoading) return loadCurriculum(); return;
    case 'curriculum-card-condition': libraryTab='guidelines';navigate('library');return openCurriculumCondition(id);
    case 'curriculum-open': return openCurriculumCondition(id);
    case 'curriculum-back': curriculumConditionId=null; curriculumCondition=null; curriculumDetailRequest++; curriculumGradeError=''; render(); return window.scrollTo({top:0,behavior:'instant'});
    case 'curriculum-detail-retry': return openCurriculumCondition(curriculumConditionId);
    case 'curriculum-retry': return loadCurriculum();
    case 'curriculum-clear': curriculumSearch='';curriculumDomain='';if($('#condition-search')) $('#condition-search').value='';if($('#condition-domain')) $('#condition-domain').value='';return loadCurriculum();
    case 'curriculum-quiz': return $('#board-question')?.scrollIntoView({block:'start',behavior:'smooth'});
    case 'curriculum-choice': if (!curriculumGrading && !curriculumAnswers.has(curriculumQuestionKey())) {curriculumChoiceId=id;curriculumGradeError='';updateCurriculumQuestionUI();} return;
    case 'curriculum-answer': return answerCurriculumQuestion();
    case 'curriculum-card': return saveCurriculumCard();
    case 'curriculum-next': if (!curriculumGrading && curriculumQuestionIndex < (curriculumCondition?.questions?.length || 0)-1) {curriculumQuestionIndex++;curriculumChoiceId=null;curriculumGradeError='';updateCurriculumQuestionUI({scroll:true});} return;
    case 'curriculum-previous': if (!curriculumGrading && curriculumQuestionIndex>0) {curriculumQuestionIndex--;curriculumChoiceId=null;curriculumGradeError='';updateCurriculumQuestionUI({scroll:true});} return;
    case 'curriculum-coach': return coachCurriculumCondition();
    case 'starter': navigate('coach'); return sendMessage(prompt);
    case 'coach-followup': return sendMessage(prompt);
    case 'practice-prompt': await createConversation({ title:prompt.slice(0,50),mode:'practice' }); return sendMessage(prompt);
    case 'topic-coach': navigate('coach'); return sendMessage(`Help me strengthen my understanding of ${topic}. Ask one active recall question at a time, wait for my answer, and help me correct gaps in my reasoning.`);
    case 'start-case': { const scenario=SCENARIOS.find(item=>item.id===id); await createConversation({ title:scenario.title,mode:'simulation',scenarioId:id }); return sendMessage('Start this fictional case. Ask me one question at a time and wait for my answer before giving feedback.'); }
    case 'new-chat': closeDialog(); await createConversation(); return notify('A fresh study conversation is ready.');
    case 'history': return historyDialog();
    case 'select-conversation': currentConversationId=id; chatDraft=''; chatError=''; closeDialog(); return navigate('coach');
    case 'delete-conversation': return confirmDialog('Delete this conversation?', 'All messages in this conversation will be removed.', 'confirm-delete-conversation',id);
    case 'confirm-delete-conversation': await mutate(`/api/conversations/${encodeURIComponent(id)}`,'DELETE'); await refreshState(); closeDialog(); render(); return notify('Conversation deleted.');
    case 'dictate': return startDictation();
    case 'voice-start': return startVoice();
    case 'voice-stop': return voiceCoach.stop();
    case 'voice-mute': return voiceCoach.toggleMute();
    case 'voice-interrupt': return voiceCoach.interrupt();
    case 'voice-speaker': return voiceCoach.playAudio();
    case 'voice-preview': return previewVoice();
    case 'premium-stop': return stopPremiumAudio(false);
    case 'premium-resume': return premiumSpeech.resume();
    case 'dismiss-chat-error': chatError=''; return render();
    case 'read-message': return readMessage(id);
    case 'copy-message': { const message=conversation()?.messages?.find(item=>item.id===id); if(message) { try { await navigator.clipboard.writeText(message.content); notify('Learning point copied.'); } catch { notify('Copy is unavailable on this browser. Select the message text to copy it.'); } } return; }
    case 'card-from-message': { const message=conversation()?.messages?.find(item=>item.id===id); return cardDialog(null,{back:message?.content || '',topic:'Family medicine'}); }
    case 'draft-cards': return generateCards();
    case 'import-cards': return importCardsDialog();
    case 'export': return exportBackup();
    case 'import-backup': return importBackupDialog();
    case 'logout': resetVoiceOptions(); await mutate('/api/logout','POST'); closeDialog(); status.authenticated=false; isLoaded=false; state.cards=[];state.conversations=[];state.reviews=[];resetCurriculumState(); resetBoardState(); return renderLogin();
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
  if(form.id==='board-start-form') return startBoardSession(form);
  if(formBusy) return;
  const data=new FormData(form);
  const submit=event.submitter;
  formBusy=true;
  if(submit) submit.disabled=true;
  let errorId;
  try {
    if (form.id === 'model-form') {
      errorId='model-error';
      await mutate('/api/model','PUT',{model:data.get('model')});
      status=await api('/api/status');
      await modelDialog(); renderNav(); notify('Your OpenAI study model is selected.');
    } else if (form.id === 'account-form') {
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
      await voiceCoach.stop(); stopPremiumAudio(); resetVoiceOptions();
      await mutate('/api/account/delete', 'POST', { confirmation: 'DELETE' });
      $('#app-dialog').close(); state.cards=[];state.reviews=[];state.conversations=[];state.settings={};isLoaded=false;currentConversationId=null;resetCurriculumState();resetBoardState();
      status=await api('/api/status'); accountFormMode='login';renderLogin();notify('Your account and saved study content were deleted.');
    } else if(form.id==='login-form') {
      errorId='login-error';
      await mutate('/api/login','POST',{token:data.get('token').trim()});
      status=await api('/api/status');
      await refreshState();render();
    } else if(form.id==='settings-form') {
      errorId='settings-error';
      if(data.get('voiceId')!==selectedVoice()) { await voiceCoach.stop(); stopPremiumAudio(); }
      await mutate('/api/settings','PUT',{focus:data.get('focus'),coachStyle:data.get('coachStyle'),voiceId:data.get('voiceId'),dailyMinutes:Number(data.get('dailyMinutes')),newCardsPerDay:Number(data.get('newCardsPerDay')),timeZone:data.get('timeZone').trim()});
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
      const selected=draftCards.map((card,index)=>({card,index})).filter(({index})=>data.get(`accept-${index}`)==='on').map(({card,index})=>({original:card,front:data.get(`front-${index}`).trim(),back:data.get(`back-${index}`).trim(),topic:data.get(`topic-${index}`).trim() || 'Family medicine',sourceTitle:card.sourceTitle || 'AI draft — verify against a reliable source',sourceUrl:data.get(`sourceUrl-${index}`).trim(),verified:false}));
      if(!selected.length) throw new Error('Select at least one draft to save.');
      if(selected.some(card=>!card.front || !card.back)) throw new Error('Each selected card needs a question and answer.');
      const personal=[];
      for (const {original,...card} of selected) {
        const canonical = original.curriculumConditionId && original.curriculumQuestionId && card.front === original.front.trim() && card.back === original.back.trim() && card.topic === original.topic && card.sourceUrl === original.sourceUrl;
        if (canonical) await mutate(`/api/curriculum/${encodeURIComponent(original.curriculumConditionId)}/card`,'POST',{questionId:original.curriculumQuestionId});
        else personal.push(card);
      }
      if(personal.length) await mutate('/api/cards/import','POST',{cards:personal});
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
      if(file.size>16*1024*1024) throw new Error('The backup is too large. The maximum is 16 MB.');
      const backup=JSON.parse(await file.text());
      await mutate('/api/import','POST',backup);
      await voiceCoach.stop(); stopPremiumAudio(); resetVoiceOptions();currentConversationId=null;reviewSession=null;resetBoardState();resetCurriculumState();await refreshState();$('#app-dialog').close();render();notify('Your study backup is restored.');
    }
  } catch(error) {
    const target=errorId && document.getElementById(errorId);
    if(target) target.textContent=error instanceof SyntaxError ? 'This JSON is not valid. Check the file or pasted content and try again.' : error.message;
    else notify(error.message);
  } finally { formBusy=false;if(submit) submit.disabled=false; }
});

document.addEventListener('input', event=>{
  if(event.target.id==='chat-input') {chatDraft=event.target.value;preserveDictationEdits(chatDraft);resizeComposer();}
  if(event.target.id==='condition-search') {curriculumSearch=event.target.value;clearTimeout(curriculumSearchTimer);curriculumRequest++;curriculumSearchTimer=setTimeout(loadCurriculum,220);}
  if(event.target.id==='card-search') { searchTerm=event.target.value;const filtered=state.cards.filter(card=>(!topicFilter || card.topic===topicFilter) && `${card.front} ${card.back} ${card.topic}`.toLowerCase().includes(searchTerm.toLowerCase()));$('#card-results').innerHTML=renderCardResults(filtered);$('.library-summary span').textContent=`${filtered.length} cards · ${state.cards.filter(card=>card.suspended).length} suspended`; }
});
document.addEventListener('change',async event=>{
  try {
    if(['board-mode','board-count','board-domain','board-feedback','board-timed'].includes(event.target.id)){const form=$('#board-start-form');const data=new FormData(form);boardMode=data.get('mode');boardCount=Number(data.get('count'));boardDomain=data.get('domain') || boardDomain;boardFeedback=data.get('feedback');boardTimed=data.get('timed')==='on';boardMinutes=Number(data.get('minutes') || boardMinutes);render();}
    if(event.target.id==='coach-voice') { const voiceId=event.target.value;await voiceCoach.stop();stopPremiumAudio();await mutate('/api/settings','PUT',{voiceId});state.settings.voiceId=voiceId;updateVoiceUI();notify('Your Coach voice is saved.'); }
    if(event.target.id==='settings-voice') { await voiceCoach.stop();stopPremiumAudio(); }
    if(event.target.id==='condition-domain') {curriculumDomain=event.target.value;await loadCurriculum();}
    if(event.target.id==='topic-filter') {topicFilter=event.target.value;render();}
    if(event.target.id==='openai-model') { $('#model-profile').innerHTML=modelProfileHtml(event.target.value); $('#test-model-button').disabled=!status.aiConfigured || event.target.value!==status.model; }
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
$('#app-dialog').addEventListener('close',()=>{dialogRevision++;if(premiumState.kind==='preview')stopPremiumAudio(false);});
$('#app-dialog').addEventListener('click',event=>{if(event.target===$('#app-dialog')) {const rect=$('#app-dialog').getBoundingClientRect();if(event.clientX<rect.left || event.clientX>rect.right || event.clientY<rect.top || event.clientY>rect.bottom) closeDialog();}});
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
window.addEventListener('online',()=>{renderNav();notify('Connected again. Your study space is ready.');});
window.addEventListener('offline',()=>{stopDictation();voiceCoach.stop('Connection lost. Your microphone is off; reconnect before starting another conversation.');stopPremiumAudio();renderNav();notify('You’re offline. Reconnect to chat or save progress.');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)stopDictation();});
window.addEventListener('pagehide',()=>{stopDictation();voiceCoach.stop('Voice stopped. Your microphone is off.');stopPremiumAudio();});

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
