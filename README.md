# devkit

Shared GitHub Actions and reusable workflows for [@gingur](https://github.com/gingur) projects. One monorepo, consumed by `@main`.

## Layout

```
.github/workflows/   reusable workflows  — uses: gingur/devkit/.github/workflows/<name>.yml@main
actions/             composite actions   — uses: gingur/devkit/actions/<name>@main
```

> Reusable workflows must live directly in `.github/workflows/` (GitHub requirement — no subdirs). Use filename prefixes to group: `ci-*.yml`, `release-*.yml`, etc.

## Using from another repo

**Reusable workflow:**

```yaml
jobs:
  ci:
    uses: gingur/devkit/.github/workflows/ci-node.yml@main
    with:
      node-version: "20"
```

**Composite action:**

```yaml
steps:
  - uses: gingur/devkit/actions/setup-node-pnpm@main
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

| Export | File | Bring your own |
|---|---|---|
| `@gingur/devkit/eslint` | `eslint.config.mjs` | `eslint`, `@eslint/js`, `typescript-eslint`, `typescript` |
| `@gingur/devkit/prettier` | `prettier.config.mjs` | `prettier` |
| `@gingur/devkit/lint-staged` | `lint-staged.config.js` | `prettier`, `eslint` |
| `@gingur/devkit/tsconfig` | `tsconfig.base.json` | `typescript` |

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

**Third-party** actions (anything not under `gingur/`) are pinned to a full commit SHA with a trailing version comment, per [GitHub's security-hardening guidance](https://docs.github.com/en/actions/security-for-github-actions/security-guides/security-hardening-for-github-actions#using-third-party-actions) — a mutable tag like `@v4` can be repointed at malicious code, a SHA cannot:

```yaml
uses: cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0 # v4
```

This includes GitHub-owned `actions/*` (lower risk, pinned for consistency). **gingur's own** actions and workflows stay on `@main` — that's the consumer convention above, and we control them.

To re-pin after an upstream release, resolve the tag to its commit and update both the SHA and the comment:

```bash
gh api repos/<owner>/<repo>/commits/<tag> --jq .sha
```

### Environments

Three names, one CI surface:

| Name | Where | Notes |
|---|---|---|
| `production` | CI | The deployed instance. |
| `preview` | CI | PR / branch previews. Same shape, separate target. |
| `local` | Developer machine | Never appears in CI. Outside the workflow input enum. |

Reusable workflows and actions only accept `production | preview` for the `environment` input. `local` is a convention for human developers — it exists to give that mode a name without ever leaking into CI.

## Secret rotation

Infisical is the single source of truth for deploy credentials. Rotate in **one place** and it propagates to every consumer on the next OIDC fetch — no per-repo secrets, no commits, no PRs. The `deploy-cf-worker.yml` workflow fetches `CF_API_TOKEN` / `CF_ACCOUNT_ID` from Infisical at deploy time, so consumers never store them.

When rotating a Cloudflare API token (annual, or on compromise / personnel change):

1. **Generate the new token** — Cloudflare dashboard → My Profile → API Tokens → Create. Minimum scope: Workers Scripts (Edit), Account Settings (Read), per-zone Workers Routes (Edit).
2. **Update the value in Infisical** — project → env → folder → click the secret → edit value → save. The audit log captures the change.
3. **Verify** — trigger any consuming workflow (or wait for the next scheduled run). The next OIDC fetch returns the new value automatically; no consumer-side config change.
4. **Revoke the old token** in Cloudflare once propagation is confirmed (24h grace recommended in case a background job cached the old value — our workflows don't cache, but the margin is cheap).

> During an incident, this is the runbook: rotate in Infisical (step 2), then revoke at Cloudflare (step 4). Everything else follows automatically.

## Testing

### Deploy credential handoff smoke test

`cloudflare/wrangler-action@v4` takes Cloudflare credentials via its **inputs**, not environment variables (it scrubs `CLOUDFLARE_*` from the env). A regression that passed creds via env once shipped to production as `must set a CLOUDFLARE_API_TOKEN environment variable`, because the original smoke test only verified the Infisical OIDC exchange and never invoked wrangler.

`.github/workflows/smoke-deploy-creds.yml` guards against that class of bug: it runs the `deploy-cf-worker` composite with bogus-but-present creds and `wrangler whoami`, then inspects wrangler's debug log. If the handoff is intact, wrangler issues a Cloudflare API request (and fails auth on the bogus token) — **pass**. If it's broken, wrangler never contacts the API and reports missing credentials — **fail**. It runs in CI on changes to the composite or the workflow, and on `workflow_dispatch`.

Run it locally with [`act`](https://github.com/nektos/act) + podman:

```bash
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
systemctl --user enable --now podman.socket
act push -W .github/workflows/smoke-deploy-creds.yml -j cred-handoff \
  -P ubuntu-latest=catthehacker/ubuntu:act-latest \
  --container-daemon-socket "unix://$XDG_RUNTIME_DIR/podman/podman.sock"
```
