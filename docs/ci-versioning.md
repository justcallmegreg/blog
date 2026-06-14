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

## Checking the running version

The engine serves its build provenance at **`GET /version`**. The version is baked in from
`VERSION.txt`, and the commit + build timestamp are injected at image build time (the commit
comes from the `SOURCE_COMMIT` build-arg, which `release.yml` sets to the released commit):

```bash
curl -s https://blog.example.com/version
# {"version":"1.4.0","commit":"<full-sha>","builtAt":"2026-06-14T08:50:20.952Z"}
```

## Notes

- **Fork PRs** skip the auto-bump (the token is read-only on forks) but still build-validate.
- The bump commits are pushed with the default `GITHUB_TOKEN`, whose commits do not trigger new
  workflow runs — so the auto-bump can't loop. `[skip ci]` and a bump-commit-excluding PATCH
  count are additional safeguards.
