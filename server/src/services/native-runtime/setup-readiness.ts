import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import { copyBackGrokAuth, resolveManagedGrokHomeDir } from "@paperclipai/adapter-grok-local/server";
import type { AdapterEnvironmentTestContext, AdapterEnvironmentTestResult } from "@paperclipai/adapter-utils";
import { runAdapterExecutionTargetShellCommand } from "@paperclipai/adapter-utils/execution-target";
import { QUALIFIED_ACPX_PROFILES, acpxRuntimeSessionDirectoryName, probeQualifiedAcpxEnvironment } from "../../vendor/paperclip-runner/index.js";
import { resolvePaperclipRunnerBinary } from "./native-codex-runner.js";
import { prepareGrokRunnerCredentials } from "./grok-runner-credentials.js";
import { readLocalAiCredentialFile } from "../local-ai-credential-file.js";

const execFileAsync = promisify(execFile);

/** Check the selected runtime as well as the separate provider authentication probe. */
export async function assertNativeRunnerSetupReady(context: AdapterEnvironmentTestContext): Promise<void> {
  let stdout: string;
  if (context.executionTarget?.kind === "remote") {
    const probe = await runAdapterExecutionTargetShellCommand(
      `runner-setup-${crypto.randomUUID()}`,
      context.executionTarget,
      'for runner in /opt/paperclip-runner/bin/paperclip-runnerd "$HOME/.local/bin/paperclip-runnerd"; do if [ -x "$runner" ]; then exec "$runner" --build-metadata; fi; done; exec paperclip-runnerd --build-metadata',
      { cwd: context.executionTarget.remoteCwd, env: {}, timeoutSec: 15 },
    );
    if (probe.timedOut || probe.exitCode !== 0) {
      throw new Error("Paperclip Runner could not start in the selected environment. Install the runner in that environment or select Legacy runner in Advanced.");
    }
    stdout = probe.stdout;
  } else {
    const result = await execFileAsync(resolvePaperclipRunnerBinary(), ["--build-metadata"], { timeout: 15_000 });
    stdout = result.stdout;
  }
  const metadata = JSON.parse(stdout) as { binaryName?: string; prp?: { minimumVersion?: number; maximumVersion?: number } };
  if (metadata.binaryName !== "paperclip-runnerd" || !metadata.prp || (metadata.prp.minimumVersion ?? 2) > 1 || (metadata.prp.maximumVersion ?? 0) < 1) {
    throw new Error("The installed Paperclip Runner is incompatible with this server. Update the runner or select Legacy runner in Advanced.");
  }
}

/** Probe the installed provider pack on the selected target, without credentials. */
export async function assertRemoteAcpxSetupReady(context: AdapterEnvironmentTestContext, agent: "claude" | "grok" | "cursor", model: string): Promise<void> {
  if (context.executionTarget?.kind !== "remote") return;
  const expected = QUALIFIED_ACPX_PROFILES[agent];
  const script = `
    const { pathToFileURL } = await import('node:url');
    const root = process.argv[1];
    const agent = process.argv[2];
    const model = process.argv[3];
    const expected = JSON.parse(process.argv[4]);
    const profiles = await import(pathToFileURL(root + '/dist/drivers/acpx/qualified-profiles.js'));
    const actual = profiles.QUALIFIED_ACPX_PROFILES[agent];
    for (const key of ['commandDigest', 'acpxVersion', 'agentServerVersion', 'agentRuntimeVersion']) {
      if (actual?.[key] !== expected[key]) throw new Error('Provider pack does not match this Paperclip release');
    }
    const probes = await import(pathToFileURL(root + '/dist/drivers/acpx/' + (agent === 'cursor' ? 'profile-installation' : 'installation-integrity') + '.js'));
    await probes[{claude:'probeAcpxClaudeInstallation',grok:'probeAcpxGrokInstallation',cursor:'probeAcpxCursorInstallation'}[agent]](model);
  `;
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const command = 'for pack in /opt/paperclip-runner/provider-pack "$HOME/.local/share/paperclip-runner/provider-pack"; do if [ -f "$pack/provider-pack.json" ]; then exec "$pack/node_modules/node/bin/node" --input-type=module -e '
    + quote(script) + ' "$pack" ' + [agent, model, JSON.stringify(expected)].map(quote).join(' ')
    + '; fi; done; echo "Qualified provider pack is missing" >&2; exit 1';
  const result = await runAdapterExecutionTargetShellCommand(`provider-setup-${crypto.randomUUID()}`, context.executionTarget, command,
    { cwd: context.executionTarget.remoteCwd, env: {}, timeoutSec: 30 });
  if (result.timedOut || result.exitCode !== 0) {
    throw new Error(`The selected environment could not verify the ${agent} runtime. Install the current Paperclip provider pack and its provider prerequisites, or select Legacy runner in Advanced. ${result.stderr.trim().slice(-1024)}`);
  }
}

