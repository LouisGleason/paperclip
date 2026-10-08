import { describe, expect, it } from "vitest";
import { canonicalRemoteCopilotCommand, copilotDeathArguments, selectOwnedCopilotProcess } from "./copilot-provider-death.js";

describe("owned Copilot provider death selector", () => {
  const root = { pid: 10, parent: 1 }, sidecar = { pid: 11, parent: 10 }, native = { pid: 12, parent: 11 };
  const argv = ["/private/paperclip-acpx-native-owned/distribution/copilot", ...copilotDeathArguments];
  it("selects only the native child of the live owned run", () => {
    expect(selectOwnedCopilotProcess(10, [root, sidecar, native], [10, 11, 12], new Map([[12, argv]]))).toEqual(native);
  });
  it.each([3, 7])("recognizes a verified inherited Linux descriptor %i", fd => {
    const command = [`/proc/self/fd/${fd}`, ...copilotDeathArguments];
    const canonical = canonicalRemoteCopilotCommand(command, argv[0]!, { dev: "1", ino: "2" }, { path: argv[0]!, dev: "1", ino: "2" });
    expect(selectOwnedCopilotProcess(10, [root, sidecar, native], [10, 11, 12], new Map([[12, canonical]]))).toEqual(native);
  });
  it("refuses descriptor aliases without matching executable identity", () => {
    for (const [command, executable, descriptor] of [
      [["/proc/self/fd/8", ...copilotDeathArguments], argv[0], { path: argv[0], dev: "1", ino: "2" }],
      [["/proc/self/fd/7", ...copilotDeathArguments], "/usr/bin/copilot", { path: "/usr/bin/copilot", dev: "1", ino: "2" }],
      [["/proc/self/fd/7", ...copilotDeathArguments], argv[0], undefined],
      [["/proc/self/fd/7", ...copilotDeathArguments], argv[0], { path: "/foreign/copilot", dev: "1", ino: "2" }],
      [["/proc/self/fd/7", ...copilotDeathArguments], argv[0], { path: argv[0], dev: "2", ino: "2" }],
      [["/proc/self/fd/7", ...copilotDeathArguments], argv[0], { path: argv[0], dev: "1", ino: "3" }],
    ] as const) {
      const canonical = canonicalRemoteCopilotCommand(command, executable!, { dev: "1", ino: "2" }, descriptor as any);
      expect(() => selectOwnedCopilotProcess(10, [root, sidecar, native], [10, 11, 12], new Map([[12, canonical]]))).toThrow();
    }
  });
  it("refuses foreign, retired, ambiguous and caller-selected processes", () => {
    const commands = new Map([[12, argv]]);
    expect(() => selectOwnedCopilotProcess(10, [root, sidecar, { ...native, parent: 99 }], [10, 11, 12], commands)).toThrow();
    expect(() => selectOwnedCopilotProcess(10, [root, sidecar, native], [11, 12], commands)).toThrow();
    expect(() => selectOwnedCopilotProcess(10, [root, sidecar, native], [10, 11], commands)).toThrow();
    expect(() => selectOwnedCopilotProcess(10, [root, sidecar, native, { pid: 13, parent: 11 }], [10, 11, 12, 13], new Map([[12, argv], [13, argv]]))).toThrow();
    for (const invalid of [["/usr/bin/copilot", ...copilotDeathArguments], [...argv, "--allow-all"], [argv[0]!, "--acp"]]) expect(() => selectOwnedCopilotProcess(10, [root, sidecar, native], [10, 11, 12], new Map([[12, invalid]]))).toThrow();
  });
});

import { assertCopilotProviderDeath } from "./copilot-provider-death.js";
import type { ActiveStopPending } from "./copilot-active-stop-evidence.js";

describe("provider-death independent evidence", () => {
  const pending = { scope: { companyId: "company", runId: "run", issueId: "issue", provider: "copilot", target: "target.txt" }, requestId: "request", toolCallId: "tool", turnId: "turn", normalizedSessionId: "session" } as ActiveStopPending;
  const row = (seq: number, eventType: string, payload: Record<string, unknown>) => ({ companyId: "company", runId: "run", seq, eventType, protocolSchemaVersion: 1, payload: { prpEvent: { schema: "paperclip.prp.event.v1", schemaVersion: 1, sourceKind: "runner", eventType, runId: "run", turnId: "turn", normalizedSessionId: "session", sourceInstanceId: "source", sourceSeq: seq, sourceEventId: `source:run:${seq}`, emittedAt: "2026-10-03T00:00:00Z", payload } } });
  const notice = row(1, "provider.notice.recorded", { schema: "paperclip.provider.notice.v1", scope: "turn", category: "copilot_tool_evidence_v1", provenance: { sessionId: "native-session", turnId: "turn", eventType: "permission_requested", method: "session/request_permission" }, details: Object.entries({ stage: "permission_requested", toolCallId: "tool", requestId: "request", operation: "edit", target: "target.txt", declineOffered: "true" }).map(([name, value]) => ({ name, value })) });
  const facts = () => ({ pending, run: { id: "run", companyId: "company", nativeIssueId: "issue", runtimeMode: "native", status: "failed" }, issue: { id: "issue", status: "blocked" }, events: [notice, row(2, "runtime_request.expired", { requestId: "request", turnId: "turn", requestKind: "permission_approval", reason: "provider_exit" }), row(3, "turn.failed", { error: { code: "AGENT_DISCONNECTED", message: "Provider exited" } })] });
  it("accepts callback expiry and an unfinished failed task with no replay", () => {
    expect(assertCopilotProviderDeath(facts())).toMatchObject({ expired: true, mutationReplay: false });
  });
  it("refuses missing expiry, stale resolution, success and foreign evidence", () => {
    const missing = facts(); missing.events.splice(1, 1); expect(() => assertCopilotProviderDeath(missing)).toThrow();
    const resolved = facts(); resolved.events.push(row(4, "runtime_request.resolved", { requestId: "request" })); expect(() => assertCopilotProviderDeath(resolved)).toThrow();
    const succeeded = facts(); succeeded.run.status = "succeeded"; expect(() => assertCopilotProviderDeath(succeeded)).toThrow();
    const done = facts(); done.issue.status = "done"; expect(() => assertCopilotProviderDeath(done)).toThrow();
    const foreign = facts(); foreign.events[0]!.companyId = "foreign"; expect(() => assertCopilotProviderDeath(foreign)).toThrow();
  });
});
