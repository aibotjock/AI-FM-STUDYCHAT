import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp, projectReferenceDirectory } from '../server/index.js';
import { createStudyCurriculum } from '../server/study-curriculum.js';

const token = 'reference-directory-test-token-over-24-characters';
const registry = JSON.parse(readFileSync(new URL('../content/source-registry.json', import.meta.url), 'utf8'));
const appText = readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');

async function fixture(t) {
  const dataDir = mkdtempSync(join(tmpdir(), 'studychat-references-'));
  const empty = createStudyCurriculum({ records: [] });
  const server = createApp({ dataDir, curriculum: empty, foundations: empty, env: { STUDY_ACCESS_TOKEN: token }, fetchImpl: () => { throw new Error('Reference browsing must not call an AI provider.'); } });
  server.listen(0, '127.0.0.1');await once(server, 'listening');
  t.after(async () => { await new Promise(resolve => server.close(resolve));rmSync(dataDir, { recursive: true, force: true }); });
  return `http://127.0.0.1:${server.address().port}`;
}

test('external reference directory requires the existing session and only supports GET', async t => {
  const base = await fixture(t);
  assert.equal((await fetch(base + '/api/study/reference-directory')).status, 401);
  const login = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) });
  assert.equal(login.status, 200);
  const headers = { Cookie: login.headers.get('set-cookie').split(';')[0] };
  const response = await fetch(base + '/api/study/reference-directory', { headers });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control'), /no-store/);
  const directory = await response.json();
  assert.equal(directory.total, registry.sources.length);
  assert.equal((await fetch(base + '/api/study/reference-directory', { method: 'POST', headers })).status, 405);
  const logout=await fetch(base + '/api/logout', { method: 'POST', headers: { ...headers, 'Content-Type':'application/json' }, body:'{}' });
  assert.equal(logout.status,200);
  assert.equal((await fetch(base + '/api/study/reference-directory', { headers })).status, 401);
});

