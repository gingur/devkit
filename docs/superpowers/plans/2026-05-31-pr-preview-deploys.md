# PR Preview Deploys Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable per-PR Cloudflare Worker previews served at an immutable masked URL (`https://pr-<N>.<domain>`), torn down on PR close — and refactor the repo to the new `<provider>.<service>.<action>` naming + version-tag pinning standards.

**Architecture:** Two phases. **Phase 1** is a behavior-preserving refactor (renames, camelCase inputs, version-tag pins, extract `infisical.secrets.fetch`) plus the lockstep consumer (`troyrhinehart`) update. **Phase 2** adds the preview feature: `workerName` + always-`--env`, a `cf.worker.domain` curl composite, `cf.worker.preview.yml` (nests the deploy primitive + attaches a custom domain + sticky comment) and `cf.worker.preview.cleanup.yml`, plus the consumer's `wrangler.toml` migration and new preview workflows.

**Tech Stack:** GitHub Actions (composite actions + reusable workflows), `cloudflare/wrangler-action`, `Infisical/secrets-action` (OIDC), `marocchino/sticky-pull-request-comment`, Cloudflare Workers + Workers Domains REST API. Local verification via `act` + rootless `podman`.

**Spec:** `docs/superpowers/specs/2026-05-31-pr-preview-deploys-design.md`
**Standards:** `CLAUDE.md` (naming, casing, pinning).

---

## Conventions for this plan

- **Verification tooling.** YAML validity: `python3 -c "import yaml,sys; yaml.safe_load(open(sys.argv[1]))" <file>`. Workflow lint (if installed): `actionlint`. Local runs: `act` against the podman socket:
  ```bash
  export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
  systemctl --user enable --now podman.socket
  SOCK="$XDG_RUNTIME_DIR/podman/podman.sock"
  # act push -W <wf> -j <job> -P ubuntu-latest=catthehacker/ubuntu:act-latest --container-daemon-socket "unix://$SOCK"
  ```
- **Third-party action `with:` keys** keep the upstream action's own input names (e.g. `Infisical/secrets-action` uses `identity-id`); only **our** action/workflow input *declarations* use concise camelCase.
- **Pinning** (per `CLAUDE.md`): credible-org actions → version tag; `marocchino/sticky-pull-request-comment` → SHA `0ea0beb66eb9baf113663a64ec522f60e49231c0` (# v3.0.4).
- **Working dir:** all devkit paths are relative to the devkit repo root. The consumer repo is at `../troyrhinehart` (separate git repo — its tasks are committed/pushed there, not in devkit).
- **Commits:** end messages with the project's `Co-Authored-By` trailer.

## File structure

```
devkit/
  actions/
    node.setup/action.yml              (rename of setup-node-pnpm; camelCase; pins→tags)
    cf.worker.deploy/action.yml        (rename of deploy-cf-worker; camelCase; +workerName [P2]; pin→tag)
    infisical.secrets.fetch/action.yml (NEW; wraps Infisical/secrets-action)
    cf.worker.domain/action.yml        (NEW [P2]; attach/detach via curl)
  .github/workflows/
    node.verify.yml                    (rename of ci-node.yml; camelCase; job verify; pins→tags)
    cf.worker.deploy.yml               (rename of deploy-cf-worker.yml; camelCase; uses extracted fetch; +--env [P2])
    cf.worker.preview.yml              (NEW [P2])
    cf.worker.preview.cleanup.yml      (NEW [P2])
  README.md                            (update usage examples + add preview recipes [P2])

troyrhinehart/ (separate repo, lockstep)
  .github/workflows/ci.yml             (→ node.verify.yml, camelCase inputs [P1])
  .github/workflows/deploy.yml         (→ cf.worker.deploy.yml, camelCase inputs [P1])
  wrangler.toml                        ([env.production]/[env.preview] [P2])
  .github/workflows/preview.yml        (NEW [P2])
  .github/workflows/preview.cleanup.yml(NEW [P2])
```

Each old file is renamed via `git mv` then rewritten, so history follows the file.

---

# PHASE 1 — Naming + pinning refactor (behavior-preserving)

### Task 1: Rename `setup-node-pnpm` → `node.setup`

**Files:**
- Rename: `actions/setup-node-pnpm/action.yml` → `actions/node.setup/action.yml`

- [ ] **Step 1: git mv the directory**

```bash
git mv actions/setup-node-pnpm actions/node.setup
```

- [ ] **Step 2: Rewrite `actions/node.setup/action.yml`** (camelCase inputs; pins→tags)

```yaml
name: 'Setup Node + pnpm'
description: 'Install pnpm and Node.js with dependency caching. Versions default to .nvmrc (Node) and the package.json packageManager field (pnpm) when inputs are unset; pass an input to override.'

inputs:
  node:
    description: 'Node.js version. Optional override. When unset, reads from .nvmrc.'
    required: false
    default: ''
  pnpm:
    description: 'pnpm version. Optional override. When unset, reads from package.json packageManager field.'
    required: false
    default: ''
  install:
    description: 'Run pnpm install --frozen-lockfile after setup'
    required: false
    default: 'true'

runs:
  using: 'composite'
  steps:
    - name: Install pnpm
      uses: pnpm/action-setup@v6
      with:
        version: ${{ inputs.pnpm }}

    - name: Setup Node.js
      uses: actions/setup-node@v6
      with:
        node-version: ${{ inputs.node }}
        node-version-file: .nvmrc
        cache: 'pnpm'

    - name: Install dependencies
      if: ${{ inputs.install == 'true' }}
      shell: bash
      run: pnpm install --frozen-lockfile
```

- [ ] **Step 3: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('actions/node.setup/action.yml'))" && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Rename setup-node-pnpm -> node.setup (camelCase inputs, version-tag pins)"
```

### Task 2: Rename `deploy-cf-worker` action → `cf.worker.deploy`

**Files:**
- Rename: `actions/deploy-cf-worker/action.yml` → `actions/cf.worker.deploy/action.yml`

- [ ] **Step 1: git mv**

```bash
git mv actions/deploy-cf-worker actions/cf.worker.deploy
```

- [ ] **Step 2: Rewrite `actions/cf.worker.deploy/action.yml`** (camelCase; wrangler pin→tag; behavior unchanged — no `workerName` yet)

```yaml
name: 'Deploy Cloudflare Worker'
description: 'Run wrangler against a pre-built directory via cloudflare/wrangler-action. Cloudflare credentials are passed as inputs (it takes them via inputs, not environment variables).'

