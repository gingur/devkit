# devkit

Shared GitHub Actions and reusable workflows for [@gingur](https://github.com/gingur) projects. One monorepo, consumed by `@main`.

## Layout

```
.github/workflows/   reusable workflows  — uses: gingur/devkit/.github/workflows/<name>.yml@main
actions/             composite actions   — uses: gingur/devkit/actions/<name>@main
```

> Reusable workflows must live directly in `.github/workflows/` (GitHub requirement — no subdirs), so names group by **dot-notation** instead: `<provider>.<service>.<action…>.yml` — an extensible dotted path, not capped at three segments (`node.verify.yml`, `cf.worker.deploy.yml`, `cf.worker.preview.cleanup.yml`). See [`CLAUDE.md`](./CLAUDE.md) for the naming standard.

## Using from another repo

**Reusable workflow:**

```yaml
jobs:
  verify:
    uses: gingur/devkit/.github/workflows/node.verify.yml@main
    with:
      node: '20'
```

**Composite action:**

```yaml
steps:
  - uses: gingur/devkit/actions/node.setup@main
```

**Shared configs:**

Add devkit as a dev dependency and re-export the config you need:

```jsonc
// package.json
"devDependencies": { "@gingur/devkit": "github:gingur/devkit#main" }
```

```js
// eslint.config.mjs
export { default } from '@gingur/devkit/eslint';
```

| Export                       | File                    | Bring your own                                            |
| ---------------------------- | ----------------------- | --------------------------------------------------------- |
| `@gingur/devkit/eslint`      | `eslint.config.mjs`     | `eslint`, `@eslint/js`, `typescript-eslint`, `typescript` |
| `@gingur/devkit/prettier`    | `prettier.config.mjs`   | `prettier`                                                |
| `@gingur/devkit/lint-staged` | `lint-staged.config.js` | `prettier`, `eslint`                                      |
| `@gingur/devkit/tsconfig`    | `tsconfig.base.json`    | `typescript`                                              |

These tools are **not** bundled — the configs reference them but consumers install
them. They are declared as `peerDependencies` (so your package manager warns when
one is missing); install the ones for the exports you use:

```bash
pnpm add -D eslint @eslint/js typescript-eslint typescript prettier
```

## Conventions

### Versioning

Pin to `@main`. This is the gingur consumer convention — single maintainer, single direction of change, so there's no benefit to maintaining version tags. Reproducibility lives on the consumer side via lockfile-pinned SHAs (e.g. `pnpm-lock.yaml` records the resolved commit when devkit is consumed as a git URL dep).

Need a frozen reference point (paused upgrade, post-mortem snapshot)? Pin to a specific SHA: `gingur/devkit/...@<sha>`.

### Action pinning

Pin by **trust in who can move the tag**:

- **gingur's own** actions/workflows → `@main` (we control them; see the consumer convention above).
- **Third-party from a credible organization** — the tool's official org or a well-known GitHub org → **version tag**. The vendor controls the tag, tags stay readable, and patch releases flow in:

  ```yaml
  uses: cloudflare/wrangler-action@v4 # Cloudflare (org)
  uses: Infisical/secrets-action@v1.0.16 # Infisical (org)
  uses: pnpm/action-setup@v6 # pnpm (org)
  uses: actions/checkout@v6 # GitHub
  ```

- **Third-party from an individual / community maintainer** — a personal account, not an org → **full commit SHA** with a trailing version comment, per [GitHub's security-hardening guidance](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions). A compromised personal account could repoint a mutable tag at malicious code; a SHA can't be moved:

  ```yaml
  uses: marocchino/sticky-pull-request-comment@<sha> # v3.0.4  (individual maintainer)
  ```

The test: _who can move the tag?_ A trusted org → tag. One person's account → SHA. To resolve a community action's tag to its commit:

```bash
gh api repos/<owner>/<repo>/commits/<tag> --jq .sha
```

### Environments

Three names, one CI surface:

| Name         | Where             | Notes                                                 |
| ------------ | ----------------- | ----------------------------------------------------- |
| `production` | CI                | The deployed instance.                                |
| `preview`    | CI                | PR / branch previews. Same shape, separate target.    |
| `local`      | Developer machine | Never appears in CI. Outside the workflow input enum. |

Reusable workflows and actions only accept `production | preview` for the `environment` input. `local` is a convention for human developers — it exists to give that mode a name without ever leaking into CI.

## Secret rotation

Infisical is the single source of truth for deploy credentials. Rotate in **one place** and it propagates to every consumer on the next OIDC fetch — no per-repo secrets, no commits, no PRs. The `cf.worker.deploy.yml` workflow fetches `CF_API_TOKEN` / `CF_ACCOUNT_ID` from Infisical at deploy time, so consumers never store them.

When rotating a Cloudflare API token (annual, or on compromise / personnel change):

1. **Generate the new token** — Cloudflare dashboard → My Profile → API Tokens → Create. Minimum scope: Workers Scripts (Edit), Account Settings (Read), per-zone Workers Routes (Edit), per-zone DNS (Edit) (DNS edit is needed for custom-domain previews).
2. **Update the value in Infisical** — project → env → folder → click the secret → edit value → save. The audit log captures the change.
3. **Verify** — trigger any consuming workflow (or wait for the next scheduled run). The next OIDC fetch returns the new value automatically; no consumer-side config change.
4. **Revoke the old token** in Cloudflare once propagation is confirmed (24h grace recommended in case a background job cached the old value — our workflows don't cache, but the margin is cheap).

> During an incident, this is the runbook: rotate in Infisical (step 2), then revoke at Cloudflare (step 4). Everything else follows automatically.

## Secret scanning

`infisical scan` (gitleaks engine, fully local — no auth) gates secrets in two places:

- **CI** — the `infisical.secrets.scan.yml` reusable workflow scans each PR's commit
  range and fails the job on any finding.
- **Pre-commit** — a husky hook runs `infisical scan git-changes --staged`, catching
  secrets before they reach history (locally; bypassable with `--no-verify`, which CI
  backstops).

Both use one shared config, `configs/infisical-scan.toml` (gitleaks defaults +
tunable allowlist).

### CI (consumer)

```yaml
# .github/workflows/infisical.secrets.scan.yml
name: Secret scan
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
jobs:
  scan:
    uses: gingur/devkit/.github/workflows/infisical.secrets.scan.yml@main
```

### Pre-commit (consumer)

Requires the `infisical` CLI on the developer's PATH.

```jsonc
// package.json
"scripts": { "prepare": "husky" },
"devDependencies": { "husky": "^9", "@gingur/devkit": "github:gingur/devkit#main" }
```

```bash
# .husky/pre-commit
npx lint-staged
infisical scan git-changes --staged --config node_modules/@gingur/devkit/configs/infisical-scan.toml --redact --no-color
```

## Reusable workflows reference

| Goal                                                | Call                                                                 |
| --------------------------------------------------- | -------------------------------------------------------------------- |
| Verify (lint + typecheck + test) on PR              | `gingur/devkit/.github/workflows/node.verify.yml@main`               |
| Deploy to production on push                        | `gingur/devkit/.github/workflows/cf.worker.deploy.yml@main`          |
| Per-PR preview deploy                               | `gingur/devkit/.github/workflows/cf.worker.preview.yml@main`         |
| Tear down preview on PR close                       | `gingur/devkit/.github/workflows/cf.worker.preview.cleanup.yml@main` |
| Roll back production to a prior version (manual)    | `gingur/devkit/.github/workflows/cf.worker.rollback.yml@main`        |
| Scan a PR's commits for leaked secrets              | `gingur/devkit/.github/workflows/infisical.secrets.scan.yml@main`    |
| Planning agent turn on issue assignment             | `gingur/devkit/.github/workflows/claude.plan.yml@main`               |
| Implementation agent turn on claude-task assignment | `gingur/devkit/.github/workflows/claude.implement.yml@main`          |
| Review agent turn on bot draft-PR assignment        | `gingur/devkit/.github/workflows/claude.review.yml@main`             |
| Start agent turns from trusted comments / ticks     | `gingur/devkit/.github/workflows/claude.wake.yml@main`               |

> Deploy, rollback, verify, secret-scan, and the `claude.*` workflows accept an
> optional `runner` input (a runner label, default `ubuntu-latest`). See
> [Self-hosted runner (local)](#self-hosted-runner-local) for provisioning and
> the routing policy — the preview workflows deliberately have no `runner` input.

### Required permissions

| Workflow                    | `contents` | `id-token` | `pull-requests`                                                                  |
| --------------------------- | ---------- | ---------- | -------------------------------------------------------------------------------- |
| `node.verify`               | `read`     | —          | —                                                                                |
| `cf.worker.deploy`          | `read`     | `write`    | `write` (records version on source PR)                                           |
| `cf.worker.preview`         | `read`     | `write`    | `write`                                                                          |
| `cf.worker.preview.cleanup` | `read`     | `write`    | `write`                                                                          |
| `cf.worker.rollback`        | `read`     | `write`    | —                                                                                |
| `infisical.secrets.scan`    | `read`     | —          | —                                                                                |
| `claude.plan`               | `read`     | `write`    | — (requires `issues: write` instead)                                             |
| `claude.implement`          | `read`     | `write`    | — (requires `issues: write`; pushes/PRs use the bot PAT, not the workflow token) |
| `claude.review`             | `read`     | `write`    | `write` (verdicts use the bot PAT; requires `issues: write` too)                 |
| `claude.wake`               | `read`     | `write`    | — (assigns via the bot PAT, not the workflow token)                              |

## Self-hosted runner (local)

Selected workflows can route to a self-hosted runner on a local machine via the
`runner` input (see the note under the
[reference table](#reusable-workflows-reference)). The runner connects
**outbound-only** — HTTPS long-polling to GitHub — so it needs no inbound
ports, no tunnel, and no public address.

> The runner **label** `local` names where a job runs. It is unrelated to the
> `local` **environment** in [Environments](#environments), which names a
> developer-machine mode that never appears in CI.

### Registration (per repo)

Personal accounts have no org-level or shareable runners, so **one runner
instance registers per repo**. Several instances can share the same machine —
each in its own directory (e.g. `~/actions-runner/<repo>/`). Open the repo's
**Settings → Actions → Runners → New self-hosted runner** page for the
download + verify commands (they embed the current runner version and a fresh
registration token), extract into the per-repo directory, then configure
against the repo URL with the single custom label `local`:

```bash
mkdir -p ~/actions-runner/<repo> && cd ~/actions-runner/<repo>
# download + extract the runner per the "New self-hosted runner" page, then:
./config.sh \
  --url https://github.com/gingur/<repo> \
  --token "$(gh api -X POST repos/gingur/<repo>/actions/runners/registration-token --jq .token)" \
  --labels local \
  --unattended
```

### Run as a service

From the same directory, the bundled script installs and starts the runner as
a service — systemd on Linux, launchd on macOS (same script):

```bash
sudo ./svc.sh install && sudo ./svc.sh start   # Linux (systemd)
./svc.sh install && ./svc.sh start             # macOS (launchd — no sudo)
```

**Hardening option — `--ephemeral`.** Passing `--ephemeral` to `config.sh`
makes the runner deregister after each job, so no job ever sees a
predecessor's workspace. The tradeoff: auto-re-registration needs a fresh
registration token per job via the REST API and a PAT (extra moving parts on
the machine). A **persistent** runner is acceptable here given the routing
policy below — only operator-gated triggers ever reach it.

### Machine prerequisites

- `git`, `curl`, `tar` — checkout and runner tooling.
- The `gh` CLI — preinstalled on GitHub-hosted images but **not** on local
  machines; `claude.plan.yml`'s report/baton steps and the agent itself shell
  out to it.
- Node / pnpm are **not** prerequisites: the runner bundles its own runtime
  for JS actions, and `actions/setup-node` / `pnpm/action-setup` maintain a
  per-runner tool cache.

### Routing policy (public repos)

Only **operator-gated** triggers may target `local`:

- `issues: assigned` — `claude.plan` / `claude.implement` (only collaborators
  can assign);
- `pull_request: [assigned]` — `claude.review` (only write-access users — or
  hooks via the operator PAT — can assign; the job additionally hard-gates on
  bot-authored, same-repo draft `claude/task-*` PRs);
- `push` to main — `cf.worker.deploy`;
- `workflow_dispatch` — `cf.worker.rollback`.

Code-driven PR workflows (verify, preview, preview cleanup, secret scan)
**always stay on GitHub-hosted runners** — a public repo must never run
PR-driven code on a machine you own. `cf.worker.preview*.yml` deliberately
have no `runner` input. `claude.review`'s `pull_request: [assigned]` is the
deliberate exception: it fires on _assignment_ (operator-gated), never on
pushed code, so it may take a `runner` input.

### Consumer wiring

Set the repo variable `RUNNER=local` and pass it through in the deploy /
rollback caller workflows; `claude.plan.yml` and `claude.implement.yml` read
`vars.RUNNER` on their own, so their callers need no change:

```bash
gh variable set RUNNER --repo gingur/<repo> --body local
```

```yaml
jobs:
  deploy:
    uses: gingur/devkit/.github/workflows/cf.worker.deploy.yml@main
    with:
      runner: ${{ vars.RUNNER }}
      # …existing inputs unchanged
```

An unset or empty variable falls back to `ubuntu-latest`, so flipping
local ↔ hosted is a repo-variable change with no commit:

```bash
gh variable delete RUNNER --repo gingur/<repo>   # back to GitHub-hosted
```

### Repo settings hardening

In each repo that routes to `local`: **Settings → Actions → General → Fork
pull request workflows from outside collaborators** → enable **"Require
approval for all outside collaborators"**.

### Caveats

- **Machine offline:** jobs targeting `local` queue for up to 24 hours, then
  fail. Flip `RUNNER` back to empty/unset to drain to GitHub-hosted runners.
- **OIDC / Infisical work unchanged** on self-hosted — tokens are issued by
  GitHub at run time, so no secrets are stored on the machine.
- **Warm caches:** a persistent runner keeps its tool / pnpm caches between
  jobs — repeat deploys get faster as a side benefit.

## PR previews

Each PR gets an immutable masked preview at `https://pr-<N>.<domain>`, redeployed on
every push and torn down when the PR closes. Previews run only for same-repo (branch)
PRs — fork PRs get no OIDC/secrets by design.

Requires `wrangler.toml` to use **named environments** (see [Environments](#environments)):

```toml
[assets]
directory = "./dist"

[env.production]
name = "<app>"            # production routes / custom domain go here

[env.preview]
name = "<app>-preview"    # placeholder; overridden per-PR by --name, no custom route
```

**Preview on PR** — `.github/workflows/cf.worker.preview.yml` in the consumer:

```yaml
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  id-token: write
  pull-requests: write
jobs:
  preview:
    uses: gingur/devkit/.github/workflows/cf.worker.preview.yml@main
    with:
      app: <app>
      domain: <your-domain>
      cfZone: <zone-id>
      infisicalProject: <project-slug>
      infisicalEnv: <env-slug> # where the CF token lives (often "production")
      infisicalPath: /<app>
      infisicalIdentity: <preview-identity-uuid> # see note below — NOT the production identity
    secrets: inherit
```

**Cleanup on close** — `.github/workflows/cf.worker.preview.cleanup.yml`:

```yaml
on:
  pull_request:
    types: [closed]
permissions:
  contents: read
  id-token: write
  pull-requests: write
jobs:
  cleanup:
    uses: gingur/devkit/.github/workflows/cf.worker.preview.cleanup.yml@main
    with:
      app: <app>
      domain: <your-domain>
      cfZone: <zone-id>
      infisicalProject: <project-slug>
      infisicalEnv: <env-slug>
      infisicalPath: /<app>
      infisicalIdentity: <preview-identity-uuid> # see note below — NOT the production identity
    secrets: inherit
```

> The preview worker is named `<app>-pr-<N>` and the URL `pr-<N>.<domain>` is attached
> as a Workers custom domain — so `<domain>` must be a Cloudflare zone on the same account.
> The token needs DNS (Edit) on that zone (see [Secret rotation](#secret-rotation)).

> **Use a preview-scoped Infisical identity.** Every preview job (deploy, domain,
> cleanup) runs under the GitHub `preview` environment, so it authenticates with the
> OIDC subject `repo:<owner>/<repo>:environment:preview` — **not** the
> `…:environment:production` subject your deploy uses. Create a second machine
> identity (e.g. `gh-<app>-preview`) whose OIDC trust is bound to that preview
> subject and grant it the same secret path, then pass its UUID as `infisicalIdentity`
> above. Reusing the production identity makes the credential fetch fail with
> `403 Access denied: OIDC subject not allowed`. This keeps the production identity's
> trust narrow (least privilege) rather than broadening it to accept PR contexts.

## Rolling back

Production deploys are versioned by Cloudflare. To revert, dispatch a rollback
workflow with the target version ID (or leave it blank to roll back to the
immediately-previous version).

### Finding the version ID

Every production deploy posts a sticky comment to its **source PR** recording the
version it produced, plus a one-click GitHub-UI link and a CLI command to roll back
to it. Because PRs are squash-merged, your PR list doubles as a deploy index: open
the PR you want to return to and use its rollback links.

If a PR comment is missing (a direct push, or a version predating this feature),
list versions in CI with the `cf.worker.versions` action, or use
`wrangler versions list` locally / the Cloudflare dashboard.

### Consumer workflow (copy-paste)

devkit ships the rollback as a `workflow_call` reusable. Add a thin
`workflow_dispatch` wrapper in your repo so the "Run workflow" form gives you an
`env` dropdown and a free-text version field:

```yaml
# .github/workflows/rollback.yml
name: Rollback
on:
  workflow_dispatch:
    inputs:
      env:
        description: Target environment
        type: choice
        options: [production, preview]
        default: production
      version:
        description: Cloudflare version UUID (blank = previous version)
        type: string
        required: false

permissions:
  contents: read
  id-token: write

jobs:
  rollback:
    uses: gingur/devkit/.github/workflows/cf.worker.rollback.yml@main
    with:
      env: ${{ inputs.env }}
      version: ${{ inputs.version }}
      infisicalProject: <your-project-slug>
      infisicalEnv: production
      infisicalPath: <your-secret-path>
      infisicalIdentity: <your-identity-uuid>
    secrets: inherit
```

> GitHub does not support pre-filling the dispatch form via URL or generating its
> dropdown from live data, so the version field is free text — paste the UUID from
> the PR comment. A genuinely in-browser version picker is possible via
> [`boasiHQ/interactive-inputs`](https://github.com/boasiHQ/interactive-inputs)
> (it pauses the run behind an ngrok tunnel to the runner), but it adds an ngrok
> secret, a public tunnel on the credentialed rollback path, and billed idle
> minutes while it waits for a human — not adopted here.

### Triggering the rollback

Two equivalent ways — both drive the same `workflow_dispatch` wrapper:

- **GitHub UI** — open the wrapper's page at
  `https://github.com/<owner>/<repo>/actions/workflows/rollback.yml`, click
  **Run workflow ▸**, pick `env`, paste the version UUID, and run. The deploy
  comment links straight to this page. (GitHub can't deep-link to a pre-filled
  form, so you still paste the UUID — but the form itself is fully UI-driven.)
- **CLI** — `gh workflow run rollback.yml -f env=production -f version=<uuid>`.

> The version-record comment builds its UI link and CLI command from the wrapper
> filename, which it assumes is `rollback.yml`. If you name your wrapper something
> else, pass `rollbackWorkflow: <your-file>.yml` to `cf.worker.deploy.yml` so the
> comment points at the right workflow.

### Manual fallback

From a checkout of the consumer repo with `CLOUDFLARE_API_TOKEN` /
`CLOUDFLARE_ACCOUNT_ID` set:

```bash
wrangler versions list --env production
wrangler rollback <version-id> --env production --message "manual rollback"
```

## claude.plan — issue-driven planning agent

Assign an issue to the machine user (`gingur-bot`) and a Claude agent takes
one **planning turn**: it studies the ask (repo code, issue thread, the web),
posts a plan as a comment, and hands the issue back. That first assignment
auto-enrolls the issue with the `claude-ask` label, and from then on the cycle
is reply-driven via [claude.wake](#claudewake--comment-driven-turn-triggers):
after each plan the bot posts an **action panel** with an **Approve**
checkbox. Tick it to accept — the next turn creates the plan's tasks as
sub-issues labeled `claude-task` — or just reply to discuss (any reply starts
a revise/answer turn automatically). **Ticking Approve is the only way to
accept a plan; comments are always discussion.** Prefix a comment with
`[hold]` to comment without starting a turn. Every turn ends with a summary
comment and the issue assigned back to you — on failure, a comment carries
the run link instead. Full design rationale:
[design spec](https://gist.github.com/gingur/db3b2def680edfc42e93b9275497b0a9).

- **Turn-taking:** you start a turn by ticking a panel checkbox or replying
  on the issue. Assigning the bot still works as a fallback _trigger_ — it
  starts a turn but never approves a plan. The panel checkboxes are tappable
  in the GitHub mobile app (validated on Android) and on github.com. The
  agent never assigns anyone; the workflow assigns the issue back to you
  unconditionally (`if: always()`), even when the run fails.
- **Stateless turns:** each run re-derives state from the issue (plan comment
  present? Approve ticked? sub-issues present? operator comments since the
  bot's last one?) and does the next right thing — propose, revise,
  materialize, or reconcile.
  Re-running is always safe. To skip the review gate for small asks, write
  "no review needed, create the tasks directly" in the issue body.
- **Billing:** runs authenticate with a Claude Max subscription OAuth token
  (`claude setup-token`), not API-key billing. Quota is shared with
  interactive Claude Code use; `turns` bounds the worst case per run.
- **Auth:** no GitHub secrets. `infisical.secrets.fetch` (OIDC) pulls
  `CLAUDE_CODE_OAUTH_TOKEN` and `GH_BOT_PAT` from Infisical project `gingur`,
  env `prod`, path `/infra/github`. The bot PAT authors all agent-created
  issues/comments so they can trigger downstream workflows (the default
  `GITHUB_TOKEN` is suppressed from triggering; a PAT is not).

### Consumer workflow (copy-paste)

```yaml
# .github/workflows/plan.yml
name: Plan
on:
  issues:
    types: [assigned]

permissions:
  contents: read
  issues: write
  id-token: write

jobs:
  plan:
    uses: gingur/devkit/.github/workflows/claude.plan.yml@main
    with:
      infisicalIdentity: <machine identity UUID>
```

The trigger stays `on: issues: [assigned]` — do **not** add `issue_comment`
here. Comment and checkbox handling lives entirely in the separate
[claude.wake caller](#claudewake--comment-driven-turn-triggers), which starts
turns by assigning the bot.

Requirements per consumer repo: `gingur-bot` invited as a collaborator with
write; the Infisical identity's OIDC subject covers the repo; Issues enabled.
In `devkit` itself the workflow self-triggers (no caller needed) and reads the
identity from the `INFISICAL_IDENTITY` Actions variable.

| Input               | Default         | Notes                                                      |
| ------------------- | --------------- | ---------------------------------------------------------- |
| `bot`               | `gingur-bot`    | machine-user login the trigger guards on                   |
| `turns`             | `50`            | max agent turns per run (cost bound)                       |
| `model`             | `fable`         | `claude --model` value (planning defaults to the top tier) |
| `infisicalIdentity` | —               | identity UUID (falls back to `vars.INFISICAL_IDENTITY`)    |
| `infisicalProject`  | `gingur`        | Infisical project slug                                     |
| `infisicalEnv`      | `prod`          | Infisical environment slug                                 |
| `infisicalPath`     | `/infra/github` | folder holding the two secrets                             |
| `runner`            | `ubuntu-latest` | runner label                                               |

**Scope note:** this workflow plans; it never implements — approved plans
become `claude-task` issues, which [claude.implement](#claudeimplement--issue-driven-implementation-agent)
picks up. claude.plan skips issues labeled `claude-task` (the mutual-exclusion
guard), so the two never fire on the same issue.
This repo is public: turns start only from issue _assignment_ (which only
collaborators can perform) and from trusted comments or panel ticks via
[claude.wake](#claudewake--comment-driven-turn-triggers) (gated as described
there). The agent surface's one `pull_request`-family trigger is
[claude.review](#claudereview--pr-review-agent-turn)'s
`pull_request: [assigned]` — itself operator-gated (only write-access users,
or hooks via the operator PAT, can assign) and additionally hard-gated to
bot-authored, same-repo draft PRs.

### Notifications

Every turn ends with `claude.handoff` re-assigning you to the issue, so the
GitHub mobile app's **assignment push** is the "your turn" signal. A failed,
timed-out, or cancelled turn additionally **@mentions you** in the failure
comment, producing a distinct **mention push** — assignment alone means the
turn completed; a mention means it needs attention. No secrets, apps, or
services are required beyond GitHub mobile push notifications for assignments
and direct mentions (both on by default).

## claude.implement — issue-driven implementation agent

The implementation sibling of claude.plan. Assign the machine user
(`gingur-bot`) to an issue labeled `claude-task` (normally created by an
approved claude.plan turn) and a Claude agent takes one **implementation
turn**: it studies the task and its parent ask, implements on the
deterministic branch `claude/task-<n>`, verifies with the repo's own checks
(package.json scripts, CI definitions — discovered, not assumed), commits
(conventional commits), pushes, and opens a **draft PR** containing
`Closes #<task>` and a link to the parent ask, with honest verification
results. The turn ends like every agent turn: one summary comment and the
issue re-assigned to you (`if: always()`), failures posted with the run link.

- **Follow-up turns:** comment your feedback on the task issue — the turn
  starts automatically (task issues are wake-enrolled by their `claude-task`
  label; re-assigning the bot also works). It checks out the same branch and
  pushes additional commits; the same PR updates. It never force-pushes.
- **Hard limits:** never merges, never pushes to the default branch, never
  marks the PR ready for review — review and merge stay yours. If the task is
  ambiguous or an acceptance criterion can't be met as written, it asks on
  the issue instead of pushing speculative code.
- **Mutual exclusion:** implement fires only on `claude-task`-labeled issues;
  claude.plan skips them. One issue, one workflow.
- **Billing/auth:** identical to claude.plan — Max-subscription OAuth token
  and `GH_BOT_PAT` fetched from Infisical via OIDC (see the claude.plan
  section); pushes and PRs are authored by the bot PAT, not the workflow
  token.
- **Notifications:** identical to claude.plan — see
  [Notifications](#notifications) (assignment push = turn done; mention
  push = turn failed).

### Consumer workflow (copy-paste)

```yaml
# .github/workflows/implement.yml
name: Implement
on:
  issues:
    types: [assigned]

permissions:
  contents: read
  issues: write
  id-token: write

jobs:
  implement:
    uses: gingur/devkit/.github/workflows/claude.implement.yml@main
    with:
      infisicalIdentity: <machine identity UUID>
```

The trigger stays `on: issues: [assigned]` — as with claude.plan, do **not**
add `issue_comment` here; comment and checkbox handling lives entirely in the
separate [claude.wake caller](#claudewake--comment-driven-turn-triggers).

Same per-repo requirements as claude.plan; in `devkit` itself the workflow
self-triggers and reads the identity from the `INFISICAL_IDENTITY` Actions
variable.

| Input               | Default         | Notes                                                            |
| ------------------- | --------------- | ---------------------------------------------------------------- |
| `bot`               | `gingur-bot`    | machine-user login the trigger guards on                         |
| `turns`             | `100`           | max agent turns per run (cost bound)                             |
| `model`             | `fable`         | `claude --model` value (implementation defaults to the top tier) |
| `infisicalIdentity` | —               | identity UUID (falls back to `vars.INFISICAL_IDENTITY`)          |
| `infisicalProject`  | `gingur`        | Infisical project slug                                           |
| `infisicalEnv`      | `prod`          | Infisical environment slug                                       |
| `infisicalPath`     | `/infra/github` | folder holding the two secrets                                   |
| `runner`            | `ubuntu-latest` | runner label                                                     |

## claude.review — PR-review agent turn

The reviewer sibling of claude.plan / claude.implement. Assign the machine
user (`gingur-bot`) to one of its own draft PRs (head branch `claude/task-<n>`,
opened by claude.implement) and a Claude agent takes one **review turn**: it
reads the PR diff, the task issue's acceptance criteria, and the checked-out
code at the PR head, then delivers exactly one verdict:

- **Blocking findings** → it submits one `COMMENT` review — at most 8 inline
  comments, prioritized correctness > repo standards > style — and the PR
  **stays draft**. The submitted review is the signal an external event layer
  can consume to start the fix turn.
- **No blocking findings** → it submits no review; it **marks the PR ready
  for review** (`gh pr ready`) and posts one comment recording the pass
  (reviewed SHA, criteria walked). The un-draft is the signal that the bot
  pass is done and human review starts.

`APPROVE` / `REQUEST_CHANGES` are never used: GitHub rejects both from a PR's
own author, and the bot authored the PR — reviews gate nothing here.

- **How a review starts:** the event layer (`gingur/hooks`) — or any
  collaborator, manually — assigns the bot to the PR. The job hard-gates on
  **all five**: the assignee is the bot; the PR is bot-authored; the head
  branch is `claude/task-*`; head repo == base repo (fork PRs never qualify);
  the PR is an open draft.
- **Compute plane only:** the workflow contains **no** intake or cycle logic
  — no auto-request of the next round, no rounds cap, no already-reviewed
  dedup. Deciding _when_ a review fires and looping a submitted review back
  into an implement turn (hooks re-assigns the task issue) live in the event
  layer (`gingur/hooks`).
- **Hard limits:** comment-and-verdict only — the agent never pushes code,
  never merges, never assigns anyone; marking ready happens only on the
  clean pass.
- **Billing/auth/notifications:** identical to claude.plan / claude.implement
  (Max-subscription OAuth token + `GH_BOT_PAT` via Infisical OIDC; verdicts
  authored by the bot PAT). The turn-end handoff runs on the PR itself — bot
  unassigned, operator assigned — and posts **no** action panel (panels live
  on ask/task issues only).

### Consumer workflow (copy-paste)

```yaml
# .github/workflows/review.yml
name: Review
on:
  pull_request:
    types: [assigned]

permissions:
  contents: read
  pull-requests: write
  issues: write
  id-token: write

jobs:
  review:
    uses: gingur/devkit/.github/workflows/claude.review.yml@main
    with:
      infisicalIdentity: <machine identity UUID>
```

Same per-repo requirements as claude.plan; in `devkit` itself the workflow
self-triggers and reads the identity from the `INFISICAL_IDENTITY` Actions
variable. On the "no `pull_request` triggers" stance: `pull_request:
[assigned]` is the one deliberate exception — assignment is operator-gated
(only write-access users, or hooks via the operator PAT, can assign), unlike
code-driven `pull_request` events, and the job additionally hard-gates on
bot-authored, same-repo, draft `claude/task-*` PRs. That is also why this
workflow may take a `runner` input while the preview workflows may not (see
[Routing policy](#routing-policy-public-repos)).

| Input               | Default         | Notes                                                    |
| ------------------- | --------------- | -------------------------------------------------------- |
| `bot`               | `gingur-bot`    | machine-user login the trigger guards on                 |
| `turns`             | `50`            | max agent turns per run (cost bound)                     |
| `model`             | `fable`         | `claude --model` value (review defaults to the top tier) |
| `infisicalIdentity` | —               | identity UUID (falls back to `vars.INFISICAL_IDENTITY`)  |
| `infisicalProject`  | `gingur`        | Infisical project slug                                   |
| `infisicalEnv`      | `prod`          | Infisical environment slug                               |
| `infisicalPath`     | `/infra/github` | folder holding the two secrets                           |
| `runner`            | `ubuntu-latest` | runner label                                             |

## claude.wake — comment-driven turn triggers

The trigger layer behind the reply-driven cycle: a separate always-on workflow
(`issue_comment: [created, edited]`) that watches enrolled issues and starts
an agent turn by assigning the bot — you drive turns by replying or tapping a
checkbox instead of touching the assignee field. It fires when:

- a **trusted user comments** on an open issue labeled `claude-ask` or
  `claude-task` — prefix the comment with `[hold]` to comment without waking;
- a **checkbox is ticked** in a bot-authored **action panel** — ticking edits
  the comment, and that edit is the trigger.

Waking removes and re-adds the bot as assignee, so it works even when the bot
is already assigned (a comment landing mid-turn queues a follow-up turn via
the agent workflows' per-issue concurrency instead of getting lost).

**Security model.** Created comments are gated on the server-computed
`author_association` — only `OWNER` / `MEMBER` / `COLLABORATOR` qualify
(`CONTRIBUTOR` / `NONE` are deliberately excluded), so drive-by comments on a
public repo can't start paid turns. Ticks need no association check: only
users with write access can edit another user's comment, and the gate
additionally requires the edited comment to be bot-authored and carry the
panel marker. Label enrollment (`claude-ask` is auto-applied by claude.plan's
first turn; `claude-task` issues are created labeled) keeps arbitrary issues
from waking the agent. Wake assigns with `GH_BOT_PAT` rather than the
workflow's own token because events caused by `GITHUB_TOKEN` never trigger
workflows — a `GITHUB_TOKEN` assignment would silently start nothing.

**Action panels** are the operator's one-tap controls: bot comments opening
with the `<!-- claude:action-panel -->` marker and offering `- [ ]`
checkboxes. At most **one live panel per issue** — the `claude.handoff`
composite posts the turn's panel (Approve after plan turns) and neutralizes
older panels into plain-text decision records (marker swapped to
`<!-- claude:action-panel:done -->`, ticked boxes rendered as `✔ …`), so the
thread reads as a decision log and stale ticks can't re-trigger. When an
agent question has enumerable answers it posts a **choices menu** — one
option per checkbox; a genuinely multi-select menu ends with a **Submit**
box, ticked last to send the selection.

**Debounce.** Per-issue `concurrency` with `cancel-in-progress: true` plus a
leading `quiet`-seconds sleep coalesce bursts: each qualifying event cancels
the pending wake and restarts the quiet timer, so a reply-then-tick or a
flurry of ticks assigns once, from the final state. Multi-select panels
extend this via the Submit convention above — the wake gate arms only once
the **Submit** box is ticked, so earlier ticks on that panel never fire.

**Operator fallback.** Wake assigns via the bot PAT, so the assignment
event's sender is the bot itself; the turn-end handoff then falls back to
`github.repository_owner` as the operator to hand the issue back to. A
direct human assignment hands back to that human, as before.

### Consumer workflow (copy-paste)

```yaml
# .github/workflows/wake.yml
name: Wake
on:
  issue_comment:
    types: [created, edited]
permissions:
  contents: read
  id-token: write
jobs:
  wake:
    uses: gingur/devkit/.github/workflows/claude.wake.yml@main
    with:
      infisicalIdentity: <machine identity UUID>
```

This caller lives alongside the claude.plan / claude.implement callers and is
the only place `issue_comment` is handled — the agent callers keep their
`on: issues: [assigned]` triggers unchanged. In `devkit` itself the workflow
self-triggers (no caller needed) and reads the identity from the
`INFISICAL_IDENTITY` Actions variable.

| Input               | Default         | Notes                                                         |
| ------------------- | --------------- | ------------------------------------------------------------- |
| `bot`               | `gingur-bot`    | machine-user login to assign (the agent identity wake starts) |
| `quiet`             | `20`            | debounce quiet period in seconds; each new event restarts it  |
| `infisicalIdentity` | —               | identity UUID (falls back to `vars.INFISICAL_IDENTITY`)       |
| `infisicalProject`  | `gingur`        | Infisical project slug                                        |
| `infisicalEnv`      | `prod`          | Infisical environment slug                                    |
| `infisicalPath`     | `/infra/github` | folder holding the two secrets                                |
| `runner`            | `ubuntu-latest` | runner label                                                  |
