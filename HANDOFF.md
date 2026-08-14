# Centre Success — Session Handoff

**Written:** 14 August 2026. **Revised** later the same day, after Centre Budgets and the operator ceremonies merged to `main`.
**Status:** No work in progress from this line of work. A concurrent session is live on `feature/budget-threshold-bands` — see §1.

---

## 1. Project

| | |
| --- | --- |
| **Project** | Bright Steps Centre Success — operational assurance platform for Bright Steps Academy, a multi-centre Australian early childhood provider |
| **`main`** | **`0ca654a`** — Centre Budgets, both operator ceremonies, and the independent review are all merged and on the main line |
| **Everything below is in `main`** | Nothing in this handoff is waiting on an unmerged branch any more. `feature/centre-budgets` and the three review branches are merged and deleted. |
| **Live work elsewhere** | `feature/budget-threshold-bands` — a **concurrent session** is actively committing migration 029 and the `foundation/centre-budgets/` threshold rules there. Do not check that branch out, reset it, or commit to it. |

**Stack:** Encore.ts + PostgreSQL modular monolith; Next.js/React/TypeScript frontend; Microsoft Entra ID authentication; PostgreSQL-owned authorisation.

### Worktrees (11 total, one shared Encore app id)

| Path suffix | Branch | State |
| --- | --- | --- |
| *(main)* | `main` | At `24f0bcc`, **stale**, and holds uncommitted governance docs — **do not touch, do not pull** |
| `-budgets` | `feature/budget-threshold-bands` | **A concurrent session is working here right now.** Leave it alone |
| `-form-builder-integration` | `integration/form-builder` | **WIP, gate FAILS.** See §4 |
| `-form-builder-{base,backend,ux}` | — | Synced, idle |
| `-standards-{backend,ux}`, `-4a-integration`, `-product`, `-production-readiness` | — | Idle |

> **All 11 worktrees share one Encore app id.** The shared local dev database is on migration **version 22** from a Centre Standards worktree, so `encore exec` fails against it. **DO NOT reset that database** — another session may be using it. Use an isolated Encore test database.

> **If you need a working tree, make one.** Both existing candidates are occupied: the `main` worktree has uncommitted governance docs, and `-budgets` has a live session in it. `git worktree add <dir> -b <branch> origin/main` is how the review work was done today, and it disturbed nobody. A docs-only change needs no `npm ci`; anything touching code does.

---

## 2. What we were trying to achieve

**Overall objective:** Claude took over as sole full-stack builder from a previous multi-agent/coordinator workflow. Build the full Centre Success product feature-by-feature. Build authority granted; **production-release authority NOT granted**.

**This session's arc:** finish the Form Builder integration → build Centre Budgets end to end → load the real organisation → start the Beresfield pilot → build the production first-administrator ceremony.

**Constraints given by the Product Owner:**
- Never invent regulatory requirements, thresholds, categories or compliance claims
- Backend contracts are authoritative; never build UI against an assumed contract
- Forward-only migrations; never reuse a number
- No production deploy, no push to `main`, no force-push, no secret exposure
- Do not weaken, skip or delete tests; fix root causes
- Unlock modules deliberately and sequentially; update governing docs as the roadmap progresses

---

## 3. Work completed this session

All of the below is merged to `main`, via **PR #14** (Centre Budgets and the ceremonies) and **PR #15** (the independent review and its fixes).

### Commits, oldest first

| Hash | Description |
| --- | --- |
| `f4f63ba` | Centre Budgets month position and portfolio read — backend domain, migrations 026/027, service, API, validation, tests |
| `cd5bca8` | Committed generated client; stripped blank JSDoc lines Encore mis-emits as trailing whitespace |
| `6348a24` | *(concurrent session)* Folded principal check into organisation resolution — removed a redundant query |
| `587b460` | Centre Budgets frontend — Director and Area Manager surfaces |
| `cb46a28` | Seeded approved categories; Budgets reachable from navigation |
| `dac1333` | Reviewed organisation reference load with a dry run |
| `ef4c2d4` | ADR-0021 D5 production first-administrator ceremony, with dry run |
| `bd22bf9` | Organisation load runnable in staging/production under a reviewed environment gate |
| `cf10c96` | **Independent review record**, and the first tests running the load and the ceremony in sequence |
| `dfc7626` | **R-1** — the ceremony takes `effective_from` from the database clock |
| `593abe8` | **R-3, R-4, R-5** — gate signature, capability collation, guarded rollbacks |
| `072961d` | **R-6** — one shared advisory lock for the two reviewed operator tools |

