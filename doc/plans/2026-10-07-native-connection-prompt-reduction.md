# Native connection prompt reduction

## Scope

Compare one fixed-prompt reduction against unchanged merged master
`378e6d95e1fbd52298f56ffcd5e261f80965b6b8`, which includes #15471.
Remove 40 words / 261 UTF-8 bytes from the fixed native prompt. The removed
three sentences repeat how to follow search instructions, use existing access
for ordinary work, and present the connection card. Existing connection-tool
descriptions and returned instructions carry this guidance unchanged.

Keep the fixed rules for searching first on explicit connection requests,
finishing independent work before yielding, avoiding repeated requests/polling,
automatic continuation, and respecting declines. Keep every tool description,
schema, shared legacy instruction, per-connection instruction, permission,
runtime implementation, fixture and grader unchanged. Bump the fixed prompt
revision to v7 so existing sessions cannot silently retain the previous prompt.

## Measurement

Use the existing production authority and scripted start/resume/continuation
capture on both exact source variants, including the authenticated OpenCode MCP
catalog. Compare combined instructions, supplied tools and task input. Report
UTF-8 bytes separately from unknown provider tokens, loading and billed costs.
A byte reduction is not proof of model behavior or a billing improvement.

## Matched live comparison

Run the same fifteen explicit Product E2E cells once per variant:
service-approve, service-decline, connection-decline, provider-decline and
provider-second across native Codex `gpt-5.6-sol`, ACPX Claude
`claude-sonnet-5` and OpenCode
`openrouter/deepseek/deepseek-v4-flash-0731`. Use distinct target branches
and the trusted default-branch workflow; retain its actual immutable revision.

Keep the existing 1,000-cent company/agent hard stops, 720-second cell deadline,
twelve-run ceiling, one original attempt per cell and no automatic retries.
Use maximum parallelism three per campaign. All provider turns and any
pre-execution failures remain in the accounting; missing charges mean unknown.

The suite hash is
`85a212a8b1b70149c0e51bf01fe5d1391d1d6fb16926b47c65c0e6b55044ec54`.
The definition digest is
`326160800748260fd8a1daad9e19dfec0342decfe969427e9f743df16201e7af`.
Verify both from each source before dispatch. Retain original grades and compare
exact case pairs and saved content: documents and returned markers, saved
decisions, service-call counts, attributable explanations, continuation, final
output and cleanup. Inspect a failure before proposing any further paid run;
do not reroll a usable behavior failure into a pass.

## Limits and disposition

This is a candidate pending live qualification. The earlier 15/15 repair result
was measured on 09a before the final #15471 review fixes; it is not the baseline
for this reduction. This comparison uses one common merged context instead.

The suite does not qualify successful new authentication/setup, agent grants,
independent work while waiting, explicit reconsideration after decline, or
general coding quality. It detects duplicate saved interactions, not every
repeated idempotent tool call. A single pair per cell does not establish general
equivalence, speed or cost trends. The failed hiring-only reduction #15389 stays
held and is not part of this comparison.
