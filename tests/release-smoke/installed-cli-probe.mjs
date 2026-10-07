// Runs inside the existing clean public-install consumer, with no checkout.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { pathToFileURL } from 'node:url';
import { isAbsolute, join, resolve } from 'node:path';

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
export async function inspectInstalledUi({ base, server, sourceRevision, timeoutMs = 90_000, assertRunning = () => {} }) {
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
    assert.equal(digest, sha256(readFileSync(`${server}/ui-dist${path}`)), `Served UI asset ${path} must be the installed file`);
    checkedAssets.push({ path, sha256: digest, bytes: bytes.length });
  }
  return { servingCommit: health.commit, installedUiAssetsPassed: true, assets: checkedAssets };
}

async function run() {
  const [version, sourceRevision, mode, pathsFile, ...extraArguments] = process.argv.slice(2);
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
