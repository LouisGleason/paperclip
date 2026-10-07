import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { AdapterEnvironmentTestContext } from "@paperclipai/adapter-utils";
import { runAdapterExecutionTargetShellCommand } from "@paperclipai/adapter-utils/execution-target";
import { QUALIFIED_ACPX_PROFILES } from "../../vendor/paperclip-runner/index.js";
import { resolvePaperclipRunnerBinary } from "./native-codex-runner.js";

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
