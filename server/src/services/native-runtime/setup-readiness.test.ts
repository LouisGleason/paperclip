import { beforeEach, describe, expect, it, vi } from "vitest";
const execute = vi.hoisted(() => vi.fn());
vi.mock("@paperclipai/adapter-utils/execution-target", () => ({ runAdapterExecutionTargetShellCommand: execute }));
import { assertNativeRunnerSetupReady, assertRemoteAcpxSetupReady } from "./setup-readiness.js";
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
