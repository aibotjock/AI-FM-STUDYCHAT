import { HttpError } from './errors.js';
import { validateSettings } from './store.js';

const STATE_KEYS = ['settings', 'cards', 'reviews', 'boardPractice', 'chatStudy', 'studySeedVersion', 'legacySettings', 'legacyStudyRecords', 'historicalSelfAssessments'];
const SECRET_KEYS = new Set(['apikey', 'openaiapikey', 'openaikey', 'accesstoken', 'studyaccesstoken', 'sessiontoken', 'token', 'authorization', 'cookie', 'cookies', 'password', 'credentials', 'rawaudio', 'audiobuffer']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const invalid = message => { throw new HttpError(400, message, 'invalid_backup'); };

// Credentials belong to configuration/session memory, never a learner backup.
function learnerCopy(value, depth = 0) {
  if (depth > 30) invalid('Backup metadata is too deeply nested.');
  if (Array.isArray(value)) return value.map(item => learnerCopy(item, depth + 1));
  if (!object(value)) return value;
  const copy = {};
  for (const [key, item] of Object.entries(value)) {
    if (['__proto__', 'constructor', 'prototype'].includes(key) || SECRET_KEYS.has(key.replace(/[_-]/g, '').toLowerCase())) continue;
    copy[key] = learnerCopy(item, depth + 1);
  }
  return copy;
}

function stateProjection(input) {
  if (!object(input) || !Array.isArray(input.cards) || !Array.isArray(input.reviews) || !object(input.settings)) invalid('Backup study state is invalid.');
  const state = {};
  for (const key of STATE_KEYS) if (input[key] !== undefined) state[key] = learnerCopy(input[key]);
  return state;
}

function cardProvenance(cards) {
  for (const card of cards) {
    if (!object(card)) invalid('Invalid backup card.');
    for (const key of ['sourceCheckedAt', 'sourceExpiresAt']) {
      if (card[key] === undefined) continue;
      const date = card[key];
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(`${date}T00:00:00Z`)) || new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) !== date) invalid(`Invalid card ${key}.`);
    }
    for (const key of ['sourceVerified', 'humanReview', 'importedSource']) if (card[key] !== undefined && typeof card[key] !== 'boolean') invalid(`Invalid card ${key}.`);
  }
}

function text(value, name, max, optional = false) {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || value.length > max || value.includes('\0') || (!optional && !value.trim())) invalid(`Invalid backup ${name}.`);
}
function timestamp(value, name) {
  if (!Number.isFinite(value) || value < 0 || value > 8640000000000000) invalid(`Invalid backup ${name}.`);
}
function unique(items, label) {
  if (new Set(items).size !== items.length) invalid(`Duplicate ${label} in backup.`);
}

function legacyConversations(input) {
  if (!Array.isArray(input) || input.length > 500) invalid('Backup has too many conversations.');
  const result = learnerCopy(input);
  for (const conversation of result) {
    if (!object(conversation) || !['coach', 'simulation', 'practice'].includes(conversation.mode) || !Array.isArray(conversation.messages) || conversation.messages.length > 1000) invalid('Invalid legacy conversation.');
    text(conversation.id, 'conversation ID', 100); text(conversation.title, 'conversation title', 160); timestamp(conversation.createdAt, 'conversation time');
    text(conversation.scenarioId, 'scenario ID', 100, true); text(conversation.curriculumConditionId, 'condition ID', 100, true);
    for (const message of conversation.messages) {
      if (!object(message) || !['user', 'assistant'].includes(message.role)) invalid('Invalid legacy message.');
      text(message.id, 'message ID', 100); text(message.content, 'message text', 20000); timestamp(message.createdAt, 'message time');
      text(message.requestId, 'request ID', 100, true); text(message.responseTo, 'response ID', 100, true);
      for (const key of ['sourceVerified', 'humanReview', 'current', 'grounded', 'canonicalStudyProcess', 'unsupported', 'voiceTranscript', 'offline', 'importedEvidence']) {
        if (message[key] !== undefined && typeof message[key] !== 'boolean') invalid(`Invalid legacy ${key}.`);
      }
      if (message.citations !== undefined) {
        if (!Array.isArray(message.citations) || message.citations.length > 10) invalid('Invalid legacy references.');
        for (const source of message.citations) {
          if (!object(source)) invalid('Invalid legacy reference.');
          text(source.id, 'reference ID', 100); text(source.title, 'reference title', 300); text(source.url, 'reference URL', 2048);
          let url; try { url = new URL(source.url); } catch { invalid('Invalid legacy reference URL.'); }
          if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) invalid('Unsafe legacy reference URL.');
        }
      }
    }
    unique(conversation.messages.map(message => message.id), 'message IDs');
    const requests = conversation.messages.filter(message => message.requestId !== undefined);
    if (requests.some(message => message.role !== 'user')) invalid('Only user messages have request IDs.');
    unique(requests.map(message => message.requestId), 'request IDs');
    const userIds = new Set(conversation.messages.filter(message => message.role === 'user').map(message => message.id));
    if (conversation.messages.some(message => message.responseTo !== undefined && (message.role !== 'assistant' || !userIds.has(message.responseTo)))) invalid('Legacy reply references an unknown user message.');
  }
  unique(result.map(conversation => conversation.id), 'conversation IDs');
  return result;
}

