# Contributing

devkit is a monorepo of shared GitHub Actions, reusable workflows, and tool configs consumed by
other `@gingur` repos via `@main`. Usage docs live in [`README.md`](./README.md); standards live
in [`CLAUDE.md`](./CLAUDE.md).

## Reporting issues

Hit a problem with a devkit workflow or action in a consumer repo? Open a GitHub issue here and
include:

- the workflow/action name (e.g. `cf.worker.preview.yml`)
- the consumer repo and a link to the failing run
- the relevant log excerpt

> **Never paste secrets or tokens into issues.** Logs from jobs that use
> `infisical.secrets.fetch` may sit right next to credentials — redact before posting.

## Conventions

- Naming (dotted file names, camelCase identifiers, `SCREAMING_SNAKE_CASE` env vars):
  [`CLAUDE.md`](./CLAUDE.md).
- Versioning and action-pinning policy:
  [`README.md` → Conventions](./README.md#conventions).

## Pull requests

- Commit messages are conventional commits matching existing history:
  `<type>(<scope>): <subject>` — e.g. `feat(actions): …`, `fix(workflows): …`, `docs(readme): …`.
- Formatting/lint uses the repo's own configs (`prettier.config.mjs`, `eslint.config.mjs`).
  `pnpm install` sets up the husky `pre-commit` hook (via the `prepare` script), which runs
  `lint-staged` and `infisical scan git-changes --staged` — the `infisical` CLI must be on PATH.
- Never commit `docs/superpowers/` — local-only planning artifacts (see
  [`CLAUDE.md`](./CLAUDE.md)).
