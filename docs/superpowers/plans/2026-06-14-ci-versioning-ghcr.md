# Automated SemVer + multi-arch GHCR publishing — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automate simplified SemVer in a committed `VERSION.txt` (PATCH per PR commit, MINOR per squash-merge to main, MAJOR via a `major` PR label) and publish a multi-arch image to ghcr.io with moving tags on release.

**Architecture:** A pure, unit-tested Node helper computes the next version. Two GitHub Actions workflows use it: `version.yml` (on PR) auto-commits the PATCH bump and build-validates both arches without pushing; `release.yml` (on merge to main) bumps MINOR/MAJOR, commits + tags, and pushes the multi-arch image as `X.Y.Z` / `X.Y` / `X` / `latest`. Loop-safety comes from pushing bump commits with the default `GITHUB_TOKEN` (whose commits don't re-trigger workflows), a bump-commit-excluding PATCH count, and `[skip ci]`.

**Tech Stack:** GitHub Actions, Docker Buildx (QEMU multi-arch), ghcr.io, Node (ESM helper), Vitest.

---

## File Structure & Responsibilities

```
VERSION.txt                       # bare MAJOR.MINOR.PATCH; version of the current commit (seed 0.1.0)
scripts/next-version.mjs          # pure version math + tiny CLI (the only logic; unit-tested)
test/ci/next-version.test.ts      # Vitest for next-version.mjs
.github/workflows/version.yml     # PR: auto PATCH bump + build-validate both arches (no push)
.github/workflows/release.yml     # merge→main: MINOR/MAJOR bump, commit+tag, push multi-arch
docs/ci-versioning.md             # required repo settings (squash-only, branch protection, bot bypass)
.github/workflows/build.yml       # REMOVED (superseded)
```

**Design notes:** All decision logic lives in `next-version.mjs` so it can be tested without
running Actions; the workflows are thin glue (git + buildx). The workflows assume **same-repo**
PRs (fork PRs skip the bump and just build-validate, since `GITHUB_TOKEN` is read-only on forks).

---

## Task 1: `next-version.mjs` (pure version math) + tests

**Files:**
- Create: `scripts/next-version.mjs`, `test/ci/next-version.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/ci/next-version.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { nextVersion, parseVersion } from '../../scripts/next-version.mjs';

describe('nextVersion', () => {
  it('patch uses the commit count on the current minor line', () => {
    expect(nextVersion('0.1.0', 'patch', 3)).toBe('0.1.3');
    expect(nextVersion('1.4.0', 'patch', 1)).toBe('1.4.1');
    expect(nextVersion('1.4.0', 'patch', 0)).toBe('1.4.0');
  });
  it('minor increments minor and resets patch', () => {
    expect(nextVersion('0.1.0', 'minor')).toBe('0.2.0');
    expect(nextVersion('1.4.2', 'minor')).toBe('1.5.0');
  });
  it('major increments major and resets minor+patch', () => {
    expect(nextVersion('0.1.0', 'major')).toBe('1.0.0');
    expect(nextVersion('1.4.2', 'major')).toBe('2.0.0');
  });
  it('rejects an unknown mode', () => {
    expect(() => nextVersion('1.0.0', 'bogus')).toThrow(/unknown mode/);
  });
  it('rejects a malformed current version', () => {
    expect(() => nextVersion('1.0', 'minor')).toThrow(/invalid version/);
  });
  it('rejects a negative patch count', () => {
    expect(() => nextVersion('1.0.0', 'patch', -1)).toThrow(/patchCount/);
  });
  it('parseVersion splits a version', () => {
    expect(parseVersion('2.3.4')).toEqual({ major: 2, minor: 3, patch: 4 });
  });
});
```

- [ ] **Step 2: Run it, confirm it FAILS**

Run: `npx vitest run test/ci/next-version.test.ts`
Expected: FAIL — cannot find module `../../scripts/next-version.mjs`.

- [ ] **Step 3: Create `scripts/next-version.mjs`**

```js
import { pathToFileURL } from 'node:url';

const RE = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(s) {
  const m = RE.exec(String(s).trim());
  if (!m) throw new Error(`invalid version: ${JSON.stringify(s)}`);
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

// mode: 'patch' (uses patchCount on the current X.Y line), 'minor' (X.Y+1.0),
// or 'major' (X+1.0.0).
export function nextVersion(current, mode, patchCount = 0) {
  const { major, minor } = parseVersion(current);
  switch (mode) {
    case 'patch': {
      const n = Number(patchCount);
      if (!Number.isInteger(n) || n < 0) throw new Error(`invalid patchCount: ${patchCount}`);
      return `${major}.${minor}.${n}`;
    }
    case 'minor':
      return `${major}.${minor + 1}.0`;
    case 'major':
      return `${major + 1}.0.0`;
    default:
      throw new Error(`unknown mode: ${mode}`);
  }
}

// CLI: node scripts/next-version.mjs <current> <patch|minor|major> [patchCount]
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [, , current, mode, patchCount] = process.argv;
  process.stdout.write(nextVersion(current, mode, patchCount ?? 0) + '\n');
}
```

- [ ] **Step 4: Run it, confirm it PASSES**

Run: `npx vitest run test/ci/next-version.test.ts`
Expected: PASS (7 cases).

- [ ] **Step 5: Sanity-check the CLI**

Run: `node scripts/next-version.mjs 0.1.0 minor` → prints `0.2.0`;
`node scripts/next-version.mjs 1.4.0 patch 3` → prints `1.4.3`.

- [ ] **Step 6: Commit**

```bash
git add scripts/next-version.mjs test/ci/next-version.test.ts
git commit -m "feat(ci): pure next-version helper + tests"
```

---

## Task 2: Seed `VERSION.txt`, remove the old workflow

**Files:**
- Create: `VERSION.txt`
- Remove: `.github/workflows/build.yml`

- [ ] **Step 1: Seed `VERSION.txt`** with exactly `0.1.0` and a trailing newline:

```bash
printf '0.1.0\n' > VERSION.txt
cat VERSION.txt
```

- [ ] **Step 2: Remove the superseded workflow**

```bash
git rm .github/workflows/build.yml
```

- [ ] **Step 3: Commit**

```bash
git add VERSION.txt
git commit -m "chore(ci): seed VERSION.txt at 0.1.0; drop old build.yml"
```

---

## Task 3: `version.yml` — PR auto PATCH bump + build-validate

**Files:**
- Create: `.github/workflows/version.yml`

- [ ] **Step 1: Create `.github/workflows/version.yml`**

```yaml
name: pr-version-and-validate

on:
  pull_request:
    types: [opened, synchronize, reopened]
    branches: [main]

concurrency:
  group: pr-version-${{ github.event.pull_request.number }}
  cancel-in-progress: true

permissions:
  contents: write

jobs:
  version-and-build:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout PR head
        uses: actions/checkout@v4
        with:
          fetch-depth: 0
          ref: ${{ github.event.pull_request.head.ref }}

      - name: Fetch main
        run: git fetch origin main

      - name: Compute + commit PATCH bump
        # Skip on fork PRs: GITHUB_TOKEN is read-only there and can't push.
        if: github.event.pull_request.head.repo.full_name == github.repository
        run: |
          set -euo pipefail
          BASE=$(git show origin/main:VERSION.txt | tr -d '[:space:]')   # X.Y.0
          PATCH=$(git rev-list --count --invert-grep --grep='\[version-bump\]' origin/main..HEAD)
          NEXT=$(node scripts/next-version.mjs "$BASE" patch "$PATCH")   # -> X.Y.PATCH
          CUR=$(tr -d '[:space:]' < VERSION.txt 2>/dev/null || echo "")
          echo "current=$CUR next=$NEXT"
          if [ "$CUR" != "$NEXT" ]; then
            echo "$NEXT" > VERSION.txt
            git config user.name  "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git add VERSION.txt
            git commit -m "chore: set version $NEXT [version-bump] [skip ci]"
            git push origin "HEAD:${{ github.event.pull_request.head.ref }}"
          fi

      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3

      - name: Build both arches (validate, no push)
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: false
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Validate the YAML parses**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/version.yml','utf8')); console.log('version.yml OK')"
```
Expected: `version.yml OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/version.yml
git commit -m "feat(ci): PR workflow — auto PATCH bump + multi-arch build-validate"
```

---

## Task 4: `release.yml` — merge bump + multi-arch push

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

```yaml
name: release

on:
  pull_request:
    types: [closed]
    branches: [main]

concurrency:
  group: release
  cancel-in-progress: false

permissions:
  contents: write
  packages: write
  pull-requests: read

jobs:
  release:
    if: github.event.pull_request.merged == true
    runs-on: ubuntu-latest
    env:
      IS_MAJOR: ${{ contains(github.event.pull_request.labels.*.name, 'major') }}
    steps:
      - name: Checkout main
        uses: actions/checkout@v4
        with:
          ref: main
          fetch-depth: 0

      - name: Compute next release version
        id: ver
        run: |
          set -euo pipefail
          CUR=$(tr -d '[:space:]' < VERSION.txt)
          if [ "$IS_MAJOR" = "true" ]; then MODE=major; else MODE=minor; fi
          NEXT=$(node scripts/next-version.mjs "$CUR" "$MODE")
          IFS=. read -r MAJ MIN PAT <<< "$NEXT"
          {
            echo "next=$NEXT"
            echo "major=$MAJ"
            echo "minor=$MAJ.$MIN"
          } >> "$GITHUB_OUTPUT"
          echo "release $CUR -> $NEXT (mode=$MODE)"

      - name: Commit VERSION.txt + tag on main
        run: |
          set -euo pipefail
          NEXT="${{ steps.ver.outputs.next }}"
          echo "$NEXT" > VERSION.txt
          git config user.name  "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add VERSION.txt
          git commit -m "chore(release): v$NEXT [version-bump] [skip ci]"
          git tag -a "v$NEXT" -m "v$NEXT"
          git push origin HEAD:main
          git push origin "v$NEXT"

      - name: Image name (lowercased)
        id: img
        run: echo "name=ghcr.io/${GITHUB_REPOSITORY,,}" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-qemu-action@v3
      - uses: docker/setup-buildx-action@v3

      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - name: Build + push multi-arch with moving tags
        uses: docker/build-push-action@v6
        with:
          context: .
          platforms: linux/amd64,linux/arm64
          push: true
          tags: |
            ${{ steps.img.outputs.name }}:${{ steps.ver.outputs.next }}
            ${{ steps.img.outputs.name }}:${{ steps.ver.outputs.minor }}
            ${{ steps.img.outputs.name }}:${{ steps.ver.outputs.major }}
            ${{ steps.img.outputs.name }}:latest
          labels: |
            org.opencontainers.image.version=${{ steps.ver.outputs.next }}
            org.opencontainers.image.revision=${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
```

- [ ] **Step 2: Validate the YAML parses**

```bash
node -e "require('js-yaml').load(require('fs').readFileSync('.github/workflows/release.yml','utf8')); console.log('release.yml OK')"
```
Expected: `release.yml OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "feat(ci): release workflow — MINOR/MAJOR bump + multi-arch push to ghcr"
```

---

## Task 5: Document the required repo settings

**Files:**
- Create: `docs/ci-versioning.md`

A workflow cannot configure its own branch protection, so these are manual repo settings. The
doc must be accurate; the `gh` snippets are best-effort and the UI steps are authoritative.

- [ ] **Step 1: Create `docs/ci-versioning.md` with this content** (write the file with the
inner code fences intact; do not wrap it in an extra outer fence):

````markdown
# CI versioning & releases

Versioning is automated through `VERSION.txt` (a bare `MAJOR.MINOR.PATCH`):

- **PATCH** — bumped on every commit you push to a PR branch. `version.yml` writes
  `VERSION.txt` and pushes a `chore: set version … [version-bump]` commit, then builds both
  arches to validate (no push).
- **MINOR** — bumped when a PR is **squash-merged** to `main`. `release.yml` writes the new
  `VERSION.txt`, tags `vX.Y.0`, and pushes the multi-arch image.
- **MAJOR** — bumped only when the PR carries a **`major`** label at merge time → `(X+1).0.0`.

Released images are pushed to `ghcr.io/<owner>/<repo>` with four tags:
`X.Y.Z` (immutable) · `X.Y` (newest patch of that minor) · `X` (newest of that major) · `latest`.

```bash
docker pull ghcr.io/<owner>/<repo>:1        # newest 1.x
docker pull ghcr.io/<owner>/<repo>:1.4      # newest 1.4.x
docker pull ghcr.io/<owner>/<repo>:1.4.2    # pinned
```

## Required repo settings (one-time)

### 1. Merge method — squash only

GitHub → **Settings → General → Pull Requests**: enable **Allow squash merging**, disable
**merge commits** and **rebase merging**. Or:

```bash
gh api -X PATCH repos/<owner>/<repo> \
  -F allow_squash_merge=true -F allow_merge_commit=false -F allow_rebase_merge=false
```

### 2. Create the `major` label

```bash
gh label create major --color B60205 --description "Breaking change — bump MAJOR on merge"
```

### 3. Branch protection on `main`

GitHub → **Settings → Branches → Add branch ruleset** (or classic protection) for `main`:

- **Require a pull request before merging.**
- **Require status checks to pass** → add the **`version-and-build`** check.
- **Require branches to be up to date before merging** — this is the "rebase" rule: when `main`
  moves, the PR must be updated, which re-runs `version.yml` and recomputes the version against
  the new base.
- **Bypass list:** add **`github-actions[bot]`** (or the "GitHub Actions" app) so `release.yml`
  can push the version-bump commit + tag to protected `main` with the built-in `GITHUB_TOKEN`.

Classic-protection equivalent for the status check + up-to-date rule:

```bash
gh api -X PUT repos/<owner>/<repo>/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f 'required_status_checks[strict]=true' \
  -f 'required_status_checks[contexts][]=version-and-build' \
  -f 'enforce_admins=false' \
  -f 'required_pull_request_reviews[required_approving_review_count]=0' \
  -f 'restrictions='
```

> If your org forbids letting `github-actions[bot]` bypass protection, create a fine-grained PAT
> or GitHub App token with `contents: write`, store it as the secret `RELEASE_TOKEN`, and change
> the `actions/checkout` in `release.yml` to `with: { token: ${{ secrets.RELEASE_TOKEN }} }`.

## Notes

- **Fork PRs** skip the auto-bump (the token is read-only on forks) but still build-validate.
- The bump commits are pushed with the default `GITHUB_TOKEN`, whose commits do not trigger new
  workflow runs — so the auto-bump can't loop. `[skip ci]` and a bump-commit-excluding PATCH
  count are additional safeguards.
````

- [ ] **Step 2: Commit**

```bash
git add docs/ci-versioning.md
git commit -m "docs(ci): versioning scheme + required repo settings"
```

---

## Task 6: Verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit suite + version CLI**

Run: `npx vitest run`
Expected: all tests pass (existing 88 + the 7 new next-version cases).

Run: `node scripts/next-version.mjs 1.4.2 major` → `2.0.0`;
`node scripts/next-version.mjs 0.1.0 patch 2` → `0.1.2`.

- [ ] **Step 2: Both workflow YAMLs parse**

```bash
for f in .github/workflows/version.yml .github/workflows/release.yml; do
  node -e "require('js-yaml').load(require('fs').readFileSync('$f','utf8')); console.log('$f OK')"
done
```
Expected: both print `OK`.

- [ ] **Step 3: actionlint (if available — optional but preferred)**

```bash
command -v actionlint >/dev/null && actionlint || echo "actionlint not installed — skipping (CI/UI will validate)"
```
Expected: no errors, or the skip message.

- [ ] **Step 4: Confirm the build context is unaffected**

Run: `npm run build`
Expected: build completes (the app build is unchanged by this CI work).

- [ ] **Step 5: Manual post-merge checklist (document only — requires the repo settings from Task 5)**

After this plan merges and the repo settings are applied, verify on a throwaway PR:
1. Push a commit → a `chore: set version 0.1.1 [version-bump]` commit appears; `version-and-build` runs and stays green; no second run is triggered by the bump.
2. Push again → version becomes `0.1.2`. Merge another PR to `main` first, then "Update branch" → version recomputes against the new minor.
3. Squash-merge → `release.yml` runs: `main`'s `VERSION.txt` becomes `0.2.0`, tag `v0.2.0` exists, and `ghcr.io/<owner>/<repo>` has `0.2.0`, `0.2`, `0`, `latest`.
4. Open a PR with the `major` label, merge → version becomes `1.0.0` and tags `1.0.0/1.0/1/latest` are pushed.

- [ ] **Step 6: Commit any fixes** (skip if none)

```bash
git add -A && git commit -m "fix(ci): address issues found during verification"
```

---

## Notes for the implementer

- `next-version.mjs` holds ALL the version logic and is the only unit-tested piece; the
  workflows are thin git/buildx glue. Don't duplicate the math in YAML — call the script.
- `version.yml` pushes the bump with the default `GITHUB_TOKEN` on purpose (no loop). Do not
  switch it to a PAT, or the bump would re-trigger the workflow.
- `release.yml`'s push to protected `main` depends on the Task 5 bot-bypass setting; that's a
  documented repo setting, not something the workflow can self-apply.
- GHCR requires a lowercase image path — hence the `${GITHUB_REPOSITORY,,}` step.
- Workflows are only fully exercisable on GitHub; locally we verify the helper, YAML validity,
  and the app build. The Task 5 manual checklist covers the live behavior.