test('all requested acronyms are searchable metadata, without evidence or import grants', () => {
  const directory = projectReferenceDirectory(registry);
  assert.equal(directory.sources.length, registry.sources.length);
  for (const acronym of ['AAFP','AAN','AAOS','AAP','ACC','ACOG','ACP','ACS','ADA','AHA','APA','ASCO','CMSS','IDSA','NCCN','ABFM']) {
    assert.ok(directory.sources.some(source => source.acronym.split(/\s|\//).includes(acronym)), `Missing ${acronym}`);
  }
  const allowed = ['id','organization','acronym','title','url','additionalUrls','specialties','referenceType','reuseNotice','checkedAt'];
  for (const source of directory.sources) {
    assert.deepEqual(Object.keys(source).sort(), [...allowed].sort());
    assert.match(source.url, /^https:\/\//);
    assert.equal(new URL(source.url).username, '');
    assert.equal(new URL(source.url).password, '');
    assert.ok(source.reuseNotice);
  }
  assert.match(directory.purpose, /not evidence/);
  assert.equal(JSON.stringify(directory).includes('commercialCorpusUseApproved'), false);
  assert.equal(JSON.stringify(directory).includes('aiProcessingApproved'), false);
  assert.equal(JSON.stringify(directory).includes('licensingRoute'), false);
});

test('the metadata projection rejects unsafe external URLs and bounds content and records', () => {
  const valid = { id: 'sample', organization: 'Publisher', title: 'Title', url: 'https://example.org/guidance', rightsStatus: 'unresolved', notes: 'secret notes', passages: ['not allowed'], questions: ['not allowed'], commercialCorpusUseApproved: true, aiProcessingApproved: true };
  const projected = projectReferenceDirectory({ version: 'v'.repeat(200), sources: [
    ...['javascript:alert(1)','data:text/html,bad','http://example.org','https://user:password@example.org'].map(url => ({ ...valid, url })),
    { ...valid, organization: 'x'.repeat(1000), title: 'y'.repeat(1000), additionalUrls: ['javascript:alert(1)','https://u:p@example.org','https://example.org/other','https://example.org/other'] },
  ] });
  assert.equal(projected.total, 1);
  assert.equal(projected.version.length, 20);
  assert.equal(projected.sources[0].organization.length, 240);
  assert.equal(projected.sources[0].title.length, 300);
  assert.deepEqual(projected.sources[0].additionalUrls, ['https://example.org/other']);
  assert.equal(JSON.stringify(projected).includes('not allowed'), false);
  assert.equal(JSON.stringify(projected).includes('secret notes'), false);
  assert.equal(projectReferenceDirectory({ sources: Array.from({ length: 150 }, (_, index) => ({ ...valid, id: `source-${index}` })) }).total, 125);
});

function shippedDirectoryHarness(apiImpl) {
  const helpers = appText.slice(appText.indexOf('function renderReferenceDirectory()'), appText.indexOf('function curriculumSources('));
  const events = appText.slice(appText.indexOf("document.addEventListener('toggle'"), appText.indexOf("document.addEventListener('change'"));
  const actions = appText.slice(appText.indexOf("    case 'reference-directory-retry':"), appText.indexOf("    case 'library-tab':"));
  assert.ok(helpers && events && actions, 'Locate shipped reference browsing functions and controls.');
  const listeners = {};
  const nodes = { '#external-reference-results': { innerHTML: '' }, '#reference-directory-search': { value: '' } };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[character]));
  const safeUrl = value => { try { const url=new URL(value);return ['http:','https:'].includes(url.protocol)?url.href:''; } catch { return ''; } };
  const factory = new Function('esc','safeUrl','api','$','curriculumIsVisible','document', `
    let referenceDirectory=null,referenceDirectoryOpen=false,referenceDirectoryLoading=false,referenceDirectoryError='',referenceDirectorySearch='',referenceDirectoryRequest=0;
    let referenceSearchQuery='',referenceSearchResults=null,referenceSearchLoading=false,referenceSearchError='',referenceSearchRequest=0;
    ${helpers}\n${events}
    function action(value) { switch(value) { ${actions} } }
    return { render:renderReferenceDirectory,load:loadReferenceDirectory,action,results:renderReferenceDirectoryResults,reset:()=>{referenceDirectoryRequest++;referenceDirectory=null;},state:()=>({referenceDirectoryOpen,referenceDirectoryLoading,referenceDirectoryError}) };`);
  const runtime = factory(escape,safeUrl,apiImpl,selector=>nodes[selector],()=>true,{ addEventListener:(name,listener)=>{listeners[name]=listener;} });
  return { ...runtime,nodes,listeners };
}

test('shipped Library directory loads on opening, filters acronyms, clears, retries and escapes links', async () => {
  const directory = projectReferenceDirectory(registry);
  directory.sources[0].organization='<img src=x onerror=alert(1)>';
  let calls=0,fail=false;
  const ui = shippedDirectoryHarness(async path => { calls++;assert.equal(path,'/api/study/reference-directory');if(fail) throw new Error('Synthetic connection loss.');return directory; });
  assert.equal(calls,0);
  assert.match(ui.render(), /id="reference-directory"/);
  assert.doesNotMatch(ui.render(), /id="reference-directory" open/);
  ui.listeners.toggle({ target:{id:'reference-directory',open:true} });
  await ui.load();await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls,1);
  assert.equal(ui.state().referenceDirectoryOpen,true);
  assert.match(ui.nodes['#external-reference-results'].innerHTML, /&lt;img/);
  assert.doesNotMatch(ui.nodes['#external-reference-results'].innerHTML, /<img/);
  assert.match(ui.nodes['#external-reference-results'].innerHTML, /rel="noopener noreferrer"/);
  ui.listeners.input({ target:{id:'reference-directory-search',value:'AAOS'} });
  assert.match(ui.nodes['#external-reference-results'].innerHTML,new RegExp(`1 of ${registry.sources.length}`));
  assert.match(ui.nodes['#external-reference-results'].innerHTML,/American Academy of Orthopaedic Surgeons/);
  ui.action('reference-directory-clear');
  assert.match(ui.nodes['#external-reference-results'].innerHTML,new RegExp(`${registry.sources.length} of ${registry.sources.length}`));
  ui.listeners.toggle({ target:{id:'reference-directory',open:false} });
  ui.listeners.toggle({ target:{id:'reference-directory',open:true} });
  await new Promise(resolve=>setImmediate(resolve));assert.equal(calls,1);
  ui.reset();fail=true;await ui.load();
  assert.match(ui.results(), /Synthetic connection loss/);
  assert.match(ui.results(), /data-action="reference-directory-retry"/);
  fail=false;await ui.action('reference-directory-retry');
  assert.equal(calls,3);assert.equal(ui.state().referenceDirectoryError,'');
  assert.match(appText,/\$\{renderReferenceDirectory\(\)\}/,'Directory is reachable from the Library curriculum view.');
});
