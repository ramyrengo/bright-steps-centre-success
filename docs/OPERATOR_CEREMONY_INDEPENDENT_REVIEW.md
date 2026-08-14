# Independent review — the two reviewed operator ceremonies

**Reviewed at:** `bd22bf9` (the last code commit on `feature/centre-budgets`; later commits are documentation only)
**Date:** 14 August 2026
**Reviewer:** Claude (Opus 5), reading the code as a reviewer independent of the sessions that wrote it.
**Requirement this addresses:** ADR-0021 §"What would unblock this" — *"Independent review of this record, and of the production ceremony in D5 before it is run."*

> **What this is, stated plainly.** This is a code review performed by an AI assistant that did not write the code under review. Whether that discharges ADR-0021's independent-review requirement, or whether that record intends a human reviewer, is a Product Owner decision and is deliberately not assumed here. ADR-0021 also requires independent review *of the record itself*; this document does not address that.

---

## 1. Verdict

**Both ceremonies are soundly built. No finding says the design is wrong.**

R-1 was a real defect that would have bitten a production operator; R-2 was a coverage gap. Both are closed, as are the three hardening findings R-3, R-4 and R-5. **R-6 is the only finding still open**, and it asks for a decision rather than a change.

The findings below are written as they stood at `bd22bf9`, with resolutions appended. That order is deliberate: what the review found is as much a part of the record as what remains.

---

## 2. Scope and method

Read in full at `bd22bf9`:

| File | Lines |
| --- | --- |
| `foundation/authentication/first-administrator-ceremony.ts` | 1018 |
| `foundation/organisation-reference/organisation-load.ts` | 882 |
| `foundation/operations/reviewed-environment-gate.ts` | 190 |
| `scripts/bootstrap-first-administrator.ts` | 118 |
| `scripts/load-bright-steps-organisation.ts` | 102 |

Supporting reads: migration 017's `reachable_system_administrator_count`, `foundation/authorization/roles.ts` and `capabilities.ts`, the operator npm scripts, and the four associated test files.

**Method.** Source reading, plus targeted execution to test specific hypotheses rather than assume them. Claims made by the handoff were re-derived from the code; two were checked and found to be more precise than the summary that reached this session, and one hypothesis of the reviewer's own (that the reported capability list was an unverified constant) was checked and proved wrong.

**Not covered.** No deployed environment was touched. Neither ceremony has been run anywhere but a local isolated test database, which remains true after this review. The frontend, the Budgets work, and the form-builder branch are out of scope.

---

## 3. Findings

### R-1 — The ceremony can refuse because the application and database clocks disagree. *(Medium. Fails closed.)*

**Mechanism.** `runFirstAdministratorCeremony` stamps `occurredAt` from the **application** clock at `first-administrator-ceremony.ts:705`, before opening its transaction at `:713`, and writes it as `effective_from` on the membership, the role assignment and the assignment scope. Migration 017's `reachable_system_administrator_count` then requires `effective_from <= now()` on all three, where `now()` is the **database** clock fixed at `BEGIN` (`foundation/migrations/017_people_access_domain.up.sql:353`).

Two different clocks, with no margin between them. If the database clock is behind the application's by more than the few milliseconds between the JavaScript timestamp and `BEGIN`, reachability is zero, and the ceremony throws `exactly_one_violated` — *"reachable System Administrators: found 0, required 1"* — and rolls back.

**Evidence.** Measured skew on the development machine was **−2 ms** (database behind host), and that was sufficient: the first run of the new chain test (R-2) failed on exactly this. The comment at `:702–704` anticipates the ordering hazard and solves it correctly *for a single clock*; the assumption that there is only one clock is the gap.

**Why no existing test catches it.** Every call to `runFirstAdministratorCeremony` in `first-administrator-ceremony.test.ts` goes through the `dependencies()` helper, which injects `now: () => AT` — a fixed instant hours in the past (`:42–50`). The suite is structurally immune to the one thing production will meet.

**Impact.** Fails closed: nothing incorrect is committed, and the transaction rolls back cleanly. The cost is operational, not correctness. An operator running a one-shot, human-approved production ceremony receives a refusal indistinguishable from a genuine invariant breach, with no indication that the cause is clock skew.

**RESOLVED** on `fix/ceremony-database-clock`. `effective_from` is now read from `now()` inside the transaction, so the value written and the value the guard compares against are the same instant and cannot disagree. `dependencies.now` was removed rather than repointed: an injectable clock would restore precisely the blindness that hid this, since every ceremony test pinned a fixed past instant and none could meet the real behaviour.

