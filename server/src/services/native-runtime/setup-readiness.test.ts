import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
const { execute, probe, nativeProbe, remoteManifest, configuredManifest, bundledRunner, runnerBinding } = vi.hoisted(() => ({ execute: vi.fn(), probe: vi.fn(), nativeProbe: vi.fn(), remoteManifest: vi.fn(), configuredManifest: vi.fn(), bundledRunner: vi.fn(), runnerBinding: vi.fn() }));
vi.mock("@paperclipai/adapter-utils/execution-target", () => ({ runAdapterExecutionTargetShellCommand: execute }));
vi.mock("../../vendor/paperclip-runner/index.js", async (original) => ({ ...await original<typeof import("../../vendor/paperclip-runner/index.js")>(), probeQualifiedAcpxEnvironment: probe, probeNativeRunnerEnvironment: nativeProbe,
  bundledRemoteRunnerBinary: bundledRunner, readRunnerdArtifactBinding: runnerBinding }));
vi.mock("./native-session-executor.js", async original => ({ ...await original<typeof import("./native-session-executor.js")>(), readBundledRemoteProviderPackManifest: remoteManifest, readRemoteProviderPackManifest: configuredManifest }));
import { QUALIFIED_ACPX_PROFILES, acpxRuntimeSessionDirectoryName, resolveQualifiedAcpxProfile } from "../../vendor/paperclip-runner/index.js";
import { assertNativeRunnerSetupReady, assertRemoteAcpxSetupReady, testNativeAcpxAuthentication, testNativeRunnerAuthentication } from "./setup-readiness.js";
import { requireVerifiedAcpxModel } from "../../vendor/paperclip-runner/testing.js";
const context = {
  companyId: "company", adapterType: "paperclip_runner", config: {},
  executionTarget: { kind: "remote" as const, transport: "sandbox" as const, providerKey: "test", remoteCwd: "/workspace", runner: { execute: vi.fn() } },
};
describe("selected environment runtime readiness", () => {
  beforeEach(() => execute.mockReset());
  it("requires a compatible runner binary", async () => {
    execute.mockResolvedValue({ exitCode: 0, timedOut: false, stdout: JSON.stringify({ binaryName: "paperclip-runnerd", prp: { minimumVersion: 1, maximumVersion: 1 } }), stderr: "" });
    await expect(assertNativeRunnerSetupReady(context)).resolves.toBeUndefined();
    execute.mockResolvedValue({ exitCode: 0, timedOut: false, stdout: JSON.stringify({ binaryName: "other" }), stderr: "" });
    await expect(assertNativeRunnerSetupReady(context)).rejects.toThrow("incompatible");
  });
  it("reports missing dependencies without switching runner", async () => {
    execute.mockResolvedValue({ exitCode: 127, timedOut: false, stdout: "", stderr: "not found" });
    await expect(assertNativeRunnerSetupReady(context)).rejects.toThrow("Legacy runner in Advanced");
    await expect(assertRemoteAcpxSetupReady(context, "claude", "claude-sonnet-5")).rejects.toThrow("provider pack");
  });
  it("probes the provider pack on the same target without sending credentials", async () => {
    execute.mockResolvedValue({ exitCode: 0, timedOut: false, stdout: "", stderr: "" });
    await assertRemoteAcpxSetupReady(context, "cursor", "model'with-quote");
    expect(execute).toHaveBeenCalledWith(expect.any(String), context.executionTarget, expect.stringContaining("probeAcpxCursorInstallation"), { cwd: "/workspace", env: {}, timeoutSec: 30 });
    const command = execute.mock.calls[0][2] as string;
    expect(command).toContain("qualified-profiles.js");
    expect(command).not.toContain("CURSOR_API_KEY");
  });
});

