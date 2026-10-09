import * as fs from 'node:fs';

/** Prepare only the fixed container data mount, then irreversibly drop root.
 * Dependencies are injectable for failure-path tests; the launcher supplies none.
 * No application code, network listener, or database is loaded here.
 */
export function initializeContainer({ env = process.env, identity = process, filesystem = fs } = {}) {
  const mount = '/app/data';
  if (env.DATA_DIR !== mount) throw new Error('Container DATA_DIR must be exactly /app/data.');
  identity.umask(0o077);
  if (identity.getuid() === 0) {
    if (!filesystem.existsSync(mount)) filesystem.mkdirSync(mount, { mode: 0o700 });
    const entry = filesystem.lstatSync(mount);
    if (entry.isSymbolicLink() || !entry.isDirectory() || filesystem.realpathSync(mount) !== mount) throw new Error('The data mount must be a real directory, never a symlink.');
    // No recursive ownership changes; application source remains root-owned.
    filesystem.chownSync(mount, 1000, 1000);
    filesystem.chmodSync(mount, 0o700);
    identity.setgroups([]);
    identity.setgid(1000);
    identity.setuid(1000);
  }
  if ([identity.getuid(), identity.geteuid(), identity.getgid(), identity.getegid()].some(value => value !== 1000) || identity.getgroups().includes(0)) throw new Error('The application must run as UID/GID 1000 without root groups.');
  // Linux exposes real, effective, saved, and filesystem IDs independently.
  const status = filesystem.readFileSync('/proc/self/status', 'utf8');
  for (const label of ['Uid', 'Gid']) {
    const match = new RegExp(`^${label}:\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)$`, 'm').exec(status);
    if (!match || match.slice(1).some(value => value !== '1000')) throw new Error('Privilege drop did not remove all root identities.');
  }
  for (const label of ['CapEff', 'CapPrm']) {
    const match = new RegExp(`^${label}:\\s+([0-9a-f]+)$`, 'mi').exec(status);
    if (!match || BigInt('0x' + match[1]) !== 0n) throw new Error('Privileged kernel capabilities remain after identity removal.');
  }
  filesystem.accessSync(mount, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
  return { uid: identity.getuid(), gid: identity.getgid() };
}
