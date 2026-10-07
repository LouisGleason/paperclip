const CLOUD_ADAPTERS = new Set([
  "claude_local",
  "codex_local",
  "opencode_local",
  "grok_local",
]);

/** Creation policy shared by the picker and direct setup links. */
export function isNewAgentAdapterAllowed(
  type: string,
  {
    cloud,
  }: { cloud: boolean; nativeRunnerEnabled: boolean },
) {
  if (type === "paperclip_runner") return false;
  if (cloud) return CLOUD_ADAPTERS.has(type);
  return true;
}
