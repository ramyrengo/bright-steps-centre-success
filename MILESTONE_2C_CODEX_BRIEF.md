# MILESTONE 2C IMPLEMENTATION BRIEF — PEOPLE & ACCESS + USER INVITATIONS

**For: Codex**
**Issued:** 11 August 2026, on Product Owner authority.
**Baseline commit:** `main` at `99bff5f` (Milestones 1, 2A, 2B merged); governance
updates recording Milestone 2B acceptance and Milestone 2C authorisation are on
branch `milestone-2c/authorisation`.

---

## 1. Authorisation and authority of this brief

The Product Owner has **formally accepted Milestone 2B** (ACCEPTED / COMPLETE)
and **separately authorised Milestone 2C — People & Access + User Invitations**
for implementation. Both decisions are recorded in the governance documents on
this branch.

The authoritative design baseline is:

- `docs/PEOPLE_AND_ACCESS.md` — the complete approved architecture;
- `docs/adr/0014-people-and-access-invitation-architecture.md`;
- `AGENTS.md`, `docs/SECURITY.md`, `docs/PERMISSIONS.md`,
  `docs/DATABASE_SCHEMA.md`, `docs/FOUNDATION_DECISIONS.md` as cross-cutting
  constraints.

**These decisions are settled. Do not revisit, redesign, or "improve" them.**
Where this brief and `docs/PEOPLE_AND_ACCESS.md` state the same rule at
different levels of detail, the architecture document governs. If you find a
genuine conflict or an unimplementable constraint, stop and report it — do not
resolve it by choosing your own architecture.

Follow `docs/PEOPLE_AND_ACCESS.md` section R (the 12-step implementation
outline) as your execution order. This brief adds the Product Owner's policy
parameters and implementation anchors so you can build without rediscovery.

## 2. Approved invitation policy (Product Owner, 11 August 2026)

| Parameter | Value |
| --- | --- |
| Invitation expiry | Exactly **72 hours** per token generation |
| Initial inviter | **System Administrator only** (`invitation.manage` via reviewed template version) |
| Standard packages (activate on verified acceptance, no second approval) | Educator (explicit centre/centres), Assistant Director (explicit centre), Centre Director (explicit centre), Area Manager (explicit selected-centre portfolio) |
| Privileged packages (require independent second System Administrator approval) | **System Administrator, Executive, Finance, Compliance Manager, organisation-wide Operations Leadership** |
| Unclassified packages | Fail closed into privileged/review handling; never assumed standard |
| Microsoft Graph | **Not used** — not for correlation, classification, or email |
| Passwords / local login | **None.** Microsoft Entra remains the only authentication path |
| Email delivery | Approved outbox → Encore Pub/Sub → **provider-neutral adapter**. The concrete provider is NOT chosen; implement the adapter boundary and a local/dev no-op or log-safe stub. Do not add a provider SDK dependency |
| Production first-administrator bootstrap | **Separately gated. Do not implement.** The local synthetic bootstrap remains local-only |

## 3. Invariants that must survive your implementation

1. Microsoft Entra authenticates; **Centre Success PostgreSQL is the only
   business-authorisation source**.
2. Permanent identity is **`tid + oid`** (`provider_key = microsoft_entra:<tid>`,
   `provider_subject` = lower-case canonical `oid`). Email/UPN is correlation
   evidence only and never an identifier, scope, or authorisation input.
3. Capability + assignment + scope authorisation with **no cross-assignment
   recombination** — one assignment must supply the complete allow path.
4. **Deny by default.** Missing, stale, ambiguous, or conflicting context denies
   with generic, non-disclosing errors.
5. No Entra group, app role, or claim is ever BSA permission authority.
6. Entra **User assignment required stays No**; unmapped/uninvited identities
   remain `not_provisioned`.
7. **Pending grants stay outside active authorisation tables.** No row in
   `organisation_memberships`, `role_assignments`, or `assignment_scopes` may
   exist for an unactivated invitation.
8. **No business access before activation.** The activation transaction is the
   first moment any active grant exists.
9. **Last-administrator protection**: every mutation that can affect
   System-Administrator reachability proves at least one other reachable active
   System Administrator remains, under lock, with equivalent database-level
   protection — application checks alone are insufficient
   (`docs/PEOPLE_AND_ACCESS.md` section K).
10. **Effective-dated joiner/mover/leaver**: mover changes are atomic
    replacement with no transient widening; leaver relies on per-request
    database recheck, never token expiry.

## 4. Hard scope exclusions (Product Owner)

Milestone 2C must NOT implement: HR sync, Microsoft Graph, SharePoint, QIP,
coaching, wellbeing, budget, AI, Daily Success, executive dashboard, unrelated
compliance features, break-glass/support impersonation, real employee seed
data, or a production bootstrap. Adding any of these is a scope violation
regardless of how small it seems.

## 5. Implementation anchors — reuse, do not reinvent