Two tests carry it. The chain tests in §5 no longer inject a clock, so they run the production path — on this machine the first of them fails without the fix and passes with it. And because no behavioural test can be relied on to fail where the clocks agree, a structural guard in `first-administrator-ceremony.unit.test.ts` asserts the source reads the database clock after `BEGIN` and that no application clock or injection seam remains.

One existing test needed a consequential change: *"grants the canonical System Administrator bundle and no business content"* evaluated the new grant at a fixture instant hours before the now-real `effective_from`, and correctly answered that the administrator could not yet act. It now evaluates just after the real one.

### R-2 — Nothing tested the two tools in sequence. *(Was Medium. Closed by this review.)*

The set of files importing both `loadBrightStepsOrganisationReference` and `runFirstAdministratorCeremony` was empty. Each tool was proven against an organisation its own fixtures built; the production sequence — load creates the organisation, ceremony creates the first administrator inside it — was never exercised.

The specific hazard: the load checks canonical roles by **presence of key**, while the ceremony additionally checks the definition's name, description, version and template linkage, and the exact capability set on **both** `role_capabilities` and `canonical_role_template_capabilities`. The ceremony is strictly stricter, so a load reporting success could be followed by a ceremony refusing `canonical_role_unavailable` — with the organisation already committed and the ceremony refusing to run again to repair it.

**Closed.** See §5. That the strict check bites was already proven at `first-administrator-ceremony.test.ts:429`; what was missing, and is now covered, is that the roles the load actually leaves behind pass it.

### R-3 — The shared gate accepts `cloud` and never reads it. *(Low.)*

`evaluateReviewedEnvironmentGate` takes `Pick<EnvironmentMeta, "cloud" | "name" | "type">` but across all 190 lines never evaluates `cloud`. The four locks use `name` and `type` only. The organisation load compensates on its local path by calling the real `assertLocalDevelopmentEnvironment`; the ceremony has no cloud assertion at all.

Defensible — the ceremony never admits `local`, so it has nothing to prove about cloud — but an unused field in the signature of the system's most security-critical helper invites a reader to believe a fifth lock exists. Either drop it from the `Pick` or make the check real.

**RESOLVED** on `fix/operator-ceremony-hardening`, by dropping it. Making the check real is not available to the gate: its two tools want opposite things from `cloud` — the ceremony never admits `local`, while the load is a supported local development tool and must. Proving that an environment calling itself `local` really is local therefore stays the tool's job, and the load already does it by calling the untouched `assertLocalDevelopmentEnvironment`, which does read `cloud`. The parameter is now `Pick<EnvironmentMeta, "name" | "type">` on both the shared gate and the ceremony's wrapper, so the gate *cannot* read `cloud` — a stronger guarantee than a test, and the reason no test asserts it.

### R-4 — The capability comparison couples a JavaScript sort to a Postgres collation. *(Low. Fails closed.)*

`SYSTEM_ADMINISTRATOR_CAPABILITIES` is sorted by JavaScript (UTF-16 code units) and compared index-wise against rows returned by `ORDER BY capability_code` (database collation). Those disagree on punctuation: glibc `en_US.UTF-8` ignores `.` and `_` at the primary level; `C` does not.

All eleven current codes were checked — every adjacent pair is decided by a letter before punctuation matters, so **this is correct today**. But a future code such as `system_health.read` beside `system.health.read` would make a correct role refuse, in production, in the check that gates the ceremony. Compare as sets, or pin `COLLATE "C"`.

**RESOLVED** on `fix/operator-ceremony-hardening`, as a set comparison. The rows are now sorted in JavaScript by the same comparator that ordered the constant, so the check no longer depends on the query's `ORDER BY` agreeing with it, and no longer depends on a collation at all. `COLLATE "C"` was the alternative and is weaker: it pins the dependency rather than removing it. A structural guard covers it, because on a `C`-collation test database nothing behavioural would fail first.

### R-5 — Rollback inside `catch` can mask the error the operator needs. *(Low. Both tools.)*

`organisation-load.ts:820` and `first-administrator-ceremony.ts:937`: if `commit()` throws, `committed` remains false, `rollback()` runs, and if that also throws its error replaces the commit failure. Wrap the rollback and rethrow the original.

**RESOLVED** on `fix/operator-ceremony-hardening`. Both rollbacks are wrapped and their failures deliberately swallowed, so the original error always propagates. A failed rollback here means the transaction was already unusable, which the error being handled says better — and on a ceremony that will not run twice, the first error is the one that explains what happened.

### R-6 — The two tools take different advisory locks. *(Informational.)*

`1112691796 / 20260814` for the load, `1112691796 / 20260815` for the ceremony. Each excludes itself; neither excludes the other. Cross-tool safety rests entirely on `SERIALIZABLE` plus the population assertions, which does appear to hold. The near-identical constants read like they were meant to be one lock, and an SSI serialization failure is a worse operator message than a clean refusal. Confirm the difference is deliberate.