### Key files created

**Backend — Centre Budgets**
- `foundation/centre-budgets/` — `contracts.ts`, `service.ts`, `api.ts`, `position.ts`, `validation.ts` + 4 test files
- `foundation/migrations/026_centre_budget_capabilities.up.sql` — `budget.position.read`, `budget.actual.enter`
- `foundation/migrations/027_centre_budget_domain.up.sql` — `budget_categories`, `budget_threshold_policies`, `budget_threshold_bands`, `centre_budget_lines`
- `foundation/migrations/028_centre_budget_reporting_categories.up.sql` — seeds Supplies / Staff Engagement / Special Days

**Backend — organisation reference load**
- `foundation/organisation-reference/bright-steps-academy.ts` — approved dataset, frozen and typed
- `foundation/organisation-reference/organisation-load.ts` — idempotent planner/applier
- `scripts/load-bright-steps-organisation.ts` — `organisation:load:dry-run` / `organisation:load:apply`
- 2 test files (16 unit + 17 integration)

**Frontend — Centre Budgets**
- `frontend/src/app/(application)/budgets/page.tsx` — Area Manager portfolio
- `frontend/src/app/(application)/budgets/centres/[centreId]/page.tsx` — Centre Director
- `frontend/src/components/centre-budget-month.tsx`, `portfolio-budget-month.tsx`
- `frontend/src/lib/budget-values.ts` — exact-decimal helpers
- 2 test files (39 tests)

**Modified:** `foundation/authorization/capabilities.ts`, `roles.ts`, `foundation/navigation/workspace-links.ts`, `foundation/daily-success/service.ts` (capability map — prevents nav drift), `frontend/src/app/globals.css`, `frontend/src/lib/client.generated.ts`

### Generated client methods added
```
getCentreBudgetMonth(month, centreId)
getPortfolioBudgetMonth(month)
createCentreBudgetActual(month, centreId, params)
```

### Tests passing at `bd22bf9`
`npm run typecheck` ✅ · `test:unit` **367/367** ✅ · `test:integration` **248/248** ✅ · `git diff --check` ✅
Frontend at `587b460`: typecheck ✅ · **223 tests** ✅ · lint ✅ · build ✅

### Also produced (published artifacts, not in repo)
- Product mockup — `claude.ai/code/artifact/5e2fa1c3-b25f-4a37-9f78-07bb08c28107`
- Sequenced roadmap — `claude.ai/code/artifact/7b3bbbf9-70ee-44ec-b28e-ff9261f25c88`

---

## 4. Current state

### ✅ Working
- **Centre Budgets end to end** — backend, frontend, categories seeded, reachable from navigation
- **Organisation reference load tooling** — dry run verified, matches approved spec exactly
- **Both operator ceremonies independently reviewed**, all seven findings resolved — see below
- All gates green at `0ca654a`

### ✅ Independent review — DONE, and its findings are fixed

`docs/OPERATOR_CEREMONY_INDEPENDENT_REVIEW.md`. Read it before touching either ceremony; it is the record ADR-0021 asks for and it carries the reasoning behind several deliberate choices that look arbitrary in the code.

Six actionable findings, all closed. The one that mattered:

