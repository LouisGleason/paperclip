import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

// Pins the wiring that makes the background-service smoke an effective gate.
// The service leg exists because v2026.824.0 shipped a service install that
// crash-looped on a missing shim while the Docker smoke stayed green; these
// assertions keep the job from being silently disconnected or weakened.

const repoRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const scriptPath = join(repoRoot, "scripts", "service-onboard-smoke.sh");
const script = readFileSync(scriptPath, "utf8");
const smokeWorkflow = readFileSync(join(repoRoot, ".github", "workflows", "release-smoke.yml"), "utf8");
const releaseWorkflow = readFileSync(join(repoRoot, ".github", "workflows", "release.yml"), "utf8");

test("smoke script is executable and parses", () => {
  accessSync(scriptPath, constants.X_OK);
  execFileSync("bash", ["-n", scriptPath]);
});

test("smoke script keeps its load-bearing assertions", () => {
  assert.match(script, /^set -euo pipefail$/m);
  // Onboards the published artifact with the service leg forced on.
  assert.match(script, /onboard --yes --install-service/);
  // Fails when the shim never materialized.
  assert.match(script, /no executable shim at .*after onboarding/);
  // Fails when the unit dies instead of serving.
  assert.match(script, /entered the failed state/);
  // Fails when health answers but the service is not what is serving --
  // the exact signature of the v2026.824.0 defect.
  assert.match(script, /something other than the service is serving/);
  // Refuses to smoke over a real install unless forced.
  assert.match(script, /SMOKE_FORCE/);
});

test("release-smoke workflow runs the service leg against the input version", () => {
  assert.match(smokeWorkflow, /^  smoke_service:$/m);
  assert.match(smokeWorkflow, /scripts\/service-onboard-smoke\.sh/);
  const serviceJob = smokeWorkflow.split(/^  smoke:$/m)[0];
  assert.match(serviceJob, /PAPERCLIPAI_VERSION: \$\{\{ inputs\.paperclip_version \}\}/);
  // Diagnostics must survive the run: cleanup stays off in CI and the
  // artifact name cannot collide with the Docker job's upload.
  assert.match(serviceJob, /SMOKE_CLEANUP: "false"/);
  assert.match(serviceJob, /\$\{\{ inputs\.artifact_name \}\}-service/);
  assert.match(serviceJob, /name: Remove the owned smoke service after diagnostics/);
  assert.match(serviceJob, /service-smoke-owned/);
  assert.match(serviceJob, /! systemctl --user is-active --quiet paperclipai\.service/);
  assert.match(serviceJob, /! systemctl --user cat paperclipai\.service/);
});

test("source service qualification keeps the supported installer and real managed-shim path", () => {
  const serviceJob = smokeWorkflow.split(/^  smoke:$/m)[0];
  assert.match(serviceJob, /ref: \$\{\{ inputs\.qualification_source_sha \|\| github\.sha \}\}/);
  assert.match(serviceJob, /cli\/node_modules\/tsx\/dist\/cli\.mjs/);
  assert.match(serviceJob, /cli\/src\/index\.ts/);
  assert.match(serviceJob, /PAPERCLIPAI_CLI_PATH: \$\{\{ runner\.temp \}\}\/service-source-qualification\/bootstrap\.mjs/);
  assert.doesNotMatch(serviceJob, /cli\/dist\/index\.js|pnpm --filter paperclipai build/);
  assert.doesNotMatch(serviceJob, /secrets\./);
  assert.match(script, /PAPERCLIP_HOME="\$DATA_DIR" PAPERCLIP_BUILD_COMMIT="\$SOURCE_SHA"/);
  assert.match(script, /install --repo paperclipai\/paperclip --ref "\$SOURCE_SHA" --yes/);
  assert.match(script, /onboard_command=\("\$SHIM_PATH"\)/);
  assert.match(script, /--inspect-service "\$SOURCE_SHA"/);
  assert.match(script, /--property=MainPID --value/);
  assert.match(script, /instances\/default\/runtime-info\.json/);
  assert.doesNotMatch(script, /writeManagedShim|\.managed-install|source.*payload.*cp/);
});