### R-7 — Some structural tests assert source text, not behaviour. *(Informational.)*

`organisation-load.unit.test.ts:116` proves that `assertEnvironmentGate(...)` appears *earlier in the file* than `centreSuccessDB.begin()`. That is textual order, not execution order. These are useful tripwires and the behavioural coverage does exist elsewhere, but they should not be counted as proof of ordering when tallying what the gate has been shown to do.

---

## 4. Verified as sound

Re-derived from the source, not accepted from the handoff:

- **The gate is evaluated before a transaction can open** in both tools (`organisation-load.ts:720` before `:738`; ceremony `:699` before `:713`).
- **The dry run is a genuine rehearsal.** `SET CONSTRAINTS ALL IMMEDIATE` is issued before *either* outcome in both tools (`:783`, `:889`), so the deferred migration 017/018 guard fires during a rolled-back run. The finding about `people_admin_guard_validate_once` is correct and the remedy is in the right place.
- **The ceremony verifies the canonical role rather than trusting it.** `loadCanonicalSystemAdministratorRole` checks key, name, description, version, template linkage and the exact capability set on two tables. The report's eleven capabilities are a verified statement, not a printed constant. *(This reviewer expected the opposite and was wrong.)*
- **`tenant_not_trusted`** is genuinely enforced against the configured `EntraTenantId`, not merely against well-formedness (`:330–336`).
- **Three independent defences against a second run:** no principal in the organisation, no prior ceremony audit event (append-only, so it survives row deletion), and the identity not already mapped.
- **Attribution is honest.** `grant_source_type 'bootstrap'` with `granted_by_principal_id NULL`, and `actor_principal_id NULL` on both audit events — the created administrator is the subject, never recorded as the actor.
- **Local admission is on evidence, not name.** The load calls the untouched `assertLocalDevelopmentEnvironment`; `local_environment_required` is proven behaviourally at `organisation-reference.integration.test.ts:280`.
- **Operator surface.** `parseArgs` is `strict: true`, so a typo refuses rather than silently defaulting; dry run is the default in both scripts; the npm scripts are correct; and the two confirmation flags are deliberately named differently (`--confirm-production-first-administrator` vs `--confirm-production-organisation-load`), so neither can be pasted across from the other tool.
- **The handoff between the tools is well-formed.** `BRIGHT_STEPS_ORGANISATION_ID` = `b5c30000-0000-4000-8000-000000000001` satisfies the ceremony's `CANONICAL_UUID`.

---

## 5. What changed as a result of this review

Test-only. No production code was modified.

**`foundation/organisation-reference/organisation-reference.integration.test.ts`** — a new `describe` block, *"the chain from the loaded organisation to the first administrator"*, appended so that it runs after the load has genuinely committed the organisation. It rehearses the ceremony against that organisation and asserts three things:

1. The roles the load leaves behind satisfy the ceremony's stricter check — closing R-2.
2. The rehearsal leaves the organisation exactly as it found it, and nobody survives the rollback.
3. An `effective_from` later than the database clock makes the ceremony refuse — R-1's mechanism, pinned deterministically rather than left to whatever the container clock is doing.

The ceremony rehearses rather than applies, deliberately: a dry run exercises the whole disagreement, whereas applying would write an append-only bootstrap audit event into the shared test organisation that `system_audit_events` would not let a later test remove. The block's own comments record this.

**`foundation/authentication/first-administrator-ceremony.unit.test.ts`** — the "no service module imports the ceremony" guard pinned an exact one-entry allow-list of importers, which the new test broke. The allow-list was widened by one test file and **strengthened**: it now also asserts that every importer is a `.test.ts` file, so admitting a future importer cannot quietly admit something on a request path.

**Gates after the changes:** `typecheck` ✅ · `test:unit` **370/370** ✅ (367 at `bd22bf9`) · `test:integration` **251/251** ✅ (248 at `bd22bf9`) · `git diff --check` ✅.

---

## 6. Conditions before either ceremony is run

1. ~~Resolve R-1.~~ Done — see R-1. It was the only finding that produced a confusing failure during the real operation.
2. ~~R-3, R-4 and R-5.~~ Done — see each. **R-6 remains open**, and it needs a decision rather than a change: confirm whether the two tools taking different advisory locks is deliberate. R-7 is an observation about how to read the existing tests, not work.
3. Neither tool has ever run against a deployed environment. Their staging and production paths are proven by integration tests that simulate those environments — which is proper engineering, and is not the same as having run.
4. This review does not grant production-release authority, which the Product Owner has not delegated.
