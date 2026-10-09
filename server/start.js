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
    const { createAiProvider } = await import('./ai-provider.js');
    const provider = createAiProvider();
    server.listen(port, host, () => console.log(`Family Medicine Study Coach ready on ${host}:${port}. ${provider.label} ${provider.configured ? `configured (${provider.model})` : 'not configured'}.`));
    const shutdown = () => server.close(() => process.exit(0));
    process.on('SIGTERM', shutdown);
    process.on('SIGINT', shutdown);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
