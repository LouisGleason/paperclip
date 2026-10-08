// Keep public-package lifecycle code off the verification host. Resolve and
// cache the public npm graph without scripts, then execute it offline.
export const GROK_PUBLIC_INSTALL_IMAGE =
  'node:24-trixie@sha256:be40f6a87b9b22215ddb20da0a2320a5c6d583fe3ee3b0024d9fa4f05b40c8fd';
// Complete the scripts-disabled install without resolving the graph again.
export const GROK_PUBLIC_INSTALL_LIFECYCLE = [
  'npm', 'rebuild', '--offline', '--ignore-scripts=false', '--dangerously-allow-all-scripts',
];

// Execute this in the existing offline public consumer, never in the checkout.
// The public index and returned command must both come from the installed graph.
export function installedCodexProbeSource(indexPath, consumerRoot, expectedVersion) {
  return `
    import assert from 'node:assert/strict';
    import { execFileSync } from 'node:child_process';
    import { accessSync, constants, realpathSync, statSync } from 'node:fs';
    import { isAbsolute, relative, sep } from 'node:path';
    import { pathToFileURL } from 'node:url';
    const root = realpathSync(${JSON.stringify(consumerRoot)});
    const contained = path => { const value = relative(root, realpathSync(path)); return value !== '' && value !== '..' && !value.startsWith('..' + sep) && !isAbsolute(value); };
    const index = ${JSON.stringify(indexPath)};
    assert.ok(contained(index), 'Codex public index must be installed in the consumer');
    const { resolvePinnedCodexCommand } = await import(pathToFileURL(index).href);
    assert.equal(typeof resolvePinnedCodexCommand, 'function', 'Installed public index must export the pinned Codex resolver');
    const command = resolvePinnedCodexCommand();
    assert.ok(isAbsolute(command) && contained(command), 'Pinned Codex must resolve inside the installed consumer');
    assert.ok(statSync(command).isFile(), 'Pinned Codex must be a regular executable');
    accessSync(command, constants.X_OK);
    const version = execFileSync(command, ['--version'], { timeout: 30_000, maxBuffer: 128 * 1024, encoding: 'utf8',
      env: { PATH: '/usr/local/bin:/usr/bin:/bin', HOME: '/tmp', NODE_PATH: '' } }).trim();
    assert.equal(version, 'codex-cli ' + ${JSON.stringify(expectedVersion)}, 'Installed Codex version must match the qualified pin');
    console.log(JSON.stringify({ pinnedCodexCommandVerified: true, pinnedCodexVersion: ${JSON.stringify(expectedVersion)}, providerCalls: 0 }));
  `;
}

export function grokConsumerDockerArgs({ assets, consumer, cache, command, uid, gid, download = false, prerequisite, temporarySizeMb = 256 }) {
  if (!Number.isSafeInteger(uid) || uid <= 0 || !Number.isSafeInteger(gid) || gid <= 0) {
    throw new Error('Public-install verification requires an unprivileged host user');
  }
  if (!Number.isSafeInteger(temporarySizeMb) || temporarySizeMb < 256 || temporarySizeMb > 2048) throw new Error('Invalid bounded public-install temporary size');
  return [
    'run', '--rm', '--platform', 'linux/amd64',
    '--user', `${uid}:${gid}`, '--read-only',
    '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges',
    '--pids-limit', '256', '--memory', '3g',
    '--network', download ? 'bridge' : 'none',
    '--tmpfs', `/tmp:rw,nosuid,nodev,size=${temporarySizeMb}m,mode=1777`,
    '--env', 'HOME=/tmp', '--env', 'npm_config_cache=/cache',
    '--env', 'npm_config_nodedir=/usr/local',
    '--env', 'npm_config_audit=false', '--env', 'npm_config_fund=false',
    '--env', `npm_config_ignore_scripts=${download ? 'true' : 'false'}`,
    '--mount', `type=bind,src=${assets},dst=/packages,readonly`,
    '--mount', `type=bind,src=${consumer},dst=/consumer`,
    '--mount', `type=bind,src=${cache},dst=/cache`,
    ...(prerequisite ? ['--mount', `type=bind,src=${prerequisite},dst=/opt/paperclip/providers/grok/1.0.13/grok,readonly`] : []),
    '--workdir', '/consumer', GROK_PUBLIC_INSTALL_IMAGE, ...command,
  ];
}