> **R-1.** The ceremony stamped `effective_from` from the **application** clock, and migration 017's reachability guard compared it against the **database** clock fixed at `BEGIN`. Two clocks, no margin — a database 2 ms behind, as measured locally, made the ceremony reach nobody and refuse `exactly_one_violated`. It failed closed, so nothing incorrect could commit; the cost was that an operator running a one-shot production ceremony would have read it as a serious invariant breach. `effective_from` now comes from `now()` inside the transaction.

**Two things to carry forward from that review, because they will recur:**

1. **R-1 was found only by running the two tools in sequence.** Each was fully green in isolation. The bug lived in the seam, and the test that exposed it was written to close a *coverage* finding, not to hunt a defect.
2. **Four of the six findings were invisible to the test suite by construction.** Pinned clocks hid R-1; a `C`-collation database hides R-4 and half of R-3; R-6 cannot be tested behaviourally at all, because `pg_advisory_xact_lock` blocks rather than fails, so a test would hang rather than fail. This subsystem attracts properties that no behavioural test can catch — which is why it uses structural source assertions, and why `dependencies.now` was **removed** rather than repointed. Do not add an injectable clock back; it restores exactly the blindness that hid R-1.

### ✅ D5 first-administrator ceremony — COMPLETE, reviewed, and fixed

Built, dry-run, reviewed, committed. **`--apply` has never been run outside an isolated test database.**

- `foundation/authentication/first-administrator-ceremony.ts` (~900 lines), `scripts/bootstrap-first-administrator.ts`, 2 test files (24 integration + 8 structural). No migration needed.
- npm scripts: `admin:bootstrap:dry-run` / `admin:bootstrap:apply`
- **Environment gate — verified, four locks plus one environment-independent property:** operator must name the environment and it must equal `appMeta()` exactly; apply confined to `["staging","production"]` (`local` deliberately absent, it has its own guarded bootstrap); types `ephemeral`/`test` can never apply; production requires `--confirm-production-first-administrator`, refused elsewhere; and it refuses if the organisation holds any principal. Also requires the operator `tid` to match the configured `EntraTenantId`.
- **Verified independently:** zero traces in `client.generated.ts`; `local-first-administrator-bootstrap.ts` and `local-identity-linker.ts` diff is **empty** — untouched.
- Proves exactly-one by counting inside the transaction, and issues `SET CONSTRAINTS ALL IMMEDIATE` so the `DEFERRABLE INITIALLY DEFERRED` last-administrator trigger actually fires during a rolled-back dry run. Without that, the rehearsal would have been weaker than it claimed.
- Audit events carry `actor_principal_id` **NULL** deliberately — the administrator is the subject, not the actor; recording them as actor would assert they granted themselves the role.
- Created administrator holds 11 canonical capabilities and is **denied** all business content, per ADR-0009. Asserted by test.

### ✅ Organisation load runnable in staging/production (`bd22bf9`)

The blocker the D5 agent found is resolved. `foundation/operations/reviewed-environment-gate.ts` now holds the shared gate used by **both** operator tools.

- **Local still works**, and is admitted only if the untouched `assertLocalDevelopmentEnvironment` also passes — **called, not copied**, so a cloud environment merely *named* `local` is refused. `--environment=local` is now required; the declaration is uniform rather than exempting local, because an exemption is the hole the gate exists to close.
- **Verified independently:** `first-administrator-ceremony.test.ts` diff since `ef4c2d4` is **empty**; `local-first-administrator-bootstrap.ts` and `local-identity-linker.ts` **untouched**.
- **Deferred-constraint finding, proven empirically:** migration 018's `people_admin_guard_validate_once` is `DEFERRABLE INITIALLY DEFERRED` and is reachable from this load via the ADR-0006 provisioning trigger. It would **never** fire in a rolled-back dry run, so `SET CONSTRAINTS ALL IMMEDIATE` is now issued here too. Without it the rehearsal was strictly weaker than the apply.
- The load deliberately leaves **zero reachable System Administrators** and says so in its own report — the D5 ceremony must run afterwards before any human can sign in.

### ❌ Not working / outstanding

