// Runs inside the existing clean public-install consumer, with no checkout.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const sha256 = value => createHash('sha256').update(value).digest('hex');

export function installedProbePaths(input = {}) {
  const paths = { consumer: '/consumer', dataDirectory: '/tmp/paperclip-installed-smoke',
    readyPath: '/tmp/paperclip-installed-smoke-ready.json', base: 'http://127.0.0.1:3100', ...input };
  assert.ok(Object.keys(input).every(key => ['consumer', 'dataDirectory', 'readyPath', 'base'].includes(key)), 'Unknown installed probe path option');
  for (const key of ['consumer', 'dataDirectory', 'readyPath']) {
    assert.ok(typeof paths[key] === 'string' && isAbsolute(paths[key]) && resolve(paths[key]) === paths[key] && paths[key] !== '/', `Invalid installed probe ${key}`);
  }
  const base = new URL(paths.base);
  assert.ok(base.protocol === 'http:' && base.hostname === '127.0.0.1' && Number(base.port) >= 1024
    && !base.username && !base.password && base.pathname === '/' && !base.search && !base.hash, 'Installed probe requires an explicit loopback URL');
  return paths;
}

/** Real HTTP and installed-byte checks shared by the finite release fixture. */
export async function inspectInstalledUi({ base, server, uiDirectory = join(server, 'ui-dist'), sourceRevision, timeoutMs = 90_000, assertRunning = () => {} }) {
  assert.ok(isAbsolute(uiDirectory) && resolve(uiDirectory) === uiDirectory && uiDirectory !== '/', 'Invalid installed UI directory');
  const deadline = Date.now() + timeoutMs;
  let health;
  while (Date.now() < deadline) {
    assertRunning();
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(Math.min(2_000, timeoutMs)) });
      if (response.ok) {
        health = await response.json();
        // The startup endpoint returns HTTP 200 while recovery is still
        // running. Wait for product readiness before checking installed bytes.
        if (health?.status === 'ok') break;
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, Math.min(250, timeoutMs)));
  }
  assert.equal(health?.status, 'ok', 'Installed CLI server did not become ready');
  assert.equal(health.commit, sourceRevision, 'The serving commit must match the packaged source');
  const response = await fetch(`${base}/onboarding`, { signal: AbortSignal.timeout(5_000) });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  const html = await response.text();
  assert.match(html, /id="root"/);
  const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+\.(?:js|css))"/g)].map(match => match[1]);
  assert.ok(assets.some(path => path.endsWith('.js')), 'Installed UI must reference its bundled JavaScript');
  const checkedAssets = [];
  for (const path of new Set(assets)) {
    assert.ok(!path.includes('..'));
    const asset = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(5_000) });
    assert.equal(asset.status, 200, `Installed UI asset ${path}`);
    const bytes = Buffer.from(await asset.arrayBuffer());
    const digest = sha256(bytes);
    assert.equal(digest, sha256(readFileSync(`${uiDirectory}${path}`)), `Served UI asset ${path} must be the installed file`);
    checkedAssets.push({ path, sha256: digest, bytes: bytes.length });
  }
  return { servingCommit: health.commit, installedUiAssetsPassed: true, assets: checkedAssets };
}

export function standardImageRequest(sourceRevision, image) {
  assert.match(sourceRevision ?? '', /^[a-f0-9]{40}$/, 'Image qualification requires a full source SHA');
  assert.match(image ?? '', /^ghcr\.io\/paperclipai\/paperclip@sha256:[a-f0-9]{64}$/, 'Image qualification requires an immutable public Core digest');
  return { sourceRevision, image };
}

export function assertStandardImageIdentity(request, metadata) {
  assert.equal(metadata.Os, 'linux');
  assert.equal(metadata.Architecture, 'amd64', 'This hosted image check qualifies Linux amd64 only');
  assert.ok(metadata.RepoDigests?.includes(request.image), 'Pulled image must match the requested digest');
  assert.equal(metadata.Config?.Labels?.['org.opencontainers.image.revision'], request.sourceRevision, 'Image label must match the requested source');
}

