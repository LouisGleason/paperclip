import type { RunnerTaskFixture } from "./types.js";

export const PI_NATIVE_MEMORY_PATH = "memory/pi-native.txt";
export const PI_NATIVE_MEMORY_PARENT_SEED_PATH = "memory/.pi-e2e-parent.txt";
export const PI_NATIVE_MEMORY_PARENT_SEED_CONTENT = "Pi qualification memory parent fixture; leave this file unchanged.\n";
export const piNativeTasks: readonly RunnerTaskFixture[] = [
  ["native-questions", "Four native questions survive browser reconnect", 1],
  ["agent-files-fresh-run", "Agent files save and survive a fresh task", 2],
  ["restrictive-denial", "Restrictive native write denial prevents a file effect", 1],
  ["human-permission-denial", "Browser denial prevents a native write through process retirement", 1],
  ["native-pending-controller-restart", "Pending native question survives controller restart in the same live run", 1],
  ["native-pending-provider-death", "Lost Pi provider expires its original unanswered native question", 1],
].map(([id, label, turns]) => ({
  id: String(id), label: String(label), groups: [], workMode: "standard", flow: "pi_native",
  expectedRunCount: Number(turns), attemptTimeoutMs: { local: 5 * 60_000, daytona: 5 * 60_000 },
  expectedTerminalState: id === "native-pending-provider-death" ? { issue: "blocked", run: "failed" } : { issue: "done", run: "succeeded" },
  buildTitle: nonce => `Pi ${id} ${nonce}`,
  buildVisibleMarker: nonce => `PI-NATIVE-${id}-${nonce}`,
  buildPrompt: nonce => piNativePrompt(String(id), nonce),
  buildMatchers: () => [], // The flow grades durable state and independent bytes.
}));

export function piNativeFinish(marker: string): string {
  return `After verifying the requested outcome, call paperclip_finish once with reportedWorkDisposition done, summary ${marker}, the current completion contract revision, satisfied objective criterion with evidenceRefs [], no remaining work, evidence [], and verification []. Wait for acceptance, then reply exactly ${marker}. Do not create unrelated work.`;
}

export function piNativeMemoryPrompt(nonce: string, outsidePath?: string): string {
  return [
    "Follow these steps in order. Use native file tools; do not use bash or the instructions API.",
    "1. Copy the exact canonical absolute AGENT_HOME path from this turn's runtime instructions. Native file paths do not expand $AGENT_HOME. Do not use a remembered path or reconstruct any directory name.",
    `2. Call native write exactly once with the JSON arguments below. Replace only the <AGENT_HOME> prefix in path with the exact absolute directory copied in step 1. Copy the content string directly into the native write arguments, including its final \\n escape. This is the only content specification: the JSON string decodes to ${Buffer.byteLength(nonce, "utf8") + 1} UTF-8 bytes, ending with exactly one line-feed byte (U+000A). Do not reconstruct content from the visible nonce, omit the escape, or double-escape it into literal backslash-and-n characters. This is personal memory, not a task deliverable. Do not edit AGENTS.md or a project file.`,
    "Native write stores exactly the content argument; it never adds a newline. Include the final JSON newline escape in the write argument itself. Native read without offset or limit returns exact file text, including any final newline; a read result without that newline means verification failed.",
    "```json",
    JSON.stringify({ path: `<AGENT_HOME>/${PI_NATIVE_MEMORY_PATH}`, content: `${nonce}\n` }),
    "```",
    "3. Use native read once, without offset or limit, to verify that complete file, including its final line feed. Do not trim or repeat the memory write. If either memory operation fails or the content differs from step 2, report the failure and end your turn without claiming success.",
    ...(outsidePath === undefined ? [] : [
      `4. After successful memory verification, attempt native write exactly once to ${JSON.stringify(outsidePath)} with content forbidden. This unassigned root must be denied. That denial is the expected result of this step, not a memory-operation failure. Do not retry or work around it.`,
    ]),
    "Paperclip collects the memory file after the provider stops. Do not claim it is already saved to managed storage.",
    piNativeFinish("PI-NATIVE-MEMORY-STAGED"),
  ].join("\n");
}

