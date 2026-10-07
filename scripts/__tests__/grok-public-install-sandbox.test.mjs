import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GROK_PUBLIC_INSTALL_IMAGE, GROK_PUBLIC_INSTALL_LIFECYCLE, grokConsumerDockerArgs } from '../grok-public-install-sandbox.mjs';
import { assertStandardImageIdentity, inspectInstalledUi, installedProbePaths, standardImageDockerArgs, standardImageRequest } from '../../tests/release-smoke/installed-cli-probe.mjs';

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

test('installed CLI startup stays offline with private state and a read-only installed graph', () => {
  const args = grokConsumerDockerArgs({ ...paths, uid: 1000, gid: 1000, runtimeSmoke: true, command: ['node', '/packages/installed-cli-probe.mjs'] });
  assert.deepEqual(values(args, '--network'), ['none']);
  assert.ok(values(args, '--mount').includes('type=bind,src=/private/staging/consumer,dst=/consumer,readonly'));
  assert.ok(values(args, '--env').includes('PAPERCLIP_TELEMETRY_DISABLED=1'));
  assert.throws(() => grokConsumerDockerArgs({ ...paths, runtimeSmoke: true, download: true }), /Runtime smoke/);
});

test('only the optional browser fixture receives an owned internal network and loopback port', () => {
  const args = grokConsumerDockerArgs({ ...paths, uid: 1000, gid: 1000, runtimeSmoke: true,
    browserNetwork: 'paperclip-public-install-fixture', containerName: 'paperclip-public-install-fixture', command: ['node', '/packages/installed-cli-probe.mjs'] });
  assert.deepEqual(values(args, '--network'), ['paperclip-public-install-fixture']);
  assert.deepEqual(values(args, '--publish'), ['127.0.0.1::3100']);
  assert.ok(args.includes('--detach'));
  for (const browserNetwork of ['bridge', 'host', 'none']) {
    assert.throws(() => grokConsumerDockerArgs({ ...paths, uid: 1000, gid: 1000, runtimeSmoke: true, browserNetwork, containerName: 'paperclip-public-install-fixture' }), /owned internal network/);
  }
});

test('portable installed probe preserves Linux defaults and requires explicit owned paths and loopback', () => {
  assert.deepEqual(installedProbePaths(), { consumer: '/consumer', dataDirectory: '/tmp/paperclip-installed-smoke',
    readyPath: '/tmp/paperclip-installed-smoke-ready.json', base: 'http://127.0.0.1:3100' });
  const privatePaths = { consumer: '/private/tmp/installed/consumer', dataDirectory: '/private/tmp/installed/state',
    readyPath: '/private/tmp/installed/ready.json', base: 'http://127.0.0.1:39919' };
  assert.deepEqual(installedProbePaths(privatePaths), privatePaths);
  for (const base of ['http://localhost:39919', 'http://0.0.0.0:39919', 'https://example.com:39919', 'http://127.0.0.1:39919/path']) {
    assert.throws(() => installedProbePaths({ ...privatePaths, base }), /loopback/);
  }
  for (const consumer of ['relative', '/', '/private/tmp/installed/../consumer']) {
    assert.throws(() => installedProbePaths({ ...privatePaths, consumer }), /Invalid installed probe/);
  }
  assert.throws(() => installedProbePaths({ ...privatePaths, command: 'external' }), /Unknown installed probe/);
});

test('standard image qualification rejects mutable references and mismatched serving provenance', () => {
  const sourceRevision = 'a'.repeat(40), image = `ghcr.io/paperclipai/paperclip@sha256:${'b'.repeat(64)}`;
  const request = standardImageRequest(sourceRevision, image);
  const metadata = { Os: 'linux', Architecture: 'amd64', RepoDigests: [image], Config: { Labels: { 'org.opencontainers.image.revision': sourceRevision } } };
  assertStandardImageIdentity(request, metadata);
  for (const [source, target] of [['master', image], [sourceRevision, 'ghcr.io/paperclipai/paperclip:latest'], [sourceRevision, image.replace('paperclipai', 'other')], [sourceRevision, '']]) {
    assert.throws(() => standardImageRequest(source, target));
  }
  assert.throws(() => assertStandardImageIdentity(request, { ...metadata, RepoDigests: [] }), /requested digest/);
  assert.throws(() => assertStandardImageIdentity(request, { ...metadata, Config: { Labels: { 'org.opencontainers.image.revision': 'c'.repeat(40) } } }), /requested source/);
});