**`integration/form-builder` at `9d099c6` — gate FAILS.** 11 TypeScript errors in `template-builder.test.tsx` and `template-builder-smoke.test.tsx`, plus uncommitted, **unreviewed** agent edits. Last green commit there is `c9ca7b2`. Task #5.

**Budget threshold bands NOT seeded.** Migration 027's schema cannot express the approved rules — five blockers, see §5. Needs migration 029.

**No people exist in the real organisation.** Blocked on the D5 ceremony. See §6.

### Temporary workarounds
- Evidence for the organisation load was produced against this worktree's isolated Encore test database, not the shared dev one (version mismatch, see §1).

---

## 5. Important decisions

### Product Owner decisions made this session — all approved, do not re-litigate

**Audit score bands** (from Karen, Area Manager; PO-confirmed org-wide):
- `≥ 80` meets standard (80 **inclusive**) · `70–79` needs attention (70 inclusive) · `< 70` escalation
- **Escalation is MANUAL.** The system makes the band visible; it notifies nobody and creates no task.

**Budget categories:** Supplies, Staff Engagement, Special Days — org-wide, seeded in migration 028.

**Budget threshold bands — TWO SEPARATE RULES, must not be merged:**
- *Rule A, budget used:* `>100%` red · `85–100%` amber · `<85%` green
- *Rule B, remaining:* `<0` red · `0 to <10% of approved` amber · `≥10%` green
- **Rule B is proportional, not a flat dollar figure.** $50 left is fine on $2,000 and alarming on $200.

**Organisation:** 12 trading centres. `organisations.default_timezone = Australia/Sydney`. Effective date `2026-01-01` for everything — **a seeding convention, NOT a real opening or appointment date.**

| State | Centres | Timezone |
| --- | --- | --- |
| NSW | Beresfield, Calala | `Australia/Sydney` |
| ACT | Macgregor | `Australia/Sydney` |
| VIC | Bentleigh, Chelsea, Clifton Hill, Horsham | `Australia/Melbourne` |
| SA | Blair Athol, Elizabeth East, Elizabeth North \| Woodford Rd | `Australia/Adelaide` |
| WA | Kwinana, Mandurah | `Australia/Perth` |

**DO NOT seed** the 8 non-trading sites: Bellbird, Bundoora, Dubbo, Elizabeth North | Laverstock Rd, Elizabeth Vale, Frankston, Inverell, Lalor.

**People and packages** (names/emails are operator input at invitation time; deliberately NOT in the repo):

| Person | Assignment | Scope | Class |
| --- | --- | --- | --- |
| Bronwyn Sterry (CEO) | `compliance_manager` **single** | organisation | PRIVILEGED |
| Katie Bridges | `compliance_manager` | organisation | PRIVILEGED |
| Helena | `area_manager` + `operations_leadership` | Beresfield, Calala, Macgregor / org | PRIVILEGED |
| Karen | `area_manager` | Bentleigh, Chelsea, Clifton Hill, Horsham | STANDARD |
| Tegan | `area_manager` | Blair Athol, Elizabeth East, Elizabeth North \| Woodford Rd | STANDARD |
| Rebekah | `area_manager` | Kwinana, Mandurah | STANDARD |
| Hannah | `centre_director` | Beresfield | STANDARD |
| Ramy | System Administrator (first administrator) | organisation | — |

- Bronwyn's organisation-read is **subsumed** by `compliance_manager` — do NOT create a second assignment.
- `package-policy.ts` rejects organisational-unit scope for `area_manager` — portfolios are explicit centre lists.
- Hannah uses a standalone licensed role account (`management.beresfield@…`), confirmed not a shared mailbox.

**Pilot:** Beresfield, **STAGING first** (a rehearsal, not the system of record — Hannah keeps her existing process).

