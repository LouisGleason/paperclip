# Default agent runner

## Outcome

New agents choose a harness. Qualified Codex, Claude, OpenCode, Grok, and Cursor harnesses default to Paperclip Runner. Unsupported harnesses keep legacy execution; Advanced allows an explicit legacy override. Existing agents and recorded runs retain their execution choice.

## Delivery

- Worktree: `/Users/dotta/.codex/worktrees/e492/paperclip`
- Branch: `codex/default-agent-runner`
- Base: `a9a20fb5c`
- Finish: one reviewable PR, required checks, live test-drive journeys, preview and evidence links. No merge or deployment.
- Next: resolve remaining regression tests, complete available live acceptance, and prepare the PR with explicit evidence gaps.

## Evidence and dependencies

- Shared mapping/translator, server creation boundary, explicit overrides, frozen approvals, import/export, harness branding, UI setup, CLI and graduation are implemented. Compatibility review is ongoing.
- Production build, full workspace typecheck, token gates, and Storybook build passed. Further changes are undergoing targeted regression checks; the full suite is running. Initial failures exposed built-in readiness and partial native credential-update bugs, now fixed and under verification.
- Real production UI on the test-drive at http://127.0.0.1:3108: ordinary harness picker has no Runner tile. Selected Grok with the saved xAI key; native binary/provider checks passed. Agent `11ac687e-ca6a-4b78-a86c-41023c8b2ad4` completed RUN-2 with 42, then its follow-up with 50. Both runs recorded `runtimeMode=native`, `adapterType=paperclip_runner` and succeeded.
- Explicit Legacy runner selected through Advanced, setup passed, and Grok agent `8806f807-8b3a-4a9b-85f9-4cbbc55990f7` created. RUN-3 execution verification pending.
- Live testing found and fixed a qualified-column SQL bug in historical adapter projection. RUN-1 retains the failed evidence; RUN-2 passed after restart.
- Evidence: `/private/tmp/runner-harness-picker.png`, `/private/tmp/runner-grok-ready.png`, `/private/tmp/runner-grok-followup.png`. Artifact attachment pending.
- Host has Codex subscription credentials, but isolated agent account login requires a fresh interactive sign-in; user handoff requested. Claude and Cursor are logged out. No authorized OpenCode provider credential or managed execution target/Daytona credentials found. These live matrix items remain unresolved; no mocks count as live acceptance.
- Remaining acceptance: other native harnesses, local/managed Codex and Claude, unsupported legacy fallback, onboarding, team import, existing-agent edits, actionable setup failure. No merge or deployment performed.

## Links

- Preview: http://127.0.0.1:3108 (local test-drive, source worktree; final revision pending).
- PR and tested commit: pending. No merge/deployment performed.
