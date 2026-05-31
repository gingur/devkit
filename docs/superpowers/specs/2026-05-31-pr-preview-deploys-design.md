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
- A gateway/proxy architecture (rejected — see Alternatives).

## Decisions (locked)

| Decision | Choice | Rationale |
|---|---|---|
| Env model | Both **named** envs: `--env production` / `--env preview` | Symmetric config separation; top-level `wrangler.toml` is shared base. |
| Per-PR isolation | Per-PR **worker** named `<app>-pr-<N>`, via wrangler `--name` override | A static `[env.preview].name` would collide across PRs. |
| URL masking | Per-PR **custom domain** `pr-<N>.<domain>` attached to the per-PR worker | Vanity URL on the project domain; ~$0 cost. |
| Hostname shape | `pr-<N>.<domain>` (one label deep) | Covered by Universal SSL — no Advanced Certificate needed. |
| URL surfacing | **Sticky PR comment** (adopt `marocchino/sticky-pull-request-comment`) | Marker-based upsert + delete-on-close in one maintained action. |
| Cleanup | **Auto-delete on PR close** (detach domain, then `wrangler delete`) | Keeps the account tidy; reclaims script-count quota. |
| Cred fetch | Extract `infisical-secrets` composite (wraps official `Infisical/secrets-action`) | Used in 3 places; centralizes the pinned SHA + OIDC wiring. |
| Custom-domain API | **Build** a `cf-worker-domain` curl composite | No OSS action exists; wrangler has no CLI for dynamic custom domains. |

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
├─ on: push  → calls deploy-cf-worker.yml  (environment: production)
├─ on: PR    → calls preview-cf-worker.yml (environment: preview)
└─ on: PR closed → calls cleanup-cf-preview.yml

devkit
├─ actions/
│  ├─ setup-node-pnpm/        (existing)
│  ├─ deploy-cf-worker/       (MODIFIED: + worker-name input)
│  ├─ infisical-secrets/      (NEW: Infisical OIDC fetch → env)
│  └─ cf-worker-domain/       (NEW: attach/detach custom domain via CF API)
└─ .github/workflows/
   ├─ deploy-cf-worker.yml    (MODIFIED: + worker-name, always forward --env)
   ├─ preview-cf-worker.yml   (NEW: nests deploy primitive + attach domain + comment)
   └─ cleanup-cf-preview.yml  (NEW: detach domain + wrangler delete + remove comment)
```

Each workflow is thin glue over single-purpose composites. Every pinned
third-party SHA (Infisical, wrangler-action, marocchino, actions/*) lives in
exactly one place.

## Components

### 1. `actions/deploy-cf-worker/` (composite — MODIFIED)

The deploy primitive's worker invocation. Add one optional input:

- `worker-name` (default `''`): when set, fold `--name <worker-name>` into the
  wrangler command, so the deployed script name is overridden per call.

Implementation: construct the command, e.g.
`command: ${{ inputs.worker-name == '' && inputs.command || format('{0} --name {1}', inputs.command, inputs.worker-name) }}`.
Existing `api-token`, `account-id`, `working-directory`, `environment`, `command`
inputs unchanged. (The `environment` input maps to wrangler-action's `environment`
→ `--env`.)

### 2. `actions/infisical-secrets/` (composite — NEW)

Thin wrapper over the official `Infisical/secrets-action` (pinned to a SHA here,
once). Fetches secrets via GitHub OIDC and exports them to the job env.

Inputs: `identity-id`, `oidc-audience` (default `https://github.com/gingur`),
`project-slug`, `env-slug`, `secret-path`. Runs the Infisical action with
`method: oidc`, `export-type: env`. Requires `id-token: write` (granted by the
calling job/workflow).

Used by: the deploy primitive, the preview domain job, and cleanup.

### 3. `actions/cf-worker-domain/` (composite — NEW)

Attach or detach a Workers custom domain via the Cloudflare API (raw `curl`; no
SHA to pin).

Inputs: `mode` (`attach` | `detach`), `api-token`, `account-id`, `zone-id`,
`hostname`, `service` (worker name; required for `attach`).

- **attach:** `PUT /accounts/{account-id}/workers/domains`
  body `{ "hostname": <hostname>, "service": <service>, "zone_id": <zone-id> }`.
  Idempotent upsert — safe to re-run on each push. Cloudflare auto-creates the
  proxied DNS record + edge cert.
- **detach:** `GET /accounts/{account-id}/workers/domains?hostname=<hostname>&zone_id=<zone-id>`
  → take the binding `id` → `DELETE /accounts/{account-id}/workers/domains/{id}`.
  No-op (success) if no binding is found, so cleanup is safe to re-run.

All calls assert `success: true` in the CF API response and fail the step otherwise.

