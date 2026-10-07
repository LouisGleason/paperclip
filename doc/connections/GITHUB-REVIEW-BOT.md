# GitHub chat and review bots

A GitHub bot belongs to one Paperclip agent. GitHub issues, pull requests, and
review threads enter ordinary Paperclip tasks; the agent's runs, permissions,
budget, and activity remain visible there. The Reviews page is a projection of
assessments attached to those tasks, not a separate execution system.

For a step-by-step explanation of mentions, automatic reviews, scores, and
required GitHub checks, read
[Understanding GitHub PR review bots](UNDERSTANDING-GITHUB-PR-REVIEW-BOTS.md).

## Set up a bot

1. Choose the bot agent. Prefer a
   [low-trust review agent](https://docs.paperclip.ing/administration/trust-and-low-trust-review/)
   with an isolated sandbox and a scoped task boundary. Standard-trust agents
   show a warning with **Change <agent> to a low trust agent**. This explicitly
   saves the low-trust preset; it does not configure a sandbox or task boundary.
2. Choose **My account** or **An organization**. Enter the organization when
   needed and review the App name suggested from your agent. Click
   **Continue to GitHub**. Paperclip fills permissions, events, and callbacks.
3. Confirm creation on GitHub, then select repositories and approve installation.
   Paperclip stores the credentials securely and imports the initial selection,
   including an explicit All repositories choice. Organization policies may
   require administrator approval; resume the same draft when it is granted.
4. Paperclip reuses your verified GitHub identity when available. Otherwise,
   authorize the dedicated App and confirm the observed account once. Bot work
   uses installation credentials, never your personal GitHub token.
5. Connection verification and completion happen automatically. The connected
   page shows the actual App identity and repositories; a mention test is
   optional. Runtime and isolation readiness remain separate prerequisites.

New connections default to authorized mentions, advisory reviews, linked-member
access, guests off, and enabled bot GitHub tools. Existing instructions, explicit
behavior, and narrower saved repository restrictions remain intact. Later
repository additions require enablement in Access. Advanced review rules and
prompts live in Settings.

Local instances receive public callbacks and signed events through an enrolled
Paperclip Cloud connector, using outbound requests instead of a public tunnel.
The Cloud gateway capability must be deployed before localhost onboarding.
Direct public-HTTPS webhook connections and manual existing-App credential
recovery remain supported. An expired, unconsumed Cloud handoff can be renewed in the same draft after the configuring manager confirms that no App was created on GitHub. Claimed, consumed, and uncertain exchanges still require existing-App recovery. Setup tasks and copied prompts are not part of this
wizard. Normal agent API keys cannot call its board-only management APIs.

GitHub review bots use the existing agent runtime; this connector does not add
provider software to the Cloud server image. Codex with managed MCP tools and
the native Runner Codex backend do not require a server-side remote provider
pack. Remote native ACPX (including Claude) and OpenCode currently require an
operator-supplied, build-owned provider pack configured through
`PAPERCLIP_RUNNER_REMOTE_PROVIDER_PACK_PATH`; the standard Cloud server image
does not supply one. A pack installed in the sandbox alone does not satisfy
that existing runtime requirement. Treat that provider setup as a separate
Runner prerequisite, not an automatic connector installation step.

Connection setup reports tool/runtime support and isolation separately; an actual test
task is still required to prove that the chosen provider can execute in the
selected environment.

## Manage a connected bot

- **Settings:** edit instructions, choose when the bot runs, and set review output.
  Event-specific instructions, filters, formal approvals, and repository overrides
  are available in disclosures.
- **Access:** choose enabled repositories, allowed people, each person’s automatic
  events, and the bot’s GitHub tools. Repository switches save immediately. Other
  changes use **Save changes**. A linked account alone does not grant selected-member
  access. External contributors still require a sponsor and restricted permissions.
- **Reviews:** see the latest review for each pull request. The result names the
  reviewed commit; earlier reviews remain in history. A previous passing result
  does not stand in for a pending review of a newer commit.
- **Conversations:** follow the task title to Paperclip or the repository/thread
  label to GitHub.

Settings and Access share unsaved edits while you switch connection tabs. Save
before reloading or leaving the connection. No permissions change merely by
opening a tab or configuring an implicit linked member’s individual event settings.

## Who can start work

Linked members may be allowed together or selected individually. Teammates
connect and confirm their own accounts; an administrator cannot assert someone
else's identity by entering a username.

To admit an unlinked GitHub person, explicitly add their verified GitHub account,
choose an active sponsor, and use the restricted guest profile. Automatic reviews
for that person are a separate choice. Guests receive no company membership or
sponsor credentials. Authority is checked again before tool calls and
publication, so revocation also affects queued or ongoing work.

Automatic events use the configured responsible member. The PR author and
webhook sender are recorded independently. Follow-ups preserve task ownership
while checking the current requester's authority.

## Mentions and pushes

Use **mentions only** for reviews initiated by an authorized `@your-bot` request.
Choose automatic reviews and enable **updated commits** to review new pushes.
Opened, reopened, ready-for-review, and updated-commit events are independently
configurable. Draft and bot-authored PRs are excluded by default. Settings can
be overridden per enabled repository.

**New GitHub issues** is a separate opt-in automatic event, disabled on existing
and new connections until selected. It uses the same repository, author,
linked-member or sponsored-guest, responsible-member, and label restrictions as
automatic PR events; PR branch filters do not apply to issues. Its instructions
start an ordinary issue task with task-bound comment tools, without a PR
assessment or commit check. Older manually configured Apps must subscribe to
the `issues` webhook event before enabling this setting.

An authorized mention can bypass automatic author/branch/label scheduling
filters. It cannot bypass repository restrictions, excluded files, or access
permissions. Ordinary discussion does not change a review score. Repeat review
mentions and pushes continue the existing task; inline replies return to the
task owning that thread.

Event prompts supplement the agent's instructions. Repository content and PR
prose are untrusted input and cannot change tool authority or publication policy.
The execution records the configuration revision and event context used.

## Assessments, checks, and formal reviews

The agent reads through task-bound bot tools, explicitly begins an assessment,
and submits the reviewed commit, findings, rationale, and coverage. Paperclip
validates the result and computes the **Paperclip Review** check. The default
threshold is 5/5; choose 1–5 or report-only as needed.

| Score | Assessment rubric |
| --- | --- |
| 0 | No usable assessment; explain what prevented evaluation. |
| 1 | Critical defects make the change unsafe to ship. |
| 2 | Major defects require substantial correction. |
| 3 | Meaningful defects require correction before merging. |
| 4 | Minor concerns remain; explain impact and remaining risk. |
| 5 | No actionable defects found within the stated coverage and limitations. |

Incomplete coverage cannot pass. Filtering which findings become inline comments
does not remove them from the assessment. A new head requires a new assessment;
old runs cannot publish over the latest head. One current summary is updated in
place, with history and task/run links retained. Stable finding keys prevent
duplicate inline comments on repeated reviews.

The check's **Details** link opens its Paperclip task on the current instance
hostname, or the connector's Reviews page when no task has been created yet.

Formal **APPROVE** and **REQUEST_CHANGES** are separate governed tools, each off
by default. Enabling either does not automatically perform it. A score of 5/5
alone never approves a PR.

To enforce the rating at merge time, configure GitHub branch protection or a
ruleset to require **Paperclip Review**, selecting this bot App as the source
where supported. Paperclip does not change repository rules. GitHub account and
repository plan restrictions may limit required-check enforcement. If automatic
execution is disallowed, a gated head requests an authorized manual review.

## Hosted ingress

Dedicated Apps use Cloud as a sealed transport gateway. Cloud routes opaque
callbacks and signed webhook bytes to the enrolled instance; the instance
exchanges GitHub codes, stores credentials, verifies webhook signatures, and
applies repository and actor policy. Local instances poll outbound and do not
need an inbound tunnel.

Legacy direct-webhook Cloud deployments proxy only `POST /api/chat-webhooks/:publicId/github` and the narrow
`GET /api/chat-github/manifest/callback` registration callback without browser
login. The instance verifies the untouched webhook body and GitHub signature;
registration uses expiring, single-use user/company/origin-bound state.
Installation return, configuration, and identity confirmation remain
authenticated. URLs use the trusted current vanity hostname, with explicit
webhook-ingress overrides preserved.

Existing chat connections do not gain review execution or broader permissions
until explicitly configured. GitHub.com and UI-managed settings are the initial
scope; cross-repository indexing and auto-fix are not included.
