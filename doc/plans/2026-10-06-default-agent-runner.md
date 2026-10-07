# Default agent runner

## Outcome and finish line

Users choose a harness. Qualified Codex, Claude, OpenCode, Grok, and Cursor harnesses default to Paperclip Runner. Unsupported harnesses keep legacy execution; Advanced allows an explicit legacy override. Existing agents, approvals and recorded runs retain their execution choice. No agent-table migration.

One owner carries implementation, verification and relevant review fixes through one reviewable PR with required checks, real test-drive acceptance and accessible evidence. Merging and deployment are excluded.

## Canonical delivery

- Worktree: `/Users/dotta/.codex/worktrees/e492/paperclip`
- Branch: `codex/default-agent-runner`
- Base: `799e4d556` (master)
- PR: https://github.com/paperclipai/paperclip/pull/15422
- Preview: http://127.0.0.1:3104/RUN/agents
- Evidence task: http://127.0.0.1:3104/RUN/issues/RUN-2
- Test-drive: the production source includes security fix `204740b27`; `/api/health` exposes the running checkout commit. The final handoff records the tested PR head.
- Next action: confirm the final browser-fixture commit in CI, finish remaining local verification, and obtain the missing credentials/managed target for the unresolved live matrix below.

## Implemented

Shared production-qualified mapping and idempotent configuration translation; server-owned creation resolution and target availability; explicit overrides; frozen approvals; internal/built-in/plugin provisioning; import/export runner preservation; CLI and hiring contracts; harness branding; setup/account/model/environment UI; saved Claude claims; native runtime readiness; flag graduation; historical-run adapter selection; session invalidation on explicit changes. No migration of existing agents.

Live testing and regression review fixed historical-adapter SQL projection, built-in setup readiness, partial native credential updates, AgentCore retention acknowledgement, managed/pooled task-model discovery, onboarding provider authentication and plugin resets across harnesses. Required legacy-specific fixtures now request legacy explicitly. The user's single-PR requirement takes precedence over the PR skill's usual file-count limit; the additional files are necessary regression coverage.

## Verification state (2026-10-07)

- Workspace typecheck, production build, Storybook build and token gates passed after the functional review fixes. Server typecheck passed after the credential-routing guard fix.
- Focused review regressions: 422 passed, then 66 passed after correcting the AgentCore test's step label. Credential inheritance, connection pools and permission suites: 183 passed after the security fix. Session/revision tests: 9 passed. Pinned Grok setup probes: 6 passed.
- Complete local UI suite: 7,688 passed. Shared: 874 passed; skills catalog: 20 passed. CLI: 517 passed and one database-fixture failure, then its complete worktree suite passed 63 tests using canonical temporary paths.
- The full local server run and source-only workspace follow-up are still running. Local failures so far include two accounting timeouts (31 tests passed in isolation), cold route-import timeouts and embedded PostgreSQL startup failures. A run that overlapped the security edit also loaded four stale permission expectations; the corrected credential/pool/permission suites subsequently passed all 183 tests. These failures are not represented as a green full local invocation.
- CI on `204740b27`: every typecheck, build, general test, serialized server, runner, Docker, and canary job passed. One browser shard failed because its inbox-retry fixture navigated away before the wakeup request reached the server. The fixture now waits for the app's navigation; the focused real browser test passed locally (1 test, 34.8 seconds). Final current-head CI is pending.
- Greptile reviewed `204740b27` at 5/5, with no actionable findings. The security scanner acknowledged the credential-routing fix and passed. All six review/security threads are resolved. Final head confirmation is pending.

## Observed live acceptance