describe("Codex and OpenCode selected native account verification", () => {
  const receipt = (provider: "codex" | "opencode", model: string | null) => ({ provider, effectiveModel: model, providerDriver: provider === "codex" ? "codex_app_server" : "opencode_server", helloProbePassed: true, cleanupConfirmed: true });
  beforeEach(() => {
    execute.mockReset(); nativeProbe.mockReset();
    remoteManifest.mockReset().mockReturnValue({ payload: { artifacts: { nodeCommand: { path: "node_modules/node/bin/node" } } } });
    configuredManifest.mockReset().mockReturnValue({ payload: { artifacts: { nodeCommand: { path: "node_modules/node/bin/node" } } } });
    bundledRunner.mockReset().mockReturnValue("/release/linux-x64/paperclip-runnerd");
    runnerBinding.mockReset().mockReturnValue({ version: "1", digest: "sha256:" + "a".repeat(64) });
    vi.stubEnv("PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH", "");
    vi.stubEnv("PAPERCLIP_RUNNER_REMOTE_BINARY_PATH", "");
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const [input] of nativeProbe.mock.calls) if (input.runtimeDirectory) await rm(input.runtimeDirectory, { recursive: true, force: true });
  });
  it.each([["codex", "gpt-6.1-sol", "OPENAI_API_KEY"], ["opencode", "openrouter/example/model", "OPENROUTER_API_KEY"]] as const)("requires the native %s host and only the selected credential", async (provider, model, key) => {
    vi.stubEnv(key, "ambient-account");
    vi.stubEnv("ANTHROPIC_API_KEY", "ambient-anthropic");
    nativeProbe.mockImplementation(async input => { await input.onCleanupConfirmed(); return receipt(provider, model); });
    const result = await testNativeRunnerAuthentication({ companyId: "company", adapterType: "paperclip_runner", config: { env: { [key]: "bound-account" }, modelReasoningEffort: "low" } }, provider, model);
    expect(result.status).toBe("pass");
    const input = nativeProbe.mock.calls[0][0];
    expect(input).toMatchObject({ provider, model, timeoutMs: 45_000, environment: { [key]: "bound-account" } });
    expect(input.environment.ANTHROPIC_API_KEY).toBeUndefined();
    if (provider === "codex") expect(input.reasoningEffort).toBe("low");
    else expect(input.reasoningEffort).toBeUndefined();
    await expect(stat(input.runtimeDirectory)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });
  it.each(["codex", "opencode"] as const)("probes native %s in the selected remote pack with env-only credentials", async provider => {
    const model = provider === "codex" ? "gpt-6.1-sol" : "openrouter/example/model";
    execute.mockResolvedValue({ exitCode: 0, timedOut: false, stdout: JSON.stringify(receipt(provider, model)), stderr: "" });
    const result = await testNativeRunnerAuthentication({ ...context, config: { env: { OPENAI_API_KEY: "bound-account", ANTHROPIC_API_KEY: "", HOME: "/controller/home" } } }, provider, model);
    expect(result.status).toBe("pass");
    expect(execute).toHaveBeenCalledWith(expect.any(String), context.executionTarget, expect.stringContaining("probeNativeRunnerEnvironment"), expect.objectContaining({ cwd: "/workspace", env: { OPENAI_API_KEY: "bound-account", ANTHROPIC_API_KEY: "" }, timeoutSec: 110 }));
    expect(execute.mock.calls[0][2]).not.toContain("bound-account");
    const command = execute.mock.calls[0][2] as string;
    expect(command).toContain("manifest mismatch");
    expect(command).toContain("dist tree digest mismatch");
    expect(command).toContain("selected daemon digest mismatch");
    expect(command).not.toContain("command -v");
    expect(command).toContain("onCleanupConfirmed");
    expect(command).toContain("if (!codexCredentialRefreshPath)");
    expect(nativeProbe).not.toHaveBeenCalled();
    expect(remoteManifest).toHaveBeenCalledOnce();
    expect(bundledRunner).toHaveBeenCalledOnce();
    expect(configuredManifest).not.toHaveBeenCalled();
    expect(runnerBinding).toHaveBeenCalledWith("/release/linux-x64/paperclip-runnerd");
  });
  it.each(["codex", "opencode"] as const)("uses the standard Linux image artifacts for %s without an npm release manifest", async provider => {
    vi.stubEnv("PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH", "/opt/paperclip-runner/provider-pack");
    remoteManifest.mockImplementation(() => { throw new Error("no assembled npm manifest in the standard image"); });
    bundledRunner.mockImplementation(() => { throw new Error("no assembled npm daemon manifest in the standard image"); });
    const model = provider === "codex" ? null : "openrouter/example/model";
    execute.mockResolvedValue({ exitCode: 0, timedOut: false, stdout: JSON.stringify(receipt(provider, model ?? "actual-codex-model")), stderr: "" });
    expect((await testNativeRunnerAuthentication(context, provider, model)).status).toBe("pass");
    expect(configuredManifest).toHaveBeenCalledWith("/opt/paperclip-runner/provider-pack");
    expect(remoteManifest).not.toHaveBeenCalled();
    expect(bundledRunner).not.toHaveBeenCalled();
    expect(runnerBinding).toHaveBeenCalledWith(expect.stringMatching(/paperclip-runnerd$/));
  });
  it("preserves the explicitly selected qualified image daemon instead of resolving another one", async () => {
    vi.stubEnv("PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH", "/opt/paperclip-runner/provider-pack");
    vi.stubEnv("PAPERCLIP_RUNNER_REMOTE_BINARY_PATH", "/image/exact-linux-daemon");
    execute.mockResolvedValue({ exitCode: 0, timedOut: false, stdout: JSON.stringify(receipt("codex", "actual-model")), stderr: "" });
    expect((await testNativeRunnerAuthentication(context, "codex", null)).status).toBe("pass");
    expect(runnerBinding).toHaveBeenCalledWith("/image/exact-linux-daemon");
  });
  it("fails before remote evaluation when the controller distribution has no qualified artifacts", async () => {
    remoteManifest.mockImplementation(() => { throw new Error("runner_remote_provider_artifact_incompatible: missing provider pack"); });
    const result = await testNativeRunnerAuthentication(context, "codex", null);
    expect(result).toMatchObject({ status: "fail", checks: [{ code: "codex_hello_probe_failed", message: expect.stringContaining("missing provider pack") }] });
    expect(execute).not.toHaveBeenCalled();
    expect(nativeProbe).not.toHaveBeenCalled();
  });
  it.each([
    ["authentication failed: bound-account", "auth_required"], ["Native provider hello probe timed out.", "timeout"],
    ["Model is unavailable", "failed"], ["native executable is missing", "failed"], ["native provider returned no response", "failed"],
  ])("fails closed and redacts native failures (%s)", async (message, code) => {
    nativeProbe.mockRejectedValue(new Error(message));
    const result = await testNativeRunnerAuthentication({ companyId: "company", adapterType: "paperclip_runner", config: { env: { OPENAI_API_KEY: "bound-account" } } }, "codex", "gpt-6.1-sol");
    expect(result).toMatchObject({ status: "fail", checks: [{ code: `codex_hello_probe_${code}`, level: "error" }] });
    expect(JSON.stringify(result)).not.toContain("bound-account");
    expect(nativeProbe).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([
    { helloProbePassed: undefined }, { effectiveModel: "another-model" }, { effectiveModel: null }, { effectiveModel: "" }, { provider: "opencode" }, { providerDriver: "codex_cli" },
  ])("rejects installation-only, legacy, or mismatched receipts", async override => {
    nativeProbe.mockResolvedValue({ ...receipt("codex", "gpt-6.1-sol"), ...override });
    expect((await testNativeRunnerAuthentication({ companyId: "company", adapterType: "paperclip_runner", config: {} }, "codex", "gpt-6.1-sol")).status).toBe("fail");
  });
  it("accepts an automatic Codex model only when the native provider observed a nonempty model", async () => {
    nativeProbe.mockResolvedValue(receipt("codex", "gpt-6.1-sol"));
    expect((await testNativeRunnerAuthentication({ companyId: "company", adapterType: "paperclip_runner", config: {} }, "codex", null)).status).toBe("pass");
    expect(nativeProbe.mock.calls[0][0].model).toBeNull();
    nativeProbe.mockResolvedValue(receipt("codex", null));
    expect((await testNativeRunnerAuthentication({ companyId: "company", adapterType: "paperclip_runner", config: {} }, "codex", null)).status).toBe("fail");
  });
  it.each([true, false])("removes failed local probe state only after confirmed teardown (%s)", async confirmed => {
    nativeProbe.mockImplementation(async input => {
      if (confirmed) await input.onCleanupConfirmed();
      throw new Error("authentication failed");
    });
    expect((await testNativeRunnerAuthentication({ companyId: "company", adapterType: "paperclip_runner", config: {} }, "codex", null)).status).toBe("fail");
    const root = nativeProbe.mock.calls[0][0].runtimeDirectory;
    if (confirmed) await expect(stat(root)).rejects.toThrow();
    else expect((await stat(root)).isDirectory()).toBe(true);
  });
  it("stages the bound Codex login and managed provider configuration on the selected target", async () => {
    const home = await mkdtemp(join(tmpdir(), "native-codex-selected-login-"));
    try {
      await writeFile(join(home, "auth.json"), JSON.stringify({ tokens: { access_token: "bound-login-token" } }), { mode: 0o600 });
      await writeFile(join(home, "config.toml"), 'model_provider = "paperclip"\n', { mode: 0o600 });
      execute.mockResolvedValue({ exitCode: 0, timedOut: false, stdout: JSON.stringify(receipt("codex", "gpt-6.1-sol")), stderr: "" });
      expect((await testNativeRunnerAuthentication({ ...context, managedAiCredentialHome: home, config: { env: { CODEX_HOME: home } } }, "codex", "gpt-6.1-sol")).status).toBe("pass");
      const env = execute.mock.calls[0][3].env;
      expect(env._PAPERCLIP_NATIVE_SETUP_CODEX_AUTH_JSON_SECRET).toContain("bound-login-token");
      expect(env._PAPERCLIP_NATIVE_SETUP_CODEX_CONFIG_TOML_SECRET).toContain('model_provider = "paperclip"');
      expect(env.CODEX_HOME).toBeUndefined();
      expect(execute.mock.calls[0][2]).not.toContain("bound-login-token");
      expect(execute.mock.calls[0][2]).not.toContain(home);
    } finally { await rm(home, { recursive: true, force: true }); }
  });
  it.each(["same-account", "another-account", "read-failure", "uncertain-close"] as const)("retains the native failure while applying the existing Codex refresh rule (%s)", async mode => {
    const home = await mkdtemp(join(tmpdir(), "native-codex-failed-refresh-"));
    const auth = (account: string, marker: string, age: number) => JSON.stringify({ tokens: { account_id: account, id_token: `id-${marker}`, access_token: `access-${marker}`, refresh_token: `refresh-${marker}` }, last_refresh: new Date(Date.now() - age).toISOString() });
    const initial = auth("qa-account", "old", 120_000);
    const refreshed = auth(mode === "another-account" ? "unrelated-account" : "qa-account", "new", 60_000);
    try {
      await writeFile(join(home, "auth.json"), initial, { mode: 0o600 });
      execute.mockResolvedValueOnce({ exitCode: 0, timedOut: false, stderr: "", stdout: JSON.stringify({ nativeProbeError: "authentication failed in the selected native provider" + (mode === "uncertain-close" ? "; native provider teardown was not confirmed" : ""), cleanupConfirmed: mode !== "uncertain-close", runtimeDirectory: "/tmp/paperclip-native-setup-QA123", codexCredentialRefreshPath: "/tmp/paperclip-native-setup-QA123/codex-home/auth.json" }) });
      execute.mockResolvedValueOnce({ exitCode: mode === "read-failure" ? 1 : 0, timedOut: false, stderr: "", stdout: Buffer.from(refreshed).toString("base64") });
      execute.mockResolvedValueOnce({ exitCode: 0, timedOut: false, stderr: "", stdout: "" });
      const result = await testNativeRunnerAuthentication({ ...context, managedAiCredentialHome: home }, "codex", "gpt-6.1-sol");
      expect(result).toMatchObject({ status: "fail", checks: [{ code: "codex_hello_probe_auth_required", message: expect.stringContaining("authentication failed in the selected native provider") }] });
      expect(JSON.parse(await readFile(join(home, "auth.json"), "utf8")).tokens.access_token).toBe(mode === "same-account" || mode === "uncertain-close" ? "access-new" : "access-old");
      if (mode === "read-failure") expect(result.checks[0].message).toContain("credential refresh handoff unavailable");
      expect(JSON.stringify(result)).not.toContain("access-new");
      expect(execute.mock.calls[1][3].env).toEqual({});
      if (mode === "uncertain-close") {
        expect(result.checks[0].message).toContain("teardown was not confirmed");
        expect(execute).toHaveBeenCalledTimes(2);
        expect(execute.mock.calls.some(call => String(call[2]).startsWith("rm -rf"))).toBe(false);
      }
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});

describe("selected native account verification", () => {
  const receipt = { effectiveModel: "claude-sonnet-5", commandDigest: QUALIFIED_ACPX_PROFILES.claude.commandDigest, helloProbePassed: true as const };
  const localContext = { companyId: "company", adapterType: "paperclip_runner", config: { env: { CLAUDE_CODE_OAUTH_TOKEN: "bound-subscription-token" } } };
  beforeEach(() => { execute.mockReset(); probe.mockReset().mockResolvedValue(receipt); });
  afterEach(async () => {
    vi.unstubAllEnvs();
    for (const [input] of probe.mock.calls) if (input.runtimeDirectory) await rm(input.runtimeDirectory, { recursive: true, force: true });
  });

  it("uses the production native host, a private workspace, and only the bound account", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "ambient-account-must-not-be-used");
    probe.mockImplementation(async input => {
      expect((await stat(input.runtimeDirectory)).mode & 0o777).toBe(0o700);
      return receipt;
    });
    const result = await testNativeAcpxAuthentication(localContext, "claude", "claude-sonnet-5");
    expect(result.status).toBe("pass");
    expect(result.checks).toEqual([expect.objectContaining({ code: "claude_hello_probe_passed" })]);
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ agent: "claude", model: "claude-sonnet-5", hello: true, timeoutMs: 45_000, environment: expect.objectContaining({ CLAUDE_CODE_OAUTH_TOKEN: "bound-subscription-token" }) }));
    expect(probe.mock.calls[0][0].environment.ANTHROPIC_API_KEY).toBeUndefined();
    await expect(stat(probe.mock.calls[0][0].runtimeDirectory)).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it("sends credentials as environment data on the selected target, never in command text", async () => {
    execute.mockResolvedValue({ exitCode: 0, timedOut: false, stdout: JSON.stringify(receipt), stderr: "" });
    const result = await testNativeAcpxAuthentication({ ...context, config: localContext.config }, "claude", "claude-sonnet-5");
    expect(result.status).toBe("pass");
    expect(execute).toHaveBeenCalledWith(expect.any(String), context.executionTarget, expect.stringContaining("probeQualifiedAcpxEnvironment"), expect.objectContaining({ cwd: "/workspace", env: expect.objectContaining({ CLAUDE_CODE_OAUTH_TOKEN: "bound-subscription-token" }), timeoutSec: 110 }));
    expect(execute.mock.calls[0][2]).not.toContain("bound-subscription-token");
  });

  it.each([
    [new Error("Authentication failed: bound-subscription-token"), "claude_hello_probe_auth_required"],
    [new Error("Native provider hello probe timed out."), "claude_hello_probe_timeout"],
    [new Error("Model is unavailable"), "claude_hello_probe_failed"],
  ])("preserves actionable failure without another runner and redacts bound credentials", async (error, code) => {
    probe.mockRejectedValue(error);
    const result = await testNativeAcpxAuthentication(localContext, "claude", "claude-sonnet-5");
    expect(result.status).toBe("fail");
    expect(result.checks[0].code).toBe(code);
    expect(JSON.stringify(result)).not.toContain("bound-subscription-token");
    expect(result.checks[0].hint).toContain("Legacy runner");
    expect(probe).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
  });

  it.each([{ ...receipt, helloProbePassed: undefined }, { ...receipt, effectiveModel: "other-model" }, { ...receipt, commandDigest: "different-runtime" }])("rejects installation-only or mismatched native receipts", async value => {
    probe.mockResolvedValue(value);
    expect((await testNativeAcpxAuthentication(localContext, "claude", "claude-sonnet-5")).status).toBe("fail");
  });

  it.each([["cursor", "CURSOR_AUTH_TOKEN", "cursor-model"], ["grok", "XAI_API_KEY", "grok-4.7"]] as const)("verifies the explicitly bound %s credential and model through the same native host", async (agent, key, model) => {
    vi.stubEnv(key, "ambient-account");
    probe.mockResolvedValue({ ...receipt, effectiveModel: model, commandDigest: QUALIFIED_ACPX_PROFILES[agent].commandDigest });
    const result = await testNativeAcpxAuthentication({ ...localContext, config: { env: { [key]: "selected-account" } } }, agent, model);
    expect(result.status, JSON.stringify(result)).toBe("pass");
    expect(probe).toHaveBeenCalledWith(expect.objectContaining({ agent, model, hello: true, environment: expect.objectContaining({ [key]: "selected-account" }) }));
    expect(result.checks[0].code).toBe(`${agent}_hello_probe_passed`);
  });

  it("accepts Cursor's normalized hello identity only after verifying its advertised full model", async () => {
    const model = "gpt-5.6-sol", selector = `${model}[context=272k,reasoning=medium,fast=false]`;
    let currentModelId = "default";
    const setModel = vi.fn(async selected => { currentModelId = selected; });
    probe.mockImplementation(async input => {
      const verified = await requireVerifiedAcpxModel({
        getStatus: async () => ({ models: { currentModelId, availableModelIds: [selector] } }), setModel,
      }, resolveQualifiedAcpxProfile(input.agent, input.model));
      return { effectiveModel: verified.models!.currentModelId, commandDigest: QUALIFIED_ACPX_PROFILES.cursor.commandDigest, helloProbePassed: true };
    });
    const selectedContext = { ...localContext, config: { env: { CURSOR_AUTH_TOKEN: "selected-account" } } };
    expect((await testNativeAcpxAuthentication(selectedContext, "cursor", model)).status).toBe("pass");
    expect(setModel).toHaveBeenCalledExactlyOnceWith(selector);
    // A custom full ID is still passed unchanged to the provider and may fail;
    // it never borrows the successful base-model selection above.
    setModel.mockRejectedValue(new Error("Model is not available for this account"));
    const rejected = await testNativeAcpxAuthentication(selectedContext, "cursor", "custom/model[context=272k]");
    expect(rejected.status).toBe("fail");
    expect(rejected.checks[0].code).toBe("cursor_hello_probe_failed");
    expect(setModel).toHaveBeenLastCalledWith("custom/model[context=272k]");
  });

  const grokReceipt = { ...receipt, effectiveModel: "grok-4.7", commandDigest: QUALIFIED_ACPX_PROFILES.grok.commandDigest };
  const grokAuth = (marker: string, expiresAt: string) => JSON.stringify({ "https://auth.x.ai::11111111-1111-1111-1111-111111111111": { key: `key-${marker}`, refresh_token: `refresh-${marker}`, expires_at: expiresAt } });
  const olderExpiry = () => new Date(Date.now() + 60_000).toISOString();
  const newerExpiry = () => new Date(Date.now() + 120_000).toISOString();
  it("stages only the server-owned Grok login and preserves a newer same-account refresh before cleanup", async () => {
    const home = await mkdtemp(join(tmpdir(), "grok-setup-connection-test-"));
    const oldAuth = grokAuth("old", olderExpiry());
    const newAuth = grokAuth("new", newerExpiry());
    try {
      await writeFile(join(home, "auth.json"), oldAuth, { mode: 0o600 });
      vi.stubEnv("XAI_API_KEY", "ambient-key-must-not-be-used");
      probe.mockImplementation(async input => {
        expect(input.environment.PAPERCLIP_ACPX_GROK_AUTH_JSON_SECRET).toBe(oldAuth);
        expect(input.environment.XAI_API_KEY).toBeUndefined();
        expect(input.environment.GROK_HOME).toBeUndefined();
        const refreshed = join(await realpath(input.runtimeDirectory), "refresh.json");
        await writeFile(refreshed, newAuth, { mode: 0o600 });
        await input.onGrokCredentialRefresh(refreshed);
        return grokReceipt;
      });
      const result = await testNativeAcpxAuthentication({ ...localContext, managedAiCredentialHome: home, config: { env: { GROK_HOME: "/untrusted/home" } } }, "grok", "grok-4.7");
      expect(result.status, JSON.stringify(result)).toBe("pass");
      expect(await readFile(join(home, "auth.json"), "utf8")).toBe(newAuth);
      expect(JSON.stringify(result)).not.toContain("key-new");
      await expect(stat(probe.mock.calls[0][0].runtimeDirectory)).rejects.toThrow();
    } finally { await rm(home, { recursive: true, force: true }); }
  });

  it.each([false, true])("remote Grok preserves refresh on the controller before reporting readiness (failed turn: %s)", async failed => {
    const home = await mkdtemp(join(tmpdir(), "grok-setup-remote-test-"));
    const runtimeDirectory = "/tmp/paperclip-native-setup-QA1";
    const grokCredentialRefreshPath = posix.join(runtimeDirectory, "acpx", acpxRuntimeSessionDirectoryName("environment-probe"), "grok-home", "auth-refresh.json");
    const newAuth = grokAuth("new", newerExpiry());
    try {
      await writeFile(join(home, "auth.json"), grokAuth("old", olderExpiry()), { mode: 0o600 });
      execute.mockResolvedValueOnce({ exitCode: 0, timedOut: false, stdout: JSON.stringify({ ...(failed ? { nativeProbeError: "Provider rejected turn" } : grokReceipt), runtimeDirectory, grokCredentialRefreshPath }), stderr: "" })
        .mockResolvedValueOnce({ exitCode: 0, timedOut: false, stdout: Buffer.from(newAuth).toString("base64"), stderr: "" })
        .mockResolvedValueOnce({ exitCode: 0, timedOut: false, stdout: "", stderr: "" });
      const result = await testNativeAcpxAuthentication({ ...context, managedAiCredentialHome: home, config: { env: { HOME: "/controller/home", GROK_HOME: "/untrusted/home" } } }, "grok", "grok-4.7");
      expect(result.status, JSON.stringify(result)).toBe(failed ? "fail" : "pass");
      expect(await readFile(join(home, "auth.json"), "utf8")).toBe(newAuth);
      expect(execute).toHaveBeenCalledTimes(3);
      expect(execute.mock.calls[0][3].env.HOME).toBeUndefined();
      expect(execute.mock.calls[0][3].env.PATH).toBeUndefined();
      expect(execute.mock.calls[0][2]).not.toContain("key-old");
      expect(execute.mock.calls[2][2]).toContain(runtimeDirectory);
      expect(JSON.stringify(result)).not.toContain("key-new");
    } finally { await rm(home, { recursive: true, force: true }); }
  });
});