**Impersonation REJECTED.** The Product Owner asked for an "act as anyone" button; it was declined and replaced with read-only diagnostics (task #13). Reason: it would break independent verification (remediator ≠ verifier is compared by principal ID) and remove the property that makes the System Administrator role safe. Break-glass stays deferred under ADR-0009.

### MUST NOT be changed

1. **Unknown is not zero.** A value that was never recorded must never render as zero, empty, green, or "on budget". Enforced by **omitting fields**, never defaulting them. Migration 027 states it in schema comments. This is the product's defining invariant.
2. **Local-only bootstrap guards.** `local-first-administrator-bootstrap.ts` and `local-identity-linker.ts` must keep refusing every non-local environment. Widening them is forbidden — the D5 ceremony is a *separate* path.
3. **Append-only budget facts.** Migration 027's trigger (`centre budget facts are append-only`) must not be dropped, cascaded around, or bypassed in tests.
4. **Backend contracts are authoritative.** Never invent an endpoint to satisfy a frontend assumption. A route was added and then withdrawn this session for exactly this reason.
5. **Money is exact.** `NUMERIC(14,2)` in SQL, decimal **strings** across the API. Never `Number()`, `parseFloat` or `toFixed` on a monetary value.
6. **System Administrator holds no business-content capability** (ADR-0009). This is what makes the bootstrap ceremony safe.

### Correction to existing docs
**ADR-0013 overstates independent verification as database-enforced. It is not.** The remediator ≠ verifier comparison is application code at `foundation/quarterly-reviews/service.ts:1392` and ~1447. The database provides supporting layers only (flag re-derived under `FOR UPDATE`; migration 015 prevents configuring critical outcomes as self-verifiable). A direct `UPDATE` setting the submitter as verifier **would succeed**. Amend the ADR.

### Environment traps that cost time this session
- **Node:** default is **v18.20.8**, below the engine floor. `.nvmrc` pins **24.16.0**. Always: `export PATH="/Users/ramymorkos/.nvm/versions/node/v24.16.0/bin:/opt/homebrew/bin:$PATH"` and verify with `node --version`.
- **git merge** needs `--no-autostash` in this repo. `-c merge.autostash=false` does **not** work and dies with `fatal: stash failed`.
- **Encore JSDoc:** a blank ` *` line inside an exported type's JSDoc becomes ` * ` (trailing space) in the generated client and fails `git diff --check`. **Fix at source in the contract comments, never in the generated file.** Hit three times.

---

## 6. Exact next steps

> **The independent review is DONE** and its six findings are fixed — see §4. What used to be step 1 here is no longer engineering work. **The critical path is now blocked on operator steps, not on code.**

1. **Establish how `encore exec` reaches a deployed environment.** This is now the first real blocker, and it is operator work rather than engineering. Both `admin:bootstrap:*` and `organisation:load:*` mirror the same invocation shape and share the same open question. Also confirm `appMeta().environment.name` is literally `staging` / `production` there — the gate matches **exactly**, so a name like `stg` refuses. Nothing on the critical path can move until this is answered.

2. **Decide whether an AI-performed review discharges ADR-0021's requirement.** `docs/OPERATOR_CEREMONY_INDEPENDENT_REVIEW.md` says plainly that it was written by an AI assistant that did not write the code, and deliberately does **not** assume this satisfies the record. If a human reviewer is intended, that review is still outstanding. ADR-0021 also asks for independent review *of the record itself*, which nothing has addressed.

3. **Migration 029 for budget threshold bands.** ⚠️ **A concurrent session is already building this** on `feature/budget-threshold-bands`. Check that branch before starting; do not duplicate it. 027 cannot express the approved rules — five blockers:
   - No column for Rule B (remaining as a proportion of approved)
   - Rule B ≠ Rule A restated — they invert at negative approved budgets
   - `[min, max)` bounds cannot express "100 inclusive, red strictly above"
   - Read path resolves `ORDER BY priority LIMIT 1` — only one band displayable, forcing the merge the PO forbade
   - `approved_by_principal_id` needs a runtime principal a migration does not have
   Needs: a rule discriminator, proportional bounds, inclusive/exclusive flags, and approval attribution without a runtime principal. Then a contract carrying **one outcome per rule**.

4. **Close Phase A** (task #5) in `../bright-steps-centre-success-form-builder-integration`: review the unreviewed diff, fix 11 fixture errors, full gate, commit.

5. **Task #13** — administrator support diagnostics (effective-permissions view, audit-trail read, access fix). Sequenced after D5.

6. **Karen's 223 scanned audit pages** → template configuration. Requires `brew install poppler` first (they are images, not text). At `/Users/ramymorkos/Desktop/Area Manager Audits[86].pdf`.

7. **Beresfield pilot** (task #11) — blocked until people exist.

**See tasks #5–#13 in the task list.** They carry every decision with reasoning.

> **Task-list drift — trust this handoff over the task states.** #1 still reads *in-progress* but its work is superseded. #10 and #12 predate the organisation-reference tooling and are now largely delivered by `dac1333` + `bd22bf9`; what remains of them is the human operator sequence in §6, not engineering.

---

## 7. Verification — run these FIRST

```bash
export PATH="/Users/ramymorkos/.nvm/versions/node/v24.16.0/bin:/opt/homebrew/bin:$PATH"
node --version   # MUST be v24.16.0

# Do NOT run these in the -budgets worktree: a concurrent session is working
# there. Make your own worktree off main first.
git -C /Users/ramymorkos/Documents/Claude/bright-steps-centre-success-budgets worktree \
  add /tmp/cs-verify --detach origin/main
cd /tmp/cs-verify
git log --oneline -1                 # expect 0ca654a or later
git worktree list                    # 11 before yours

docker info >/dev/null 2>&1 && echo DOCKER_OK || echo DOCKER_DOWN

npm ci                               # a fresh worktree has no node_modules
npm run typecheck
npm run test:unit                    # 373 expected at 0ca654a
npm run test:integration             # 251 expected at 0ca654a
npm --prefix frontend run typecheck
npm --prefix frontend test           # 223 expected
npm --prefix frontend run lint
npm --prefix frontend run build
git diff --check
```

If counts are **below** those numbers, something regressed. `0ca654a` is the known-good commit.

> **Known flake, not hidden:** the timeouts in `people-access.integration.test.ts` are pre-existing and unmodified. Two different tests in that file have now timed out on a cold run and passed on every subsequent one — *"recovers stale dispatch claims"* and *"keeps proposals outside active grants…"*. Treat a single timeout in that file as noise; treat two consecutive as real.

---

## 8. Safety

- **No secrets are in this repository.** No credential value appears in this handoff.
- **Files that reference secrets by NAME only** (never values): `foundation/**` via Encore `secret()` — `EntraTenantId`, `EntraApiClientId`, `EntraWebClientId`, `InvitationTokenDigestKey`, `InvitationDeliveryEncryptionKey`, `InvitationPublicBaseUrl`, `MicrosoftGraphClientSecret`. Configured in Encore Cloud, not in code. `.github/scripts/secret-configuration-guard.mjs` checks presence, never values.
- **Real personal data:** staff names and email addresses were given verbally and are deliberately **NOT committed**. They are operator input at invitation time. Keep it that way.
- **Do not reset, stash, discard or overwrite** any worktree's uncommitted work. The `main` worktree has uncommitted governance docs; `-form-builder-integration` has unreviewed edits; **`-budgets` has a concurrent session actively committing to it**. All three are deliberate.
- **Check `git status` immediately before any destructive git operation, and never use `reset --hard` in a shared worktree.** During today's review, two tracked files appeared in `-budgets` within a minute of a clean status — a `reset --hard` would have destroyed another session's uncommitted work. `reset --mixed` followed by `git restore` on named paths does the same job without touching anything else.
- **Do not reset the shared local Encore database.** Eleven worktrees share one app id.
- Real staff data in **staging is still real personal data** — access control, retention and deletion apply.

---

## 9. Unresolved — needs Product Owner decision

1. **State unit display names** — currently `NSW`, `ACT`, `VIC`, `SA`, `WA` rather than expanded names. Will look sparse in a UI. Five-second decision.
2. **Credential expiry** (task #7) — which credentials, renewal intervals, warning windows. Nothing can be built without these.
3. **Notifications** (roadmap step 7) — what escalates, to whom, how loudly. Currently nothing notifies anyone of anything.
4. **Shared-device sign-in** — classroom tablets pass between educators all day; the flow assumes a personal device. **Blocks the entire Educator experience.**
5. **Currency** — no currency approved anywhere. Budget figures render the ISO code the record carries, or plainly if none.
6. **Period grain** — Budgets assumes monthly. The source says "financial period" against an organisation calendar and leaves the calendar open.
7. ~~Production vs staging for the real organisation load~~ — **resolved.** `--apply` reaches staging and production under the shared reviewed environment gate, since `bd22bf9`.
8. **Does an AI-performed review discharge ADR-0021's independent-review requirement?** The review is written and its findings are fixed, but the record does not assume it satisfies the ADR. If a human reviewer is intended, that is still outstanding — as is ADR-0021's separate ask for independent review *of the record itself*.
9. **How `encore exec` reaches a deployed environment**, and whether that deployment reports its name as exactly `staging` / `production`. Now the first blocker on the critical path.

### The critical path, stated plainly

**Nobody can use any of this until:** D5 ceremony built → first administrator created → **second** administrator created (Bronwyn, Katie and Helena all classify PRIVILEGED and need an independent approver) → six invitations → each person signs in with a verified Entra identity. Hannah's pilot invitation sits behind all of it.

**What changed today:** the first link is now built, reviewed and fixed, and the organisation load that has to precede it can reach a deployed environment. **Everything still outstanding on this path is operator work or a Product Owner decision — none of it is engineering.** Neither ceremony has ever run against a real deployment; their staging and production paths are proven by integration tests that simulate those environments, which is not the same as having run.

---

## 10. Resume prompt

> Continue Bright Steps Centre Success as lead full-stack engineer.
>
> Read `HANDOFF.md` in the repository root first — it is on `main` — then `docs/OPERATOR_CEREMONY_INDEPENDENT_REVIEW.md`, then the task list. Tasks #5–#13 carry Product Owner decisions with their reasoning, but **trust the handoff over the task states**; several are stale.
>
> **Before anything else:** `export PATH="/Users/ramymorkos/.nvm/versions/node/v24.16.0/bin:/opt/homebrew/bin:$PATH"` and confirm `node --version` is v24.16.0. The default v18 is below this repo's engine floor and results obtained under it are meaningless.
>
> **Do not work in an existing worktree.** The `main` one holds uncommitted governance docs and the `-budgets` one has a concurrent session live in it. Make your own with `git worktree add <dir> -b <branch> origin/main`.
>
> `main` is at `0ca654a`. Centre Budgets, both operator ceremonies, and an independent review of those ceremonies with all six of its findings fixed, are merged. **Neither ceremony has ever been run against a real deployment** — their staging and production paths are proven only by integration tests that simulate those environments.
>
> The critical path to real users is no longer blocked on engineering. Its first blocker is operator work: establish how `encore exec` reaches a deployed environment, and confirm that deployment reports its name as exactly `staging` or `production` — the gate matches exactly, so `stg` refuses. Ask me about that before assuming an answer.
>
> Engineering work available in the meantime, in order: (1) close Phase A in the form-builder-integration worktree — 11 fixture errors plus an unreviewed diff; (2) task #13, administrator support diagnostics. **Migration 029 for the budget threshold bands is already being built by a concurrent session on `feature/budget-threshold-bands`** — check before starting it.
>
> Do not run either ceremony's `--apply` against a deployed environment. Do not re-introduce an injectable clock into the first-administrator ceremony; `dependencies.now` was removed deliberately, and the review record says why.
>
> Do not invent regulatory requirements, thresholds, categories or currencies. Do not weaken tests to make a gate pass. Do not push to `main`, merge to `main`, or reset any worktree without asking. Ask me before assuming any unresolved item in HANDOFF §9.