- Ordinary picker: no Paperclip Runner tile; Grok selected normally and reused the saved xAI key. Native binary/provider readiness passed.
- Native Grok `11ac687e-ca6a-4b78-a86c-41023c8b2ad4`: RUN-2 answered 17 + 25 with 42; follow-up answered 50. Both runs succeeded with native execution recorded. A further follow-up after the server restart returned 51 and succeeded with `adapterType: paperclip_runner`, `runtimeMode: native`.
- Explicit legacy Grok `8806f807-8b3a-4a9b-85f9-4cbbc55990f7`: Advanced Legacy selected, setup passed, RUN-3 answered 6 × 7 with 42 and succeeded as `grok_local`.
- Unsupported Process agent created through the actual CLI without a runner preference; UI Run now succeeded as `process`, run `6be96bc4-128c-49cd-9aba-82f898a8d8e7`.
- Production UI imported a local team package omitting runner choice. Agent `0fc4a759-b31d-459a-a05b-9e1c7aad4b19` persisted `paperclip_runner`, ACPX Grok, model `grok-4.7`.
- Actual export records `adapter.runner: paperclip`. Automated round-trip coverage verifies execution preservation.
- Unrelated title edits through the UI preserved the native and legacy Grok agents' execution after reload and API readback.
- Cursor setup with no explicit model showed `cursor requires an explicit provider model`; Finish setup was disabled. Selecting Legacy in Advanced invalidated the stale test result.
- Server onboarding seed selected native Grok. First-agent UI onboarding is blocked at its recommended Claude/Codex account setup by the missing logins below; the server seed does not substitute for that journey.
- RUN-1 retains a historical failed run from the SQL projection defect; RUN-2 passed after the repair. Restart recovery of that old run did not pass and is not counted as successful recovery proof.

## Precise remaining dependencies

Host Codex subscription credentials exist, but isolated agent login requires a fresh interactive sign-in; user handoff remains pending. Claude and Cursor are logged out. No authorized OpenCode provider credential or qualified managed target/Daytona credentials was found. Native Codex/Claude/OpenCode/Cursor task-and-follow-up acceptance and the managed matrix remain unresolved. Mocks and CI do not substitute for this live proof.

New harness qualification, existing-agent migration, legacy removal, permission-policy changes and unrelated UI redesign remain deferred. No merge or deployment performed.

## Accessible evidence

Screenshots are uploaded as attachment-backed artifact work products on RUN-2, not only workspace files.

- [Ordinary harness picker](http://127.0.0.1:3104/api/attachments/2e6efe43-e49a-4d65-9a43-4e3e8da0ff38/content) — work product `575c48a4-f11f-4ea3-a876-2fe4ac0489f6`.
- [Native Grok setup passed](http://127.0.0.1:3104/api/attachments/d82ef090-76b9-45d8-aac8-a1ba733e1ec7/content) — work product `1c544e99-0293-4e83-8c87-ebcf31a303c8`.
- [Native Grok task and follow-up](http://127.0.0.1:3104/api/attachments/b797d434-6a4a-4859-ab3d-265ffa1a93b9/content) — work product `bd6fb0b4-37d6-40ed-875c-d8bed6517370`.
- [Explicit legacy Grok task](http://127.0.0.1:3104/api/attachments/b3bdb8e4-dbbc-4755-be82-547075e23712/content) — work product `695fb35f-3a2a-45cd-8189-acb39cbae80c`.
- [Automatic team import](http://127.0.0.1:3104/api/attachments/d28fcf60-7af9-42ad-b757-995eaf185d9d/content) — work product `b1353ddb-9335-4657-b2af-6a2a8149d651`.
- [Unsupported harness stays legacy](http://127.0.0.1:3104/api/attachments/7543c47f-a8c5-400e-a9c7-4fbbadfddf34/content) — work product `845cd3d1-a91c-491f-a2e6-6b6a2a158cf4`.
- [Actionable Cursor setup failure and runner override](http://127.0.0.1:3104/api/attachments/e7aa5c95-fed6-4472-bf57-3350d3e7bbf6/content) — work product `e71aeb0b-41d8-4da6-b154-221b158cc485`.

- [Native Grok follow-up after restart](http://127.0.0.1:3104/api/attachments/96941d27-7881-4f37-8eea-c772412b2f06/content) — work product `6af9e9f8-117d-4821-9de3-aebc564d4823`.