### 4. `.github/workflows/deploy-cf-worker.yml` (reusable — MODIFIED)

The deploy primitive. Production uses it directly; preview nests it.

- New optional input `worker-name` (passthrough to the composite's `--name`).
- **Always** forward `environment` to the composite as `--env` (breaking change — see Migration).
- Replace the inline Infisical step with `uses: ./actions/infisical-secrets`.
- No PR/comment/preview logic — stays one job: deploy a worker for a given env/name.

### 5. `.github/workflows/preview-cf-worker.yml` (reusable — NEW)

PR-preview orchestrator. Two jobs:

- **`deploy`** — `uses: ./.github/workflows/deploy-cf-worker.yml` with
  `environment: preview`, `worker-name: ${{ inputs.app-name }}-pr-${{ github.event.pull_request.number }}`,
  `secrets: inherit`.
- **`domain`** (`needs: deploy`) — fetch creds (`infisical-secrets`) →
  `cf-worker-domain` `attach` (`hostname: pr-<N>.<preview-domain>`,
  `service: <app-name>-pr-<N>`) → `marocchino/sticky-pull-request-comment`
  (`header: cf-preview`, body = the masked URL). Holds `pull-requests: write`.

Inputs: `app-name`, `preview-domain` (e.g. `troyrhinehart.com`), `cloudflare-zone-id`,
the deploy passthroughs (`working-directory`, `build-command`, `node-version`,
`pnpm-version`), and the `infisical-*` set. Permissions: `contents: read`,
`id-token: write`, `pull-requests: write`.

### 6. `.github/workflows/cleanup-cf-preview.yml` (reusable — NEW)

Triggered by the consumer on `pull_request: closed`. One job:

- fetch creds (`infisical-secrets`) →
- `cf-worker-domain` `detach` (`hostname: pr-<N>.<preview-domain>`) →
- `wrangler delete` the per-PR worker via the **existing** `deploy-cf-worker`
  composite (`command: delete`, `worker-name: <app>-pr-<N>`) →
- `marocchino/sticky-pull-request-comment` with `delete: true`, `header: cf-preview`
  to remove the preview comment.

Order matters: detach the domain **before** deleting the worker.

## Data flow

**Preview (PR #N opened / synchronized):**
```
consumer PR workflow → preview-cf-worker.yml
  job deploy:  infisical-secrets → wrangler deploy --env preview --name <app>-pr-N
  job domain:  infisical-secrets → PUT workers/domains {pr-N.<domain> → <app>-pr-N}
                                 → sticky comment "Preview: https://pr-N.<domain>"
```

**Cleanup (PR #N closed):**
```
consumer PR-closed workflow → cleanup-cf-preview.yml
  infisical-secrets → GET+DELETE workers/domains (pr-N.<domain>)
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

## Breaking change & migration

Always passing `--env` means a consumer whose `wrangler.toml` has **no
`[env.production]`** block would have wrangler deploy a worker named
`<name>-production` (wrangler auto-suffixes unnamed environments) — silently
renaming the production worker. Every consumer must migrate to explicit
`[env.production]` / `[env.preview]` blocks **in lockstep** with adopting this.

Today the only consumer is `gingur/troyrhinehart` (separate repo, migrated there,
not here). Migration recipe (documented in the README):

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
| Workers custom-domain attach/detach | **Build** | `cf-worker-domain` curl composite (no OSS action exists) |
| wrangler deploy / delete | **Reuse** | existing `deploy-cf-worker` composite (`command: deploy` / `delete`) |
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
4. **CF API error handling:** `cf-worker-domain` must assert `success: true` and
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
    uses: gingur/devkit/.github/workflows/preview-cf-worker.yml@main
    with:
      app-name: troyrhinehart
      preview-domain: troyrhinehart.com
      cloudflare-zone-id: <zone-id>
      infisical-project-slug: gingur-7xjq
      infisical-env-slug: preview
      infisical-secret-path: /troyrhinehart
      infisical-identity-id: <uuid>
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
    uses: gingur/devkit/.github/workflows/cleanup-cf-preview.yml@main
    with:
      app-name: troyrhinehart
      preview-domain: troyrhinehart.com
      cloudflare-zone-id: <zone-id>
      infisical-project-slug: gingur-7xjq
      infisical-env-slug: preview
      infisical-secret-path: /troyrhinehart
      infisical-identity-id: <uuid>
    secrets: inherit
```

## Out of scope / future

- Extract a generic sticky-comment composite (only if a second non-preview consumer appears).
- `wrangler.toml` composition/templating ([#6](https://github.com/gingur/devkit/issues/6)) — unrelated, deferred.
- Concurrency control (cancel in-flight preview deploys per PR) — can add `concurrency:` later if needed.