inputs:
  token:
    description: 'Cloudflare API token'
    required: true
  account:
    description: 'Cloudflare account ID'
    required: true
  cwd:
    description: 'Directory containing wrangler.toml'
    required: false
    default: '.'
  env:
    description: 'wrangler --env value. Empty means run without --env.'
    required: false
    default: ''
  command:
    description: 'wrangler subcommand'
    required: false
    default: 'deploy'

runs:
  using: 'composite'
  steps:
    - name: Deploy
      uses: cloudflare/wrangler-action@v4
      with:
        apiToken: ${{ inputs.token }}
        accountId: ${{ inputs.account }}
        workingDirectory: ${{ inputs.cwd }}
        environment: ${{ inputs.env }}
        command: ${{ inputs.command }}
```

- [ ] **Step 3: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('actions/cf.worker.deploy/action.yml'))" && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Rename deploy-cf-worker action -> cf.worker.deploy (camelCase, version-tag pin)"
```

### Task 3: Create `infisical.secrets.fetch` composite (extraction)

**Files:**
- Create: `actions/infisical.secrets.fetch/action.yml`

- [ ] **Step 1: Create `actions/infisical.secrets.fetch/action.yml`**

```yaml
name: 'Fetch Infisical secrets'
description: 'Fetch secrets from Infisical via GitHub OIDC and export them to the job environment. Requires id-token: write in the calling job.'

inputs:
  identity:
    description: 'Infisical machine identity UUID with OIDC trust for this repo'
    required: true
  audience:
    description: 'OIDC audience claim (must match the identity configuration)'
    required: false
    default: 'https://github.com/gingur'
  project:
    description: 'Infisical project slug (e.g., gingur-7xjq)'
    required: true
  env:
    description: 'Infisical environment slug (e.g., production)'
    required: true
  path:
    description: 'Infisical secret folder path (e.g., /troyrhinehart)'
    required: true

runs:
  using: 'composite'
  steps:
    - name: Fetch secrets
      uses: Infisical/secrets-action@v1.0.16
      with:
        method: oidc
        identity-id: ${{ inputs.identity }}
        oidc-audience: ${{ inputs.audience }}
        project-slug: ${{ inputs.project }}
        env-slug: ${{ inputs.env }}
        secret-path: ${{ inputs.path }}
        export-type: env
```

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('actions/infisical.secrets.fetch/action.yml'))" && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add actions/infisical.secrets.fetch/action.yml
git commit -m "Add infisical.secrets.fetch composite (OIDC secret fetch, one home for the pin)"
```

### Task 4: Rename `ci-node.yml` → `node.verify.yml`

**Files:**
- Rename: `.github/workflows/ci-node.yml` → `.github/workflows/node.verify.yml`

- [ ] **Step 1: git mv**

```bash
git mv .github/workflows/ci-node.yml .github/workflows/node.verify.yml
```

- [ ] **Step 2: Rewrite `.github/workflows/node.verify.yml`** (camelCase inputs; job `verify`; uses `node.setup`; checkout pin→tag)

```yaml
name: Verify

on:
  workflow_call:
    inputs:
      node:
        description: 'Node.js version (optional override). Empty means read from .nvmrc.'
        type: string
        required: false
        default: ''
      pnpm:
        description: 'pnpm version (optional override). Empty means read from packageManager field.'
        type: string
        required: false
        default: ''
      cwd:
        description: 'Directory containing package.json'
        type: string
        required: false
        default: '.'
      lint:
        description: 'pnpm script to run for lint'
        type: string
        required: false
        default: 'lint'
      typecheck:
        description: 'pnpm script to run for typecheck'
        type: string
        required: false
        default: 'typecheck'
      test:
        description: 'pnpm script to run for tests'
        type: string
        required: false
        default: 'test'
      runner:
        description: 'Runner label'
        type: string
        required: false
        default: 'ubuntu-latest'

permissions:
  contents: read

