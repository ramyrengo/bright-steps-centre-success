# Milestone 1 foundation — gap review

**Reviewed:** 11 August 2026, 15:20 AEST, against the working tree on `milestone-1/foundation` (uncommitted).
**Scope of review:** the Milestone 1 exit criteria in `docs/MVP_BUILD_PLAN.md`, the approved constraints in `docs/FOUNDATION_DECISIONS.md`, the authorisation requirements in `docs/PERMISSIONS.md`, and the invariants in `AGENTS.md` — checked against `foundation/`, `frontend/`, `encore.app`, and the migration set.

The repository was being actively modified during the review. Migrations `003`–`005` and `foundation/authorization/role-assignment-schema.test.ts` landed mid-review and are accounted for below. Items already resolved are listed at the end.

**This file is a transient review artifact.** Delete it once the issues are closed or triaged; it is deliberately not added to the `README.md` documentation map.

---

## What is correct

The Milestone 1 boundary is respected. No authentication handler, no protected business endpoint, no client-supplied identity, no temporary login. `encore.app` permits only uncredentialed `http://localhost:3000`. The health endpoint returns no organisation, centre, or principal data.

The policy core is sound: `authorise()` requires a **single** assignment to supply both the capability and a matching scope, which correctly prevents capability/scope recombination across assignments (`docs/FOUNDATION_DECISIONS.md` line 35). Ambiguous membership denies. Effective-dating is applied to both memberships and assignments. Audit events are append-only at the database level, not merely by convention. Backend typecheck passes clean.

---

## Issues

### H1 — Nothing loads a `PrincipalAuthorisationContext` from the database

**Severity:** High
**Evidence:** `PrincipalAuthorisationContext` appears only in `foundation/authorization/policy.ts` (definition) and `foundation/authorization/policy.test.ts` (hand-built literals). No repository, query, or mapping function reads `principals`, `organisation_memberships`, `role_assignments`, `role_definitions`, `role_capabilities`, or `assignment_scopes` into it.

**Why it matters:** The schema half and the policy half are each individually correct and have never been introduced to each other. Milestone 1's stated goal is to "prove tenant and centre isolation before adding sensitive workflows" (`docs/MVP_BUILD_PLAN.md` line 63) — currently that is proven against fixtures, not against the tables that will feed it in Milestone 2. The exit criterion "no business module can bypass the authorisation interface" (line 74) has no interface to bypass.

**Acceptance:**
- A module-internal function that, given a principal ID and a resolved resource, loads current memberships, active assignments, their capabilities (via `role_capabilities`), and their scopes (via `assignment_scopes`) from the database and returns a `PrincipalAuthorisationContext`.
- It must not accept organisation, centre, role, or capability from any caller-supplied argument other than an opaque principal identifier and the resource identity.
- Tests that seed synthetic rows, load through this function, and assert the same allow/deny matrix that `policy.test.ts` currently asserts on literals.
- No new exposed API. This is an internal seam only, consistent with the Milestone 1 boundary.

---

### H2 — `scopeMatches` assumes a pre-flattened ancestor list; nested units will silently deny

**Severity:** High (latent — will surface the moment H1 is implemented)
**Evidence:** `foundation/authorization/policy.ts` line 127 matches an `organisational_unit` scope against a centre with `resource.organisationalUnitIds.includes(scope.organisationalUnitId)` — an exact membership test on a caller-supplied array. `organisational_units` supports arbitrary nesting via `parent_id` with kinds `state`, `region`, `centre_group` (`001_foundation.up.sql` lines 12–31).

**Why it matters:** An assignment scoped to a **state** unit will *not* match a centre whose `organisationalUnitIds` contains only its region, unless the caller flattens every ancestor into that array. The requirement exists only as prose in a doc comment ("The resource and its effective hierarchy IDs must be resolved by the backend"). It is not enforced by the type system, not implemented anywhere, and has no test. This is the most likely way a future loader introduces a silent authorisation bug — and the failure mode is over-denial in test but potentially under-denial if someone "fixes" it by widening the match.

**Acceptance:**
- A test with a genuine `state → region → centre` chain proving a state-scoped assignment reaches a centre nested two levels below it.
- Either the resource type documents and enforces that `organisationalUnitIds` is the full effective ancestor closure (rename to something like `effectiveOrganisationalUnitIds` and construct it only in the H1 loader), or `scopeMatches` walks the hierarchy itself.
- A negative test proving a sibling branch (e.g. VIC region under a NSW-scoped assignment) is denied.

---

### H3 — The canonical role bundles exist only as a test fixture

**Severity:** High
**Evidence:** `role_definitions` and `role_capabilities` are created by `001_foundation.up.sql` and never populated. The approved nine-role → capability mapping lives in the `roleBundles` object at `foundation/authorization/policy.test.ts` line 26. `role-assignment-schema.test.ts` inserts throwaway `synthetic_<uuid>` role keys, confirming no canonical roles exist in data.

