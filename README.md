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
  uses: cloudflare/wrangler-action@v4        # Cloudflare (org)
  uses: Infisical/secrets-action@v1.0.16     # Infisical (org)
  uses: pnpm/action-setup@v6                 # pnpm (org)
  uses: actions/checkout@v6                  # GitHub
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

| Goal                                             | Call                                                                 |
| ------------------------------------------------ | -------------------------------------------------------------------- |
| Verify (lint + typecheck + test) on PR           | `gingur/devkit/.github/workflows/node.verify.yml@main`               |
| Deploy to production on push                     | `gingur/devkit/.github/workflows/cf.worker.deploy.yml@main`          |
| Per-PR preview deploy                            | `gingur/devkit/.github/workflows/cf.worker.preview.yml@main`         |
| Tear down preview on PR close                    | `gingur/devkit/.github/workflows/cf.worker.preview.cleanup.yml@main` |
| Roll back production to a prior version (manual) | `gingur/devkit/.github/workflows/cf.worker.rollback.yml@main`        |
| Scan a PR's commits for leaked secrets           | `gingur/devkit/.github/workflows/infisical.secrets.scan.yml@main`    |
| Planning agent turn on issue assignment          | `gingur/devkit/.github/workflows/claude.plan.yml@main`               |

### Required permissions

| Workflow                    | `contents` | `id-token` | `pull-requests`                        |
| --------------------------- | ---------- | ---------- | -------------------------------------- |
| `node.verify`               | `read`     | —          | —                                      |
| `cf.worker.deploy`          | `read`     | `write`    | `write` (records version on source PR) |
| `cf.worker.preview`         | `read`     | `write`    | `write`                                |
| `cf.worker.preview.cleanup` | `read`     | `write`    | `write`                                |
| `cf.worker.rollback`        | `read`     | `write`    | —                                      |
| `infisical.secrets.scan`    | `read`     | —          | —                                      |
| `claude.plan`               | `read`     | `write`    | — (requires `issues: write` instead)   |

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

Assign an issue to the machine user (`gingur-bot`) and a Claude agent takes one
**planning turn**: it studies the ask (repo code, issue thread, the web),
posts a plan as a comment, and hands the issue back by re-assigning you.
Comment your approval or corrections and re-assign the bot; on an approving
turn it creates the plan's tasks as sub-issues labeled `claude-task`. Every
turn ends with a summary comment and the issue assigned back to you — on
failure, a comment carries the run link instead. Full design rationale:
[design spec](https://gist.github.com/gingur/db3b2def680edfc42e93b9275497b0a9).

- **Turn-taking:** assignment is the baton. Bot assigned = agent's turn;
  you assigned = your turn. The agent never assigns anyone; the workflow
  re-assigns you unconditionally (`if: always()`), even when the run fails.
- **Stateless turns:** each run re-derives state from the issue (plan comment
  present? sub-issues present? operator comments since the bot's last one?)
  and does the next right thing — propose, revise, materialize, or reconcile.
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

Requirements per consumer repo: `gingur-bot` invited as a collaborator with
write; the Infisical identity's OIDC subject covers the repo; Issues enabled.
In `devkit` itself the workflow self-triggers (no caller needed) and reads the
identity from the `INFISICAL_IDENTITY` Actions variable.

| Input               | Default           | Notes                                                    |
| ------------------- | ----------------- | -------------------------------------------------------- |
| `bot`               | `gingur-bot`      | machine-user login the trigger guards on                 |
| `turns`             | `50`              | max agent turns per run (cost bound)                     |
| `model`             | account default   | `claude --model` override (e.g. pin a cheaper model)     |
| `infisicalIdentity` | —                 | identity UUID (falls back to `vars.INFISICAL_IDENTITY`)  |
| `infisicalProject`  | `gingur`          | Infisical project slug                                   |
| `infisicalEnv`      | `prod`            | Infisical environment slug                               |
| `infisicalPath`     | `/infra/github`   | folder holding the two secrets                           |
| `runner`            | `ubuntu-latest`   | runner label                                             |

**Scope note:** this workflow plans; it never implements. The implement
workflow (triggering on `claude-task` issues) is a separate, future piece.
This repo is public: the trigger requires issue *assignment*, which only
collaborators can perform — do not add `pull_request`-family triggers here.
