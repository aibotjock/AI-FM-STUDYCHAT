import { readFileSync } from 'node:fs';
import { createStore } from './store.js';
import { createModelGateway } from './provider.js';
import { createIngeniumTelemetry } from './telemetry.js';
import { createChatService } from './chat.js';
import { createStudyService } from './study.js';
import { createBackupService } from './backup.js';
import { createApp } from './app.js';
import { createReferenceDirectory } from './references.js';
import { createVoiceService } from './voice.js';

export function buildApplication({ config, provider: suppliedProvider } = {}) {
  const store = createStore({ dataDir: config.dataDir, maxBytes: config.backupBytes });
  const bank = JSON.parse(readFileSync(new URL('../content/medical-question-bank.json', import.meta.url), 'utf8'));
  const study = createStudyService({ store, bank });
  const telemetry = createIngeniumTelemetry({ db: store.db, config });
  const models = createModelGateway({ config, onSettled: metadata => telemetry.record(metadata) });
  const provider = suppliedProvider || models;
  const references = createReferenceDirectory();
  const chat = createChatService({ db: store.db, provider, config,
    getSelection: () => { const settings = study.settings(); return { provider: settings.aiProvider, model: settings.aiModel || (settings.aiProvider === 'anthropic' ? config.anthropicModel : config.model) }; },
    getContext: ({ conversationId, input, referenceIds = [] }) => {
      const context = study.getChatContext(conversationId, input);
      if (!referenceIds.length) return context;
      try { const links = references.resolveIds(referenceIds).map(({ id, title, url, records }) => ({ id, title, url, label: 'Reference link', consulted: false, datesAndRights: records.map(record => ({ edition: record.metadata.edition, checkedAt: record.metadata.checkedAt, rightsStatus: record.metadata.rightsStatus })) })); return `${context}\nRequested reference links (directory metadata only; exact documents were not read; do not claim consultation or current checked recommendations): ${JSON.stringify(links)}`; }
      catch (error) { if (error.code !== 'source_unavailable') throw error; return `${context}\nRequested reference directory is unavailable. Explain the source limit, and still provide useful conversation within your tutor rules.`; }
    },
    resolveTurn: ({ conversationId, input, turnId }) => study.resolveChatTurn({ conversationId, text: input, turnId })
  });
  const backup = createBackupService({ store, chat, study, maxBytes: config.backupBytes });
  const voice = createVoiceService({ db: store.db, chat, config });
  store.db.prepare('INSERT OR IGNORE INTO schema_version VALUES(3)').run();
  const app = createApp({ config, chat, study, backup, references, voice, telemetry, models: suppliedProvider?.catalogue ? suppliedProvider : models });
  return { ...app, store, chat, study, backup, references, voice, models, telemetry, async shutdown() { voice.close(); chat.close(); await app.close(); await telemetry.close(); store.close(); } };
}