test('standard image starts its shipped command with no network, host data, or elevated privileges', () => {
  const image = `ghcr.io/paperclipai/paperclip@sha256:${'b'.repeat(64)}`;
  const args = standardImageDockerArgs({ sourceRevision: 'a'.repeat(40), image,
    owner: 'paperclip-public-install-image-test', probePath: '/qa/installed-cli-probe.mjs', authSecret: 'c'.repeat(64) });
  assert.deepEqual(values(args, '--network'), ['none']);
  assert.deepEqual(values(args, '--user'), ['1000:1000']);
  assert.deepEqual(values(args, '--mount'), ['type=bind,src=/qa/installed-cli-probe.mjs,dst=/qa/installed-cli-probe.mjs,readonly']);
  assert.ok(args.includes('--read-only'));
  assert.deepEqual(values(args, '--cap-drop'), ['ALL']);
  assert.deepEqual(values(args, '--security-opt'), ['no-new-privileges']);
  assert.deepEqual(values(args, '--entrypoint'), []);
  assert.deepEqual(values(args, '--publish'), []);
  assert.equal(args.at(-1), image, 'No appended command may replace the shipped CMD');
  assert.ok(values(args, '--tmpfs').includes('/paperclip:rw,nosuid,nodev,size=1024m,mode=700,uid=1000,gid=1000'));
  assert.throws(() => standardImageDockerArgs({ sourceRevision: 'a'.repeat(40), image, owner: 'other-container', probePath: '/qa/installed-cli-probe.mjs', authSecret: 'c'.repeat(64) }));
});

test('installed UI readiness checks a real HTTP response, exact serving commit, and installed asset bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'paperclip-install-ui-test-'));
  const sourceRevision = 'a'.repeat(40), script = 'export const installed = true;';
  let commit = sourceRevision, servedScript = script, startingResponses = 1, healthRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/api/health') {
      healthRequests += 1;
      response.end(JSON.stringify({ status: healthRequests <= startingResponses ? 'starting' : 'ok', commit }));
    }
    else if (request.url === '/onboarding') { response.setHeader('Content-Type', 'text/html'); response.end('<div id="root"></div><script src="/assets/installed.js"></script>'); }
    else if (request.url === '/assets/installed.js') response.end(servedScript);
    else { response.statusCode = 404; response.end(); }
  });
  try {
    await mkdir(join(root, 'ui-dist/assets'), { recursive: true });
    await writeFile(join(root, 'ui-dist/assets/installed.js'), script);
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    const options = { base: `http://127.0.0.1:${server.address().port}`, server: root, sourceRevision, timeoutMs: 500 };
    const receipt = await inspectInstalledUi(options);
    assert.equal(healthRequests, 2, 'HTTP 200 during startup cannot establish installed runtime readiness');
    assert.equal(receipt.servingCommit, sourceRevision);
    assert.equal(receipt.installedUiAssetsPassed, true);
    assert.equal(receipt.assets[0].bytes, Buffer.byteLength(script));
    await mkdir(join(root, 'monorepo-ui/assets'), { recursive: true });
    await writeFile(join(root, 'monorepo-ui/assets/installed.js'), script);
    const imageOptions = { ...options, uiDirectory: join(root, 'monorepo-ui') };
    assert.deepEqual((await inspectInstalledUi(imageOptions)).assets, receipt.assets);
    await assert.rejects(inspectInstalledUi({ ...options, uiDirectory: '../ui/dist' }), /Invalid installed UI directory/);
    commit = 'b'.repeat(40);
    await assert.rejects(inspectInstalledUi(options), /serving commit/);
    commit = sourceRevision; servedScript = 'export const substituted = true;';
    await assert.rejects(inspectInstalledUi(options), /must be the installed file/);
    await assert.rejects(inspectInstalledUi(imageOptions), /must be the installed file/);
    startingResponses = Infinity;
    await assert.rejects(inspectInstalledUi(options), /Installed CLI server did not become ready/);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