const PROBE_TRANSPORT_ENV_KEYS = ["PATH", "LANG", "LANGUAGE", "TZ", "TMPDIR", "TEMP", "TMP", "SSL_CERT_FILE", "SSL_CERT_DIR", "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "no_proxy", "all_proxy"];

function redactNativeProbeMessage(message: string, environment: Record<string, string>): string {
  const redact = (value: unknown): void => {
    if (typeof value === "string" && value) message = message.replaceAll(value, "[REDACTED]");
    else if (value && typeof value === "object") for (const item of Object.values(value)) redact(item);
  };
  for (const [name, value] of Object.entries(environment)) {
    if (!/key|token|secret|password/i.test(name) || !value) continue;
    redact(value);
    try { redact(JSON.parse(value)); } catch { /* Most credentials are plain strings. */ }
  }
  return message.slice(0, 2000);
}

/** Use the qualified native host and bound account, without borrowing a legacy CLI or ambient login. */
export async function testNativeAcpxAuthentication(context: AdapterEnvironmentTestContext, agent: "claude" | "grok" | "cursor", model: string): Promise<AdapterEnvironmentTestResult> {
  const configured = context.config.env;
  const remote = context.executionTarget?.kind === "remote";
  let environment: Record<string, string> = Object.fromEntries([
    ...(remote ? [] : PROBE_TRANSPORT_ENV_KEYS.flatMap(key => typeof process.env[key] === "string" ? [[key, process.env[key]!]] : [])),
    ...Object.entries(configured && typeof configured === "object" && !Array.isArray(configured) ? configured : {})
      .filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  ]);
  const timeoutMs = context.executionTarget?.kind === "remote" ? 90_000 : 45_000;
  const expected = QUALIFIED_ACPX_PROFILES[agent];
  let runtimeDirectory: string | undefined;
  try {
    const grokHome = agent === "grok" && !environment.XAI_API_KEY?.trim()
      ? await realpath(context.managedAiCredentialHome ?? resolveManagedGrokHomeDir(process.env, context.companyId))
        .catch(() => { throw new Error("Grok subscription login is unavailable. Connect Grok Build or select an xAI API key."); }) : undefined;
    const grokCredential = agent === "grok" ? await prepareGrokRunnerCredentials({
      companyId: context.companyId, environment, remote,
      // Only the resolved connection or this company's login may be probed.
      managedHome: grokHome,
    }) : null;
    if (grokCredential) environment = Object.fromEntries(Object.entries(grokCredential.environment).filter((entry): entry is [string, string] => typeof entry[1] === "string"));
    let receipt: Awaited<ReturnType<typeof probeQualifiedAcpxEnvironment>>;
    if (context.executionTarget?.kind === "remote") {
      const target = context.executionTarget;
      for (const key of ["HOME", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "CODEX_HOME", "GROK_HOME", "CLAUDE_CONFIG_DIR"]) delete environment[key];
      // Only configured credential names cross the selected environment boundary.
      // Values remain transport env data, never command text or diagnostic metadata.
      const script = `
        const { pathToFileURL } = await import('node:url');
        const { mkdtemp, rm } = await import('node:fs/promises');
        const { tmpdir } = await import('node:os');
        const { join } = await import('node:path');
        const { probeQualifiedAcpxEnvironment } = await import(pathToFileURL(process.argv[1] + '/dist/index.js'));
        const redactNativeProbeMessage = ${redactNativeProbeMessage.toString()};
        const names = JSON.parse(process.argv[4]);
        const environment = Object.fromEntries([...new Set([...names, ...${JSON.stringify(PROBE_TRANSPORT_ENV_KEYS)}])].filter(name => typeof process.env[name] === 'string').map(name => [name, process.env[name]]));
        const runtimeDirectory = await mkdtemp(join(tmpdir(), 'paperclip-native-setup-'));
        let grokCredentialRefreshPath;
        try {
          const result = await probeQualifiedAcpxEnvironment({ runtimeDirectory, agent: process.argv[2], model: process.argv[3], environment, hello: true, timeoutMs: ${timeoutMs}, onGrokCredentialRefresh: async path => { grokCredentialRefreshPath = path; } });
          if (!grokCredentialRefreshPath) await rm(runtimeDirectory, { recursive: true, force: true });
          console.log(JSON.stringify({ ...result, ...(grokCredentialRefreshPath ? { runtimeDirectory, grokCredentialRefreshPath } : {}) }));
        } catch (error) {
          let message = error instanceof Error ? error.message : 'The selected native runtime could not verify this account.';
          message = redactNativeProbeMessage(message, environment);
          if (grokCredentialRefreshPath) console.log(JSON.stringify({ nativeProbeError: message.slice(0, 2000), runtimeDirectory, grokCredentialRefreshPath }));
          else { console.error(message.slice(0, 2000)); process.exitCode = 1; }
        }
      `;
      const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
      const command = 'for pack in /opt/paperclip-runner/provider-pack "$HOME/.local/share/paperclip-runner/provider-pack"; do if [ -f "$pack/provider-pack.json" ]; then exec "$pack/node_modules/node/bin/node" --input-type=module -e '
        + quote(script) + ' "$pack" ' + [agent, model, JSON.stringify(Object.keys(environment))].map(quote).join(' ')
        + '; fi; done; echo "Qualified provider pack is missing" >&2; exit 1';
      const probe = await runAdapterExecutionTargetShellCommand(`native-hello-${crypto.randomUUID()}`, context.executionTarget, command,
        { cwd: context.executionTarget.remoteCwd, env: environment, timeoutSec: 110 });
      if (probe.timedOut) throw new Error("Native provider hello probe timed out.");
      if (probe.exitCode !== 0) throw new Error(probe.stderr.trim() || "The selected native runtime could not verify this account.");
      const result = JSON.parse(probe.stdout.trim());
      if (result.grokCredentialRefreshPath) {
        if (!grokCredential?.home || typeof result.runtimeDirectory !== "string"
          || !posix.isAbsolute(result.runtimeDirectory) || result.runtimeDirectory !== posix.normalize(result.runtimeDirectory) || !/^paperclip-native-setup-[A-Za-z0-9]+$/.test(posix.basename(result.runtimeDirectory))
          || result.grokCredentialRefreshPath !== posix.join(result.runtimeDirectory, "acpx", acpxRuntimeSessionDirectoryName("environment-probe"), "grok-home", "auth-refresh.json")) {
          throw new Error("The native Grok credential refresh handoff is invalid.");
        }
        // This is the same private, bounded transport read used by native runs;
        // credential bytes never enter the setup result or public diagnostics.
        const readScript = `const fs=require('node:fs'),path=require('node:path');let fd;try{let parent=path.dirname(process.argv[1]);while(true){if(!fs.lstatSync(parent).isDirectory())throw Error('directory');const next=path.dirname(parent);if(next===parent)break;parent=next;}fd=fs.openSync(process.argv[1],fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);const st=fs.fstatSync(fd);if(!st.isFile()||st.uid!==process.getuid()||(st.mode&511)!==384||st.size>65536)throw Error('credential');const b=Buffer.alloc(65537);let n=0;while(n<b.length){const k=fs.readSync(fd,b,n,b.length-n,n);if(!k)break;n+=k;}if(n>65536)throw Error('size');process.stdout.write(b.subarray(0,n).toString('base64'));b.fill(0);}catch(e){process.exitCode=e.code==='ENOENT'?66:1;}finally{if(fd!==undefined)fs.closeSync(fd);}`;
        await copyBackGrokAuth({ hostHomeDir: grokCredential.home, log: () => {}, readSandboxAuth: async () => {
          const read = await runAdapterExecutionTargetShellCommand(`native-refresh-${crypto.randomUUID()}`, target, 'node -e ' + quote(readScript) + ' ' + quote(result.grokCredentialRefreshPath), { cwd: target.remoteCwd, env: {}, timeoutSec: 10 });
          if (read.timedOut || read.exitCode !== 0) throw Object.assign(new Error("Native Grok credential refresh handoff unavailable."), { code: read.exitCode === 66 ? "ENOENT" : "INVALID_CREDENTIAL" });
          return Buffer.from(read.stdout, "base64");
        } });
        const cleaned = await runAdapterExecutionTargetShellCommand(`native-cleanup-${crypto.randomUUID()}`, context.executionTarget, 'rm -rf -- ' + quote(result.runtimeDirectory), { cwd: context.executionTarget.remoteCwd, env: {}, timeoutSec: 10 });
        if (cleaned.timedOut || cleaned.exitCode !== 0) throw new Error("Native Grok setup credential cleanup failed.");
      }
      if (result.nativeProbeError) throw new Error(result.nativeProbeError);
      receipt = result;
    } else {
      runtimeDirectory = await mkdtemp(join(tmpdir(), "paperclip-native-setup-"));
      receipt = await probeQualifiedAcpxEnvironment({ runtimeDirectory, agent, model, environment, hello: true, timeoutMs,
        ...(grokCredential?.home ? { onGrokCredentialRefresh: async (filename: string) => {
          await copyBackGrokAuth({ hostHomeDir: grokCredential.home!, log: () => {}, readSandboxAuth: async () => Buffer.from(await readLocalAiCredentialFile(filename)) });
        } } : {}),
      });
      // A successful receipt includes the driver's confirmed provider/credential cleanup.
      await rm(runtimeDirectory, { recursive: true, force: true });
    }
    if (receipt.helloProbePassed !== true || receipt.effectiveModel !== model || receipt.commandDigest !== expected.commandDigest) {
      throw new Error("The selected native runtime returned an incompatible account or model verification receipt.");
    }
    return {
      adapterType: "paperclip_runner", status: "pass", testedAt: new Date().toISOString(),
      checks: [{ code: `${agent}_hello_probe_passed`, level: "info",
        message: `The native ${agent} runtime verified the selected account and model in ${context.executionTarget?.kind === "remote" ? "the selected environment" : "the Paperclip host"}.` }],
    };
  } catch (error) {
    let message = error instanceof Error ? error.message : "The selected native runtime could not verify this account.";
    message = redactNativeProbeMessage(message, environment);
    const authentication = /(?:invalid (?:api[- ]?key|auth(?:entication)? token)|authentication (?:failed|required)|unauthenticated|unauthorized|not authenticated|please (?:log|sign) in|not logged in|\b(?:401|403)\b)/i.test(message);
    return {
      adapterType: "paperclip_runner", status: "fail", testedAt: new Date().toISOString(),
      checks: [{ code: `${agent}_hello_probe_${authentication ? "auth_required" : /timed out/i.test(message) ? "timeout" : "failed"}`, level: "error",
        message: message.slice(0, 2000), hint: "Check the selected account, model access, and native runtime prerequisites, then retry. Legacy runner is available explicitly in Advanced." }],
    };
  }
}