function oldSettings(input = {}) {
  if (!object(input)) invalid('Invalid legacy settings.');
  const mapped = {};
  if (input.focus !== undefined) { if (!['clinical-reasoning', 'exam', 'balanced'].includes(input.focus)) invalid('Invalid legacy focus.'); mapped.focus = input.focus === 'exam' ? 'exam-preparation' : input.focus; }
  if (input.coachStyle !== undefined) { mapped.style = { socratic: 'guided-questions', direct: 'concise', 'teach-quiz': 'detailed' }[input.coachStyle]; if (!mapped.style) invalid('Invalid legacy coaching style.'); }
  for (const [old, current] of [['dailyMinutes', 'sessionMinutes'], ['newCardsPerDay', 'newCardLimit'], ['voiceId', 'voice'], ['timeZone', 'timeZone'], ['voiceEnabled', 'voiceEnabled']]) if (input[old] !== undefined) mapped[current] = input[old];
  if (input.newCardsPerDay !== undefined && (!Number.isInteger(input.newCardsPerDay) || input.newCardsPerDay < 0 || input.newCardsPerDay > 50)) invalid('Invalid legacy new-card limit.');
  const legacy = {};
  for (const key of ['focus', 'coachStyle', 'dailyMinutes', 'newCardsPerDay', 'voiceId', 'timeZone', 'voiceEnabled']) if (input[key] !== undefined) legacy[key] = input[key];
  let historicalSelfAssessments;
  if (input.competencyRatings !== undefined) {
    if (!object(input.competencyRatings) || Object.entries(input.competencyRatings).some(([key, rating]) => !['PC', 'MK', 'PBLI', 'ICS', 'PROF', 'SBP'].includes(key) || !Number.isInteger(rating) || rating < 1 || rating > 5)) invalid('Invalid legacy self-assessment ratings.');
    historicalSelfAssessments = { competencyRatings: { ...input.competencyRatings }, label: 'Imported learner self-assessment; not an official competency assessment' };
    legacy.competencyRatings = { ...input.competencyRatings };
  }
  return { settings: validateSettings(mapped), legacySettings: legacy, ...(historicalSelfAssessments ? { historicalSelfAssessments } : {}) };
}

export function createBackupService({ store, chat, study, maxBytes = 16 * 1024 * 1024, now = Date.now } = {}) {
  function bounded(snapshot) {
    let encoded; try { encoded = JSON.stringify(snapshot); } catch { invalid('Backup must contain ordinary JSON data.'); }
    if (!encoded || Buffer.byteLength(encoded) > maxBytes) throw new HttpError(413, 'Backup exceeds the 16 MiB limit. Remove older records before exporting or restoring.', 'backup_too_large');
    return snapshot;
  }
  function exportBackup() {
    // Logical SQLite reads are synchronous; no WAL file is copied mid-write.
    const snapshot = store.transaction(() => ({ format: 'studychat-no-rag', version: 2, exportedAt: now(), state: stateProjection(store.getState()), chat: learnerCopy(chat.exportData()) }));
    return bounded(snapshot);
  }
  function importBackup(snapshot) {
    bounded(snapshot);
    if (chat.hasActiveWork()) throw new HttpError(409, 'Stop active chat before restoring a backup.', 'chat_busy');
    let state, chatData;
    if (snapshot?.version === 1) {
      if (!Array.isArray(snapshot.cards) || !Array.isArray(snapshot.reviews)) invalid('Choose a version 1 or version 2 StudyChat backup.');
      const archive = legacyConversations(snapshot.conversations);
      state = { cards: learnerCopy(snapshot.cards), reviews: learnerCopy(snapshot.reviews), ...oldSettings(snapshot.settings), boardPractice: learnerCopy(snapshot.boardPractice), chatStudy: {}, studySeedVersion: 1 };
      if (snapshot.boardPractice !== undefined) state.legacyStudyRecords = { boardPractice: learnerCopy(snapshot.boardPractice), label: 'Imported historical practice records; not trusted grading state' };
      chatData = { version: 1, conversations: [], turns: [], attempts: [], legacyRecords: archive };
    } else if (snapshot?.version === 2 && snapshot.format === 'studychat-no-rag') {
      state = stateProjection(snapshot.state);
      if (!object(snapshot.chat)) invalid('Backup chat state is invalid.');
      chatData = learnerCopy(snapshot.chat);
      chatData.legacyRecords = legacyConversations(chatData.legacyRecords || []);
    } else invalid('Choose a version 1 or version 2 StudyChat backup.');
    cardProvenance(state.cards);
    const validState = study.validateImport(state);
    const validChat = chat.validateImport(chatData);
    bounded({ format: 'studychat-no-rag', version: 2, exportedAt: now(), state: validState, chat: validChat });
    return store.transaction(() => {
      // Validation precedes all writes; either every learner table changes or none does.
      if (chat.hasActiveWork()) throw new HttpError(409, 'Stop active chat before restoring a backup.', 'chat_busy');
      store.saveState(validState);
      store.db.exec('DELETE FROM study_actions');
      const imported = chat.importData(validChat);
      return { restored: true, version: snapshot.version, cards: validState.cards.length, reviews: validState.reviews.length, conversations: imported.conversations + validChat.legacyRecords.length, importedHistory: true };
    });
  }
  return { export: exportBackup, import: importBackup };
}
