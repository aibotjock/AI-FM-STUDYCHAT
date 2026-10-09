// Commercial mode is opt-in; a typo must never expose the personal workspace.
const mode = process.env.APP_MODE || 'personal';
if (!['personal', 'commercial'].includes(mode)) throw new Error('APP_MODE must be personal or commercial.');
try {
  if (mode === 'commercial') {
    const { startCommercial } = await import('./commercial/index.js');
    startCommercial();
  } else {
    const { createApp } = await import('./index.js');
    const port = Number(process.env.PORT || 3000);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be from 1 to 65535.');
    const host = process.env.HOST || '127.0.0.1';
    const server = createApp();
    server.listen(port, host, async () => {
      console.log(`Family Medicine Study Coach ready on ${host}:${port}. Check Study preferences for the active AI model.`);
      if (process.env.INGENIUM_INITIAL_CONNECTION_CHECK === 'ready-v1') {
        const { runIngeniumConnectionCheck } = await import('./ingenium-check.js');
        const result = await runIngeniumConnectionCheck({ baseUrl: `http://127.0.0.1:${port}/`, flushTelemetry: () => server.flushIngeniumTelemetry() });
        console.log('Ingenium registration check:', JSON.stringify(result));
      }
      if (process.env.STUDY_INITIAL_SOURCE_CHECK === 'source-v1') {
        const { runStudySourceCheck } = await import('./study-check.js');
        const result = await runStudySourceCheck({ baseUrl: `http://127.0.0.1:${port}/`, flushTelemetry: () => server.flushIngeniumTelemetry() });
        console.log('Study source selector check:', JSON.stringify(result));
      }
      if (process.env.STUDY_INITIAL_CONVERSATION_CHECK === 'dialogue-v2') {
        const { runConversationCheck } = await import('./conversation-check.js');
        const result = await runConversationCheck({ baseUrl: `http://127.0.0.1:${port}/`, flushTelemetry: () => server.flushIngeniumTelemetry() });
        console.log('Study conversational tutor check:', JSON.stringify(result));
      }
    });
    const shutdown = async () => { await server.closeVoiceSessions(); server.close(() => process.exit(0)); };
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