export function piNativePrompt(id: string, nonce: string): string {
  if (id === "native-pending-provider-death") return [
    'Call paperclip_native_question exactly once with {method:"input",title:"Pi native provider death",placeholder:"Answer"}. Wait for the real answer; never guess it or substitute semantic request_human_input.',
    "Only after receiving the actual answer, use native write to save its exact tool-result object as JSON to pi-provider-death-answer.json in the task workspace. Never write that file while the question is unanswered. This is an internal verification file, not a deliverable.",
    piNativeFinish(`PI-NATIVE-${id}-${nonce}`),
  ].join("\n");
  if (id === "native-pending-controller-restart") return [
    'Call paperclip_native_question exactly once with {method:"input",title:"Pi native restart",placeholder:"Answer"}. Wait for the real answer; never guess it or substitute semantic request_human_input.',
    "Use native write to save the exact returned tool-result object as JSON to pi-native-restart-answer.json in the task workspace. Do not change or infer its fields. This is an internal verification file, not a deliverable.",
    piNativeFinish(`PI-NATIVE-${id}-${nonce}`),
  ].join("\n");
  if (id === "native-questions") return [
    "Use paperclip_native_question exactly four times, sequentially, waiting for each answer. Do not substitute semantic request_human_input.",
    'First: {method:"select",title:"Pi native color",options:[{id:"blue",label:"Blue"},{id:"red",label:"Red"}]}.',
    'Second: {method:"confirm",title:"Pi native confirmation",message:"Continue this fixture?"}.',
    'Third: {method:"input",title:"Pi native name",placeholder:"Name"}.',
    'Fourth: {method:"editor",title:"Pi native draft",prefill:"Old draft"}.',
    "Keep the actual four tool result objects in order. Using the native write tool, write their JSON array to pi-native-answers.json in the task workspace. This is an internal verification file, not a deliverable. Do not infer, change, or prefill any answer.",
    piNativeFinish(`PI-NATIVE-${id}-${nonce}`),
  ].join("\n");
  if (id === "agent-files-fresh-run") return piNativeMemoryPrompt(nonce);
  if (id === "human-permission-denial") return [
    "Attempt native write exactly once with relative path pi-human-denied.txt and content forbidden. Wait for the actual browser permission decision. Do not retry, use bash or an API, write another path, or work around denial.",
    "After the native write returns its denial, finish this negative test. Native denial is the expected result; never claim that the file was written.",
    piNativeFinish(`PI-NATIVE-${id}-${nonce}`),
  ].join("\n");
  if (id === "restrictive-denial") return [
    "This fixture deliberately denies native writes. Attempt the native write tool exactly once, with relative path pi-denied.txt and content forbidden. Do not use bash, an API, another path, or a retry to work around the denial.",
    "After the actual tool failure, report completion of this negative test through the assigned semantic tool. A failed native write is the expected outcome, not a reason to repeat it.",
    piNativeFinish(`PI-NATIVE-${id}-${nonce}`),
  ].join("\n");
  throw new Error(`Unknown Pi native fixture ${id}`);
}

export function gradePiNativeAnswers(actual: unknown, name: string, draft: string): boolean {
  const expected = [{ status: "answered", optionId: "blue" }, { status: "negative_or_cancelled", confirmed: false }, { status: "answered", value: name }, { status: "answered", value: draft }];
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return actual.every((value, index) => value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === Object.keys(expected[index]!).length
    && Object.entries(expected[index]!).every(([key, wanted]) => value[key] === wanted));
}

export function hasFailedPiWrite(events: readonly Record<string, any>[], path: string): boolean {
  return events.some(row => {
    const payload = row.payload?.prpEvent?.payload;
    return row.eventType === "tool.execution.completed" && payload?.schema === "paperclip.tool.execution.v1"
      && payload.operation === "edit" && payload.status === "failed"
      && payload.target === path;
  });
}

/** Outside paths are intentionally omitted from public display locations. */
export function hasPiCrossRootDenial(events: readonly Record<string, any>[]): boolean {
  const denied = events.filter(row => {
    const payload = row.payload?.prpEvent?.payload;
    return row.eventType === "tool.execution.completed" && payload?.schema === "paperclip.tool.execution.v1"
      && payload.transport === "builtin" && payload.operation === "edit" && payload.name === "write"
      && payload.status === "failed" && payload.target === null
      && typeof payload.executionId === "string" && payload.executionId.length > 0
      && typeof payload.output === "string" && payload.output.includes("Pi tool path is outside its assigned workspace and agent files");
  });
  return denied.length === 1;
}
