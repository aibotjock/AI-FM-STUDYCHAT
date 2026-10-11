import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildApplication } from '../server/bootstrap.js';
import { loadConfig } from '../server/config.js';

const modulePath = process.env.PLAYWRIGHT_MODULE;
const executablePath = process.env.CHROMIUM_EXECUTABLE;
if (!modulePath || !executablePath) throw new Error('Set PLAYWRIGHT_MODULE and CHROMIUM_EXECUTABLE to your test tools. They are not production dependencies.');
const { chromium } = createRequire(import.meta.url)(modulePath);
const dataDir = mkdtempSync(`${tmpdir()}/studychat-browser-`);
const token = randomUUID(); let calls = 0;
const modelChoices = [
  { id: 'gpt-4.1-mini', provider: 'openai', label: 'GPT-4.1 mini', tier: 'standard', available: true, limits: { maxPromptBytes: 24000, maxOutputTokens: 1200 } },
  { id: 'claude-opus-5-5', provider: 'anthropic', label: 'Claude Opus 5.5', tier: 'limited', available: true, limits: { maxPromptBytes: 8000, maxOutputTokens: 768 } }
];
const provider = { available: true, async catalogue() { return { providers: [{ id: 'openai', label: 'OpenAI', configured: true }, { id: 'anthropic', label: 'Anthropic', configured: true }], models: modelChoices, defaultSelection: { provider: 'openai', model: 'gpt-4.1-mini' } }; }, async resolveSelection(selection) { if (!modelChoices.some(model => model.provider === selection.provider && model.id === selection.model)) throw new Error('Invalid fixture model'); return selection; }, async generate({ messages, selection, onDelta, signal }) {
  calls++; const input = messages.at(-1).content;
  if (input === 'Wait for Stop') await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
  signal.throwIfAborted(); const content = `Coach received: ${input}`; onDelta('Coach received: '); await new Promise(resolve => setTimeout(resolve, 60)); onDelta(input); return { content, model: selection.model, provider: selection.provider };
} };
const app = buildApplication({ config: loadConfig({ HOST: '127.0.0.1', PORT: '0', DATA_DIR: dataDir, STUDY_ACCESS_TOKEN: token, OPENAI_API_KEY: 'test-placeholder' }), provider });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${app.server.address().port}`;
let browser;
const errors = [], checks = [], requests = [];
let page;
try {
  browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(8000);
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push(new URL(request.url()).pathname));
  await page.goto(origin); await page.getByLabel('Study access token').fill(token); await page.getByRole('button', { name: 'Open workspace', exact: true }).click();
  await page.getByLabel('Message Coach').fill('Hello'); await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByText('Coach received: Hello', { exact: true }).waitFor();
  assert.equal(calls, 1); assert.ok(!requests.some(path => path.startsWith('/api/references') || path.startsWith('/api/voice'))); checks.push('authenticated typed stream; one model request; no reference/audio requests');
  const modelSaved = page.waitForResponse(response => response.url().endsWith('/api/settings') && response.request().postData()?.includes('claude-opus-5-5'));
  await page.getByLabel('Chat model', { exact: true }).selectOption(JSON.stringify(['anthropic', 'claude-opus-5-5'])); await modelSaved;
  await page.getByText(/768/).first().waitFor();
  await page.reload(); assert.equal(await page.getByLabel('Chat model', { exact: true }).inputValue(), JSON.stringify(['anthropic', 'claude-opus-5-5']));
  await page.getByLabel('Message Coach').fill('Chosen Claude'); await page.getByRole('button', { name: 'Send message', exact: true }).click(); await page.getByText('Coach received: Chosen Claude', { exact: true }).waitFor(); checks.push('provider/model selection persists; limited-model caps visible; unified chat uses captured selection');
  await page.reload(); await page.getByText('Coach received: Hello', { exact: true }).waitFor(); checks.push('saved history after reload');
  await page.getByLabel('Message Coach').fill('Wait for Stop'); await page.getByRole('button', { name: 'Send message', exact: true }).click(); await page.getByRole('button', { name: 'Stop', exact: true }).click();
  await page.getByText(/Cancelled/).first().waitFor(); checks.push('Stop visibly cancels');
  await page.locator('.tabbar [data-tab="practice"]').click(); await page.getByRole('button', { name: 'Start practice', exact: true }).click(); await page.getByRole('button', { name: 'Check answer', exact: true }).waitFor();
  await page.locator('.option').first().click(); await page.getByRole('button', { name: 'Check answer', exact: true }).click(); await page.getByText('Answer saved', { exact: true }).waitFor(); await page.reload(); await page.locator('.tabbar [data-tab="practice"]').click(); await page.getByRole('button', { name: 'Previous', exact: true }).click(); await page.getByText('Answer saved', { exact: true }).waitFor(); checks.push('practice grading and saved resume');
  await page.getByRole('button', { name: 'Finish session', exact: true }).click();
  await page.locator('.tabbar [data-tab="review"]').click(); await page.getByRole('button', { name: 'Reveal answer', exact: true }).click(); await page.getByRole('button', { name: /^Good/ }).click(); checks.push('review reveal and rating');
  await page.getByRole('button', { name: '+ New card', exact: true }).click(); await page.getByLabel('Front').fill('Browser fixture question'); await page.getByLabel('Back').fill('Browser fixture answer'); await page.getByRole('button', { name: 'Save card', exact: true }).click(); await page.getByText('Browser fixture question', { exact: true }).waitFor(); checks.push('personal card creation');
  await page.locator('.tabbar [data-tab="library"]').click(); await page.getByRole('button', { name: 'References', exact: true }).click(); await page.getByLabel('Search library').fill('AHRQ'); await page.getByRole('button', { name: 'Search', exact: true }).click(); await page.getByText(/Reference link · not consulted/i).first().waitFor(); checks.push('lazy reference search and truthful labels');
  await page.locator('.tabbar [data-tab="settings"]').click(); await page.getByLabel('Session minutes').fill('20'); await page.getByLabel('Voice', { exact: true }).selectOption('af_bella'); await page.getByRole('button', { name: 'Save preferences', exact: true }).click(); await page.getByText('Preferences saved.', { exact: true }).waitFor(); checks.push('settings persistence');
  await page.getByRole('heading', { name: 'Ingenium test client', exact: true }).waitFor(); await page.getByText('Disabled', { exact: true }).waitFor(); const monitoring = page.waitForResponse(response => response.url().endsWith('/api/telemetry') && response.request().method() === 'GET'); await page.getByRole('button', { name: 'Refresh monitoring status', exact: true }).click(); assert.equal((await (await monitoring).json()).configured, false); checks.push('private monitoring status and refresh without browser credentials');
  const downloadPromise = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download JSON backup', exact: true }).click(); const download = await downloadPromise; const backupPath = await download.path(); assert.ok(backupPath); checks.push('JSON backup download');
  await page.getByLabel('Select a JSON backup').setInputFiles(backupPath); await page.getByRole('button', { name: 'Restore selected backup', exact: true }).click(); await page.getByLabel('Message Coach').waitFor(); checks.push('validated backup restore in browser');
  await page.getByRole('button', { name: 'Start voice conversation', exact: true }).click(); const voiceDialog = page.getByRole('dialog', { name: 'Voice conversation', exact: true }); await voiceDialog.waitFor(); assert.equal(await voiceDialog.getByRole('button', { name: 'Start conversation', exact: true }).isDisabled(), true); await voiceDialog.getByRole('button', { name: 'Use typed chat', exact: true }).click(); await page.getByLabel('Message Coach').fill('After device voice uninstalled'); await page.getByRole('button', { name: 'Send message', exact: true }).click(); await page.getByText('Coach received: After device voice uninstalled', { exact: true }).waitFor(); checks.push('uninstalled device voice keeps capture disabled and typed chat usable without a paid speech fallback');
  await page.locator('.tabbar [data-tab="progress"]').click(); assert.ok((await page.locator('body').innerText()).includes('Study signals')); checks.push('progress uses study labels');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false); assert.deepEqual(errors, []); checks.push('390px layout; no page errors');
  await page.screenshot({ path: process.env.BROWSER_SCREENSHOT || '/tmp/studychat-phone.png', fullPage: true });
  const result = { browser: await browser.version(), mockedProvider: true, calls, checks, errors };
  if (process.env.BROWSER_RESULTS) writeFileSync(process.env.BROWSER_RESULTS, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} catch (error) { console.error(JSON.stringify({ failure: error.message, errors, checks, body: await page?.locator('body').innerText() })); throw error; }
finally { await browser?.close(); await app.shutdown(); rmSync(dataDir, { recursive: true, force: true }); }