export function standardImageDockerArgs({ sourceRevision, image, owner, probePath, authSecret }) {
  standardImageRequest(sourceRevision, image);
  assert.match(owner ?? '', /^paperclip-public-install-image-[a-z0-9-]+$/);
  assert.ok(isAbsolute(probePath) && resolve(probePath) === probePath && probePath !== '/');
  assert.match(authSecret ?? '', /^[a-f0-9]{64}$/);
  // No command or entrypoint override: start the image exactly as shipped.
  return ['run', '--detach', '--name', owner,
    '--network', 'none', '--user', '1000:1000', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges', '--pids-limit', '256', '--memory', '3g',
    '--tmpfs', '/paperclip:rw,nosuid,nodev,size=1024m,mode=700,uid=1000,gid=1000',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=256m,mode=1777',
    '--mount', `type=bind,src=${probePath},dst=/qa/installed-cli-probe.mjs,readonly`,
    '--env', `BETTER_AUTH_SECRET=${authSecret}`, '--env', 'PAPERCLIP_TELEMETRY_DISABLED=1',
    '--env', 'PAPERCLIP_UPDATE_CHECK=0', '--env', 'PAPERCLIP_OPEN_ON_LISTEN=false', image];
}

function runStandardImageSmoke(sourceRevision, image) {
  const request = standardImageRequest(sourceRevision, image);
  assert.equal(process.platform, 'linux', 'Run image qualification on the existing hosted Linux executor');
  const root = mkdtempSync(join(tmpdir(), 'paperclip-image-startup-'));
  const dockerConfig = join(root, 'docker-config'); mkdirSync(dockerConfig);
  const env = { ...process.env, DOCKER_CONFIG: dockerConfig };
  const docker = (args, timeout = 30_000) => execFileSync('docker', args, { env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024 });
  const owner = `paperclip-public-install-image-${process.pid}-${Date.now()}`;
  const authSecret = randomBytes(32).toString('hex');
  let attempted = false, receipt;
  try {
    docker(['pull', image], 240_000);
    const [metadata] = JSON.parse(docker(['image', 'inspect', image]));
    assertStandardImageIdentity(request, metadata);
    attempted = true;
    docker(standardImageDockerArgs({ ...request, owner, probePath: fileURLToPath(import.meta.url), authSecret }));
    const inspected = JSON.parse(docker(['exec', owner, 'node', '/qa/installed-cli-probe.mjs', '--inspect-standard-image', sourceRevision, image], 135_000).trim());
    receipt = { schema: 'paperclip.standard-image.startup.v1', ...request, ...inspected,
      normalEntrypointAndCommand: true, network: 'none', runtimeUid: 1000, providerCalls: 0,
      scope: 'Immutable image default startup and served UI bytes; provider authentication and tasks are separate.' };
  } catch (error) {
    if (attempted) {
      try { console.error(docker(['logs', owner]).replaceAll(authSecret, '[fixture-auth-secret]').replace(/pcp_bootstrap_[a-zA-Z0-9]+/g, '[fixture-invite]').slice(-12_000)); } catch {}
    }
    throw error;
  } finally {
    try {
      if (attempted) {
        try { docker(['rm', '--force', owner]); }
        catch (error) { assert.match(String(error.stderr ?? ''), /no such (?:object|container)/i, 'Owned image fixture removal failed'); }
        // An unavailable daemon is not evidence of successful cleanup.
        try { docker(['inspect', owner]); assert.fail('Owned image fixture still exists'); }
        catch (error) {
          assert.match(String(error.stderr ?? ''), /no such (?:object|container)/i, 'Owned image cleanup must be confirmed by the available daemon');
        }
        if (receipt) receipt.ownedContainerAbsent = true;
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  console.log(JSON.stringify(receipt));
}

async function run() {
  const [version, sourceRevision, mode, pathsFile, ...extraArguments] = process.argv.slice(2);
  if (version === '--standard-image' || version === '--inspect-standard-image') {
    assert.ok(!pathsFile && !extraArguments.length, 'Invalid image probe arguments');
    standardImageRequest(sourceRevision, mode);
    if (version === '--standard-image') return runStandardImageSmoke(sourceRevision, mode);
    const server = '/app/server';
    assert.equal(JSON.parse(readFileSync(`${server}/dist/build-info.json`, 'utf8')).commit, sourceRevision);
    const uiDirectory = ['/app/server/ui-dist', '/app/ui/dist'].find(path => existsSync(join(path, 'index.html')));
    assert.ok(uiDirectory, 'The standard image must contain its production UI');
    console.log(JSON.stringify(await inspectInstalledUi({ base: 'http://127.0.0.1:3100', server, uiDirectory, sourceRevision })));
    return;
  }
  assert.ok((mode === undefined || mode === 'offline' || mode === 'browser') && !extraArguments.length, 'Invalid installed probe arguments');
  const browser = mode === 'browser';
  const paths = installedProbePaths(pathsFile ? JSON.parse(readFileSync(pathsFile, 'utf8')) : {});
  const cli = join(paths.consumer, 'node_modules/paperclipai/dist/index.js');
  const server = join(paths.consumer, 'node_modules/@paperclipai/server');
  assert.equal(realpathSync(cli), cli, 'The installed CLI cannot resolve into a checkout');
  assert.equal(realpathSync(server), server, 'The installed server cannot resolve into a checkout');
  assert.equal(execFileSync(process.execPath, [cli, '--version'], { encoding: 'utf8', timeout: 30_000 }).trim(), version);
  assert.equal(JSON.parse(readFileSync(`${server}/dist/build-info.json`, 'utf8')).commit, sourceRevision);
  let output = '';
  const child = spawn(process.execPath, [cli, 'onboard', '--yes', '--data-dir', paths.dataDirectory,
    ...(browser ? ['--bind', 'lan'] : [])], { cwd: paths.consumer, detached: true, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, PORT: new URL(paths.base).port, ...(pathsFile ? { HOST: '127.0.0.1' } : {}) } });
  for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { output = (output + chunk).slice(-64 * 1024); });
  const exited = once(child, 'exit');
  void exited.catch(() => undefined);
  const exitObserved = exited.then(() => true);
  const signalOwned = signal => {
    try { if (child.pid) process.kill(-child.pid, signal); }
    catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const waitForExit = async timeoutMs => {
    let timer;
    try { return await Promise.race([exitObserved, new Promise(resolve => { timer = setTimeout(() => resolve(false), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  };
  let receipt;
  try {
    const ui = await inspectInstalledUi({ base: paths.base, server, sourceRevision,
      assertRunning: () => { if (child.exitCode !== null || child.signalCode !== null) throw new Error('Installed CLI exited before its server became ready'); } });
    receipt = { cliVersion: version, cliSha256: sha256(readFileSync(cli)), installedCliStartupPassed: true, ...ui, providerCalls: 0 };
    if (browser) {
      const invitePath = output.match(/\/invite\/(pcp_bootstrap_[a-zA-Z0-9]+)/)?.[0];
      assert.ok(invitePath, 'The ordinary installed CLI must offer its bootstrap invite');
      // This private fixture token never appears in the public receipt or logs.
      writeFileSync(paths.readyPath, JSON.stringify({ receipt, invitePath }), { mode: 0o600 });
      let stop;
      const stopping = new Promise(resolve => { stop = resolve; });
      process.once('SIGTERM', stop);
      process.once('SIGINT', stop);
      await Promise.race([stopping, exited.then(() => { throw new Error('Installed CLI server exited during its browser smoke'); })]);
    }
  } catch (error) {
    const sanitized = output.replace(/pcp_bootstrap_[a-zA-Z0-9]+/g, '[fixture-invite]').slice(-12_000);
    console.error(sanitized);
    throw error;
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      signalOwned('SIGTERM');
      if (!await waitForExit(8_000)) {
        signalOwned('SIGKILL');
        assert.ok(await waitForExit(2_000), 'Installed CLI process exit could not be confirmed');
      }
    }
  }
  console.log(JSON.stringify(receipt));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await run();
