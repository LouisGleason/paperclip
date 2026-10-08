# Runner defaults: staged delivery

Updated 2026-10-08.

## Outcome and ownership

Users choose a harness. New agents use Paperclip Runner where the harness and
execution target are qualified. Existing agents keep their recorded runner.
The task owns implementation, verification, review fixes, and reviewable PRs.
Merging and deployment require separate authorization.

The original implementation is preserved on `codex/default-agent-runner` at
`171d841295808ca185a258aaeb10b3dee68bb2b9`. Its public review is
[PR #15422](https://github.com/paperclipai/paperclip/pull/15422).
The user approved splitting that work into four useful steps:

1. Packaged runtime reliability and Codex prerequisites, without changing defaults.
2. Codex defaults across creation, onboarding, hiring, imports, and the UI.
3. Claude defaults and authentication.
4. The remaining supported harness defaults and provider-specific fixes.

## Current slice

Canonical branch: `codex/runner-packaging-prerequisites`.
Base: `71cd0a2621615182274a977d6cc969b9ab920b92`.
PR, tested commit, and CI links: pending the first slice's commit and publication.

This slice fixes the installed dependency graph, Codex executable resolution,
isolated browser login, Git install staging, and the release asset transfer needed
for Linux and macOS packages. It reuses the existing install sandbox, release
verification workflow, tests, and runner binary assembler.

It does not change agent defaults, the harness picker, provider qualification,
database schema, experimental feature policy, or existing agent configuration.
The large execution and setup changes stay in the later slices.

## Evidence and gates

| Gate | Status | Evidence |
| --- | --- | --- |
| Preserve original implementation | Passed | Original branch and commit above |
| Extract only first-slice behavior | Passed | 30 files; separate branch; independent packaging/release review |
| Installer and packaging tests | Passed | Existing installer suite: 26 tests; existing packaging suite: 24 tests |
| Login and transport controls | Passed | Login: 13/13; focused Codex/transport selection: 21 passed, 185 outside the focused filter |
| Release-transfer controls | Passed | Release workflow, transfer, and sandbox suites: 38/38; actionlint and Node/shell syntax checks passed |
| Token gates | Passed | All three commands in `check:token-gates` passed |
| Package and module contracts | Passed | Release package manifest and feature module boundary checks passed |
| Clean installed Codex version probe | Pending | Existing Linux npm consumer sandbox in CI |
| Full checks and fresh review | Pending | Require green checks on the final PR head |
| All-harness live onboarding and cloud qualification | Deferred | Owned by later slices; prior evidence does not prove this revision |

Heavy builds run in hosted CI. No local Docker or Rust build is planned.
No provider-backed runs or new disposable environments are needed for this
slice. The original $250 cost ceiling and cleanup obligations still apply.
Existing login credentials and running user previews must remain untouched.

Focused test commands use Node 24 and a single worker: `node --test
--test-concurrency=1 scripts/acpx-patch-packaging.test.mjs` and, from `cli/`,
`node ../node_modules/vitest/vitest.mjs run src/__tests__/install-command.test.ts
--maxWorkers=1 --no-file-parallelism`. These tests include real offline npm pack
and installation controls; they do not claim a published release or provider task.

Next action: publish the first PR and resolve its review and check failures on
the final candidate.
