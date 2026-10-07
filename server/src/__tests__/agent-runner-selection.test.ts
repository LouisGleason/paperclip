import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ disabled: [] as string[], overrides: new Set<string>() }));
vi.mock("../adapters/registry.js", () => ({
  findActiveServerAdapter: (type: string) => type === "missing" ? null : { type },
  hasActiveAdapterOverride: (type: string) => state.overrides.has(type),
  listEnabledServerAdapters: () => ["codex_local", "paperclip_runner", "gemini_local"].filter(type => !state.disabled.includes(type)).map(type => ({ type })),
}));
vi.mock("../services/adapter-plugin-store.js", () => ({ getDisabledAdapterTypes: () => state.disabled }));
import { agentRunnerAvailability, resolveNewAgentRunner } from "../services/agent-runner-selection.js";

describe("server-owned agent runner selection", () => {
  beforeEach(() => { state.disabled = []; state.overrides.clear(); });
  it.each([
    ["codex_local", { provider: "codex" }], ["claude_local", { provider: "acpx", acpxAgent: "claude" }],
    ["opencode_local", { provider: "opencode" }], ["grok_local", { provider: "acpx", acpxAgent: "grok" }],
    ["cursor", { provider: "acpx", acpxAgent: "cursor" }],
  ])("resolves %s to its qualified provider", (adapterType, profile) => {
    expect(resolveNewAgentRunner({ adapterType, adapterConfig: { model: adapterType === "opencode_local" ? "openai/gpt-5" : "chosen-model" } })).toMatchObject({ adapterType: "paperclip_runner", adapterConfig: profile });
  });
  it.each(["gemini_local", "pi_local", "kimi_local", "hermes_local", "cursor_cloud", "process", "http", "vendor"])("keeps %s legacy", adapterType => {
    expect(resolveNewAgentRunner({ adapterType }).adapterType).toBe(adapterType);
  });
  it("preserves an explicit legacy choice", () => {
    expect(resolveNewAgentRunner({ adapterType: "codex_local", runner: "legacy", adapterConfig: { command: "/custom/codex" } })).toMatchObject({ adapterType: "codex_local" });
  });
  it("uses legacy when the native adapter is disabled", () => {
    state.disabled = ["paperclip_runner"];
    expect(agentRunnerAvailability("codex_local").defaultRunner).toBe("legacy");
    expect(resolveNewAgentRunner({ adapterType: "codex_local" }).adapterType).toBe("codex_local");
    expect(() => resolveNewAgentRunner({ adapterType: "codex_local", runner: "paperclip" })).toThrow(/unavailable/);
  });
  it("rejects a disabled harness before selecting a runner", () => {
    state.disabled = ["claude_local"];
    expect(() => resolveNewAgentRunner({ adapterType: "claude_local" })).toThrow(/not available/);
  });
  it("respects an active external override", () => {
    state.overrides.add("codex_local");
    expect(resolveNewAgentRunner({ adapterType: "codex_local" }).adapterType).toBe("codex_local");
  });
  it("uses legacy on an unqualified execution platform", () => {
    const input = { adapterType: "grok_local", target: { driver: "local", platform: "darwin", architecture: "x64" } };
    expect(resolveNewAgentRunner(input).adapterType).toBe("grok_local");
    expect(() => resolveNewAgentRunner({ ...input, runner: "paperclip" })).toThrow(/unavailable/);
  });
  it("does not fall back for unsupported custom settings or invalid native models", () => {
    expect(() => resolveNewAgentRunner({ adapterType: "codex_local", adapterConfig: { command: "/custom/codex" } })).toThrow(/command/);
    expect(() => resolveNewAgentRunner({ adapterType: "opencode_local", adapterConfig: { model: "invalid" } })).toThrow(/provider\/model/);
    expect(() => resolveNewAgentRunner({ adapterType: "cursor" })).toThrow(/model/);
  });
  it("never guesses an unknown provider", () => {
    expect(() => resolveNewAgentRunner({ adapterType: "paperclip_runner", adapterConfig: { provider: "unknown" } })).toThrow(/provider/);
  });
});
