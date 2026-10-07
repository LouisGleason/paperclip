import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
const { execute, probe } = vi.hoisted(() => ({ execute: vi.fn(), probe: vi.fn() }));
vi.mock("@paperclipai/adapter-utils/execution-target", () => ({ runAdapterExecutionTargetShellCommand: execute }));
vi.mock("../../vendor/paperclip-runner/index.js", async (original) => ({ ...await original<typeof import("../../vendor/paperclip-runner/index.js")>(), probeQualifiedAcpxEnvironment: probe }));
import { QUALIFIED_ACPX_PROFILES, acpxRuntimeSessionDirectoryName } from "../../vendor/paperclip-runner/index.js";
import { assertNativeRunnerSetupReady, assertRemoteAcpxSetupReady, testNativeAcpxAuthentication } from "./setup-readiness.js";
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