**Why it matters:** `docs/FOUNDATION_DECISIONS.md` line 31 states "Roles are data-driven bundles" and lines 37–49 fix the nine canonical roles as an approved baseline that may only change by documented decision. The tables are data-driven; the approved baseline is not represented as data anywhere in the repository. Codex added `capabilities.test.ts` to prevent drift between the TypeScript capability enum and the `capabilities` table — there is no equivalent guard for roles, because there is nothing to guard against.

**Note:** `docs/DEVELOPER_SETUP.md` line 101 states the repository contains no development seed. If keeping role definitions out of data is deliberate, that is a legitimate position — but it needs to be a recorded decision (see M7), because it means the approved role baseline is currently unverifiable and duplicated in a test file.

**Acceptance — pick one and record it:**
- *(a)* Seed the nine canonical `role_definitions` and their `role_capabilities` in a migration, have `policy.test.ts` derive `roleBundles` from that source rather than redeclaring it, and add a drift test mirroring `capabilities.test.ts`; **or**
- *(b)* Record an explicit decision that canonical roles are configuration supplied per environment rather than seeded data, state where the authoritative definition lives, and add a test asserting the documented bundles match whatever that source is.

---

### M4 — Effective-dated centre/unit membership is never resolved or tested

**Severity:** Medium
**Evidence:** `centre_organisational_unit_memberships` carries `effective_from` / `effective_to` (`001_foundation.up.sql` lines 48–61) and has supporting indexes. No code reads the table. No test exercises date filtering on it.

**Why it matters:** `docs/PERMISSIONS.md` line 116 requires that "Area Manager access derives from effective-dated centre assignments, not from a client-provided region filter," and line 117 that "Moving a centre changes future portfolio access promptly; historical audit authorship remains." `docs/FOUNDATION_DECISIONS.md` line 58 requires Area Manager allow/deny on *effective-dated* assigned centres. The rule is documented and modelled but not implemented — and `policy.test.ts`'s Area Manager test uses direct centre scopes, which does not exercise it.

**Acceptance:** Resolution of a centre's effective units at a given instant (naturally part of H1's loader), plus a test proving that a centre moved out of a unit is denied *after* the move date and allowed for an `at` timestamp before it.

---

### M5 — `RecordAuditEventInput` does not express the invariants migration 003 now enforces

**Severity:** Medium
**Evidence:** `003_system_audit_scope_integrity.up.sql` requires that `scope_type = 'system'` has **no** `organisation_id` and **no** `scope_id`, and that every non-system scope has **both**. `RecordAuditEventInput` in `foundation/audit/events.ts` lines 13–24 declares `organisationId?`, `scopeId?` and `scopeType` as independent optional fields.

**Why it matters:** Both `recordAuditEvent({ action, resourceType, scopeType: "centre" })` and `recordAuditEvent({ ..., scopeType: "system", organisationId })` compile cleanly and fail at runtime inside a database trigger. A database constraint is the right last line of defence, but the TypeScript API should make the invalid states unrepresentable rather than discovering them in production. `foundation/audit/events.test.ts` predates migration 003 and does not cover the new trigger paths.

**Acceptance:** Make `RecordAuditEventInput` a discriminated union on `scopeType` — the `system` variant forbidding `organisationId`/`scopeId`, the tenant variants requiring both. Add tests for the trigger's rejection paths (system-with-org, tenant-without-scope, cross-organisation scope ID, cross-organisation actor).

---

### M6 — No CI pipeline

**Severity:** Medium
**Evidence:** No `.github/`, and no other CI configuration anywhere in the repository.

**Why it matters:** `docs/MVP_BUILD_PLAN.md` line 71 names "CI quality/security checks and controlled deployment path" as Milestone 1 **exit evidence**. `docs/DEVELOPER_SETUP.md` lines 62–81 document the right commands (`npm run typecheck`, `encore test`, `npm audit`, frontend `lint`/`typecheck`/`build`/`audit`) but nothing enforces them, so the milestone cannot be evidenced as passing on any commit.

**Acceptance:** A pipeline running exactly the documented backend and frontend gates on pull request, including the `npm audit` steps, with the Encore CLI version pinned to match `docs/DEVELOPER_SETUP.md`. The "controlled deployment path" half may be recorded as a deferred decision if Encore Cloud's GitHub integration covers it — but state which.

---

### M7 — No architecture decision records

**Severity:** Medium
**Evidence:** `docs/` contains no ADR directory or per-decision records. `docs/FOUNDATION_DECISIONS.md` records approved constraints and lists deferrals at lines 93–100.

