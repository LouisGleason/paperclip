import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GROK_PUBLIC_INSTALL_IMAGE, GROK_PUBLIC_INSTALL_LIFECYCLE, grokConsumerDockerArgs, installedCodexProbeSource } from '../grok-public-install-sandbox.mjs';

const paths = { assets: '/private/staging/assets', consumer: '/private/staging/consumer', cache: '/private/staging/cache', uid: 1001, gid: 1001 };
const values = (args, flag) => args.flatMap((value, index) => value === flag ? [args[index + 1]] : []);

test('lifecycle execution has no network, host credentials, checkout, or elevated privileges', () => {
  const args = grokConsumerDockerArgs({ ...paths, command: GROK_PUBLIC_INSTALL_LIFECYCLE });
  assert.deepEqual(values(args, '--network'), ['none']);
  assert.deepEqual(values(args, '--user'), ['1001:1001']);
  assert.ok(args.includes('--read-only'));
  assert.deepEqual(values(args, '--cap-drop'), ['ALL']);
  assert.deepEqual(values(args, '--security-opt'), ['no-new-privileges']);
  assert.deepEqual(values(args, '--mount'), [
    'type=bind,src=/private/staging/assets,dst=/packages,readonly',
    'type=bind,src=/private/staging/consumer,dst=/consumer',
    'type=bind,src=/private/staging/cache,dst=/cache',
  ]);
  assert.deepEqual(values(args, '--env'), ['HOME=/tmp', 'npm_config_cache=/cache', 'npm_config_nodedir=/usr/local', 'npm_config_audit=false', 'npm_config_fund=false', 'npm_config_ignore_scripts=false']);
  assert.match(GROK_PUBLIC_INSTALL_IMAGE, /@sha256:[a-f0-9]{64}$/);
});

test('deferred lifecycle execution rebuilds the installed graph without dependency resolution', () => {
  assert.deepEqual(GROK_PUBLIC_INSTALL_LIFECYCLE, ['npm', 'rebuild', '--offline', '--ignore-scripts=false', '--dangerously-allow-all-scripts']);
});

test('a root or malformed host identity cannot run lifecycle scripts', () => {
  for (const uid of [0, -1, undefined, '1001']) {
    assert.throws(() => grokConsumerDockerArgs({ ...paths, uid, command: ['npm', 'ci'] }), /unprivileged/);
  }
});

test('only the scripts-disabled dependency download gets network access', () => {
  const args = grokConsumerDockerArgs({ ...paths, download: true, command: ['npm', 'install', '--ignore-scripts'] });
  assert.deepEqual(values(args, '--network'), ['bridge']);
  assert.ok(values(args, '--env').includes('npm_config_ignore_scripts=true'));
});

test('the separately provisioned executable is exposed read-only to the offline probe', () => {
  const prerequisite = '/private/staging/native/grok';
  const args = grokConsumerDockerArgs({ ...paths, prerequisite, command: ['node', '/packages/probe.mjs', 'present'] });
  assert.deepEqual(values(args, '--network'), ['none']);
  assert.equal(values(args, '--mount').at(-1), `type=bind,src=${prerequisite},dst=/opt/paperclip/providers/grok/1.0.13/grok,readonly`);
});

test('verification never elevates PR-controlled provisioning or cleanup on the host', () => {
  const source = readFileSync(new URL('../verify-grok-npm-install.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bsudo\b/);
  assert.ok(source.includes("const prerequisite = join(root, 'native/grok')"));
});

test('the installed Codex probe exercises the public export and rejects incomplete or mismatched packages', () => {
  const root = mkdtempSync(join(tmpdir(), 'installed-codex-probe-'));
  try {
    const consumer = join(root, 'consumer'); mkdirSync(consumer);
    const index = join(consumer, 'index.mjs'), command = join(consumer, 'codex'), probe = join(root, 'probe.mjs');
    const executable = version => writeFileSync(command, `#!/bin/sh\n[ "$1" = --version ] || exit 65\nprintf '%s\\n' 'codex-cli ${version}'\n`, { mode: 0o755 });
    writeFileSync(probe, installedCodexProbeSource(index, consumer, '0.160.0'));
    const run = () => spawnSync(process.execPath, [probe], { encoding: 'utf8', timeout: 10_000, env: { PATH: '/usr/bin:/bin', NODE_PATH: '' } });
    writeFileSync(index, `export const resolvePinnedCodexCommand = () => ${JSON.stringify(command)};`);
    executable('0.160.0');
    let result = run(); assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).pinnedCodexCommandVerified, true);
    assert.equal(JSON.parse(result.stdout).providerCalls, 0);
    executable('9.9.9'); result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /qualified pin/);
    rmSync(command); result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /ENOENT/);
    const outside = join(root, 'outside'); writeFileSync(outside, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    writeFileSync(index, `export const resolvePinnedCodexCommand = () => ${JSON.stringify(outside)};`);
    result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /inside the installed consumer/);
    writeFileSync(index, 'export const unrelated = true;'); result = run(); assert.notEqual(result.status, 0); assert.match(result.stderr, /must export the pinned Codex resolver/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
