# PR preview deploys for Cloudflare Workers — design

- **Date:** 2026-05-31
- **Issue:** [gingur/devkit#1](https://github.com/gingur/devkit/issues/1)
- **Status:** Approved (pending spec review)

## Summary

Add devkit-side enablement for **per-PR preview deploys** of Cloudflare Workers
sites, with each PR served at an **immutable, masked URL on the project's own
domain** — `https://pr-<N>.<domain>` (e.g. `https://pr-42.troyrhinehart.com`).
Content is mutable (each push redeploys in place); the URL is stable for the PR's
lifetime. Previews are torn down automatically when the PR closes.

This is the **devkit side only**: new/changed reusable workflows and composite
actions, plus docs and consumer recipes. Site-specific wiring (a consumer's own
`wrangler.toml`, their calling workflows) is out of scope except as documented
recipes.

This work also introduces a repo-wide **naming convention** (see below) and
renames the existing workflows/actions to match.

## Goals

- One preview worker **per PR**, no collisions across concurrent PRs.
- **Immutable URL per PR**, masked under the project domain (`pr-<N>.<domain>`).
- Mutable content: each push to the PR redeploys the same worker/URL.
- Automatic teardown on PR close (worker + custom domain).
- Preview URL surfaced on the PR via a **sticky comment** (updated in place, removed on close).
- Single source of truth for every reused concern (credential fetch, credential
  handoff, custom-domain API) — no duplicated logic across workflows.

## Non-goals

- Site-specific config (consumer `wrangler.toml`, consumer workflows) beyond recipes.
- Preview environments for non-Workers targets.
- `workers.dev`-hosted previews (explicitly rejected in favour of masked domains).
- A gateway/proxy architecture (rejected — see Decisions).
- Multi-package-manager support (npm/yarn) — pnpm is the assumed default.

## Naming convention

Full standards live in [`CLAUDE.md`](../../../CLAUDE.md). Summary — a 3-tier
identifier system:

| Tier | Convention | Examples |
|---|---|---|
| File names (workflows, action dirs) | `lowercase.dot.notation` `<provider>.<service>.<action>` | `cf.worker.preview.yml`, `node.verify.yml` |
| Identifiers (inputs, job/step ids, outputs) | `camelCase`, single word when possible | `deploy`, `workerName`, `cfZoneId` |
| Env vars & secrets | `SCREAMING_SNAKE_CASE` | `CF_API_TOKEN` |

- **provider** abbreviated where common (`cf`); runtime is the provider for
  tooling (`node` now, `bun` future sibling). **service** omitted when the provider
  has one obvious surface (`node.verify`). **action** named for intent, not trigger
  (`verify`, not `ci`). Compound lifecycles use more dots, not hyphens
  (`cf.worker.preview.cleanup`).
- Inputs are provider-prefixed only when a surface spans providers
  (`infisicalProjectSlug` + `cfZoneId`); single-provider actions stay bare
  (`apiToken`).

### Rename map

| Kind | Old | New |
|---|---|---|
| workflow | `ci-node.yml` | `node.verify.yml` |
| workflow | `deploy-cf-worker.yml` | `cf.worker.deploy.yml` |
| workflow | *(new)* | `cf.worker.preview.yml` |
| workflow | *(new)* | `cf.worker.preview.cleanup.yml` |
| action | `setup-node-pnpm` | `node.setup` |
| action | `deploy-cf-worker` | `cf.worker.deploy` |
| action | *(new)* | `infisical.secrets.fetch` |
| action | *(new)* | `cf.worker.domain` |
| inputs | `kebab-case` (`api-token`, `working-directory`) | `camelCase` (`apiToken`, `workingDirectory`) |

Nice parallel: the reusable workflow `cf.worker.deploy.yml` sits over the
composite `actions/cf.worker.deploy/`. Jobs/steps: `node.verify` → job `verify`
(`lint`/`typecheck`/`test`); `cf.worker.deploy` → job `deploy`
(`validate`/`checkout`/`setup`/`install`/`build`/`secrets`/`deploy`);
`cf.worker.preview` → jobs `deploy` + `domain` (`secrets`/`attach`/`comment`);
`cf.worker.preview.cleanup` → job `cleanup` (`secrets`/`detach`/`delete`/`comment`).

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Env model | Both **named** envs: `--env production` / `--env preview` | Symmetric config separation; top-level `wrangler.toml` is shared base. |
| Per-PR isolation | Per-PR **worker** named `<app>-pr-<N>`, via wrangler `--name` override | A static `[env.preview].name` would collide across PRs. |
| URL masking | Per-PR **custom domain** `pr-<N>.<domain>` attached to the per-PR worker | Vanity URL on the project domain; ~$0 cost. |
| Hostname shape | `pr-<N>.<domain>` (one label deep) | Covered by Universal SSL — no Advanced Certificate needed. |
| URL surfacing | **Sticky PR comment** (adopt `marocchino/sticky-pull-request-comment`) | Marker-based upsert + delete-on-close in one maintained action. |
| Cleanup | **Auto-delete on PR close** (detach domain, then `wrangler delete`) | Keeps the account tidy; reclaims script-count quota. |
| Cred fetch | Extract `infisical.secrets.fetch` composite (wraps official `Infisical/secrets-action`) | Used in 3 places; centralizes the version pin + OIDC wiring. |
| Custom-domain API | **Build** a `cf.worker.domain` curl composite | No OSS action exists; wrangler has no CLI for dynamic custom domains. |

### Why not native preview URLs

Cloudflare's native preview URLs (`wrangler versions upload --preview-alias`) are
simpler but live on `workers.dev` and **cannot be masked**: a custom domain routes
to a worker's live *deployment*, never to a preview *version/alias*. Masking
therefore requires a real deployed worker on the hostname. "Native + a gateway
proxy worker" can mask but adds a permanent proxy worker and a per-request billable
hop (converting otherwise-free static-asset serves into paid Worker invocations),
so it is both more complex and more expensive than a per-PR worker. Per-PR worker
+ custom domain is the cheapest masked path (~$0; per-PR worker scripts carry no
per-script fee, only a soft script-count quota that cleanup reclaims).

## Architecture

```
consumer repo (e.g. troyrhinehart)
├─ on: push  → calls cf.worker.deploy.yml          (environment: production)
├─ on: PR    → calls cf.worker.preview.yml         (environment: preview)
└─ on: PR closed → calls cf.worker.preview.cleanup.yml

devkit
├─ actions/
│  ├─ node.setup/                (RENAMED from setup-node-pnpm)
│  ├─ cf.worker.deploy/          (RENAMED from deploy-cf-worker; + workerName input)
│  ├─ infisical.secrets.fetch/   (NEW: Infisical OIDC fetch → env)
│  └─ cf.worker.domain/          (NEW: attach/detach custom domain via CF API)
└─ .github/workflows/
   ├─ node.verify.yml            (RENAMED from ci-node.yml)
   ├─ cf.worker.deploy.yml       (RENAMED from deploy-cf-worker.yml; + workerName, always forward --env)
   ├─ cf.worker.preview.yml      (NEW: nests deploy primitive + attach domain + comment)
   └─ cf.worker.preview.cleanup.yml (NEW: detach domain + wrangler delete + remove comment)
```

Each workflow is thin glue over single-purpose composites. Each third-party
action lives in exactly one place. Pinning follows the policy in `CLAUDE.md`:
credible-org actions use **version tags** (`Infisical`, `cloudflare`, `pnpm`,
`actions/*`); the only **SHA**-pinned action is the individual-maintainer
`marocchino/sticky-pull-request-comment`.

## Components

### 1. `actions/cf.worker.deploy/` (composite — RENAMED + MODIFIED)

The deploy primitive's worker invocation (was `deploy-cf-worker`). Add one
optional input:

- `workerName` (default `''`): when set, fold `--name <workerName>` into the
  wrangler command, so the deployed script name is overridden per call.

Implementation: construct the command, e.g.
`command: ${{ inputs.workerName == '' && inputs.command || format('{0} --name {1}', inputs.command, inputs.workerName) }}`.
Existing `apiToken`, `accountId`, `workingDirectory`, `environment`, `command`
inputs unchanged. (The `environment` input maps to wrangler-action's `environment`
→ `--env`.)

### 2. `actions/infisical.secrets.fetch/` (composite — NEW)

Thin wrapper over the official `Infisical/secrets-action` (credible org → pinned
to a version tag here, once). Fetches secrets via GitHub OIDC and exports them to
the job env.

Inputs (bare — single-provider surface): `identityId`, `oidcAudience` (default
`https://github.com/gingur`), `projectSlug`, `envSlug`, `secretPath`. Runs the
Infisical action with `method: oidc`, `export-type: env`. Requires
`id-token: write` (granted by the calling job/workflow).

Used by: the deploy primitive, the preview domain job, and cleanup.

### 3. `actions/cf.worker.domain/` (composite — NEW)

Attach or detach a Workers custom domain via the Cloudflare API (raw `curl`; no
SHA to pin).

Inputs (bare — single-provider surface): `mode` (`attach` | `detach`), `apiToken`,
`accountId`, `zoneId`, `hostname`, `service` (worker name; required for `attach`).

- **attach:** `PUT /accounts/{accountId}/workers/domains`
  body `{ "hostname": <hostname>, "service": <service>, "zone_id": <zoneId> }`.
  Idempotent upsert — safe to re-run on each push. Cloudflare auto-creates the
  proxied DNS record + edge cert.
- **detach:** `GET /accounts/{accountId}/workers/domains?hostname=<hostname>&zone_id=<zoneId>`
  → take the binding `id` → `DELETE /accounts/{accountId}/workers/domains/{id}`.
  No-op (success) if no binding is found, so cleanup is safe to re-run.

All calls assert `success: true` in the CF API response and fail the step otherwise.

### 4. `.github/workflows/cf.worker.deploy.yml` (reusable — RENAMED + MODIFIED)

The deploy primitive (was `deploy-cf-worker.yml`). Production uses it directly;
preview nests it.

- New optional input `workerName` (passthrough to the composite's `--name`).
- **Always** forward `environment` to the composite as `--env` (breaking change — see Migration).
- Replace the inline Infisical step with `uses: ./actions/infisical.secrets.fetch`.
- No PR/comment/preview logic — stays one job: deploy a worker for a given env/name.

### 5. `.github/workflows/cf.worker.preview.yml` (reusable — NEW)

PR-preview orchestrator. Two jobs:

- **`deploy`** — `uses: ./.github/workflows/cf.worker.deploy.yml` with
  `environment: preview`, `workerName: ${{ inputs.appName }}-pr-${{ github.event.pull_request.number }}`,
  `secrets: inherit`.
- **`domain`** (`needs: deploy`) — steps `secrets` (`infisical.secrets.fetch`) →
  `attach` (`cf.worker.domain` attach, `hostname: pr-<N>.<previewDomain>`,
  `service: <appName>-pr-<N>`) → `comment` (`marocchino/sticky-pull-request-comment`,
  `header: cf-preview`, body = the masked URL). Holds `pull-requests: write`.

Inputs (provider-prefixed — spans providers): `appName`, `previewDomain` (e.g.
`troyrhinehart.com`), `cfZoneId`, the deploy passthroughs (`workingDirectory`,
`buildCommand`, `nodeVersion`, `pnpmVersion`), and the `infisical*` set
(`infisicalProjectSlug`, `infisicalEnvSlug`, `infisicalSecretPath`,
`infisicalIdentityId`). Permissions: `contents: read`, `id-token: write`,
`pull-requests: write`.

### 6. `.github/workflows/cf.worker.preview.cleanup.yml` (reusable — NEW)

Triggered by the consumer on `pull_request: closed`. One job:

- `secrets` — fetch creds (`infisical.secrets.fetch`) →
- `detach` — `cf.worker.domain` detach (`hostname: pr-<N>.<previewDomain>`) →
- `delete` — `wrangler delete` the per-PR worker via the **existing**
  `cf.worker.deploy` composite (`command: delete`, `workerName: <app>-pr-<N>`) →
- `comment` — `marocchino/sticky-pull-request-comment` with `delete: true`,
  `header: cf-preview` to remove the preview comment.

Order matters: detach the domain **before** deleting the worker.

## Data flow

**Preview (PR #N opened / synchronized):**
```
consumer PR workflow → cf.worker.preview.yml
  job deploy:  infisical.secrets.fetch → wrangler deploy --env preview --name <app>-pr-N
  job domain:  infisical.secrets.fetch → PUT workers/domains {pr-N.<domain> → <app>-pr-N}
                                       → sticky comment "Preview: https://pr-N.<domain>"
```

**Cleanup (PR #N closed):**
```
consumer PR-closed workflow → cf.worker.preview.cleanup.yml
  infisical.secrets.fetch → GET+DELETE workers/domains (pr-N.<domain>)
                          → wrangler delete --name <app>-pr-N
                          → sticky comment delete
```

## Cloudflare specifics

- **Custom domain** auto-creates a proxied DNS record + edge cert. `pr-<N>.<domain>`
  is one label deep, so the zone's Universal SSL covers it — no Advanced Certificate.
- **Token scope** (update the Secret-rotation runbook): Workers Scripts (Edit),
  Account Settings (Read), per-zone **Workers Routes (Edit)**, per-zone **DNS (Edit)**.
  DNS edit is newly required for custom-domain auto-DNS.
- **`[env.preview]`** supplies preview-specific config (vars/bindings). Its `name`
  is a placeholder, overridden per-PR by `--name`. It should carry **no custom
  route** (so it doesn't fight the per-PR custom domain we attach via API).

## Breaking changes & migration

Two breaking changes land together; both require a coordinated update to the only
consumer, `gingur/troyrhinehart` (separate repo, migrated there, not here):

1. **Always-forward `--env`.** A consumer whose `wrangler.toml` has **no
   `[env.production]`** block would have wrangler deploy a worker named
   `<name>-production` (wrangler auto-suffixes unnamed environments) — silently
   renaming the production worker. Consumers must migrate to explicit
   `[env.production]` / `[env.preview]` blocks.
2. **Renames + camelCase inputs.** `ci-node.yml` → `node.verify.yml` and
   `deploy-cf-worker.yml` → `cf.worker.deploy.yml`; all inputs move kebab →
   camelCase (`infisical-project-slug` → `infisicalProjectSlug`, etc.).
   troyrhinehart references both workflows (`ci.yml`, `deploy.yml`) and must update
   the `uses:` paths **and** the input keys. (Composite-action renames are
   devkit-internal only — no consumer references them directly.)

Consumer `wrangler.toml` migration:

```toml
# before (top-level only)
name = "troyrhinehart"
[assets]
directory = "./dist"

# after
[assets]
directory = "./dist"

[env.production]
name = "troyrhinehart"
# (any existing production routes/custom domain go here)

[env.preview]
name = "troyrhinehart-preview"   # placeholder; overridden per-PR by --name
```

## Adopt vs build (OSS scan)

| Need | Verdict | Choice |
|---|---|---|
| Sticky PR comment | **Adopt** | `marocchino/sticky-pull-request-comment` (marker upsert + `delete`) |
| Infisical OIDC fetch | **Adopt** (wrapped) | official `Infisical/secrets-action`, `method: oidc` |
| Workers custom-domain attach/detach | **Build** | `cf.worker.domain` curl composite (no OSS action exists) |
| wrangler deploy / delete | **Reuse** | existing `cf.worker.deploy` composite (`command: deploy` / `delete`) |
| Sticky-comment as own action | **Defer** | adopt marocchino instead of hand-rolling |

## Risks & verification

1. **`--name` override is the linchpin.** The deployed worker must be exactly
   `<app>-pr-<N>` so the custom domain binds to the right `service`. wrangler 4.95
   *accepts* `--name` with `--env preview` (verified via dry-run; older wrangler
   rejected the combo). Override semantics confirmed on the **first real preview
   deploy**. **Fallback:** deploy preview off top-level config with `--name` only
   (drop `--env preview`), losing preview-specific config but keeping isolation.
2. **`wrangler delete --name` runs non-interactively in CI** (no confirmation
   prompt). Verify command assembly with `act` / `--dry-run`.
3. **First-hit propagation:** brand-new PR custom domain may take seconds for
   DNS/cert to go live. Acceptable; note in docs.
4. **CF API error handling:** `cf.worker.domain` must assert `success: true` and
   fail loudly, so a broken attach/detach doesn't pass silently.
5. **Fork PRs (security boundary, intentional):** GitHub does not expose
   `id-token`/secrets to workflows triggered by PRs from forks. Since previews
   depend on OIDC → Infisical → Cloudflare creds, previews only run for
   **same-repo (branch) PRs** and silently no-op (or fail the OIDC step) for fork
   PRs. This is the desired default — we do not want fork PRs deploying workers
   with our credentials. Documented, not worked around.

## Consumer recipes (documented in README)

**Preview on PR:**
```yaml
# .github/workflows/preview.yml (consumer repo)
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
      appName: troyrhinehart
      previewDomain: troyrhinehart.com
      cfZoneId: <zoneId>
      infisicalProjectSlug: gingur-7xjq
      infisicalEnvSlug: production   # where the CF token lives (independent of environment: preview)
      infisicalSecretPath: /troyrhinehart
      infisicalIdentityId: <identityId>
    secrets: inherit
```

**Cleanup on close:**
```yaml
# .github/workflows/preview-cleanup.yml (consumer repo)
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
      appName: troyrhinehart
      previewDomain: troyrhinehart.com
      cfZoneId: <zoneId>
      infisicalProjectSlug: gingur-7xjq
      infisicalEnvSlug: production   # where the CF token lives (independent of environment: preview)
      infisicalSecretPath: /troyrhinehart
      infisicalIdentityId: <identityId>
    secrets: inherit
```

## Out of scope / future

- Extract a generic sticky-comment composite (only if a second non-preview consumer appears).
- `bun.*` sibling namespace (e.g. `bun.ci`, `bun.setup`) if/when bun support is added.
- `wrangler.toml` composition/templating ([#6](https://github.com/gingur/devkit/issues/6)) — unrelated, deferred.
- Concurrency control (cancel in-flight preview deploys per PR) — can add `concurrency:` later if needed.
