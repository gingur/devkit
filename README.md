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

## Versioning

Pin to `@main`. Personal tools — backwards compatibility is maintained by hand rather than via tags. Pin to a SHA if you ever need a frozen reference point.
