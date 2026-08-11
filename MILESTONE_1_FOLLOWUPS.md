# Milestone 1 — open follow-ups

> **STATUS: REMEDIATED**
>
> The findings in this document were addressed before Milestone 1 acceptance.
> Milestone 1 was subsequently accepted and merged through pull request #1 with
> Foundation CI green on `main`. The original findings remain below as
> engineering history.

**Raised:** 11 August 2026, 16:35 AEST. **Updated:** 17:00 AEST against
`9360de8` on `milestone-1/foundation`, after the first CI run.

All twelve issues in `MILESTONE_1_REVIEW.md` are closed and that file is
historical. These two items are new and are not regressions. They are the only
things I would resolve before Milestone 1 is presented for product-owner
acceptance.

F1 was raised as a prediction and is now **confirmed** — Foundation CI ran on
pull request #1 and failed. The evidence below is the actual failure, not the
anticipated one.

Verified locally at `9360de8`: 20 unit, 19 integration, and 3 frontend tests
pass; `npm run typecheck` is clean. The CI failure is environmental — the Encore
CLI is unauthenticated on the runner — and does not indicate a code defect.

---

## F1 — Foundation CI fails: the Encore CLI is unauthenticated on the runner

**Severity:** High — CI is red on every pull request

**Status:** Confirmed by [run 31466996792][run] on pull request #1, which failed
in 34 seconds.

**Evidence:** The *Encore database integration tests* step runs
`npm run test:integration`, which resolves to
`encore test --config vitest.integration.config.ts`. It exits 1 with:

```
error: fetch secrets for bright-steps-centre-success-uwhi:
GET /apps/bright-steps-centre-success-uwhi/secrets:values?kind=development:
not logged in: run 'encore auth login' first
```

Everything before it passes — checkout, Node from `.nvmrc`, both lockfile
installs, Encore CLI 1.57.13, toolchain verification, backend typecheck, and the
20 pure authorization tests. The failure is environmental, not a code defect.

**Why it happens:** `encore.app` carries the App ID
`bright-steps-centre-success-uwhi`, so the CLI treats the application as linked
to Encore Cloud and fetches development secrets before running tests. On a CI
runner there is no authenticated session, so the fetch fails and the command
aborts. Milestone 1 defines no secrets — the fetch is incidental to the app
being linked, not to anything the tests need.

**Do not "fix" this by unlinking the app or changing the App ID.**
`docs/DEVELOPER_SETUP.md` line 21 already prohibits that, and
`docs/FOUNDATION_DECISIONS.md` requires the existing Encore application, App ID,
and Cloud connection be preserved.

**Acceptance:**
- Create an Encore auth key for CI and store it as the repository secret
  `ENCORE_AUTH_KEY`. Authenticate after the CLI install step and before any
  `encore` invocation:

  ```yaml
  - name: Authenticate Encore CLI
    run: encore auth login --auth-key="$ENCORE_AUTH_KEY"
    env:
      ENCORE_AUTH_KEY: ${{ secrets.ENCORE_AUTH_KEY }}
  ```

  `encore auth login --auth-key=<KEY>` is supported by CLI 1.57.13 — verified
  against `encore auth login --help`.
- The workflow currently declares `permissions: contents: read`, which does not
  cover secret access patterns beyond the default; confirm the secret resolves
  on a pull-request trigger. Note that `secrets` are **not** available to
  `pull_request` runs from forks, so if outside contributors are ever expected,
  this step needs a `pull_request_target` or self-hosted strategy instead.
- Consider whether the integration step should degrade gracefully rather than
  hard-fail when no auth key is configured, so a fork PR reports "integration
  tests skipped" instead of a red build.

**Still unproven:** the four steps after the failure never ran. In particular
*Verify generated Encore client* (lines 84–87) invokes
`encore gen client --env=local`, which may hit the same authentication path, and
*Verify repository consistency* (lines 89–92) ends with `git diff --exit-code`,
which turns red if any earlier step rewrites a tracked file. Both need a green
run before Milestone 1 can claim CI as exit evidence.

[run]: https://github.com/ramyrengo/bright-steps-centre-success/actions/runs/31466996792

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
