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
- Next action: confirm CI and Greptile on the dropdown correction, then hand off the updated PR. The missing credentials and managed target still block the remaining provider acceptance matrix.

## Implemented

Shared production-qualified mapping and idempotent configuration translation; server-owned creation resolution and target availability; explicit overrides; frozen approvals; internal/built-in/plugin provisioning; import/export runner preservation; CLI and hiring contracts; harness branding; setup/account/model/environment UI; saved Claude claims; native runtime readiness; flag graduation; historical-run adapter selection; session invalidation on explicit changes. No migration of existing agents.

Live testing and regression review fixed historical-adapter SQL projection, built-in setup readiness, partial native credential updates, AgentCore retention acknowledgement, managed/pooled task-model discovery, onboarding provider authentication and plugin resets across harnesses. Required legacy-specific fixtures now request legacy explicitly. The user's single-PR requirement takes precedence over the PR skill's usual file-count limit; the additional files are necessary regression coverage.

## Verification state (2026-10-07)

- Workspace typecheck, production build, Storybook build and token gates passed after the functional review fixes. Server typecheck passed after the credential-routing guard fix.
- Focused review regressions: 422 passed, then 66 passed after correcting the AgentCore test's step label. Credential inheritance, connection pools and permission suites: 183 passed after the security fix. Session/revision tests: 9 passed. Pinned Grok setup probes: 6 passed.
- Complete local UI suite: 7,688 passed. Shared: 874 passed; skills catalog: 20 passed. CLI: 517 passed and one database-fixture failure, then its complete worktree suite passed 63 tests using canonical temporary paths.
- The full local server invocation was stopped after embedded PostgreSQL exhausted the Mac's 32 System V shared-memory slots. The source-only workspace run passed 3,489 tests, with five database-startup failures. Accounting passed all 31 tests in isolation, cold route imports passed 49 tests with a larger local startup allowance, and the corrected credential/pool/permission suites passed all 183 tests. These results do not establish a green full local invocation.
- CI on `204740b27`: every typecheck, build, general test, serialized server, runner, Docker, and canary job passed. One browser shard failed because its inbox-retry fixture navigated away before the wakeup request reached the server. The fixture now waits for the app's navigation; the focused real browser test passed locally (1 test, 34.8 seconds). CI on `bd0f1809d` passed all 53 successful checks, with two intentionally skipped checks and Snyk success. The new dropdown correction requires a fresh CI run.
- Greptile reviewed `204740b27` at 5/5, with no actionable findings. The security scanner acknowledged the credential-routing fix and passed. All six review/security threads are resolved. The `bd0f1809d` review was confirmed at 5/5. The dropdown correction requires a fresh review.

## Dropdown correction (2026-10-07)

The dark-mode Runner menu used native HTML options with unreadable text on the browser's light popup. Extracted the existing harness picker into the shared `SelectPopover` surface and reused its trigger and menu for Runner, Managed harness, Model, Thinking effort, environment, manager, secret requirement, schema-driven choices, and adapter-specific runtime choices. Searchable model entry and legacy settings remain available. Added an existing legacy-agent editing story and keyboard-selection/dismissal coverage. Applied the same picker to onboarding, built-in setup, new-agent Runner/model/effort/environment choices, and advanced managed harness selection. Model provider groups and custom model IDs remain available; custom entry restores focus to its field.

- Complete UI suite: 7,691 passed across 693 files after the setup changes. Targeted setup suites passed 157 tests; the final model accessibility and new-agent regressions passed 165 tests. The later named-listbox and managed-picker changes are covered by that final targeted run.
- Workspace typecheck, production build, Storybook build, and token gates passed. The tsx preflight required the normal sandbox exception for its local IPC socket.
- Real test-drive: opened the Runner and Managed harness menus in dark mode; verified selected legacy state, readable options, keyboard movement and Escape; searched and selected a model, then discarded the test draft. Checked the runner menu at 390px width and restored the normal viewport. API readback retained `grok_local` and `grok-4.7`.
- CI on `eb3b74b0e` passed all 53 successful checks, with two intentionally skipped checks and Snyk success. Greptile rated it 5/5 and identified missing list context for searchable model choices. Added a named listbox, kept search/Detect/Refresh outside it, and verified the accessibility regression. The next pushed head requires fresh checks and review.
- Live creation: selected Grok from the ordinary picker, reused the saved xAI connection, inspected the shared Runner and Model menus, and confirmed custom-model entry focused Model ID. Closed the disposable setup tab without hiring an agent.
- [Creation menu evidence](http://127.0.0.1:3104/api/attachments/6efcce5f-fe88-402f-9fa1-4f69d6dc200b/content) — work product `b6bb6818-0de9-4264-8d8e-b5d1662d5c79`.
- [Dark menu evidence](http://127.0.0.1:3104/api/attachments/0a5e7872-508e-4edb-be09-c91973d013a7/content) — work product `a7ba4c67-4bbb-48fb-ad2d-22b1d323b351`.
- [Mobile menu evidence](http://127.0.0.1:3104/api/attachments/ec5a31b8-2e12-41e1-82c5-ef5f396b66ba/content) — work product `044cfc23-1d26-41f7-9cb6-184bdc79ce45`.

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
