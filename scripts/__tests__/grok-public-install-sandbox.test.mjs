import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { GROK_PUBLIC_INSTALL_IMAGE, GROK_PUBLIC_INSTALL_LIFECYCLE, grokConsumerDockerArgs, macPublicInstallLifecyclePolicy } from '../grok-public-install-sandbox.mjs';
import { assertStandardImageIdentity, inspectInstalledDaemon, inspectInstalledProviderReadiness, inspectInstalledUi, inspectManagedServiceInstall, installedProbePaths, standardImageDockerArgs, standardImageRequest } from '../../tests/release-smoke/installed-cli-probe.mjs';

const paths = { assets: '/private/staging/assets', consumer: '/private/staging/consumer', cache: '/private/staging/cache', uid: 1001, gid: 1001 };
const values = (args, flag) => args.flatMap((value, index) => value === flag ? [args[index + 1]] : []);
const hash = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function daemonFixture(root, server) {
  // These contract fixtures exercise the installed probe's independent checks.
  // Hosted package qualification loads the real production modules and native
  // executable; these shell fixtures are never used as platform evidence.
  const installed = join(server, 'dist/vendor/paperclip-runner'), target = `${process.platform}-${process.arch}`;
  const executable = join(installed, `bin/${target}/paperclip-runnerd`), sourceRevision = 'a'.repeat(40);
  const metadata = { schema: 'paperclip-runner/runnerd-build-metadata/v1', binaryName: 'paperclip-runnerd',
    packageName: '@paperclipai/paperclip-runner', packageVersion: '0.0.0', binaryContractVersion: 2,
    nativeExecutionVersion: 1, harnessDriverVersion: 1, prp: { name: 'paperclip.runner', minimumVersion: 1, maximumVersion: 2 },
    durableSessionCapabilities: ['unlimited_runtime', 'connection_lease_renewal'], prpTransportModes: ['dial_ws_loopback', 'dial_wss', 'listen_ws'] };
  await mkdir(join(installed, `bin/${target}`), { recursive: true }); await mkdir(join(installed, 'live'));
  await mkdir(join(installed, 'evals'));
  await writeFile(join(installed, 'live/runner-binary.js'), `import fs from 'node:fs';import path from 'node:path';
    export function resolvePackagedRunnerBinary(root) {
      const exact=path.join(root, 'bin/${target}/paperclip-runnerd'), generic=path.join(root, 'bin/paperclip-runnerd');
      if(fs.existsSync(${JSON.stringify(join(root, 'outside-resolver'))}))return ${JSON.stringify(join(root, 'outside'))};
      return fs.existsSync(exact)?exact:fs.existsSync(generic)?generic:null;
    }
    export function runnerBinaryTarget() {return fs.existsSync(${JSON.stringify(join(root, 'wrong-architecture'))})?'wrong-platform':'${target}';}`);
  await writeFile(join(installed, 'evals/build-metadata.js'), `export const PAPERCLIP_RUNNERD_BUILD_METADATA_SCHEMA='paperclip-runner/runnerd-build-metadata/v1';
    export const PAPERCLIP_RUNNER_BUILD_METADATA={package:{name:'@paperclipai/paperclip-runner'},
      contracts:{runnerdArtifact:2,nativeExecution:1,harnessDriver:1},prp:{name:'paperclip.runner',minimumVersion:1,maximumVersion:2}};`);
  // Reuse the existing actual metadata parser, rather than a replacement grader.
  const { stripTypeScriptTypes } = await import('node:module');
  const parser = readFileSync(new URL('../../packages/paperclip-runner/src/evals/runnerd-artifact.ts', import.meta.url), 'utf8');
  // Node's strip-only loader rejects constructor parameter properties. The
  // fixture needs the parser and error messages, not its stored issue field.
  await writeFile(join(installed, 'evals/runnerd-artifact.js'), stripTypeScriptTypes(parser.replace('readonly issue:', 'issue:')));
  const metadataPath = join(root, 'daemon-metadata.json'), argumentsPath = join(root, 'daemon-arguments.json');
  await writeFile(metadataPath, JSON.stringify(metadata));
  await writeFile(executable, `#!${process.execPath}\nimport fs from 'node:fs';
    fs.writeFileSync(${JSON.stringify(argumentsPath)}, JSON.stringify(process.argv.slice(2)));
    if(process.argv.slice(2).join(' ')!=='--build-metadata')process.exit(9);
    console.log(fs.readFileSync(${JSON.stringify(metadataPath)},'utf8'));`, { mode: 0o755 });
  const manifestPath = join(installed, 'bin/release-manifest.json');
  const manifest = { schema: 'paperclip.runner.release-binaries.v1', sourceRevision,
    platforms: Object.fromEntries(['darwin-arm64','darwin-x64','linux-x64'].map(platform => [platform,
      { path: `${platform}/paperclip-runnerd`, sha256: hash(readFileSync(executable)) }])) };
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(server, 'dist/build-info.json'), JSON.stringify({ commit: sourceRevision }));
  return { installed, executable, sourceRevision, metadataPath, argumentsPath, manifestPath, manifest, metadata };
}

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

