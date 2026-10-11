import { el, api, actionId, field, notice, pageIntro, navigate, showGlobalError, getSession, updateSession, startCase, modelSelector, getVoiceChoices } from '/app.js';

let timer = null;
let telemetryController = null;
const button = (text, handler, cls = '') => el('button', { type: 'button', class: cls, text, onclick: handler });
const safe = handler => async event => { const target = event?.currentTarget; if (target?.disabled) return; if (target) target.disabled = true; try { await handler(event); } catch (error) { showGlobalError(error); } finally { if (target) target.disabled = false; } };
const post = (path, body) => api(path, { method: 'POST', body: { actionId: actionId(), ...body } });
const select = values => el('select', {}, values.map(([value, label]) => el('option', { value, text: label })));
const title = (name, description = '') => el('div', {}, el('h2', { text: name }), description ? el('p', { class: 'muted', text: description }) : null);
const empty = (heading, description) => el('div', { class: 'panel empty' }, el('h2', { text: heading }), el('p', { text: description }));
const metric = (value, label) => el('div', { class: 'panel' }, el('div', { class: 'metric', text: value == null ? '—' : String(value) }), el('div', { class: 'metric-label', text: label }));
const sources = (list = [], label = 'Question sources') => el('div', { class: 'source-list' }, el('div', { class: 'eyebrow', text: label }), list.filter(item => item.url && /^https:\/\//.test(item.url)).map(item => el('div', {}, el('a', { href: item.url, target: '_blank', rel: 'noopener noreferrer', text: item.title || item.organization || item.url }))));
function modalKeys(backdrop, close) {
  backdrop.addEventListener('click', event => { if (event.target === backdrop) close(); });
  backdrop.addEventListener('keydown', event => {
    if (event.key === 'Escape') { close(); return; }
    if (event.key !== 'Tab') return;
    const nodes = Array.from(backdrop.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href],summary')).filter(node => !node.closest('.hidden') && node.getClientRects().length > 0);
    const first = nodes[0], last = nodes.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  });
}
export function cleanup() { clearInterval(timer); timer = null; telemetryController?.abort(); telemetryController = null; }
export async function render(tab, page) {
  cleanup(); page.replaceChildren(el('div', { class: 'loading', role: 'status', text: 'Opening your study tools…' }));
  try { const view = { practice, review, library, progress, settings }[tab]; if (view) await view(page); }
  catch (error) { page.replaceChildren(pageIntro('Connection needs attention', 'Your tools could not load.', 'Check your connection, then try again. No automatic action was repeated.'), notice(error.message, 'error'), button('Try loading again', () => render(tab, page), 'primary')); }
}

async function practice(page) {
  const summary = await api('/api/study'), container = el('div', { class: 'stack' });
  if (!page.isConnected) return;
  page.replaceChildren(pageIntro('Practice · deterministic answers', 'Think before you choose.', 'Original study questions, canonical grading, and explanations. Your session is saved as you go.'), container);
  if (summary.activePractice) return drawPractice(summary.activePractice, container);
  if (summary.practiceWarning) container.append(notice(`${summary.practiceWarning.message} Your recorded data remains saved; a replacement session uses only currently eligible questions.`));
  const mode = select([['mixed', 'Weighted mixed practice'], ['missed', 'Missed questions'], ['weak', 'Lowest practice domain'], ['domain', 'Choose a domain']]);
  const size = select([10, 20, 40, 80, 100].map(count => [String(count), `${count} questions`]));
  const domain = select((summary.catalog?.domains || []).map(item => [item.id, `${item.title} · ${item.available} available`]));
  const domainField = field('Domain', domain); domainField.classList.add('hidden'); mode.addEventListener('change', () => domainField.classList.toggle('hidden', mode.value !== 'domain'));
  const feedback = select([['immediate', 'After each answer'], ['end', 'At session end']]);
  const timed = el('input', { type: 'checkbox' }); const minutes = el('input', { type: 'number', min: '1', max: '180', value: '18' });
  const startActionId = actionId();
  const start = button(summary.practiceWarning ? 'Replace unavailable session' : 'Start practice', safe(async () => { const options = { actionId: startActionId, action: summary.practiceWarning ? 'restart' : 'start', mode: mode.value, count: Number(size.value), feedback: feedback.value, timed: timed.checked }; if (mode.value === 'domain') options.domain = domain.value; if (timed.checked) options.timeLimitSeconds = Number(minutes.value) * 60; await drawPractice(await post('/api/practice', options), container); }), 'primary');
  container.append(el('div', { class: 'grid' }, el('section', { class: 'panel' }, title('A focused session', `${summary.eligibleQuestions} currently eligible U.S. questions from ${summary.loadedQuestions} loaded items.`), field('Session', mode), field('Number of questions', size), domainField, field('Feedback', feedback), el('label', { class: 'check-row' }, timed, 'Use a practice timer'), field('Timer in minutes', minutes), start), el('section', { class: 'panel' }, title('Coverage, honestly shown'), el('p', { class: 'muted', text: 'Mixed practice follows the saved blueprint weighting. Expired sources, comparative items, and unavailable questions are excluded. Shortages remain visible.' }), el('div', { class: 'list' }, (summary.catalog?.domains || []).map(item => el('div', { class: 'row spread' }, el('span', { text: item.title }), el('span', { class: 'tag', text: `${item.available} eligible` })))))), el('p', { class: 'bottom-note', text: 'Practice accuracy describes these independent study items. It does not establish clinical competence or predict board passage.' }));
}
async function drawPractice(view, container) {
  if (!container.isConnected) return;
  cleanup(); container.replaceChildren();
  if (!view) { container.append(empty('No saved session', 'Start a session to practice.')); return; }
  if (view.status === 'completed') {
    container.append(el('div', { class: 'grid three' }, metric(view.answered, 'Questions answered'), metric(view.accuracy == null ? '—' : `${view.accuracy}%`, 'Accuracy on answered questions'), metric(view.skipped, 'Skipped questions')), notice('These are learning signals from this session, not an official exam or competency assessment.'), button('Start another session', () => navigate('practice'), 'primary'));
    const results = el('div', { class: 'list' });
    for (const question of view.questions || []) { const details = el('details', { class: 'panel' }, el('summary', { text: `${question.answered ? question.feedback?.correct ? 'Correct' : 'Missed' : 'Skipped'} · ${question.conditionTitle || question.key}` }), el('p', { class: 'preserve-lines', text: question.stem }), feedbackView(question.feedback)); results.append(details); }
    container.append(results); return;
  }
  const question = view.question, choices = el('div', { class: 'options' }); let selected = view.selectedChoiceId;
  const submit = button('Check answer', safe(async () => { if (!selected) throw new Error('Select an answer first.'); await drawPractice(await post('/api/practice', { action: 'answer', sessionId: view.sessionId, questionKey: question.key, choiceId: selected }), container); }), 'primary'); submit.disabled = Boolean(view.selectedChoiceId) || view.timeExpired;
  for (const choice of question.choices) { const choiceButton = button(`${choice.id}. ${choice.text}`, () => { selected = choice.id; choices.querySelectorAll('button').forEach(node => { const checked = node.dataset.choice === selected; node.classList.toggle('selected', checked); node.setAttribute('aria-pressed', String(checked)); }); }, 'option'); choiceButton.dataset.choice = choice.id; choiceButton.classList.toggle('selected', selected === choice.id); choiceButton.setAttribute('aria-pressed', String(selected === choice.id)); choiceButton.disabled = Boolean(view.selectedChoiceId) || view.timeExpired; if (view.feedback?.correctChoiceId === choice.id) choiceButton.classList.add('correct'); else if (view.feedback && view.selectedChoiceId === choice.id && !view.feedback.correct) choiceButton.classList.add('incorrect'); choices.append(choiceButton); }
  const clock = el('span', { class: 'tag', text: view.timed ? `${Math.ceil(view.remainingSeconds / 60)} min remaining` : 'Untimed' });
  const panel = el('section', { class: 'panel' }, el('div', { class: 'row spread' }, el('div', { class: 'eyebrow', text: `Question ${view.position + 1} of ${view.count} · ${view.answeredCount} answered` }), clock), el('h2', { text: question.conditionTitle }), el('p', { class: 'question-stem preserve-lines', text: question.stem }), choices, el('div', { class: 'row question-actions' }, submit, view.selectedChoiceId ? el('span', { class: 'tag good', text: 'Answer saved' }) : null), view.feedback ? feedbackView(view.feedback) : null);
  let restartArmed = false;
  const restart = button('Restart session', safe(async event => { if (!restartArmed) { restartArmed = true; event.currentTarget.textContent = 'Confirm restart'; return; } const options = { action: 'restart', mode: view.mode, count: view.count, timed: view.timed, feedback: view.feedbackMode }; if (view.domain && ['domain', 'weak'].includes(view.mode)) options.domain = view.domain; if (view.conditionId) options.conditionId = view.conditionId; if (view.timed) options.timeLimitSeconds = view.timeLimitSeconds; await drawPractice(await post('/api/practice', options), container); }));
  container.append(panel, el('div', { class: 'row spread' }, el('div', { class: 'row' }, button('Previous', safe(async () => drawPractice(await post('/api/practice', { action: 'view', sessionId: view.sessionId, index: Math.max(0, view.position - 1) }), container))), button('Next', safe(async () => drawPractice(await post('/api/practice', { action: 'view', sessionId: view.sessionId, index: Math.min(view.count - 1, view.position + 1) }), container)))), el('div', { class: 'row' }, restart, button('Finish session', safe(async () => drawPractice(await post('/api/practice', { action: 'finish', sessionId: view.sessionId }), container)), 'primary'))), el('p', { class: 'bottom-note', text: 'Answers are immutable once recorded. You can leave and resume this session. Reflecting with Coach preserves it.' }));
  if (view.timed) { const deadline = Date.now() + view.remainingSeconds * 1000; timer = setInterval(() => { const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000)); clock.textContent = `${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')} remaining`; if (!remaining) { cleanup(); submit.disabled = true; choices.querySelectorAll('button').forEach(node => node.disabled = true); clock.textContent = 'Time ended · finish to review'; } }, 1000); }
}
function feedbackView(feedback) {
  if (!feedback) return null;
  return el('div', { class: 'reveal' }, el('div', { class: 'eyebrow', text: 'Recorded question explanation' }), feedback.correctChoiceId ? el('h3', { text: `Canonical answer: ${feedback.correctChoiceId}` }) : null, el('p', { class: 'preserve-lines', text: feedback.rationale || feedback.explanation || '' }), feedback.choices?.length ? el('details', {}, el('summary', { text: 'Why the other choices differ' }), feedback.choices.map(choice => el('p', { class: 'muted', text: `${choice.id}. ${choice.explanation || ''}` }))) : null, sources(feedback.sources || feedback.citations));
}

