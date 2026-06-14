# Automated SemVer + multi-arch GHCR publishing — Design

**Date:** 2026-06-14
**Status:** Approved (pending spec review)

## Summary

A GitHub Actions pipeline that builds the blog image for **linux/amd64 + linux/arm64**
and publishes it to **ghcr.io**, with fully automated simplified semantic versioning
maintained in a committed `VERSION.txt`:

- **PATCH** bumps on every (human) commit to a PR branch — written back as an automated commit.
- **MINOR** bumps when a PR is squash-merged to `main` (the release).
- **MAJOR** bumps only when a human applies a **`major`** label to the PR before merge.

PRs build both arches to validate (no push); merges to `main` push the release with moving
tags so consumers can pin to `X.Y.Z`, follow `X.Y`, follow `X`, or `latest`.

## Goals

- One multi-arch image, published to ghcr on release.
- Automated, conflict-free SemVer in `VERSION.txt` (the version of the current commit).
- Human-gated MAJOR via a PR label; automated MINOR (merge) and PATCH (per commit).
- PRs must be up to date with `main` ("rebase") before merge so versions stay in harmony.
- No infinite CI loops from the auto-commit.

## Non-goals

- No Conventional-Commits parsing or changelog generation.
- No pre-release/build-metadata suffixes (plain `MAJOR.MINOR.PATCH`).
- No pushing of PR/preview images (PRs build-only).
- Workflows do not configure their own branch protection — that's a documented repo setting.

## Key decisions