jobs:
  verify:
    runs-on: ${{ inputs.runner }}
    defaults:
      run:
        working-directory: ${{ inputs.cwd }}
    steps:
      - uses: actions/checkout@v6

      - uses: gingur/devkit/actions/node.setup@main
        with:
          node: ${{ inputs.node }}
          pnpm: ${{ inputs.pnpm }}

      - name: Lint
        run: pnpm ${{ inputs.lint }}

      - name: Typecheck
        run: pnpm ${{ inputs.typecheck }}

      - name: Test
        run: pnpm ${{ inputs.test }}
```

- [ ] **Step 3: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/node.verify.yml'))" && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Rename ci-node.yml -> node.verify.yml (intent name, camelCase, job verify)"
```

### Task 5: Rename `deploy-cf-worker.yml` → `cf.worker.deploy.yml`, use extracted fetch

**Files:**
- Rename: `.github/workflows/deploy-cf-worker.yml` → `.github/workflows/cf.worker.deploy.yml`

- [ ] **Step 1: git mv**

```bash
git mv .github/workflows/deploy-cf-worker.yml .github/workflows/cf.worker.deploy.yml
```

- [ ] **Step 2: Rewrite `.github/workflows/cf.worker.deploy.yml`** (camelCase inputs; job `deploy`; uses `node.setup` + `infisical.secrets.fetch` + `cf.worker.deploy` action; checkout pin→tag. **Behavior unchanged: `environment` is validated + sets the GitHub Environment but is NOT yet forwarded to wrangler** — Phase 2 adds that.)

```yaml
name: Deploy Cloudflare Worker

on:
  workflow_call:
    inputs:
      node:
        description: 'Node.js version (optional override). Empty means read from .nvmrc.'
        type: string
        required: false
        default: ''
      pnpm:
        description: 'pnpm version (optional override). Empty means read from packageManager field.'
        type: string
        required: false
        default: ''
      build:
        description: 'Build command to run before deploy'
        type: string
        required: false
        default: 'pnpm build'
      cwd:
        description: 'Directory containing package.json + wrangler.toml'
        type: string
        required: false
        default: '.'
      env:
        description: 'Deployment target: production | preview. Validated by case guard; sets the GitHub Environment for this job.'
        type: string
        required: true
      infisicalProject:
        description: 'Infisical project slug (e.g., gingur-7xjq)'
        type: string
        required: true
      infisicalEnv:
        description: 'Infisical environment slug (e.g., production)'
        type: string
        required: true
      infisicalPath:
        description: 'Infisical secret folder path (e.g., /troyrhinehart)'
        type: string
        required: true
      infisicalIdentity:
        description: 'Infisical machine identity UUID with OIDC trust for this repo'
        type: string
        required: true
      infisicalAudience:
        description: 'OIDC audience claim (must match the identity configuration)'
        type: string
        required: false
        default: 'https://github.com/gingur'

permissions:
  contents: read
  id-token: write

jobs:
  deploy:
    runs-on: ubuntu-latest
    environment: ${{ inputs.env }}
    steps:
      - name: Validate environment input
        shell: bash
        run: |
          case "${{ inputs.env }}" in
            production|preview) ;;
            *)
              echo "::error::environment must be one of: production, preview (got: '${{ inputs.env }}')"
              exit 1
              ;;
          esac

      - uses: actions/checkout@v6

      - uses: gingur/devkit/actions/node.setup@main
        with:
          node: ${{ inputs.node }}
          pnpm: ${{ inputs.pnpm }}

      - name: Install dependencies
        working-directory: ${{ inputs.cwd }}
        shell: bash
        run: pnpm install --frozen-lockfile

      - name: Build
        working-directory: ${{ inputs.cwd }}
        shell: bash
        run: ${{ inputs.build }}

      # CF_API_TOKEN / CF_ACCOUNT_ID live only in Infisical (single source of truth).
      # To rotate them, see the "Secret rotation" runbook in the README.
      - name: Fetch CF credentials
        uses: gingur/devkit/actions/infisical.secrets.fetch@main
        with:
          identity: ${{ inputs.infisicalIdentity }}
          audience: ${{ inputs.infisicalAudience }}
          project: ${{ inputs.infisicalProject }}
          env: ${{ inputs.infisicalEnv }}
          path: ${{ inputs.infisicalPath }}

      - name: Deploy
        uses: gingur/devkit/actions/cf.worker.deploy@main
        with:
          cwd: ${{ inputs.cwd }}
          token: ${{ env.CF_API_TOKEN }}
          account: ${{ env.CF_ACCOUNT_ID }}
```

- [ ] **Step 3: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/cf.worker.deploy.yml'))" && echo OK`
Expected: `OK`

- [ ] **Step 4: Verify no old names / kebab inputs remain in devkit**