async function review(page, mode = 'due', query = '') {
  const content = el('div', { class: 'stack' });
  page.replaceChildren(pageIntro('Review · spaced practice', 'Return at the right time.', 'Reveal the answer, reflect on recall, then choose a rating.', button('+ New card', () => cardEditor(null, () => review(page, 'cards')), 'primary')), el('div', { class: 'row section-tabs' }, button('Due today', () => review(page, 'due'), mode === 'due' ? 'primary' : ''), button('All cards', () => review(page, 'cards'), mode === 'cards' ? 'primary' : '')), content);
  if (mode === 'cards') {
    const search = el('input', { class: 'search', type: 'search', placeholder: 'Search cards by text or topic', 'aria-label': 'Search cards', value: query });
    page.insertBefore(el('form', { class: 'row search-form', onsubmit: event => { event.preventDefault(); void review(page, 'cards', search.value).catch(showGlobalError); } }, search, el('button', { type: 'submit', text: 'Search' })), content);
    const result = await api(`/api/cards?q=${encodeURIComponent(query)}`);
    if (!result.cards.length) content.append(empty('No cards found', 'Create a personal card or save a question from the library.'));
    for (const card of result.cards) content.append(el('article', { class: 'panel' }, el('div', { class: 'row spread' }, el('span', { class: 'eyebrow', text: card.topic || 'Personal card' }), el('span', { class: 'tag', text: card.suspended ? 'Suspended' : card.state || 'New' })), el('h3', { class: 'preserve-lines', text: card.front }), el('details', {}, el('summary', { text: 'View answer' }), el('p', { class: 'preserve-lines', text: card.back }), cardProvenance(card)), el('div', { class: 'row question-actions' }, button('Edit', () => cardEditor(card, () => review(page, 'cards', query))), button(card.suspended ? 'Resume' : 'Suspend', safe(async () => { await post('/api/cards', { action: 'update', id: card.id, suspended: !card.suspended }); await review(page, 'cards', query); })), deleteButton(card, () => review(page, 'cards', query)))));
    return;
  }
  const result = await api('/api/review');
  content.append(el('div', { class: 'grid three' }, metric(result.stats.dueCount, 'Available now'), metric(result.stats.reviewedToday, 'Reviews today'), metric(result.stats.newRemaining, 'New cards remaining today')));
  if (!result.cards.length) { content.append(empty('You’re caught up.', 'Due-first review and your daily new-card limit determine this queue. Return later or browse your cards.')); return; }
  const card = result.cards[0], answer = el('div', { class: 'reveal hidden' }), reviewActionId = actionId();
  const ratings = el('div', { class: 'rating-row' }, ['again', 'hard', 'good', 'easy'].map(rating => button('', safe(async () => { ratings.querySelectorAll('button').forEach(node => node.disabled = true); try { await post('/api/review', { actionId: reviewActionId, cardId: card.id, rating }); await review(page); } catch (error) { ratings.querySelectorAll('button').forEach(node => node.disabled = false); throw error; } }))));
  Array.from(ratings.children).forEach((node, index) => { const rating = ['again', 'hard', 'good', 'easy'][index]; node.append(rating[0].toUpperCase() + rating.slice(1), el('small', { text: card.intervals?.[rating] || '' })); });
  answer.append(el('p', { class: 'preserve-lines', text: card.back }), cardProvenance(card), el('p', { class: 'muted', text: 'How readily did you recall this answer?' }), ratings);
  content.append(el('section', { class: 'panel' }, el('div', { class: 'eyebrow', text: `${card.topic || 'Personal study'} · ${result.cards.length} in today’s queue` }), el('h2', { class: 'preserve-lines', text: card.front }), button('Reveal answer', event => { answer.classList.remove('hidden'); event.currentTarget.classList.add('hidden'); }, 'primary'), answer), el('p', { class: 'bottom-note', text: 'Scheduling is an SM-2-inspired heuristic. Ratings reflect your recall, not validated mastery or retention predictions.' }));
}
function cardProvenance(card) { return el('div', {}, card.origin === 'question' ? sources(card.questionSources, 'Question sources · not rechecked live') : el('span', { class: 'tag', text: 'Personal/imported card · unverified' }), card.sourceWarning ? notice(card.sourceWarning) : null, card.sourceUrl && /^https:\/\//.test(card.sourceUrl) ? el('a', { href: card.sourceUrl, target: '_blank', rel: 'noopener noreferrer', text: card.sourceTitle || 'Saved source link' }) : null); }
function deleteButton(card, refresh) { let armed = false; return button('Delete', safe(async event => { if (!armed) { armed = true; event.currentTarget.textContent = 'Confirm delete'; return; } await post('/api/cards', { action: 'delete', id: card.id }); await refresh(); }), 'danger'); }
function cardEditor(card, refresh) {
  const front = el('textarea', { maxlength: '2000', required: true, value: card?.front || '', placeholder: 'A question, cue, or reflection prompt' });
  const back = el('textarea', { maxlength: '8000', required: true, value: card?.back || '', placeholder: 'The answer or reflection you want to revisit' });
  const topic = el('input', { maxlength: '120', value: card?.topic || '', placeholder: 'For example: Cardiology' }); const feedback = el('div');
  const dialog = el('section', { class: 'panel dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': card ? 'Edit card' : 'Create card' }), saveActionId = actionId();
  const previousFocus = document.activeElement, backdrop = el('div', { class: 'dialog-backdrop' }, dialog), close = () => { backdrop.remove(); previousFocus?.focus(); };
  const save = el('button', { class: 'primary', type: 'submit', text: 'Save card' });
  dialog.append(el('div', { class: 'row spread' }, el('h2', { text: card ? 'Edit your card' : 'Create a personal card' }), button('Close', close, 'subtle')), el('form', { onsubmit: async event => { event.preventDefault(); if (save.disabled) return; save.disabled = true; try { await post('/api/cards', { actionId: saveActionId, action: card ? 'update' : 'create', ...(card ? { id: card.id } : {}), front: front.value, back: back.value, topic: topic.value }); close(); await refresh(); } catch (error) { feedback.replaceChildren(notice(error.message, 'error')); save.disabled = false; } } }, field('Front', front), field('Back', back), field('Topic', topic), notice('Personal edits remain unverified study material.'), save, feedback));
  modalKeys(backdrop, close); document.body.append(backdrop); front.focus();
}

async function library(page, tab = 'questions', query = '', number = 1) {
  const search = el('input', { type: 'search', class: 'search', placeholder: tab === 'references' ? 'Search titles, organizations, or topics' : 'Search medical topics', 'aria-label': 'Search library', value: query });
  const content = el('div', { class: 'stack' });
  page.replaceChildren(pageIntro('Library · deliberate reference', 'Find what you need.', 'Browse original study material and a separate directory of reputable reference links.'), el('div', { class: 'row section-tabs' }, ['questions', 'cases', 'worksheets', 'references'].map(item => button(item[0].toUpperCase() + item.slice(1), () => library(page, item).catch(showGlobalError), tab === item ? 'primary' : ''))), ['questions', 'references'].includes(tab) ? el('form', { class: 'row search-form', onsubmit: event => { event.preventDefault(); void library(page, tab, search.value).catch(showGlobalError); } }, search, el('button', { type: 'submit', text: 'Search' })) : document.createDocumentFragment(), content);
  if (tab === 'references') { content.append(notice('Reference links are directory entries. Their exact documents have not been consulted for a Coach answer.')); let result; try { result = await api(`/api/references?q=${encodeURIComponent(query)}&page=${number}`); } catch (error) { content.append(notice(error.message, 'error')); return; }
    content.append(el('p', { class: 'muted', text: `${result.total} matching references · ${result.counts?.uniqueUrls || 429} in the directory` }));
    for (const reference of result.references || []) content.append(el('article', { class: 'panel' }, el('div', { class: 'eyebrow', text: 'Reference link · not consulted' }), el('h3', {}, el('a', { href: reference.url, target: '_blank', rel: 'noopener noreferrer', text: reference.title || reference.url })), el('p', { class: 'muted', text: reference.organization || new URL(reference.url).hostname }), el('details', {}, el('summary', { text: 'Source metadata and restrictions' }), el('p', { class: 'muted', text: 'Publisher screening does not verify every clinical claim, current edition, or copying right. Direct source reading is unavailable in this build.' }), (reference.records || []).map(record => el('pre', { class: 'metadata', text: JSON.stringify(record, null, 2) })))));
    content.append(pagination(result, page, tab, query)); return;
  }
  if (tab === 'cases') { const result = await api('/api/cases'); content.append(notice(result.purpose || 'Fictional educational exercises; feedback is not an official competency rating.')); for (const scenario of result.cases || []) content.append(el('article', { class: 'panel' }, el('div', { class: 'eyebrow', text: `${scenario.category || 'Guided case'} · ${scenario.estimatedMinutes || 18} minutes` }), el('h3', { text: scenario.title }), el('p', { class: 'muted', text: scenario.description }), button('Work through with Coach', safe(async () => startCase(scenario.id)), 'primary'))); return; }
  if (tab === 'worksheets') { const result = await api('/api/worksheets'); content.append(notice(result.purpose || 'Personal study reflections, not competency assessments.')); for (const worksheet of result.worksheets || []) { const responses = (worksheet.fields || []).map(label => ({ label, input: el('textarea', { maxlength: '1200' }) })); const saved = el('div'); content.append(el('section', { class: 'panel' }, el('h3', { text: worksheet.title }), responses.map(item => field(item.label, item.input)), button('Save as reflection card', safe(async () => { const back = responses.map(item => `${item.label}\n${item.input.value}`).join('\n\n'); if (!responses.some(item => item.input.value.trim())) throw new Error('Add a reflection before saving.'); await post('/api/cards', { action: 'create', front: worksheet.title, back, topic: 'Reflection' }); saved.replaceChildren(notice('Reflection saved as an unverified personal card.', 'good')); }), 'primary'), saved)); } return; }
  const result = await api(`/api/library?q=${encodeURIComponent(query)}&page=${number}`);
  content.append(el('p', { class: 'muted', text: `${result.total} matching topics` }));
  if (!result.topics.length) content.append(empty('No matching topics', 'Try a broader medical term.'));
  for (const topic of result.topics || []) { const details = el('details', { class: 'panel' }, el('summary', { text: `${topic.name} · ${topic.eligibleCount} eligible questions` }), el('p', { class: 'muted', text: `${topic.specialty || 'Family medicine'} · ${topic.questionCount} total · ${topic.comparativeCount} comparative` }), el('div', { class: 'row' }, (topic.questionKeys || []).map((key, index) => button(`Question ${index + 1}`, safe(async () => questionDialog(key)))))); content.append(details); }
  content.append(pagination(result, page, tab, query));
}
function pagination(result, page, tab, query) { const previous = button('Previous page', () => library(page, tab, query, result.page - 1).catch(showGlobalError)); previous.disabled = result.page <= 1; const next = button('Next page', () => library(page, tab, query, result.page + 1).catch(showGlobalError)); next.disabled = result.page >= result.pages; return el('div', { class: 'row spread' }, previous, el('small', { text: `Page ${result.page} of ${Math.max(1, result.pages)}` }), next); }
async function questionDialog(key) {
  const question = await api(`/api/question?key=${encodeURIComponent(key)}`), dialog = el('section', { class: 'panel dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Study question' }), backdrop = el('div', { class: 'dialog-backdrop' }, dialog), answer = el('div');
  const previousFocus = document.activeElement, close = () => { backdrop.remove(); previousFocus?.focus(); };
  dialog.append(el('div', { class: 'row spread' }, el('h2', { text: question.topic?.name || question.conditionTitle || 'Study question' }), button('Close', close, 'subtle')), !question.current ? notice('This question is outside current source eligibility. It remains archived study material.') : null, question.comparative ? notice('Comparative material; excluded from U.S. weighted practice.') : null, el('p', { class: 'question-stem preserve-lines', text: question.stem }), el('div', { class: 'options' }, question.choices.map(choice => el('div', { class: 'list-item', text: `${choice.id}. ${choice.text}` }))), button('Reveal recorded answer', safe(async event => { const revealed = await api(`/api/question?key=${encodeURIComponent(key)}&reveal=true`); answer.replaceChildren(feedbackView(revealed.feedback), button('Save question as card', safe(async saveEvent => { await post('/api/cards', { action: 'from-question', key }); saveEvent.currentTarget.textContent = 'Saved as card'; }), 'primary')); event.currentTarget.classList.add('hidden'); }), 'primary question-actions'), answer);
  modalKeys(backdrop, close); document.body.append(backdrop); dialog.querySelector('button').focus();
}

async function progress(page) {
  const result = await api('/api/progress'), stats = result.review || {}, history = result.practice?.history || [];
  page.replaceChildren(pageIntro('Today · learning signals', 'Keep the next step small.', 'A practical view of review activity and recorded practice. These signals do not measure clinical competence.'), el('div', { class: 'grid three' }, metric(stats.dueCount, 'Cards available now'), metric(stats.reviewedToday, 'Reviews today'), metric(stats.streak, 'Days with recorded reviews')), el('div', { class: 'row section-tabs' }, button('Review due cards', () => navigate('review'), 'primary'), button('Start practice', () => navigate('practice'))), el('div', { class: 'grid' }, el('section', { class: 'panel' }, title('Recent review activity', 'Recorded reviews per day, in your configured timezone.'), el('div', { class: 'activity-grid' }, (stats.activity || []).map(day => el('div', { class: `activity-cell ${day.count ? 'has-activity' : ''}`, title: `${day.date}: ${day.count} reviews`, text: String(day.count) }))), el('p', { class: 'bottom-note', text: 'Self-ratings describe recall during these reviews. They are not validated retention predictions.' })), el('section', { class: 'panel' }, title('Topics to revisit'), stats.weakTopics?.length ? el('div', { class: 'list' }, stats.weakTopics.slice(0, 5).map(topic => el('div', { class: 'row spread' }, el('span', { text: topic.topic || 'Uncategorized' }), el('small', { text: `${topic.lapses} Again ratings / ${topic.reviews} reviews` })))) : el('p', { class: 'muted', text: 'Review cards to build a useful activity history.' }))), el('section', { class: 'panel' }, title('Recent practice'), history.length ? el('div', { class: 'list' }, history.slice(0, 10).map(item => el('div', { class: 'list-item' }, el('div', { class: 'row spread' }, el('strong', { text: `${item.count} questions · ${item.mode}` }), el('span', { class: 'tag', text: item.trusted === false ? 'Imported · unverified' : 'Recorded practice' })), el('p', { class: 'muted', text: `${item.answered} answered · ${item.accuracy == null ? 'No recorded accuracy' : `${item.accuracy}% accuracy on answered items`} · ${new Date(item.completedAt || item.createdAt).toLocaleDateString()}` })))) : el('p', { class: 'muted', text: 'Your completed practice sessions will appear here.' })), notice(result.selfAssessmentLabel || 'Study signals, not clinical competence or board-readiness predictions.'));
}

function telemetryPanel() {
  const status = el('div', { role: 'status' }, el('p', { class: 'muted', text: 'Loading monitoring status…' }));
  const refresh = button('Refresh monitoring status', () => load());
  const panel = el('section', { class: 'panel' }, title('Ingenium test client'), el('p', { class: 'muted', text: 'Model, token, latency, and status metadata only. Prompts and replies stay in StudyChat.' }), status, refresh);
  let loading = false;
  const current = () => panel.isConnected && getSession().authenticated && !document.hidden;
  async function load() {
    if (loading || !current()) return;
    loading = true; refresh.disabled = true;
    const controller = new AbortController(); telemetryController = controller;
    try {
      const result = await api('/api/telemetry', { signal: controller.signal, timeoutMs: 10000 });
      if (controller.signal.aborted || !current()) return;
      const count = key => Number.isFinite(Number(result[key])) ? Math.max(0, Number(result[key])) : 0;
      const deliveryDate = result.lastDeliveryAt ? new Date(result.lastDeliveryAt) : null;
      const details = [el('p', {}, el('span', { class: 'tag', text: result.configured ? 'Configured' : 'Disabled' }))];
      details.push(el('div', { class: 'list' }, ['pending', 'delivered', 'rejected', 'dropped'].map(key => el('div', { class: 'row spread' }, el('span', { text: key[0].toUpperCase() + key.slice(1) }), el('strong', { text: String(count(key)) })))));
      details.push(el('p', { class: 'muted', text: deliveryDate && Number.isFinite(deliveryDate.getTime()) ? `Last delivery ${deliveryDate.toLocaleString()}.` : 'No successful delivery recorded.' }));
      if (count('pending') || count('rejected') || count('dropped')) details.push(notice('Some monitoring events are pending, rejected, or dropped. These counts do not delay Coach replies.'));
      if (result.lastError) details.push(notice(`Last delivery error: ${String(result.lastError).slice(0, 500)}`, 'error'));
      status.replaceChildren(...details);
    } catch (error) {
      if (!controller.signal.aborted && current()) status.replaceChildren(notice(`Monitoring status could not load. ${error.message}`, 'error'));
    } finally {
      if (telemetryController === controller) telemetryController = null;
      loading = false; refresh.disabled = false;
    }
  }
  queueMicrotask(() => {
    if (!panel.isConnected || !getSession().authenticated) return;
    timer = setInterval(() => { if (current()) void load(); }, 10000);
    if (current()) void load(); else status.replaceChildren(el('p', { class: 'muted', text: 'Monitoring status refreshes when Settings is visible.' }));
  });
  return panel;
}

async function settings(page) {
  const [saved, voiceOptions] = await Promise.all([api('/api/settings'), api('/api/voice').catch(() => ({ enabled: false, voices: [], unavailableReason: 'Voice settings could not load. Your study preferences can still be saved.' }))]);
  if (!page.isConnected) return;
  const focus = select([['clinical-reasoning', 'Clinical reasoning'], ['exam-preparation', 'Exam preparation'], ['balanced', 'Balanced study']]), style = select([['guided-questions', 'Guided questions'], ['concise', 'Concise explanations'], ['detailed', 'Detailed explanations']]);
  focus.value = saved.focus; style.value = saved.style;
  const duration = el('input', { type: 'number', min: '5', max: '120', value: saved.sessionMinutes }), newCards = el('input', { type: 'number', min: '0', max: '100', value: saved.newCardLimit }), timezone = el('input', { value: saved.timeZone, placeholder: 'America/New_York', maxlength: '100' });
  const voiceChoices = getVoiceChoices(voiceOptions), voices = voiceChoices.map(choice => choice.id);
  const voice = select(voiceChoices.length ? voiceChoices.map(choice => [choice.id, choice.label]) : [['', 'Voice list unavailable']]);
  voice.value = voices.includes(saved.voice) ? saved.voice : voices.includes(voiceOptions.defaultVoice) ? voiceOptions.defaultVoice : voices[0] || '';
  voice.disabled = !voices.length;
  const feedback = el('div'), save = el('button', { class: 'primary', type: 'submit', text: 'Save preferences' });
  const form = el('form', { onsubmit: async event => { event.preventDefault(); if (save.disabled) return; save.disabled = true; try { const preferences = { focus: focus.value, style: style.value, sessionMinutes: Number(duration.value), newCardLimit: Number(newCards.value), timeZone: timezone.value }; if (voices.includes(voice.value)) preferences.voice = voice.value; const result = await post('/api/settings', preferences); updateSession({ settings: result }); feedback.replaceChildren(notice('Preferences saved.', 'good')); } catch (error) { feedback.replaceChildren(notice(error.message, 'error')); } finally { save.disabled = false; } } }, field('Study focus', focus), field('Coach style', style), field('Session minutes', duration), field('Daily new-card limit', newCards), field('Timezone', timezone), field('Voice', voice), el('p', { class: 'bottom-note', text: voiceOptions.enabled ? 'AI-generated speech. Microphone starts only when you start voice chat.' : voiceOptions.unavailableReason || 'The self-hosted voice service is not connected. Typed chat is available.' }), save, feedback);
  const restoreInput = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Select a JSON backup' }), restoreFeedback = el('div');
  const restoreButton = button('Restore selected backup', safe(async () => { const file = restoreInput.files[0]; if (!file) throw new Error('Select a JSON backup first.'); if (file.size > 16 * 1024 * 1024) throw new Error('Backup exceeds the 16 MiB limit.'); let data; try { data = JSON.parse(await file.text()); } catch { throw new Error('The backup is not valid JSON.'); } await api('/api/backup', { method: 'POST', body: data }); restoreFeedback.replaceChildren(notice('Backup restored. Saved data was validated and replaced atomically. Reloading the workspace…', 'good')); location.reload(); }), 'danger');
  page.replaceChildren(pageIntro('Settings · your study rhythm', 'Make this space yours.', 'Keep preferences simple, save your work, and return with a clear next step.'), el('div', { class: 'grid' }, el('section', { class: 'panel' }, title('Study preferences'), form), el('div', { class: 'stack' }, el('section', { class: 'panel' }, title('Your data'), el('p', { class: 'muted', text: 'Backups contain your saved study records and preferences, without API keys or access tokens.' }), button('Download JSON backup', safe(async () => { const data = await api('/api/backup'); const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })); const link = el('a', { href: url, download: `studychat-backup-${new Date().toISOString().slice(0, 10)}.json` }); document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); }), 'primary'), el('div', { class: 'reveal' }, el('h3', { text: 'Restore a backup' }), notice('Restore replaces current study data after validation. Download a backup first if you want to preserve your current records.'), restoreInput, restoreButton, restoreFeedback)), el('section', { class: 'panel' }, title('Connection'), modelSelector('settings'), el('p', { class: 'muted', text: getSession().aiAvailable ? 'Choose a configured OpenAI or Anthropic model above. Model choice saves immediately; provider keys remain on the server.' : 'AI is unavailable. Practice, review, personal cards, cases, and fixed worksheets remain usable.' }), button('Sign out', () => document.querySelector('.sidebar-foot button')?.click()), el('p', { class: 'bottom-note', text: 'The installed shell can load without a network. Saved study workflows require a backend connection; there is no offline sync.' })), telemetryPanel())));
}
