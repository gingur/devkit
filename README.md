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

Add devkit as a dev dependency and wire up the config you need:

```jsonc
// package.json
"devDependencies": { "@gingur/devkit": "github:gingur/devkit#main" }
```

```jsonc
// .oxlintrc.json — oxlint resolves `extends` as file paths (relative to this
// file), not package specifiers, so point into node_modules:
{ "extends": ["./node_modules/@gingur/devkit/configs/oxlintrc.base.json"] }
```

```ts
// oxfmt.config.ts — the only auto-discovered JS/TS config filename
// (`.oxfmtrc.json` / `.oxfmtrc.jsonc` are the JSON alternatives;
// `oxfmt.config.{js,mjs,cjs}` are NOT discovered)
export { default } from '@gingur/devkit/oxfmt';
```

```jsonc
// package.json scripts
"scripts": { "lint": "oxlint", "fmt": "oxfmt", "fmt:check": "oxfmt --check" }
```

| Export                       | File                    | Bring your own    |
| ---------------------------- | ----------------------- | ----------------- |
| `@gingur/devkit/oxlint`      | `oxlintrc.base.json`    | `oxlint`          |
| `@gingur/devkit/oxfmt`       | `oxfmt.config.mjs`      | `oxfmt`           |
| `@gingur/devkit/lint-staged` | `lint-staged.config.js` | `oxfmt`, `oxlint` |
| `@gingur/devkit/tsconfig`    | `tsconfig.base.json`    | `typescript`      |

These tools are **not** bundled — the configs reference them but consumers install
them. They are declared as `peerDependencies` (so your package manager warns when
one is missing); install the ones for the exports you use:

```bash
pnpm add -D oxlint oxfmt typescript
```

> **Migration (ESLint/Prettier → oxlint/oxfmt).** Consumers track devkit via
> `#main`, so they move in **lockstep**: on your next devkit bump, drop
> `eslint` / `@eslint/js` / `typescript-eslint` / `prettier`, install the three
> peers above, and replace `eslint.config.mjs` / `prettier.config.mjs` with the
> `.oxlintrc.json` + `oxfmt.config.ts` wiring shown here. TypeScript baseline is
> `^6 || ^7`: use TS7 unless a dependency still needs the TypeScript **JS
> compiler API** (e.g. `@astrojs/check` peers `^5 || ^6`) — pin TS6 there until
> it catches up.

### Shared configs are live in CI

CI does not run against the committed lockfile's devkit pin: `actions/node.setup`
(the setup path of `node.verify.yml` **and** `cf.worker.deploy.yml`) runs
`pnpm update @gingur/devkit` after its frozen install, re-resolving the
dependency to whatever its **specifier** names on every run. The specifier is
the policy knob:

| Specifier                             | Every CI run resolves to                        |
| ------------------------------------- | ----------------------------------------------- |
| `github:gingur/devkit#main`           | `main` head — **live** (the fleet default)      |
| `github:gingur/devkit#<sha>`          | that SHA — hold-back during a migration         |
| `github:gingur/devkit#semver:<range>` | range-bounded, once version tags exist (future) |

The committed lockfile and local dev catch up on demand — run
`pnpm update @gingur/devkit` and commit; until then local can lag CI, and **CI
is authoritative**. Repos without an `@gingur/devkit` dependency are untouched
(the refresh is a verified no-op).

> **Fleet working rule:** a shared-config change lands **backward-compatible,
> or is rolled out fleet-wide the same day** — live import puts every
> consumer's next verify _and production deploy_ in the blast radius.
> "Backward-compatible" includes **tool-version floors** (the
> `peerDependencies` above): a config option requiring a newer oxlint / oxfmt /
> TypeScript breaks consumers whose binaries lag devkit's floor (e.g.
> vp-bundled oxlint/oxfmt), even when the change is otherwise additive.

## Conventions

### Versioning

Pin to `@main`. This is the gingur consumer convention — single maintainer, single direction of change, so there's no benefit to maintaining version tags. Reproducibility lives on the consumer side via lockfile-pinned SHAs (e.g. `pnpm-lock.yaml` records the resolved commit when devkit is consumed as a git URL dep) — except the `@gingur/devkit` package dep itself in CI, which `node.setup` re-resolves to its specifier every run (see [Shared configs are live in CI](#shared-configs-are-live-in-ci)).

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

1. **Generate the new token** — Cloudflare dashboard → My Profile → API Tokens → Create. Minimum scope: Workers Scripts (Edit), Workers KV Storage (Edit), Account Settings (Read), per-zone Workers Routes (Edit), per-zone DNS (Edit) (DNS edit is needed for custom-domain previews; KV Storage is probed by `wrangler delete` during preview cleanup).
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

> Deploy, rollback, verify, and secret-scan accept an
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
  machines; used for runner registration and by workflow steps that shell out
  to it.
- Node / pnpm are **not** prerequisites: the runner bundles its own runtime
  for JS actions, and `actions/setup-node` / `pnpm/action-setup` maintain a
  per-runner tool cache.

### Routing policy (public repos)

Only **operator-gated** triggers may target `local`:

- `push` to main — `cf.worker.deploy`;
- `workflow_dispatch` — `cf.worker.rollback`.

Code-driven PR workflows (verify, preview, preview cleanup, secret scan)
**always stay on GitHub-hosted runners** — a public repo must never run
PR-driven code on a machine you own. `cf.worker.preview*.yml` deliberately
have no `runner` input.

### Consumer wiring

Set the repo variable `RUNNER=local` and pass it through in **every** caller
workflow — deploy and rollback alike. A caller repo's variables don't resolve inside a
cross-repo reusable, so the reusables' own `vars.RUNNER` fallback covers only
devkit's own direct dispatch runs — a consumer that omits the input silently runs
GitHub-hosted (bit us: gingur/hooks, 2026-07-10):

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
      infisicalEnv: <env-slug> # where the CF token lives (often "public")
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

devkit ships the rollback as a `workflow_call` reusable. It targets
**production only** (the job hardcodes `environment: production`; there is no
`env` input — a preview worker is disposable and gets torn down on PR close
instead of rolled back). Add a thin `workflow_dispatch` wrapper in your repo
so the "Run workflow" form gives you a free-text version field:

```yaml
# .github/workflows/rollback.yml
name: Rollback
on:
  workflow_dispatch:
    inputs:
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
      version: ${{ inputs.version }}
      infisicalProject: <your-project-slug>
      infisicalEnv: public
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
  **Run workflow ▸**, paste the version UUID, and run. The deploy comment
  links straight to this page. (GitHub can't deep-link to a pre-filled form,
  so you still paste the UUID — but the form itself is fully UI-driven.)
- **CLI** — `gh workflow run rollback.yml -f version=<uuid>`.

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
