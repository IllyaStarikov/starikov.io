# Sibling-repo dispatch handoff

`deploy.yml` already listens for `repository_dispatch: {types: [content-update]}`
(no changes needed there). What's missing is the *sender* side: a workflow in
each content-source repo that fires that event on push. `notify-site.yml` in
this directory is that sender, ready to copy into `bin` and `.dotfiles`.

**These are USER actions.** Creating a token, adding repo secrets, and
committing a workflow file to `bin`/`.dotfiles` all touch repos and
credentials outside this one -- none of it was done as part of this task.
The steps below are what to run.

## 1. Create the fine-grained PAT

Settings -> Developer settings -> Personal access tokens -> Fine-grained
tokens -> Generate new token.

- **Name:** `SITE_DISPATCH_TOKEN` (or similar -- the secret name in step 2
  is what actually matters, the token's own name is just for your own
  bookkeeping in the GitHub UI)
- **Resource owner:** IllyaStarikov
- **Repository access:** "Only select repositories" -> `starikov.io` only.
  Do **not** grant org/account-wide access -- the token only ever needs to
  hit one repo's dispatch endpoint.
- **Permissions:** verified against the [peter-evans/repository-dispatch
  README](https://github.com/peter-evans/repository-dispatch#token), which
  states fine-grained tokens need exactly:
  - `Contents: Read and write`
  - `Metadata: Read-only` (the README notes this "is automatically selected
    when selecting the contents permission" -- GitHub's UI adds it for you,
    no separate action needed)

  No other permission (`Actions`, `Administration`, `Pull requests`, etc.)
  is required or should be granted. This is the documented minimum scope,
  not a guess -- `repository_dispatch` is a REST write to the repo's
  contents-adjacent API surface, hence `Contents: write` rather than
  something more specific like an "Events" or "Dispatch" permission (GitHub
  doesn't expose one).
- **Expiration:** your call; fine-grained tokens support up to 1 year, or a
  custom date. A 1-year expiry with a calendar reminder to rotate is
  reasonable for a low-privilege token like this one.

Copy the generated token now -- GitHub only shows it once.

## 2. Add it as a secret to both sender repos

```sh
gh secret set SITE_DISPATCH_TOKEN --repo IllyaStarikov/bin
gh secret set SITE_DISPATCH_TOKEN --repo IllyaStarikov/.dotfiles
```

Each command prompts for the token value on stdin (or pipe it: `echo "$TOKEN" |
gh secret set SITE_DISPATCH_TOKEN --repo IllyaStarikov/bin`). Use the same
token value for both -- it's scoped to the `starikov.io` repo only, not to
the sender repo, so one token covers both senders.

**`academia` is skipped.** It's archived (`gh api repos/IllyaStarikov/academia
--jq .archived` -> `true`) -- archived repos are read-only and cannot run
Actions at all, so a sender workflow there would never fire regardless. Its
content is frozen; the existing nightly cron in `deploy.yml`
(`17 9 * * *`) already re-checks it once a day, which is the freshness
guarantee academia gets instead.

## 3. Copy `notify-site.yml` into each repo

```sh
mkdir -p /path/to/bin/.github/workflows
cp handoff/notify-site.yml /path/to/bin/.github/workflows/notify-site.yml

mkdir -p /path/to/.dotfiles/.github/workflows
cp handoff/notify-site.yml /path/to/.dotfiles/.github/workflows/notify-site.yml
```

Commit and push each on its own repo's `main` branch (both repos' default
branch is `main`, matching the `on: push: {branches: [main]}` trigger in the
file). The file needs no edits -- it's identical for both repos; the
`client-payload`'s `source` field reads `github.repository` from context, so
it self-identifies which repo sent the dispatch.

Note: GitHub only honors `repository_dispatch`-triggered workflows
(`deploy.yml` here) if they're committed to the *target* repo's default
branch -- that's already true for `starikov.io`/main, so nothing more is
needed on this side once `notify-site.yml` lands in the two sender repos.

## 4. End-to-end test

After both secrets are set and `notify-site.yml` is pushed to at least one
of `bin` or `.dotfiles`:

```sh
# In the sender repo (e.g. bin):
git commit --allow-empty -m "test: verify content-update dispatch" 
git push origin main

# Watch the sender's own Action run (should go green quickly -- it's just
# the one dispatch step):
gh run list -R IllyaStarikov/bin -L 1

# Then watch starikov.io pick it up. Expect a new "Deploy" run to appear
# within roughly a minute of the push above:
gh run list -R IllyaStarikov/starikov.io -L 1
```

What to expect:
- The sender repo's run shows a single job (`dispatch`) completing in a few
  seconds -- it only makes one API call.
- A **new** run appears at the top of `gh run list -R
  IllyaStarikov/starikov.io` with trigger reason `repository_dispatch`
  (visible via `gh run view <run-id> -R IllyaStarikov/starikov.io` or the
  Actions UI -- the run's event field reads `repository_dispatch` rather
  than `push`/`schedule`).
- That run runs the full `deploy.yml` pipeline (checkout, build, deploy) and
  should go green like any other deploy.

If the sender run fails at the dispatch step: the most likely causes are
a wrong/expired token, the secret not set on that repo, or a typo in
`repository:` (must be exactly `IllyaStarikov/starikov.io`). If the sender
run succeeds but no new starikov.io run appears within a couple of minutes,
check that `notify-site.yml` was actually pushed to the sender's default
branch (not a feature branch) and that the token's repository access was
scoped to `starikov.io`, not to the sender repo.

Once verified working on one sender repo, repeat for the other -- each is
independent (their own secret, own workflow file, own push history).
