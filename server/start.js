import { loadConfig } from './config.js';
import { buildApplication } from './bootstrap.js';

const config = loadConfig();
const app = buildApplication({ config });
app.server.listen(config.port, config.host, () => console.log(JSON.stringify({ event: 'listening', port: app.server.address().port, node: process.version, aiAvailable: !!(config.apiKey || config.anthropicApiKey), model: config.model })));
let closing = false;
async function stop() { if (closing) return; closing = true; await app.shutdown(); }
process.on('SIGTERM', () => { void stop(); }); process.on('SIGINT', () => { void stop(); });