Run:
```bash
grep -rnE 'setup-node-pnpm|deploy-cf-worker|ci-node\.yml|node-version:|pnpm-version:|api-token:|account-id:|working-directory:|infisical-[a-z]' .github actions || echo "CLEAN"
```
Expected: `CLEAN` (the `working-directory:` on step-level `working-directory:` keys are GitHub's own step key, not our inputs — confirm any hits are step keys, not input declarations).

> Note: GitHub's own step-level `working-directory:` and third-party action input keys (`node-version:` on `actions/setup-node`, `identity-id:` on Infisical) are upstream names and stay as-is. The grep is to catch stray *our-input* references; eyeball any hits.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "Rename deploy-cf-worker.yml -> cf.worker.deploy.yml; use node.setup + infisical.secrets.fetch"
```

### Task 6: Update README usage examples to new names

**Files:**
- Modify: `README.md` (Layout, Using-from-another-repo examples)

- [ ] **Step 1: Update the `## Using from another repo` examples**

Replace the reusable-workflow and composite examples so they reference the new names:

```yaml
jobs:
  verify:
    uses: gingur/devkit/.github/workflows/node.verify.yml@main
    with:
      nodeVersion: "20"
```

```yaml
steps:
  - uses: gingur/devkit/actions/node.setup@main
```

- [ ] **Step 2: Verify README references**

Run: `grep -nE 'ci-node|setup-node-pnpm|deploy-cf-worker' README.md || echo "CLEAN"`
Expected: `CLEAN`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "Update README usage examples to node.verify / node.setup names"
```

### Task 7: Local smoke of the renamed workflows with `act`

**Files:** none (verification only)

- [ ] **Step 1: Confirm podman socket + act**

Run:
```bash
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
systemctl --user enable --now podman.socket
ls -l "$XDG_RUNTIME_DIR/podman/podman.sock" && act --version
```
Expected: socket exists, act prints a version.

- [ ] **Step 2: Lint workflows if actionlint is present**

Run: `command -v actionlint >/dev/null && actionlint .github/workflows/*.yml || echo "actionlint not installed — skipping (YAML already validated)"`
Expected: no errors (or the skip message).

- [ ] **Step 3: Dry-run the deploy primitive's wrangler invocation**

The deploy workflow can't fully run without CF creds, but the `cf.worker.deploy` composite's wrangler call can be exercised in `--dry-run`. Create a throwaway workflow under `$CLAUDE_JOB_DIR/tmp/deploy-probe.yml` that calls the composite with a `deploy --dry-run` command and bogus creds, run with `act`, and confirm it reaches wrangler (not a YAML/wiring error):

```yaml
name: deploy-probe
on: push
jobs:
  probe:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
      - uses: ./actions/cf.worker.deploy
        continue-on-error: true
        with:
          apiToken: bogus
          accountId: bogus
          command: deploy --dry-run
```

Run with `act push -W $CLAUDE_JOB_DIR/tmp/deploy-probe.yml -P ubuntu-latest=catthehacker/ubuntu:act-latest --container-daemon-socket "unix://$SOCK"`.
Expected: log shows `wrangler` running (a `--dry-run: exiting now.` or a creds/config error from wrangler itself — NOT a "file not found / unknown input" wiring error). Delete the probe file after.

- [ ] **Step 4: Commit (no-op if nothing changed)**

No file changes; this task gates Phase 1. If the probe surfaced a wiring bug, fix it in the relevant action.yml and re-commit under the owning task.

### Task 8: Lockstep — update `troyrhinehart` consumer (Phase 1)

> Separate repo at `../troyrhinehart`. These changes must merge **together** with the devkit Phase-1 merge (devkit actions/workflows are consumed `@main`). Coordinate the merge timing.

**Files:**
- Modify: `../troyrhinehart/.github/workflows/ci.yml`
- Modify: `../troyrhinehart/.github/workflows/deploy.yml`

- [ ] **Step 1: Update `ci.yml`** to the new workflow name

```yaml
name: CI

on: [pull_request]

jobs:
  verify:
    uses: gingur/devkit/.github/workflows/node.verify.yml@main
```

- [ ] **Step 2: Update `deploy.yml`** to the new workflow name + camelCase inputs

```yaml
name: Deploy

on:
  push:
    branches: [main]

permissions:
  id-token: write # required for GitHub OIDC
  contents: read

jobs:
  deploy:
    uses: gingur/devkit/.github/workflows/cf.worker.deploy.yml@main
    with:
      env: production
      infisicalProject: gingur-7xjq
      infisicalEnv: production
      infisicalPath: /troyrhinehart
      infisicalIdentity: f87b7cde-3016-4e85-84b5-0d077e8833e0
```

- [ ] **Step 3: Validate YAML**

Run: `for f in ../troyrhinehart/.github/workflows/ci.yml ../troyrhinehart/.github/workflows/deploy.yml; do python3 -c "import yaml; yaml.safe_load(open('$f'))" && echo "OK $f"; done`
Expected: both `OK`.

- [ ] **Step 4: Commit in the troyrhinehart repo**

```bash
git -C ../troyrhinehart add .github/workflows/ci.yml .github/workflows/deploy.yml
git -C ../troyrhinehart commit -m "Adopt devkit node.verify / cf.worker.deploy (renamed workflows, camelCase inputs)"
```

> **Phase-1 merge checkpoint:** open the devkit PR (Phase 1 commits) and the troyrhinehart PR; merge devkit first, then troyrhinehart; confirm troyrhinehart's next push deploys green (production unchanged). Only then start Phase 2.

---

# PHASE 2 — Preview feature

### Task 9: Add `workerName` to the `cf.worker.deploy` composite

**Files:**
- Modify: `actions/cf.worker.deploy/action.yml`

- [ ] **Step 1: Add the `worker` input and fold `--name` into the command**

Replace the `inputs:` `command:` block tail and the `command:` passthrough. Final file:

```yaml
name: 'Deploy Cloudflare Worker'
description: 'Run wrangler against a pre-built directory via cloudflare/wrangler-action. Cloudflare credentials are passed as inputs (it takes them via inputs, not environment variables).'

inputs:
  token:
    description: 'Cloudflare API token'
    required: true
  account:
    description: 'Cloudflare account ID'
    required: true
  cwd:
    description: 'Directory containing wrangler.toml'
    required: false
    default: '.'
  env:
    description: 'wrangler --env value. Empty means run without --env.'
    required: false
    default: ''
  worker:
    description: 'Override the deployed script name (wrangler --name). Empty means use the name from config.'
    required: false
    default: ''
  command:
    description: 'wrangler subcommand'
    required: false
    default: 'deploy'

runs:
  using: 'composite'
  steps:
    - name: Deploy
      uses: cloudflare/wrangler-action@v4
      with:
        apiToken: ${{ inputs.token }}
        accountId: ${{ inputs.account }}
        workingDirectory: ${{ inputs.cwd }}
        environment: ${{ inputs.env }}
        command: ${{ inputs.worker == '' && inputs.command || format('{0} --name {1}', inputs.command, inputs.worker) }}
```

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('actions/cf.worker.deploy/action.yml'))" && echo OK`
Expected: `OK`

- [ ] **Step 3: Verify `--name` composition with `wrangler --dry-run`** (the linchpin — uses `worker` input)

In `$CLAUDE_JOB_DIR/tmp/wrtest`, create a minimal worker with `[env.preview]` and confirm `wrangler deploy --env preview --name <x> --dry-run` is accepted (exit 0):
```bash
cd "$CLAUDE_JOB_DIR/tmp" && rm -rf wrtest && mkdir wrtest && cd wrtest
printf 'main = "src/index.js"\ncompatibility_date = "2025-01-01"\n\n[env.production]\nname = "app"\n\n[env.preview]\nname = "app-preview"\n' > wrangler.toml
mkdir -p src && printf 'export default { fetch() { return new Response("ok"); } }\n' > src/index.js
npx -y wrangler@4 deploy --env preview --name app-pr-42 --dry-run; echo "exit=$?"
```
Expected: `exit=0`, no "cannot use --name with --env" error. (Full override-of-name semantics confirmed on the first real preview deploy — fallback per spec is to drop `--env preview`.)

- [ ] **Step 4: Commit**

```bash
git add actions/cf.worker.deploy/action.yml
git commit -m "cf.worker.deploy: add workerName input (wrangler --name override)"
```

### Task 10: Forward `--env` in `cf.worker.deploy.yml` (breaking change)

**Files:**
- Modify: `.github/workflows/cf.worker.deploy.yml` (the final `Deploy` step + add `worker` input)

- [ ] **Step 1: Add a `worker` workflow input** (after `cwd`, before `env`):

```yaml
      worker:
        description: 'Override the deployed worker name (wrangler --name). Empty uses the config name.'
        type: string
        required: false
        default: ''
```

- [ ] **Step 2: Update the `Deploy` step** to forward `env` and `worker`:

```yaml
      - name: Deploy
        uses: gingur/devkit/actions/cf.worker.deploy@main
        with:
          cwd: ${{ inputs.cwd }}
          env: ${{ inputs.env }}
          worker: ${{ inputs.worker }}
          token: ${{ env.CF_API_TOKEN }}
          account: ${{ env.CF_ACCOUNT_ID }}
```

- [ ] **Step 3: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/cf.worker.deploy.yml'))" && echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/cf.worker.deploy.yml
git commit -m "cf.worker.deploy.yml: forward --env and workerName to wrangler (breaking: requires [env.production])"
```

### Task 11: Create `cf.worker.domain` composite (attach/detach custom domain)

**Files:**
- Create: `actions/cf.worker.domain/action.yml`

- [ ] **Step 1: Create `actions/cf.worker.domain/action.yml`**

```yaml
name: 'Cloudflare Worker custom domain'
description: 'Attach or detach a Workers custom domain via the Cloudflare API. Auto-manages the proxied DNS record + edge cert.'

inputs:
  mode:
    description: 'attach | detach'
    required: true
  token:
    description: 'Cloudflare API token (needs Workers Routes + DNS edit)'
    required: true
  account:
    description: 'Cloudflare account ID'
    required: true
  zone:
    description: 'Cloudflare zone ID for the domain'
    required: true
  hostname:
    description: 'Hostname to bind, e.g. pr-42.example.com'
    required: true
  service:
    description: 'Worker script name (required for attach)'
    required: false
    default: ''

runs:
  using: 'composite'
  steps:
    - name: Manage custom domain
      shell: bash
      env:
        CF_API_TOKEN: ${{ inputs.token }}
        ACCOUNT_ID: ${{ inputs.account }}
        ZONE_ID: ${{ inputs.zone }}
        HOSTNAME: ${{ inputs.hostname }}
        SERVICE: ${{ inputs.service }}
        MODE: ${{ inputs.mode }}
      run: |
        set -euo pipefail
        api="https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/workers/domains"
        auth=(-H "Authorization: Bearer ${CF_API_TOKEN}" -H "Content-Type: application/json")

        assert_success() { # $1 = json response
          if [ "$(echo "$1" | jq -r '.success')" != "true" ]; then
            echo "::error::Cloudflare API call failed:"; echo "$1" | jq -r '.errors'; exit 1
          fi
        }

        case "$MODE" in
          attach)
            [ -n "$SERVICE" ] || { echo "::error::service is required for attach"; exit 1; }
            resp=$(curl -fsS "${auth[@]}" -X PUT "$api" \
              --data "$(jq -n --arg h "$HOSTNAME" --arg s "$SERVICE" --arg z "$ZONE_ID" \
                        '{hostname:$h, service:$s, zone_id:$z}')")
            assert_success "$resp"
            echo "Attached $HOSTNAME -> $SERVICE"
            ;;
          detach)
            list=$(curl -fsS "${auth[@]}" -G "$api" \
              --data-urlencode "hostname=${HOSTNAME}" --data-urlencode "zone_id=${ZONE_ID}")
            assert_success "$list"
            id=$(echo "$list" | jq -r '.result[0].id // empty')
            if [ -z "$id" ]; then echo "No domain binding for $HOSTNAME — nothing to detach."; exit 0; fi
            resp=$(curl -fsS "${auth[@]}" -X DELETE "$api/$id")
            assert_success "$resp"
            echo "Detached $HOSTNAME (id=$id)"
            ;;
          *)
            echo "::error::mode must be attach or detach (got '$MODE')"; exit 1 ;;
        esac
```

- [ ] **Step 2: Validate YAML + shell**

Run:
```bash
python3 -c "import yaml; yaml.safe_load(open('actions/cf.worker.domain/action.yml'))" && echo "YAML OK"
python3 - <<'PY'
import yaml
s=yaml.safe_load(open('actions/cf.worker.domain/action.yml'))
print("SHELL:", s['runs']['steps'][0].get('shell'))
PY
bash -n <(python3 -c "import yaml;print(yaml.safe_load(open('actions/cf.worker.domain/action.yml'))['runs']['steps'][0]['run'])") && echo "BASH SYNTAX OK"
```
Expected: `YAML OK`, `SHELL: bash`, `BASH SYNTAX OK`.

- [ ] **Step 3: Commit**

```bash
git add actions/cf.worker.domain/action.yml
git commit -m "Add cf.worker.domain composite (attach/detach Workers custom domain via CF API)"
```

### Task 12: Create `cf.worker.preview.yml` (nest deploy + attach domain + comment)

**Files:**
- Create: `.github/workflows/cf.worker.preview.yml`

- [ ] **Step 1: Create `.github/workflows/cf.worker.preview.yml`**

```yaml
name: Preview Cloudflare Worker

on:
  workflow_call:
    inputs:
      app:
        description: 'Base worker name; the preview worker is <app>-pr-<N>'
        type: string
        required: true
      domain:
        description: 'Base domain for previews; the URL is pr-<N>.<domain>'
        type: string
        required: true
      cfZone:
        description: 'Cloudflare zone ID for domain'
        type: string
        required: true
      cwd:
        type: string
        required: false
        default: '.'
      build:
        type: string
        required: false
        default: 'pnpm build'
      node:
        type: string
        required: false
        default: ''
      pnpm:
        type: string
        required: false
        default: ''
      infisicalProject:
        type: string
        required: true
      infisicalEnv:
        type: string
        required: true
      infisicalPath:
        type: string
        required: true
      infisicalIdentity:
        type: string
        required: true
      infisicalAudience:
        type: string
        required: false
        default: 'https://github.com/gingur'

permissions:
  contents: read
  id-token: write
  pull-requests: write

jobs:
  deploy:
    uses: ./.github/workflows/cf.worker.deploy.yml
    with:
      env: preview
      worker: ${{ inputs.app }}-pr-${{ github.event.pull_request.number }}
      cwd: ${{ inputs.cwd }}
      build: ${{ inputs.build }}
      node: ${{ inputs.node }}
      pnpm: ${{ inputs.pnpm }}
      infisicalProject: ${{ inputs.infisicalProject }}
      infisicalEnv: ${{ inputs.infisicalEnv }}
      infisicalPath: ${{ inputs.infisicalPath }}
      infisicalIdentity: ${{ inputs.infisicalIdentity }}
      infisicalAudience: ${{ inputs.infisicalAudience }}
    secrets: inherit

  domain:
    needs: deploy
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write
      pull-requests: write
    env:
      WORKER_NAME: ${{ inputs.app }}-pr-${{ github.event.pull_request.number }}
      HOSTNAME: pr-${{ github.event.pull_request.number }}.${{ inputs.domain }}
    steps:
      - name: Fetch CF credentials
        uses: gingur/devkit/actions/infisical.secrets.fetch@main
        with:
          identity: ${{ inputs.infisicalIdentity }}
          audience: ${{ inputs.infisicalAudience }}
          project: ${{ inputs.infisicalProject }}
          env: ${{ inputs.infisicalEnv }}
          path: ${{ inputs.infisicalPath }}

      - name: Attach custom domain
        uses: gingur/devkit/actions/cf.worker.domain@main
        with:
          mode: attach
          token: ${{ env.CF_API_TOKEN }}
          account: ${{ env.CF_ACCOUNT_ID }}
          zone: ${{ inputs.cfZone }}
          hostname: ${{ env.HOSTNAME }}
          service: ${{ env.WORKER_NAME }}

      - name: Comment preview URL
        uses: marocchino/sticky-pull-request-comment@0ea0beb66eb9baf113663a64ec522f60e49231c0 # v3.0.4
        with:
          header: cf-preview
          message: |
            🔎 **Preview deployed** → https://${{ env.HOSTNAME }}

            Worker `${{ env.WORKER_NAME }}` · updates on each push · removed when this PR closes.
```

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/cf.worker.preview.yml'))" && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/cf.worker.preview.yml
git commit -m "Add cf.worker.preview.yml (per-PR deploy + custom domain + sticky comment)"
```

### Task 13: Create `cf.worker.preview.cleanup.yml`

**Files:**
- Create: `.github/workflows/cf.worker.preview.cleanup.yml`

- [ ] **Step 1: Create `.github/workflows/cf.worker.preview.cleanup.yml`**

```yaml
name: Cleanup Cloudflare Worker preview

on:
  workflow_call:
    inputs:
      app:
        type: string
        required: true
      domain:
        type: string
        required: true
      cfZone:
        type: string
        required: true
      cwd:
        type: string
        required: false
        default: '.'
      infisicalProject:
        type: string
        required: true
      infisicalEnv:
        type: string
        required: true
      infisicalPath:
        type: string
        required: true
      infisicalIdentity:
        type: string
        required: true
      infisicalAudience:
        type: string
        required: false
        default: 'https://github.com/gingur'

permissions:
  contents: read
  id-token: write
  pull-requests: write

jobs:
  cleanup:
    runs-on: ubuntu-latest
    env:
      WORKER_NAME: ${{ inputs.app }}-pr-${{ github.event.pull_request.number }}
      HOSTNAME: pr-${{ github.event.pull_request.number }}.${{ inputs.domain }}
    steps:
      - uses: actions/checkout@v6

      - name: Fetch CF credentials
        uses: gingur/devkit/actions/infisical.secrets.fetch@main
        with:
          identity: ${{ inputs.infisicalIdentity }}
          audience: ${{ inputs.infisicalAudience }}
          project: ${{ inputs.infisicalProject }}
          env: ${{ inputs.infisicalEnv }}
          path: ${{ inputs.infisicalPath }}

      - name: Detach custom domain
        uses: gingur/devkit/actions/cf.worker.domain@main
        with:
          mode: detach
          token: ${{ env.CF_API_TOKEN }}
          account: ${{ env.CF_ACCOUNT_ID }}
          zone: ${{ inputs.cfZone }}
          hostname: ${{ env.HOSTNAME }}

      - name: Delete preview worker
        uses: gingur/devkit/actions/cf.worker.deploy@main
        with:
          cwd: ${{ inputs.cwd }}
          token: ${{ env.CF_API_TOKEN }}
          account: ${{ env.CF_ACCOUNT_ID }}
          command: delete
          worker: ${{ env.WORKER_NAME }}

      - name: Remove preview comment
        uses: marocchino/sticky-pull-request-comment@0ea0beb66eb9baf113663a64ec522f60e49231c0 # v3.0.4
        with:
          header: cf-preview
          delete: true
```

> **Note for execution:** `wrangler delete --name <x>` with no config env may need `wrangler delete --name <x> --force` or run in the worker's directory. Verify non-interactive behavior on the first real cleanup; if it prompts, change the cleanup's `command:` to `delete --force` (wrangler supports `--force` to skip confirmation).

- [ ] **Step 2: Validate YAML**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/cf.worker.preview.cleanup.yml'))" && echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/cf.worker.preview.cleanup.yml
git commit -m "Add cf.worker.preview.cleanup.yml (detach domain + delete worker + remove comment)"
```

### Task 14: README — preview docs + recipes + token scope

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a `## PR previews` section** with the consumer recipes (preview + cleanup) exactly as in the spec's "Consumer recipes", and a one-paragraph explainer (immutable `pr-<N>.<domain>` URL, updates per push, deleted on close, fork-PR boundary).

```markdown
## PR previews

Each PR gets an immutable masked preview at `https://pr-<N>.<your-domain>`,
redeployed on every push and torn down when the PR closes. Previews run only for
same-repo (branch) PRs — fork PRs get no OIDC/secrets by design.

**Preview on PR** — `.github/workflows/preview.yml` in the consumer:

​```yaml
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
      app: troyrhinehart
      domain: troyrhinehart.com
      cfZone: <zoneId>
      infisicalProject: gingur-7xjq
      infisicalEnv: production
      infisicalPath: /troyrhinehart
      infisicalIdentity: <identityId>
    secrets: inherit
​```

**Cleanup on close** — `.github/workflows/preview.cleanup.yml`:

​```yaml
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
      app: troyrhinehart
      domain: troyrhinehart.com
      cfZone: <zoneId>
      infisicalProject: gingur-7xjq
      infisicalEnv: production
      infisicalPath: /troyrhinehart
      infisicalIdentity: <identityId>
    secrets: inherit
​```

Requires `wrangler.toml` to use named environments (`[env.production]` / `[env.preview]`).
```

- [ ] **Step 2: Update the Secret-rotation token scope** to add DNS (Edit):

Change the minimum-scope line under `## Secret rotation` to:
`Minimum scope: Workers Scripts (Edit), Account Settings (Read), per-zone Workers Routes (Edit), per-zone DNS (Edit).`

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "README: document PR previews + recipes; add DNS edit to token scope"
```

### Task 15: Lockstep — `troyrhinehart` Phase-2 migration

> Separate repo. Merge **with** the devkit Phase-2 merge.

**Files:**
- Modify: `../troyrhinehart/wrangler.toml`
- Create: `../troyrhinehart/.github/workflows/preview.yml`
- Create: `../troyrhinehart/.github/workflows/preview.cleanup.yml`

- [ ] **Step 1: Migrate `wrangler.toml`** to named environments

```toml
compatibility_date = "2026-01-01"

[assets]
directory = "./dist"

[env.production]
name = "troyrhinehart"
# (production custom domain troyrhinehart.com is managed in the Cloudflare dashboard; keep as-is)

[env.preview]
name = "troyrhinehart-preview"   # placeholder; overridden per-PR by --name; no custom route here
```

- [ ] **Step 2: Get the zone id** for `troyrhinehart.com` (needed for `cfZoneId`)

Run (needs a CF token locally, or read from the dashboard):
```bash
# Dashboard: troyrhinehart.com → Overview → API → Zone ID, or:
# curl -s -H "Authorization: Bearer $CF_API_TOKEN" \
#   "https://api.cloudflare.com/client/v4/zones?name=troyrhinehart.com" | jq -r '.result[0].id'
```
Record the value as `<zoneId>` for the next steps.

- [ ] **Step 3: Create `../troyrhinehart/.github/workflows/preview.yml`** (fill `<zoneId>`)

```yaml
name: Preview
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
      app: troyrhinehart
      domain: troyrhinehart.com
      cfZone: <zoneId>
      infisicalProject: gingur-7xjq
      infisicalEnv: production
      infisicalPath: /troyrhinehart
      infisicalIdentity: f87b7cde-3016-4e85-84b5-0d077e8833e0
    secrets: inherit
```

- [ ] **Step 4: Create `../troyrhinehart/.github/workflows/preview.cleanup.yml`** (fill `<zoneId>`)

```yaml
name: Preview cleanup
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
      app: troyrhinehart
      domain: troyrhinehart.com
      cfZone: <zoneId>
      infisicalProject: gingur-7xjq
      infisicalEnv: production
      infisicalPath: /troyrhinehart
      infisicalIdentity: f87b7cde-3016-4e85-84b5-0d077e8833e0
    secrets: inherit
```

- [ ] **Step 5: Validate YAML + commit (troyrhinehart repo)**

```bash
for f in ../troyrhinehart/wrangler.toml ../troyrhinehart/.github/workflows/preview.yml ../troyrhinehart/.github/workflows/preview.cleanup.yml; do
  case "$f" in *.toml) python3 -c "import tomllib;tomllib.load(open('$f','rb'))";; *) python3 -c "import yaml;yaml.safe_load(open('$f'))";; esac && echo "OK $f"; done
git -C ../troyrhinehart add wrangler.toml .github/workflows/preview.yml .github/workflows/preview.cleanup.yml
git -C ../troyrhinehart commit -m "Add per-PR preview + cleanup; migrate wrangler.toml to named envs"
```

### Task 16: First-real-run verification (post-merge)

**Files:** none (live verification — documents the acceptance test)

- [ ] **Step 1: Open a throwaway PR** on troyrhinehart. Confirm:
  - the `preview` workflow deploys worker `troyrhinehart-pr-<N>` (NOT `troyrhinehart-preview` — proves `--name` overrode `[env.preview].name`; if it didn't, apply the spec fallback: drop `--env preview` in `cf.worker.preview.yml`'s deploy by leaving `environment` empty and relying on top-level config),
  - the sticky comment appears with `https://pr-<N>.troyrhinehart.com`,
  - the URL serves the built site (allow a few seconds for cert/DNS).
- [ ] **Step 2: Push a second commit** to the PR; confirm the same URL updates and the comment stays a single (updated) comment.
- [ ] **Step 3: Close the PR.** Confirm the `cleanup` run detaches the domain (`pr-<N>.troyrhinehart.com` stops resolving), deletes the worker (`wrangler delete` — if it hung on a prompt, switch to `command: delete --force` in the cleanup workflow), and removes the comment.
- [ ] **Step 4: Re-open/close once** to confirm idempotency (attach upsert + detach no-op on missing binding don't error).

---

## Self-review

- **Spec coverage:** env model (T10 `--env` forward), per-PR worker (T9 `workerName` + T12 `workerName: <app>-pr-<N>`), masking (T11 `cf.worker.domain` + T12 attach), hostname shape (T12 `pr-<N>.<previewDomain>`), sticky comment (T12 marocchino), cleanup (T13), infisical extraction (T3, used T5/T12/T13), naming + pins (T1–T6), breaking change + migration (T8, T15), risks/verification (T7, T9-S3, T16), README + token scope (T14). All spec sections map to a task.
- **Type/name consistency:** input names match across producer/consumer — `worker`, `app`, `domain`, `cfZone`, `infisical*` identical in `cf.worker.deploy.yml` ↔ `cf.worker.preview.yml` ↔ recipes; composite inputs (`token`, `account`, `zone`, `hostname`, `service`, `mode`) match call sites; the marocchino `header: cf-preview` matches between attach-comment (T12) and delete-comment (T13).
- **Pinning:** every third-party `uses:` is a version tag except `marocchino@0ea0beb…` (SHA). `cf.worker.domain` uses `curl` (no action to pin).
- **Placeholders:** the only `<...>` tokens are genuine consumer-supplied values (`<zoneId>`, `<identityId>`) — provided where known (identity UUID) and flagged where the user must fetch (zone id, Task 15 Step 2).