| Existing seam | Location | Use for |
| --- | --- | --- |
| Entra token verifier | `foundation/authentication/entra-access-token-verifier.ts`, `entra-jwks.ts` | The acceptance boundary MUST reuse this verifier unchanged — same issuer/tid/aud/azp/version/time/scope contract |
| Auth handler + AuthData | `foundation/authentication/auth-handler.ts` | Never place an unmapped external subject into `userID`; the acceptance boundary is separate from normal `auth: true` flow (see §6) |
| Mapping lookup | `foundation/authentication/external-identity.ts` | Extend for activation-time mapping creation; keep active-mapping + active-principal semantics |
| Business principal + capability checks | `foundation/quarterly-reviews/authorization.ts` (`requireBusinessPrincipal`, `requireOrganisationCapability`) | Same pattern for all `/admin/people` APIs |
| Database authoriser | `foundation/authorization/database-authoriser.ts` | Every admin API re-authorises per request |
| Serializable transaction helper | `foundation/quarterly-reviews/service.ts` (`inSerializableTransaction`) | Activation, approval, lifecycle, and outbox writes |
| Transactional audit events | `foundation/audit/events.ts` (`recordAuditEventWithExecutor`) | Every material write commits its audit event atomically; extend `TENANT_FOUNDATION_RESOURCE_TYPES` and migration-level audit target validation for new resource types (follow migration 009's pattern) |
| Canonical role templates | migrations `006`, `010` | The System Administrator template update adding `invitation.read`, `invitation.manage`, `privileged_access.approve`, `access_history.read` is a **new template version** following the 010 pattern (inactivate v_n, insert v_n+1, re-provision, migrate assignments, audit) |
| Optimistic concurrency | `lock_version` columns throughout | Same convention on all new mutable tables |
| Local admin bootstrap / linker | `foundation/authentication/local-first-administrator-bootstrap.ts`, `scripts/` | Remain local-only; do not extend toward production |

Schema concepts, invitation/principal state machines, capability keys, the
role/scope validation matrix, API surface, routes, email architecture, secret
handling (256-bit, keyed digest via Encore secret, constant-time compare,
72-hour expiry, one-time consumption, rotation on resend), and the threat-model
controls are all specified in `docs/PEOPLE_AND_ACCESS.md` sections B, C, D, F,
G, H, J, M, N. Implement them as written.

## 6. The one genuinely novel boundary — invitation acceptance

This is the only part of 2C without an existing pattern, and the place a
mistake becomes a security hole. Requirements:

- An invited user has a valid Entra token but **no internal mapping**. The
  acceptance endpoint therefore cannot sit behind the normal provisioned
  `auth: true` + `requireBusinessPrincipal` path.
- **Validate the exact Encore mechanism before coding** (gateway behaviour vs
  a raw endpoint doing explicit verification) and record the choice in the
  implementation notes. Whichever mechanism: the Milestone 2A verifier runs
  unchanged; a verification failure is a generic denial.
- The opaque invitation token travels in the **request body**, never the URL
  query/path, never logs, never audit context.
- Acceptance never treats the external subject as an internal principal until
  the activation transaction commits the mapping.
- All existing business APIs must continue to require a provisioned internal
  principal — prove with a regression test.
- Correlation failure, guest/member ambiguity, tenant mismatch, or mapping
  conflict → invitation enters `ADMINISTRATOR_REVIEW`; no partial state.

## 7. Migration preflight obligations

- Principal states migrate to `pending | active | suspended | revoked`.
  Existing `inactive` rows must be **explicitly classified in migration
  preflight** (fail the migration with a clear message if any unclassifiable
  row exists — follow migration 015's refuse-don't-rewrite precedent).
- Forward-only migrations (ADR-0007). Add columns nullable → backfill →
  constrain.
- Last-admin protection needs its database-level guard in the same migration
  set as the tables it protects.
- Migrations must apply cleanly to both an empty database and one carrying
  Milestone 2B data (versions 001–015).

## 8. Required tests

Implement the complete matrix in `docs/PEOPLE_AND_ACCESS.md` section O. It is
the acceptance target; do not trim it. Emphases from review history:

- negative and concurrency cases are what acceptance reviews check first
  (double acceptance, resend/cancel race, concurrent approval, concurrent
  last-admin removal, outbox rollback, Pub/Sub duplicate delivery);
- self-approval and inviter-approval denial for every privileged package;
- forwarded-invitation and wrong-employee correlation denial;
- regression: all Milestone 1 / 2A / 2B suites stay green, the auth-scope
  guard passes, and the generated client is regenerated and byte-stable.

## 9. Delivery constraints

- Node 24.16.0 (`.nvmrc`), Encore CLI 1.57.13 invoked by absolute path
  (`/opt/homebrew/bin/encore`) — do not prepend `/opt/homebrew/bin` to PATH
  (Node 18 shadowing, `docs/DEVELOPER_SETUP.md`).
- Update `docs/DEVELOPER_SETUP.md`, `docs/DATABASE_SCHEMA.md`,
  `docs/PERMISSIONS.md` and the ADR index for what you actually build; record
  the acceptance-boundary mechanism decision.
- Do not modify Milestone 2A authentication files except where this brief's
  anchors require extension; never weaken a validation.
- Known accepted debt: the N+1 multi-centre authorisation pattern. Do not
  extend it to People & Access list endpoints if a bounded alternative exists;
  do not "fix" it globally in this milestone.
- **Perform no Git operations** (no commit, push, branch, merge). No
  production bootstrap. No real-user provisioning. No later-milestone work.
- When complete: run backend typecheck, unit, integration, frontend
  lint/typecheck/tests/build, both dependency audits, auth-scope guard, and
  the generated-client byte comparison; then **report the evidence and STOP**
  for independent review and Product Owner acceptance.

## 10. Stop conditions

Stop and report — rather than improvise — if you encounter:

- a conflict between this brief and `docs/PEOPLE_AND_ACCESS.md` / ADR-0014;
- an Encore limitation that prevents the acceptance boundary from reusing the
  2A verifier unchanged;
- any need for a Microsoft Graph permission, client secret, or new Entra app
  registration change;
- any situation where last-admin protection cannot be enforced at the
  database level;
- ambiguity about whether a package is standard or privileged.