**Why it matters:** `docs/MVP_BUILD_PLAN.md` line 69 names "architecture decision records for open foundation decisions" as the first item of Milestone 1 exit evidence. `AGENTS.md` line 41 requires unresolved business decisions be recorded as explicit open decisions. `FOUNDATION_DECISIONS.md` is a good summary of what was *decided*, but the open items (identity provider, session/MFA model, hierarchy nesting, break-glass, production CORS) have no record carrying context, options considered, status, and consequences.

**Acceptance:** One short record per open foundation decision, with status (`open` / `deferred` / `accepted`), the constraint it imposes on Milestone 1, and what would unblock it. H3's choice and M6's deployment-path decision should each get one.

---

### L8 — The audit module has no production caller

**Severity:** Low
**Evidence:** `recordAuditEvent` is referenced only by `foundation/audit/events.ts` (definition) and its own test. Notably, `events.test.ts` line 8 uses the action name `foundation.health.checked` — but `foundation/api.ts` never records it.

**Why it matters:** `AGENTS.md` invariant 8 makes auditability part of each write path. There are no write paths in Milestone 1, so this is not a violation — but the audit seam has never been exercised by a real operation, and `docs/PERMISSIONS.md` line 75 ("Record material allow/deny/security audit data under policy") has no implementation. The test's own choice of action name suggests health-check auditing was intended and dropped.

**Acceptance:** Either record a system-scoped event from the health endpoint (cheap, proves the seam end-to-end, discloses nothing), or note in the audit module why no caller exists until Milestone 2.

---

### L9 — Assistant Director's defining negative boundary is not asserted

**Severity:** Low
**Evidence:** `policy.test.ts` lines 135–149 covers Educator and Assistant Director together: assigned-centre allow, other-centre deny, `organisation.read` deny. It never asserts that Assistant Director lacks `centre.manage`.

**Why it matters:** `docs/FOUNDATION_DECISIONS.md` line 56 and `docs/PERMISSIONS.md` line 41 both single out "no automatic equivalence to Centre Director" as the required exclusion. `centre.manage` is precisely the capability that separates the two roles, so it is the one assertion that actually proves the boundary.

**Acceptance:** Assert `centre.manage` is denied for Assistant Director on their own assigned centre.

---

### L10 — "Conflicting context" denial is untested

**Severity:** Low
**Evidence:** `docs/FOUNDATION_DECISIONS.md` line 82 requires "deactivated, expired, missing, ambiguous, and conflicting context denial." `policy.test.ts` covers deactivated, expired, missing, ambiguous, and invalid — there is no conflicting-context case.

**Acceptance:** Either add a case (for example, overlapping assignments where one is active and one expired for the same role and scope, or contradictory scope rows on one assignment) or record that "conflicting" is considered synonymous with "ambiguous" and covered.

---

### L11 — No frontend tests and no accessibility verification

**Severity:** Low
**Evidence:** `frontend/` has no test runner, no test files, and no accessibility tooling. `frontend/package.json` scripts are `dev`, `build`, `start`, `lint`, `typecheck`, `client:generate`.

**Why it matters:** `docs/MVP_BUILD_PLAN.md` line 156 requires "accessible responsive workflows and plain-language errors" at every milestone. The shell is written with genuine care — `aria-busy`, `aria-live="polite"`, `role="alert"`, a visually-hidden heading — and none of it is verified, so it will regress silently.

**Acceptance:** A minimal component test over `FoundationStatus` covering the loading, ready, and error states including their ARIA attributes, wired into the frontend check script and into M6's pipeline.

---

### L12 — Root `npm test` does not do what it appears to

**Severity:** Low
**Evidence:** Root `package.json` sets `"test": "vitest run --passWithNoTests"`. There is no `vitest.config.*`. `docs/DEVELOPER_SETUP.md` line 68 correctly instructs `encore test`.

**Why it matters:** Running `npm test` directly executes the database-backed suites (`api.test.ts`, `audit/events.test.ts`, `capabilities.test.ts`, `role-assignment-schema.test.ts`) without Encore's test infrastructure, producing confusing connection failures rather than a clear "use `encore test`" signal.

**Acceptance:** Make the failure mode obvious — either have the script point at `encore test`, or leave it as the runner Encore invokes and add a comment plus a note in `DEVELOPER_SETUP.md` that it is not a standalone entry point.

---

## Resolved during the review

- The empty `hello/` directory left behind by the deleted starter service has been removed.
- Drift between the TypeScript capability enum and the `capabilities` table is now guarded by `foundation/authorization/capabilities.test.ts`.

## Not raised as issues

Threat model, privacy review, and data classification are covered by `docs/SECURITY.md` and `docs/PERMISSIONS.md` (data classes at lines 54–61); both were updated in this working tree. Absence of `.down.sql` migrations is consistent with Encore's forward-only model, though the "rollback/recovery approach" mentioned at `docs/MVP_BUILD_PLAN.md` line 143 is not documented anywhere and would fit naturally in an M7 record.