test('hosted Mac lifecycle denies OS networking and writes only owned temporary state', () => {
  const policy = macPublicInstallLifecyclePolicy({ ownedRoot: '/private/tmp/owned-qualification', npmRoot: '/Users/runner/node/npm' });
  assert.match(policy, /\(deny default\)/);
  assert.match(policy, /\(deny network\*\)/);
  assert.match(policy, /\(allow file-write\* \(subpath "\/private\/tmp\/owned-qualification"\) \(literal "\/dev\/null"\)\)/);
  assert.doesNotMatch(policy, /allow default|allow network|mach-lookup|syscall/);
  for (const ownedRoot of ['/', '../home', '/private/tmp/../other', '/private/tmp/owned\n(allow default)']) {
    assert.throws(() => macPublicInstallLifecyclePolicy({ ownedRoot, npmRoot: '/Users/runner/node/npm' }), /absolute owned/);
  }
  const source = readFileSync(new URL('../verify-grok-npm-install.mjs', import.meta.url), 'utf8');
  const sandbox = source.indexOf("execFileSync('/usr/bin/sandbox-exec'");
  assert.ok(sandbox > source.indexOf("npm(['install', '--ignore-scripts'"));
  assert.ok(sandbox < source.indexOf('const listener = createServer()'));
  assert.match(source, /sandbox-exec.*\[.*'-f', policy,[\s\S]*?GROK_PUBLIC_INSTALL_LIFECYCLE\.slice\(1\)/);
  assert.match(source, /Hosted Mac lifecycle qualification requires OS network isolation/);
  assert.doesNotMatch(source, /no OS egress assertion/);
});

test('a root or malformed host identity cannot run lifecycle scripts', () => {
  for (const uid of [0, -1, undefined, '1001']) {
    assert.throws(() => grokConsumerDockerArgs({ ...paths, uid, command: ['npm', 'ci'] }), /unprivileged/);
  }
});

test('the scripts-disabled dependency download gets network access before offline lifecycle execution', () => {
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

test('the separate optional browser fixture receives an owned network and loopback port', () => {
  const args = grokConsumerDockerArgs({ ...paths, uid: 1000, gid: 1000, runtimeSmoke: true,
    browserNetwork: 'paperclip-public-install-fixture', containerName: 'paperclip-public-install-fixture', command: ['node', '/packages/installed-cli-probe.mjs'] });
  assert.deepEqual(values(args, '--network'), ['paperclip-public-install-fixture']);
  assert.deepEqual(values(args, '--publish'), ['127.0.0.1::3100']);
  assert.ok(args.includes('--detach'));
  for (const browserNetwork of ['bridge', 'host', 'none']) {
    assert.throws(() => grokConsumerDockerArgs({ ...paths, uid: 1000, gid: 1000, runtimeSmoke: true, browserNetwork, containerName: 'paperclip-public-install-fixture' }), /owned network/);
  }
  const source = readFileSync(new URL('../verify-grok-npm-install.mjs', import.meta.url), 'utf8');
  assert.ok(source.indexOf('isolated(GROK_PUBLIC_INSTALL_LIFECYCLE)') < source.indexOf("run('docker', ['network', 'create', browserOwner])"));
  assert.doesNotMatch(source, /\['network', 'create', '--internal'/);
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
  assert.equal(args.includes('--read-only'), false, 'The supported entrypoint must be able to prepare image-owned Postgres library aliases');
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

test('installed provider readiness uses the production pinned Codex resolver and installed Claude verifier', async () => {
  // Unit fixtures exercise the probe contract. Actual package qualification
  // invokes these checks against the installed graph, never these fixtures.
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'paperclip-provider-readiness-test-')));
  const bin = join(root, 'bin'), server = join(root, 'server');
  const installed = join(server, 'dist/vendor/paperclip-runner/drivers/acpx');
  try {
    await mkdir(bin); await mkdir(installed, { recursive: true });
    await mkdir(join(server, 'dist/vendor/paperclip-runner/drivers/codex'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    await writeFile(join(bin, 'codex'), `#!${process.execPath}\nimport fs from 'node:fs';
      fs.writeFileSync(${JSON.stringify(join(root, 'codex-arguments.json'))}, JSON.stringify(process.argv.slice(2)));
      if (process.argv.slice(2).join(' ') !== '--version') process.exit(9);
      console.log('codex-cli 0.160.0');\n`, { mode: 0o755 });
    await writeFile(join(server, 'dist/vendor/paperclip-runner/drivers/codex/codex-command.js'), `import fs from 'node:fs';
      export function resolvePinnedCodexCommand() {
        if (fs.existsSync(${JSON.stringify(join(root, 'missing-codex'))})) throw new Error('Pinned Codex runtime unavailable: missing installed package; choose Legacy runner in Advanced');
        return ${JSON.stringify(join(bin, 'codex'))};
      }`);
    await writeFile(join(installed, 'qualified-profiles.js'), `export const QUALIFIED_ACPX_PROFILES={codex:{agentRuntimeVersion:'0.160.0'}};
      export function resolveQualifiedAcpxProfile(agent, model) {
      if (agent !== 'claude' || model !== 'claude-sonnet-5') throw new Error('Unexpected profile');
      return {agentServerPackage:'@agentclientprotocol/claude-agent-acp',agentServerVersion:'0.73.0',
        agentRuntimePackage:'@anthropic-ai/claude-agent-sdk',agentRuntimeVersion:'0.3.286',commandDigest:'sha256:fixture'};
    }`);
    await writeFile(join(installed, 'installation-integrity.js'), `import fs from 'node:fs';
      export async function probeAcpxClaudeInstallation(model) {
        if (fs.existsSync(${JSON.stringify(join(root, 'bad-claude'))})) throw new Error('ACPX claude runtime version mismatch');
        fs.writeFileSync(${JSON.stringify(join(root, 'claude-model'))}, model);
      }`);
    const daemon = await daemonFixture(root, server);
    const receipt = await inspectInstalledProviderReadiness({ server, commandPath: bin });
    assert.equal(receipt.providerCalls, 0);
    assert.equal(receipt.codex.executable, join(bin, 'codex'));
    assert.equal(receipt.codex.version, 'codex-cli 0.160.0');
    assert.deepEqual(JSON.parse(readFileSync(join(root, 'codex-arguments.json'), 'utf8')), ['--version']);
    assert.equal(readFileSync(join(root, 'claude-model'), 'utf8'), 'claude-sonnet-5');
    assert.equal(receipt.claude.agentRuntimeVersion, '0.3.286');
    assert.equal(receipt.claude.commandLeasePassed, true);
    assert.equal(receipt.runnerd.manifestVerified, true);
    assert.equal(receipt.runnerd.executable, daemon.executable);
    assert.deepEqual(JSON.parse(readFileSync(daemon.argumentsPath, 'utf8')), ['--build-metadata']);

    assert.equal((await inspectInstalledProviderReadiness({ server, commandPath: join(root, 'empty-runtime-path') })).codex.versionProbePassed, true,
      'A pinned executable does not require a global Codex command on PATH');
    await writeFile(join(root, 'missing-codex'), 'missing installed package');
    await assert.rejects(inspectInstalledProviderReadiness({ server, commandPath: bin }), error => {
      assert.match(error.message, /Pinned Codex runtime unavailable.*Legacy runner/);
      assert.equal(error.providerReadiness.codex, undefined);
      assert.equal(error.providerReadiness.claude.installationIntegrityPassed, true, 'Preserve independently verified Claude readiness');
      return true;
    });
    await rm(join(root, 'missing-codex'));
    await writeFile(join(root, 'bad-claude'), 'mismatched installed runtime');
    await assert.rejects(inspectInstalledProviderReadiness({ server, commandPath: bin }), error => {
      assert.match(error.message, /Claude: ACPX claude runtime version mismatch/);
      assert.equal(error.providerReadiness.codex.versionProbePassed, true);
      assert.equal(error.providerReadiness.claude, undefined, 'An incomplete Claude verifier cannot qualify installation');
      return true;
    });
    await writeFile(join(bin, 'codex'), `#!${process.execPath}\nconsole.log('authentication required');\n`, { mode: 0o755 });
    await assert.rejects(inspectInstalledProviderReadiness({ server, commandPath: bin }), /Codex did not return its CLI version/);
    await assert.rejects(inspectInstalledProviderReadiness({ server: '../checkout' }), /Invalid installed server/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('installed daemon proof rejects source, target, digest, capability and resolver failures without ambient fallback', async () => {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'paperclip-installed-daemon-test-'))), server = join(root, 'server');
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ type: 'module' }));
    const fixture = await daemonFixture(root, server), target = `${process.platform}-${process.arch}`;
    const options = { server, sourceRevision: fixture.sourceRevision };
    const receipt = await inspectInstalledDaemon(options);
    assert.equal(receipt.sha256, hash(readFileSync(fixture.executable)));
    assert.equal(receipt.compatibilityPassed, true);
    for (const change of [manifest => { manifest.sourceRevision = 'b'.repeat(40); },
      manifest => { manifest.platforms[target].sha256 = `sha256:${'b'.repeat(64)}`; },
      manifest => { manifest.platforms[target].path = '../outside'; }]) {
      const manifest = structuredClone(fixture.manifest); change(manifest);
      await writeFile(fixture.manifestPath, JSON.stringify(manifest)); await rm(fixture.argumentsPath, { force: true });
      await assert.rejects(inspectInstalledDaemon(options), /manifest (?:source|target)|digest mismatch/);
      assert.equal((await import('node:fs')).existsSync(fixture.argumentsPath), false, 'Reject unbound bytes before execution');
    }
    await writeFile(fixture.manifestPath, JSON.stringify(fixture.manifest));
    for (const change of [metadata => { metadata.nativeExecutionVersion = 999; }, metadata => { metadata.binaryName = 'other'; },
      metadata => { metadata.prp.maximumVersion = 1; }, metadata => { metadata.durableSessionCapabilities = []; }]) {
      const metadata = structuredClone(fixture.metadata); change(metadata);
      await writeFile(fixture.metadataPath, JSON.stringify(metadata));
      await assert.rejects(inspectInstalledDaemon(options), /incompatible|unexpected binary|protocol|missing durable/);
    }
    await writeFile(fixture.metadataPath, JSON.stringify(fixture.metadata));
    await writeFile(join(root, 'wrong-architecture'), 'wrong');
    await assert.rejects(inspectInstalledDaemon(options), /architecture mismatch/); await rm(join(root, 'wrong-architecture'));
    await writeFile(join(root, 'outside-resolver'), 'outside');
    await assert.rejects(inspectInstalledDaemon(options), /resolver must select/); await rm(join(root, 'outside-resolver'));
    await rm(fixture.manifestPath);
    await assert.rejects(inspectInstalledDaemon(options), /complete daemon release manifest/);
    const generic = join(fixture.installed, 'bin/paperclip-runnerd');
    await (await import('node:fs/promises')).rename(fixture.executable, generic);
    assert.equal((await inspectInstalledDaemon({ ...options, allowHostOnlyDaemon: true })).hostOnlySourceInstall, true);
    await rm(generic);
    await assert.rejects(inspectInstalledDaemon({ ...options, allowHostOnlyDaemon: true }), /no ambient fallback/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('service qualification binds a real managed shim and current link to the exact source payload', async () => {
  const root = realpathSync(await mkdtemp(join(tmpdir(), 'paperclip-service-install-test-')));
  const sourceRevision = 'a'.repeat(40), store = join(root, 'cli');
  const payload = join(store, 'installs/git', sourceRevision.slice(0, 12));
  const server = join(payload, 'node_modules/@paperclipai/server');
  const cli = join(payload, 'node_modules/paperclipai/dist/index.js');
  const manifestPath = join(store, 'install.json'), shimPath = join(root, 'paperclipai');
  const manifest = { schemaVersion: 1, source: 'git', repo: 'paperclipai/paperclip', sha: sourceRevision,
    ref: sourceRevision, payloadPath: payload, version: '0.3.1' };
  try {
    await mkdir(join(server, 'dist'), { recursive: true });
    await mkdir(join(payload, 'node_modules/paperclipai/dist'), { recursive: true });
    await writeFile(cli, `if (process.argv[2] !== '--version') process.exit(9); console.log('0.3.1');\n`);
    await writeFile(join(server, 'dist/build-info.json'), JSON.stringify({ commit: sourceRevision }));
    await writeFile(manifestPath, JSON.stringify(manifest));
    await symlink(payload, join(store, 'current'));
    await writeFile(shimPath, `#!/bin/sh\n# paperclipai managed install shim v1\nexec "${process.execPath}" "${join(store, 'current/node_modules/paperclipai/dist/index.js')}" "$@"\n`, { mode: 0o755 });
    const options = { sourceRevision, manifestPath, shimPath };
    const receipt = inspectManagedServiceInstall(options);
    assert.equal(receipt.managedInstallCommit, sourceRevision);
    assert.equal(receipt.managedShimPassed, true);
    assert.equal(receipt.cliVersion, '0.3.1');
    for (const override of [{ source: 'npm' }, { ref: 'master' }, { sha: 'b'.repeat(40) }, { payloadPath: join(root, 'checkout') }]) {
      await writeFile(manifestPath, JSON.stringify({ ...manifest, ...override }));
      assert.throws(() => inspectManagedServiceInstall(options));
    }
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(join(server, 'dist/build-info.json'), JSON.stringify({ commit: 'b'.repeat(40) }));
    assert.throws(() => inspectManagedServiceInstall(options));
    await writeFile(join(server, 'dist/build-info.json'), JSON.stringify({ commit: sourceRevision }));
    await writeFile(shimPath, '#!/bin/sh\necho 0.3.1\n', { mode: 0o755 });
    assert.throws(() => inspectManagedServiceInstall(options), /real managed shim/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
