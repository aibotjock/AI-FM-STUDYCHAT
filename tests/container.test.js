import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { initializeContainer } from '../server/container-init.js';

function fixture({ symlink = false, realpath = '/app/data', dropFails = false } = {}) {
  const calls = []; let uid = 0, gid = 0, groups = [0];
  const identity = {
    umask: value => calls.push(['umask', value]), getuid: () => uid, geteuid: () => uid, getgid: () => gid, getegid: () => gid, getgroups: () => groups,
    setgroups: value => { calls.push(['groups', value]); groups = value; },
    setgid: value => { calls.push(['gid', value]); gid = value; },
    setuid: value => { calls.push(['uid', value]); if (!dropFails) uid = value; },
  };
  const filesystem = {
    existsSync: () => true, lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => symlink }), realpathSync: () => realpath,
    chownSync: (...args) => calls.push(['chown', ...args]), chmodSync: (...args) => calls.push(['chmod', ...args]),
    readFileSync: () => `Uid:\t${uid}\t${uid}\t${uid}\t${uid}\nGid:\t${gid}\t${gid}\t${gid}\t${gid}\nCapEff:\t0000000000000000\nCapPrm:\t0000000000000000\n`, accessSync: (...args) => calls.push(['access', ...args]),
  };
  return { env: { DATA_DIR: '/app/data' }, identity, filesystem, calls };
}

test('container storage initialization is bounded and privilege removal precedes app startup', () => {
  const value = fixture(); assert.deepEqual(initializeContainer(value), { uid: 1000, gid: 1000 });
  assert.deepEqual(value.calls.slice(1, 6), [['chown', '/app/data', 1000, 1000], ['chmod', '/app/data', 448], ['groups', []], ['gid', 1000], ['uid', 1000]]);
  assert.equal(value.calls.at(-1)[0], 'access');
});

test('container refuses escaping mounts, symlinks and failed privilege removal', () => {
  const wrong = fixture(); wrong.env.DATA_DIR = '/app/data/../../';
  assert.throws(() => initializeContainer(wrong), /exactly/); assert.equal(wrong.calls.length, 0);
  for (const value of [fixture({ symlink: true }), fixture({ realpath: '/other' })]) {
    assert.throws(() => initializeContainer(value), /real directory/); assert.equal(value.calls.some(call => call[0] === 'chown'), false);
  }
  const failed = fixture({ dropFails: true }); assert.throws(() => initializeContainer(failed), /UID\/GID/);
  assert.equal(failed.calls.some(call => call[0] === 'access'), false);
});

const canDropIdentity = process.platform === 'linux' && process.getuid?.() === 0 &&
  (BigInt('0x' + (/^CapEff:\s+([0-9a-f]+)$/m.exec(readFileSync('/proc/self/status', 'utf8'))?.[1] || '0')) & 0xc0n) === 0xc0n;
test('kernel privilege drop cannot regain root in an isolated child process', { skip: canDropIdentity ? false : 'Executor lacks Linux CAP_SETUID/CAP_SETGID; verify runtime identities in the deployed container.' }, () => {
  const moduleUrl = new URL('../server/container-init.js', import.meta.url).href;
  const script = `import {initializeContainer} from ${JSON.stringify(moduleUrl)}; import * as fs from 'node:fs';
    const filesystem = { ...fs, existsSync: () => true, lstatSync: () => ({isDirectory:()=>true,isSymbolicLink:()=>false}), realpathSync:()=>'/app/data', chownSync:()=>{}, chmodSync:()=>{}, accessSync:()=>{} };
    initializeContainer({env:{DATA_DIR:'/app/data'},filesystem});
    let regained=false;try{process.seteuid(0);regained=true;}catch{}
    process.stdout.write(JSON.stringify({uid:process.getuid(),euid:process.geteuid(),regained}));`;
  const child = spawnSync(process.execPath, ['--input-type=module'], { input: script, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { uid: 1000, euid: 1000, regained: false });
});
