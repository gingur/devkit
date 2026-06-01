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

The test: *who can move the tag?* A trusted org → tag. One person's account → SHA. To resolve a community action's tag to its commit:

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
