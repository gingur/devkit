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

### Environments

Three names, one CI surface:

| Name | Where | Notes |
|---|---|---|
| `production` | CI | The deployed instance. |
| `preview` | CI | PR / branch previews. Same shape, separate target. |
| `local` | Developer machine | Never appears in CI. Outside the workflow input enum. |

Reusable workflows and actions only accept `production | preview` for the `environment` input. `local` is a convention for human developers — it exists to give that mode a name without ever leaking into CI.