test("source service bootstrap loads with every workspace dist module unavailable", () => {
  const root = mkdtempSync(join(tmpdir(), "paperclip-service-source-bootstrap-"));
  try {
    const generator = smokeWorkflow.match(/node --input-type=module <<'NODE'\n([\s\S]*?)\n          NODE/)?.[1];
    assert.ok(generator, "The workflow must prepare its owned source bootstrap");
    // Reject compiled workspace modules rather than relying on this checkout's
    // build outputs. External npm dependencies retain their real install graph.
    const loader = join(root, "source-only.mjs");
    writeFileSync(loader, `import { registerHooks } from "node:module";
import { fileURLToPath } from "node:url";
const workspaces = ${JSON.stringify([realpathSync(repoRoot) + "/", realpathSync(root) + "/"])};
registerHooks({ resolve(specifier, context, nextResolve) {
  const result = nextResolve(specifier, context);
  if (result.url.startsWith("file:")) {
    const file = fileURLToPath(result.url);
    const workspace = workspaces.find(root => file.startsWith(root));
    const relative = workspace && file.slice(workspace.length);
    if (relative && !relative.includes("node_modules/") && relative.split("/").includes("dist")) {
      throw new Error("SOURCE_BOOTSTRAP_REQUIRES_WORKSPACE_DIST: " + file);
    }
  }
  return result;
}});
`, { mode: 0o600 });
    const env = { ...process.env, GITHUB_WORKSPACE: repoRoot, RUNNER_TEMP: root,
      PAPERCLIP_TELEMETRY_DISABLED: "1", NODE_PATH: "", NODE_OPTIONS: `--import=${pathToFileURL(loader).href}` };
    const control = join(root, "dist", "must-not-load.mjs");
    mkdirSync(join(root, "dist"));
    writeFileSync(control, "throw new Error('Compiled workspace code executed');\n");
    const rejected = spawnSync(process.execPath, ["--input-type=module", "--eval",
      `await import(${JSON.stringify(pathToFileURL(control).href)})`], { env, encoding: "utf8", timeout: 10_000 });
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /SOURCE_BOOTSTRAP_REQUIRES_WORKSPACE_DIST/);
    const directory = join(root, "service-source-qualification");
    mkdirSync(directory, { recursive: true });
    execFileSync(process.execPath, ["--input-type=module"], { input: generator, env, timeout: 10_000 });
    const help = execFileSync(process.execPath, [join(directory, "bootstrap.mjs"), "--help"],
      { env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
    assert.match(help, /Usage:/);
    assert.match(help, /install/);
    // An install subcommand help flag must reach the real CLI unchanged.
    const installHelp = execFileSync(process.execPath, [join(directory, "bootstrap.mjs"), "install", "--help"],
      { env, encoding: "utf8", timeout: 30_000, maxBuffer: 1024 * 1024 });
    assert.match(installHelp, /--repo/);
    assert.match(installHelp, /--ref/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("malformed source qualification cannot run or clean up an existing shim", () => {
  const root = mkdtempSync(join(tmpdir(), "paperclip-service-input-test-"));
  const shim = join(root, "paperclipai"), invoked = join(root, "invoked");
  try {
    writeFileSync(shim, `#!/bin/sh\ntouch "${invoked}"\n`, { mode: 0o755 });
    for (const [SOURCE_SHA, PAPERCLIPAI_CLI_PATH, message] of [
      ["master", shim, /full source SHA/],
      ["a".repeat(40), "relative-cli.js", /candidate CLI bootstrap/],
      ["a".repeat(40), join(root, "missing-cli.js"), /candidate CLI bootstrap/],
    ]) {
      const result = spawnSync("bash", [scriptPath], { encoding: "utf8",
        env: { ...process.env, SOURCE_SHA, PAPERCLIPAI_CLI_PATH, PAPERCLIP_SHIM_PATH: shim,
          DATA_DIR: join(root, "data"), SMOKE_CLEANUP: "true" } });
      assert.equal(result.status, 1);
      assert.match(result.stderr, message);
      assert.equal(existsSync(invoked), false, "Refusing malformed input must not uninstall a preexisting service");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("nightly and beta smokes still route through the reusable workflow", () => {
  const calls = releaseWorkflow.match(/uses: \.\/\.github\/workflows\/release-smoke\.yml/g) ?? [];
  assert.ok(calls.length >= 2, "smoke_nightly and smoke_beta must call release-smoke.yml so smoke_service gates them");
});
