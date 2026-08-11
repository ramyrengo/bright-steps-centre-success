# Milestone 1 — open follow-ups

**Raised:** 11 August 2026, 16:35 AEST, against commit `4d0de01` on
`milestone-1/foundation`.

Both issues in `MILESTONE_1_REVIEW.md` are closed and that file is historical.
These two items are new, are not regressions, and are the only things I would
resolve before Milestone 1 is presented for product-owner acceptance.

Verified state at `4d0de01`: 20 unit, 19 integration, and 3 frontend tests pass;
`npm run typecheck` is clean.

---

## F1 — Foundation CI has never executed

**Severity:** Medium

**Evidence:** `.github/workflows/foundation-ci.yml` was added in `4d0de01` and
no run exists, because the branch has not been pushed. The workflow is
well-formed — actions are SHA-pinned, `persist-credentials: false`, Node comes
from `.nvmrc`, the Encore CLI is pinned to 1.57.13 — but "CI quality/security
checks" is Milestone 1 **exit evidence** in `docs/MVP_BUILD_PLAN.md`, and an
unexecuted workflow is not evidence.

**Why it matters:** Two steps are the likely first failures, and neither can be
confirmed locally.

1. *Verify generated Encore client* (lines 84–87) runs
   `npm --prefix frontend run client:generate`, which resolves to
   `encore gen client --env=local --services=foundation`. Whether `--env=local`
   resolves on a runner with no local Encore environment, no linked app, and no
   authenticated CLI session is unproven. If it needs app linkage or auth, this
   step fails on every pull request.
2. *Verify repository consistency* (lines 89–92) ends with
   `git diff --exit-code`. Any step that legitimately rewrites a tracked file —
   `npm ci` touching a lockfile, `next typegen` emitting types, the client
   regeneration above — turns a clean run red.

**Acceptance:**
- Push the branch and let the workflow run to completion at least once.
- If `encore gen client --env=local` cannot run unauthenticated in CI, either
  replace the drift check with one that does not require the CLI (for example,
  regenerate only when an exposed API file changed, or compare against a
  checked-in contract hash), or document why the step is skipped.
- Confirm no step leaves the tree dirty, so `git diff --exit-code` fails only on
  genuine drift.
- Record the first green run as Milestone 1 exit evidence.

---

## F2 — `DEVELOPER_SETUP.md` PATH guidance selects Node 18 and breaks the backend suite

**Severity:** Medium — costs an hour and the error misdirects

**Evidence:** `docs/DEVELOPER_SETUP.md` line 21 instructs the developer to
correct the shell `PATH` so the Homebrew Encore CLI (1.57.13) is selected
instead of `~/.encore/bin/encore` (1.57.5). It does not say how, and the
obvious implementation is destructive:

```sh
export PATH="/opt/homebrew/bin:$PATH"   # fixes encore, breaks node
```

On the verification workstation `/opt/homebrew/bin/node` is **v18.20.8**, so
prepending that directory shadows the nvm-managed **v24.16.0** that `.nvmrc`
and the `engines` field require. Every backend test command then fails at
startup with:

```
SyntaxError: The requested module 'node:util'
does not provide an export named 'styleText'
```

`styleText` requires Node 20.12 or newer. The failure surfaces inside
`node_modules/rolldown/...`, so it reads as a broken dependency or a Vitest
incompatibility rather than as a PATH problem — the developer will debug the
wrong thing. The same shell still reports `node --version` as v24.16.0 if nvm
is re-sourced afterwards, which makes it harder still to spot.

**Reproduction:**

```sh
export PATH="/opt/homebrew/bin:$PATH"
npm run test:unit        # startup error, no tests run
```

Without that export, the same command passes 20 tests.

**Acceptance:**
- Replace the line 21 guidance with an approach that cannot shadow Node. Calling
  the CLI by absolute path is the least invasive:

  ```sh
  /opt/homebrew/bin/encore test --config vitest.integration.config.ts
  ```

  Appending rather than prepending Homebrew, or an `encore` shell alias, are
  equally acceptable; changing which Node is selected is not.
- State the symptom explicitly — a `styleText` export error means the wrong Node
  is selected, not a dependency fault — so the next person recognises it.
- Add a preflight check to the Tests section that fails loudly on mismatch:

  ```sh
  node --version   # must match .nvmrc (24.16.0)
  encore version   # must be 1.57.13
  ```

- Consider recommending `brew unlink node` on workstations that do not need the
  Homebrew Node, since it exists here only as a transitive dependency.

**Not affected:** CI. `.github/workflows/foundation-ci.yml` selects Node via
`node-version-file: .nvmrc` and installs Encore separately, so it never sees
this conflict. This is a local-workstation documentation defect only.