| Decision | Choice |
|---|---|
| MAJOR trigger | A `major` **label** on the PR (human-applied); on merge → `(X+1).0.0`. |
| PR images | Build both arches, **no push** (validation / required check). |
| Release images | Merge to `main` pushes versioned + moving tags. |
| Merge method | **Squash and merge** (keeps main history clean of preview-bump commits). |
| Version store | Committed `VERSION.txt` (bare `MAJOR.MINOR.PATCH`). |
| Loop safety | Bump pushed with default `GITHUB_TOKEN` (doesn't re-trigger workflows) + PATCH excludes bump commits + `[skip ci]`. |
| Release→main push | `github-actions[bot]` added to the branch-protection **bypass allowlist** (no PAT). |

## Version model

`VERSION.txt` contains a single line `MAJOR.MINOR.PATCH`, e.g. `0.1.0`. It is the version of
the current commit.

- **On `main`:** always `X.Y.0` (PATCH is a branch-only concept; the release workflow always
  writes `.0`). Seeded at `0.1.0`.
- **On a PR branch:** `X.Y.PATCH`, where `X.Y` is read from `main`'s `VERSION.txt` and
  `PATCH` = number of non-bump commits the branch is ahead of `main`.
- **Lifecycle example:** main `0.1.0` → PR commits preview as `0.1.1`, `0.1.2` → squash-merge
  (normal) → main `0.2.0`; the next PR previews `0.2.1`…; a `major`-labelled merge → `1.0.0`.

Rationale for previews on the *current* minor line (`X.Y.PATCH`) rather than the upcoming one:
it matches the literal rule "PATCH per branch commit, MINOR per merge", and since PR images are
not pushed, preview patch numbers never collide in the registry.

## Workflow 1 — `version.yml` (PR: auto PATCH bump + build-validate)

**Trigger:** `pull_request` (`opened`, `synchronize`, `reopened`) with base `main`.
**Permissions:** `contents: write`. **Concurrency:** group per-PR, cancel-in-progress.

Steps:
1. `actions/checkout` with `fetch-depth: 0` (full history) and the PR head; fetch `origin/main`.
2. Compute version:
   - `read X.Y` from `origin/main:VERSION.txt` (`git show origin/main:VERSION.txt`).
   - `PATCH = git rev-list --count --invert-grep --grep='\[version-bump\]' origin/main..HEAD`
     (commits ahead of main, excluding bump commits).
   - `next = X.Y.PATCH`.
3. If `VERSION.txt` (at HEAD) ≠ `next`: write it, then
   `git commit -m "chore: set version $next [version-bump] [skip ci]"` and
   `git push` to the PR branch using `GITHUB_TOKEN`.
4. Build both arches (`docker/build-push-action`, `platforms: linux/amd64,linux/arm64`,
   `push: false`) to validate. This job is the required status check.

**Loop safety:** the bump push uses the default `GITHUB_TOKEN`; commits it authors do **not**
trigger new workflow runs, so step 3 cannot re-trigger `version.yml`. Independently, `PATCH`
excludes `[version-bump]` commits, so the computation is idempotent (re-running yields the same
version → no-op), and `[skip ci]` is included as a third safeguard.

## Workflow 2 — `release.yml` (merge to main: MINOR/MAJOR bump + push)

**Trigger:** `pull_request` with `types: [closed]`, guarded by
`if: github.event.pull_request.merged == true && github.event.pull_request.base.ref == 'main'`.
**Permissions:** `contents: write`, `packages: write`, `pull-requests: read`.
**Concurrency:** group `release`, no cancel (serialize releases).

Steps:
1. `actions/checkout` `main` (`fetch-depth: 0`).
2. Read `X.Y.Z` from `VERSION.txt`.
3. Decide bump from labels:
   `contains(github.event.pull_request.labels.*.name, 'major')` → `MAJOR=X+1, MINOR=0, PATCH=0`;
   else → `MAJOR=X, MINOR=Y+1, PATCH=0`. Result `next = A.B.0`.
4. Write `VERSION.txt = next`; commit `chore(release): v$next [version-bump] [skip ci]` to
   `main`; create + push annotated tag `v$next`.
5. Login to ghcr (`docker/login-action`, `${{ github.actor }}` / `GITHUB_TOKEN`), build
   multi-arch and **push** with tags (computed in a step):
   - `ghcr.io/${{ github.repository }}:A.B.0`
   - `ghcr.io/${{ github.repository }}:A.B`
   - `ghcr.io/${{ github.repository }}:A`
   - `ghcr.io/${{ github.repository }}:latest`
6. Image is labelled `org.opencontainers.image.version=A.B.0` (build-arg/label).

`docker pull …:A` always resolves to the newest `A.*`, `…:A.B` to the newest `A.B.*`,
`…:A.B.0` is immutable, `latest` follows the most recent release.

## Rebase requirement & required repo settings

These are **repo settings** (a workflow can't set its own protection); documented in
`docs/ci-versioning.md` with `gh` CLI commands:

- **Merge method:** allow **squash only** (disable merge-commit + rebase-merge).
- **Branch protection on `main`:**
  - Require a pull request before merging.
  - **Require branches to be up to date before merging** — this is the "rebase" requirement:
    when `main` advances, the PR must be updated/rebased, which fires `synchronize` and makes
    `version.yml` recompute `X.Y` from the new base (keeping versions in harmony).
  - Require the `version.yml` build-validate check to pass.
  - **Allow `github-actions[bot]` to bypass** these rules, so `release.yml` can push the
    version-bump commit + tag to protected `main` with the default `GITHUB_TOKEN`.
    (Alternative: a `RELEASE_TOKEN` PAT/GitHub-App secret — documented as a fallback.)

## Files

- Create: `VERSION.txt` (seed `0.1.0`); `.github/workflows/version.yml`;
  `.github/workflows/release.yml`; `scripts/next-version.sh` (pure version math, unit-tested);
  `test/ci/next-version.test.ts` (or a bash test) for the version logic; `docs/ci-versioning.md`.
- Modify/replace: existing `.github/workflows/build.yml` (superseded → removed).
- Optional: `Dockerfile` ARG/LABEL for `org.opencontainers.image.version`.

## Testing

- **Unit:** `scripts/next-version.sh` is a pure function (`current`, `mode=patch|minor|major`,
  `patchCount` → next). Test: patch from `0.1.0` + count 3 → `0.1.3`; minor from `0.1.0` →
  `0.2.0`; major from `1.4.2` → `2.0.0`; minor from `1.4.0` → `1.5.0`. Run via Vitest (shelling
  out) or a `bats`-style bash check invoked from `npm test`.
- **Static:** `actionlint` over the workflow YAML (a CI lint step or local run).
- **Integration (manual, documented):** open a test PR → confirm the bump commit appears and the
  preview version increments per push and per rebase; merge → confirm `main` bumps MINOR, the
  tag is created, and the four image tags are pushed; add `major` label on a second PR → confirm
  MAJOR bump.

## Open questions / future work

- A `RELEASE_TOKEN` GitHub-App path if the org disallows bot bypass of protection.
- Cosign image signing / SBOM — out of scope for now.
- Changelog generation from PR titles — out of scope.
