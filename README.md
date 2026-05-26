# devkit

Shared GitHub Actions, reusable workflows, and dev configs for [@gingur](https://github.com/gingur) projects. One monorepo, pinned by tag.

## Layout

```
.github/workflows/   reusable workflows  — uses: gingur/devkit/.github/workflows/<name>.yml@v1
actions/             composite actions   — uses: gingur/devkit/actions/<name>@v1
configs/             shared eslint/tsconfig/prettier/etc.
scripts/             one-off shell/node utilities
```

> Reusable workflows must live directly in `.github/workflows/` (GitHub requirement — no subdirs). Use filename prefixes to group: `ci-*.yml`, `release-*.yml`, etc.

## Using from another repo

**Reusable workflow:**

```yaml
jobs:
  ci:
    uses: gingur/devkit/.github/workflows/ci-node.yml@v1
    with:
      node-version: "20"
```

**Composite action:**

```yaml
steps:
  - uses: gingur/devkit/actions/setup-node-pnpm@v1
```

## Versioning

Pin to `@v1`. The major-version tag (`v1`, `v2`, ...) moves forward on every non-breaking release; breaking changes advance the major. **Don't pin to `main`** — it's the bleeding edge.
