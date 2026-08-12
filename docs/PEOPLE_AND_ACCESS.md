# People & Access Architecture

## Status and implementation gate

**Architecture approved; IMPLEMENTED — ACCEPTANCE REMEDIATION IN PROGRESS for Milestone 2C — People & Access + User Invitations.** The Product Owner accepted Milestone 2B and separately authorised Milestone 2C implementation on 11 August 2026. An independent review returned PASS WITH CHANGES. Forward migrations 016–018, workflow APIs, the candidate-only identity boundary, task routes, outbox worker and regression tests implement this design without expanding it. Targeted independent re-review, Product Owner acceptance, a production email provider and production first-administrator bootstrap remain separate gates.

This document is the approved product and engineering design. Microsoft Entra proves identity. Centre Success PostgreSQL owns application access. Centre Success is not an HR system and does not manage Microsoft accounts.

## A. Product workflow

### Joiner and standard access

1. An authorised System Administrator opens **Administration → People & Access → Invite User**.
2. They enter the delivery/correlation email, choose an approved canonical role and valid scope, select centres where required, give a reason, and review the complete package.
3. Centre Success creates a `pending` principal and invitation-owned access proposal. It creates no active organisation membership, role assignment, or assignment scope.
4. The invitation and a transactional outbox record commit together. An Encore Pub/Sub-backed worker sends the branded invitation through the selected transactional email provider.
5. The employee follows the current one-time link and authenticates with the single Bright Steps Entra tenant.
6. Centre Success validates the API access token and safely correlates the authenticated identity with the intended invitation. Email is correlation evidence only; `tid + oid` becomes the permanent external identity.
7. For an approved standard package, one serializable transaction consumes the token generation, creates the external identity mapping, activates the pending principal, creates the organisation membership and independent role/scope assignments, records audit events, and marks the invitation activated.
8. Every later business request reloads current PostgreSQL authorisation. The invitation token grants no access by itself.

Standard packages eligible for activation without another approval are:

- Educator with explicit selected centre or centres;
- Assistant Director with explicit centre scope;
- Centre Director with explicit centre scope; and
- Area Manager with an explicit selected-centre portfolio.

This fast path applies only when a System Administrator created the current invitation, the package has not changed, identity correlation succeeds, the invitation remains valid, the Entra tenant is exact, and no mapping conflict exists. Any unclassified package fails closed into privileged/review handling; it is never assumed standard.

### Privileged access

The initial privileged packages are System Administrator, Executive, Finance, Compliance Manager, and Operations Leadership with organisation-wide scope. Policy may designate further packages privileged. A package containing any privileged assignment requires a second currently authorised System Administrator to approve the exact immutable package after identity verification. The inviter/requester, target, and independent approver must satisfy separation-of-duties policy; the inviter cannot approve their own requested privileged grant.

Activation revalidates the approver, invitation generation, identity, package digest/version, role definitions, scopes, last-administrator invariant, and mapping uniqueness in the same serializable transaction. Approval of one package cannot be reused after the package changes.

## B. Invitation state machine

Invitation state is separate from principal and assignment state:

```text
DRAFT
  └─ send ─> SENT
               ├─ begin verified acceptance ─> IDENTITY_VERIFIED
               │      ├─ standard package ─> ACTIVATED
               │      ├─ privileged package ─> AWAITING_PRIVILEGED_APPROVAL ─> ACTIVATED
               │      └─ unsafe correlation ─> ADMINISTRATOR_REVIEW
               ├─ resend ─> SENT (new generation; earlier generation invalid)
               ├─ cancel ─> CANCELLED
               └─ time >= expires_at ─> EXPIRED
```

`ADMINISTRATOR_REVIEW` cannot silently change the intended email or identity. An authorised administrator must cancel and issue a reviewed replacement, or resolve the mismatch through a separately audited procedure. `ACTIVATED`, `CANCELLED`, and `EXPIRED` are terminal for that invitation. Resend keeps the invitation in `SENT` but replaces its token generation and sets a fresh 72-hour expiry.

Expiry is enforced from trusted database time on every transition even if a scheduled status-materialisation job has not run. Concurrent send, resend, cancel, accept, or approve operations use optimistic versions plus row/transaction locking.

Principal lifecycle is independent:

```text
pending -> active -> suspended -> active
                   └──────────> revoked
active ───────────────────────> revoked
```

`revoked` is terminal in the initial model. A suspended principal may be reactivated only after current permission, identity-mapping, membership, package, and last-administrator validation. Historical attribution is never deleted.

## C. Identity-binding design

- Entra **User assignment required** remains **No**. Any valid identity from the exact Bright Steps tenant may authenticate, but authentication creates no Centre Success access.
- Unmapped or uninvited identities remain `not_provisioned`.
- The accepted identity key is canonical `provider_key = microsoft_entra:<tid>` plus raw canonical lower-case `oid` as `provider_subject`.
- Email/UPN/`preferred_username` is not a permanent identifier, scope, or authorisation input. Email changes do not relink an account.
- Acceptance requires the current opaque invitation token and a freshly validated Centre Success API access token from the exact BSA tenant. An ID token or Graph token is rejected.
- Correlation uses the invitation's normalised intended email only as onboarding evidence. If the required, verified claim is absent, ambiguous, different, or not reliable for a guest/member case, no mapping or access activates and the invitation enters `ADMINISTRATOR_REVIEW`.
- A forwarded invitation cannot be claimed merely because the recipient is in the same tenant.
- A unique active mapping conflict, an `oid` already linked elsewhere, or an invitation principal already linked to another identity fails closed.
- No Microsoft Graph dependency is approved for invitation correlation or member/guest classification. Questionable guest/B2B identities require administrator review.

The invitation-acceptance boundary is narrower than a normal business endpoint because an invited user may not yet have an internal mapping. The implementation exposes only sensitive `POST /invitations/accept` for this state. It reads a strict Bearer header, reuses the exact Milestone 2A cryptographic verifier, passes verified `tid + oid` only to the invitation workflow, and never creates Encore AuthData for an unmapped subject. All existing M1/M2A/M2B and People & Access administration APIs remain `auth: true` and require a provisioned internal principal.

## D. Implemented database model

Migrations 016–018 implement these reviewed organisation-owned records:

| Concept | Purpose and key invariants |
| --- | --- |
| `access_invitations` | Organisation, pending principal, intended email, state, expiry, inviter, reason, package version/digest, optimistic lock; no plaintext token |
| `invitation_role_proposals` | One immutable proposed canonical role definition per package component, privilege classification and policy version |
| `invitation_scope_proposals` | Invitation-owned organisation, organisational-unit, or explicit centre scopes; no active authority |
| `invitation_token_generations` | Generation number, keyed digest, created/expiry/consumed/invalidated metadata; only one current generation |
| `invitation_events` | Append-only invitation transition history with actor, reason, safe before/after summary and correlation ID |
| `privileged_invitation_approvals` | Exact package digest/version, requester, distinct approver, decision, reason and time; invalid after package mutation |
| `people_notification_outbox` | Transactional delivery intent, authenticated-encrypted delivery credential, idempotency key and publish state |
| `people_notification_delivery_attempts` | Provider reference, redacted result, retry state and timestamps; never message secrets |
| `organisation_access_invariants` | Per-organisation row used by transactional/database last-reachable-administrator guards |
| `people_admin_guard_validation_queue` | Transaction-local affected-organisation set; drives one deferred reachability validation per organisation at commit |

Migration 016 installs principal states `pending`, `active`, `suspended`, and `revoked` and fails closed if an existing `inactive` record requires explicit human classification. Existing foundation tables remain the only active-authorisation source:

- `external_identity_mappings` receives `tid + oid` only after verified correlation;
- `organisation_memberships`, `role_assignments`, and `assignment_scopes` receive no pending proposal rows;
- activation writes the mapping, membership, assignments, scopes, audit events, and invitation outcome atomically;
- each assignment retains its own role, scope, dates, grantor, reason, and privilege approval lineage;
- PostgreSQL tenant/composite foreign keys and package/scope constraints prevent cross-organisation linkage.

## E. Pending role/scope strategy

Invitation-owned proposals remain outside active membership and permission tables until activation. This avoids every query having to distinguish pending grants, prevents accidental policy inclusion, and preserves the current authoriser unchanged. The proposal stores reviewed role-definition and scope references plus a stable package digest. Package-format version 2 hashes a canonical fixed-key representation containing organisation, package and assignment privilege classifications, exact role-definition ID/key/version, normalised effective dates, and deterministically sorted typed scopes. Package-format version 1 remains verifiable only for invitations created before the forward migration. Activation re-resolves those references and denies drift, retirement, inactive centres, invalid hierarchy, missing capabilities, or a privilege-classification change.

A person may later hold several independent assignments. The policy engine must find a complete allow path within one assignment; it cannot borrow a capability from one assignment and scope from another.

## F. Authorisation and capabilities

Initial administration remains System Administrator only and is enforced by capability and organisation scope, never a route-level role-name check. Existing `principal.read`, `principal.manage`, `identity.mapping.manage`, `assignment.read`, and `assignment.manage` remain relevant. Migration 016 adds the narrowly reviewed capabilities:

- `invitation.read`;
- `invitation.manage` (create, send, resend, cancel);
- `privileged_access.approve`;
- `access_history.read`; and
- `access.change.request`, reserved for a later Operations Leadership request workflow and not a direct grant/activation authority.

Canonical System Administrator template version 2 receives the first four only. No other role gets them automatically. `access.change.request` is registered but ungranted; Operations Leadership may receive it only through a later approved workflow. Compliance Manager, Area Manager, Centre Director, Finance, Executive, Assistant Director, and Educator receive no automatic People & Access administration.

### Role/scope validation matrix

| Role | Initially valid scope input | Activation class |
| --- | --- | --- |
| Educator | Explicit selected centre(s); never inferred | Standard |
| Assistant Director | Explicit centre | Standard |
| Centre Director | Explicit centre | Standard |
| Area Manager | Explicit selected-centre portfolio | Standard |
| Compliance Manager | Explicit organisation compliance scope | Privileged |
| Operations Leadership | Organisation/state/region/group/explicit centres supported by the hierarchy; organisation-wide is explicitly privileged | Non-standard packages fail closed to privileged approval |
| Finance | Explicit approved organisation/unit/centre financial scope | Privileged |
| Executive | Explicit organisation strategic scope | Privileged |
| System Administrator | Explicit technical administration scope | Privileged |

Backend policy validates every combination against active organisation/hierarchy/centre facts. Frontend selectors are guidance only.

## G. People & Access experience

The interface is simple and task-oriented:

- `/admin/people`: search/filter people and invitations; show Centre Success state, Microsoft identity connection, role/scope summary and next action without exposing raw claims.
- `/admin/people/invite`: email, canonical role, role-specific scope selector, explicit centres, reason, privilege warning and review/send confirmation.
- `/admin/people/invitations/[invitationId]`: current state, expiry, requester/reason, separate role/version/classification/effective-date cards, every scope by human-readable name, safe delivery status, deliberate cancellation, mismatch review, and independent approval where required. Expired invitations are terminal and link to creation of a new invitation rather than offering resend.
- `/admin/people/[principalId]`: minimal profile, identity connected/not connected, principal state and assignment summary.
- `/admin/people/[principalId]/access`: add/end/effective-date independent assignments, edit the complete explicit-centre portfolio without a destructive default, and suspend/reactivate/revoke through action-specific confirmation and reason flows.
- `/admin/people/[principalId]/history`: append-only invitation, identity, membership, assignment, scope and lifecycle events.
- `/invitations/accept`: token validation, BSA Microsoft sign-in, safe correlation outcome and plain-language success/review/expired/cancelled states.

No screen displays raw access tokens, JWT claims, invitation digests, unnecessary Microsoft identifiers, or a role name as proof that an operation is allowed. Confirmation screens show the exact role and human-readable scope before a material change.

## H. Invitation email architecture

1. The invitation transaction writes the invitation generation and an outbox intent together.
2. A bounded outbox dispatcher claims unpublished rows and publishes an idempotent Encore Pub/Sub message after commit.
3. A Pub/Sub subscriber renders the reviewed Bright Steps template and sends through a transactional email provider.
4. Delivery attempts persist provider reference, safe status, retry count and redacted error class.
5. Duplicate Pub/Sub delivery is harmless because the generation/idempotency key is stable.

The production provider remains deferred. Development and deterministic tests use a no-network no-op adapter; the provider-neutral interface and retryable delivery-attempt model are implemented. Microsoft Graph is not used for email. The delivery request contains a generic Centre Success acceptance URL and a separate opaque invitation code; it contains no role, scope, permission, token claim, child/staff data, or sensitive access detail.

Invitation secrets are generated with 256 bits of cryptographic randomness. Plaintext exists only in command/subscriber memory long enough to hand the code to the provider adapter. The verifier table stores only an HMAC-SHA-256 digest. The outbox stores authenticated AES-256-GCM ciphertext under a separate Encore secret only while asynchronous delivery or retry may still need it; business and audit projections never expose it. A successful terminal delivery atomically preserves non-sensitive delivery metadata and clears the ciphertext, IV, and authentication tag. Verification compares digests in constant time. Expiry is exactly 72 hours. Consumption, cancellation, and resend invalidate the generation; resend rotates the secret before creating the new outbox intent.

## I. Joiner, mover and leaver

### Joiner

Use the invitation and activation workflow above. The first active business access appears only in the activation transaction.

### Mover

Create replacement assignments/scopes with explicit effective dates and end the replaced grants at the same boundary. Validate the complete before/after package in one transaction so there is no temporary union that widens access. Keep historical rows and record actor/reason. Privileged additions require independent approval. Per-request database authorisation makes the new boundary effective without relying on frontend/session state.

### Leaver

Suspend or revoke the Centre Success principal promptly, end/disable current access grants and external mappings as policy requires, and preserve attribution/history. Microsoft account disablement is a separate identity-team process. Because an already-issued Entra token may remain cryptographically valid, Centre Success rechecks mapping/principal/assignment state on every request.

HR/recruitment remains the employment system of record. HR integration, if later approved, may propose joiner/mover/leaver events but cannot silently grant access.

## J. Security threat model

| Threat | Required control |
| --- | --- |
| Forwarded invitation | Current one-time token plus exact-tenant Entra authentication and safe intended-identity correlation; mismatch goes to review |
| Token theft/brute force | 256-bit secret, keyed digest, 72-hour expiry, rate limits, generic responses, no plaintext storage/logging |
| Replay/double acceptance | One current generation, atomic consumption and unique mapping/activation constraints |
| Resend/cancel race | Row lock/version; rotate or invalidate before enqueueing replacement mail |
| Wrong/foreign tenant or Graph/ID token | Reuse strict Milestone 2A issuer/tenant/audience/client/scope/type validation |
| Mutable email/UPN | Correlation only; permanent mapping is `tid + oid`; no automatic email rewrite |
| Guest/B2B ambiguity | No automatic activation when reliable classification/correlation is unavailable; administrator review |
| Role/scope escalation | Server-owned role definitions, package digest, capability/scope validation, privilege policy and independent approval |
| Self-approval | Distinct inviter/requester and privileged approver; target cannot use pending access to approve |
| Last admin removal | Cross-table reachable-administrator invariant checked under transaction lock and database guard |
| Concurrent admin edits | Optimistic lock plus serializable transaction and immutable audit history |
| Suspended/revoked reuse | Per-request state recheck; revoked terminal; reactivation is an authorised audited command |
| Outbox/Pub/Sub duplicates | Stable idempotency key, claimed outbox state and idempotent provider dispatch |
| Data leakage | Minimal email/profile data, classified retention, no secrets/claims in logs, generic unauthorised responses |

## K. Last-administrator protection

A **reachable active System Administrator** has all of the following at the decision time:

- an `active` principal;
- an active mapping to the approved Bright Steps Entra tenant;
- one active organisation membership;
- an active canonical System Administrator assignment;
- a current technical administration scope covering the organisation; and
- the current capabilities required to administer invitations, principals, mappings, assignments and privileged approval.

Every mutation that can affect reachability—principal suspension/revocation, mapping deactivation, membership end, role assignment removal, scope narrowing, role-template change, or capability removal—must lock the organisation's administrator invariant and prove at least one other reachable administrator remains. Direct database writes receive equivalent database protection; application checks alone are insufficient. A row-level collector records each affected organisation once per transaction and acquires the existing transaction advisory lock; one deferred constraint trigger then performs the expensive reachability validation once per affected organisation at commit. Concurrent operations cannot each count the other administrator and remove both.

The hard invariant is at least one. Operational policy targets at least two active reachable System Administrators and alerts when the count falls below two. Break-glass/recovery remains separately deferred.

## L. Production first-administrator bootstrap

No permanent production bootstrap endpoint, magic header, default account, migration seed, or reusable enrollment token is allowed. Before implementation, the team must validate a specific Encore Cloud operational mechanism and obtain separate Product Owner approval.

The future mechanism should be one-time, environment-bound, operator-authenticated, dual-approved, expiring, non-network-public, fail closed when any administrator already exists, use the canonical System Administrator role, create only reviewed tenant identity data, and write complete immutable audit evidence. It must be disabled or removed after use and must not reuse the local synthetic bootstrap as a production workflow. The exact Encore Cloud command/job procedure remains an implementation gate, not an assumption in this architecture.

## M. Implemented workflow APIs

These workflow APIs are implemented as task commands/queries rather than generic CRUD:

| Command/query | Required authority | Scope and important validation | Audit event |
| --- | --- | --- | --- |
| `listPeople` | `principal.read` | Organisation; filter results server-side | Sensitive query telemetry, not per-row business event |
| `getPersonAccess` | `principal.read` + `assignment.read` | Target organisation; no cross-tenant existence leak | Access read where policy requires |
| `getAccessHistory` | `access_history.read` | Organisation and target | History access event |
| `createInvitation` | `invitation.manage` + assignment authority | Exact role/scope package, email, reason, privilege class | `invitation.created` |
| `sendInvitation` | `invitation.manage` | Draft/version current; rotate token generation and outbox atomically | `invitation.sent` |
| `resendInvitation` | `invitation.manage` | Nonterminal invitation; invalidate old generation first | `invitation.resent` |
| `cancelInvitation` | `invitation.manage` | Current nonterminal state; reason | `invitation.cancelled` |
| `acceptInvitation` | Current token + strict Entra identity proof | Exact tenant, correlation, expiry, generation, mapping uniqueness, package validity | `identity.verified`, `invitation.activated` or safe review event |
| `approvePrivilegedInvitation` | `privileged_access.approve` | Distinct approver, exact package digest, current privilege policy | `privileged_access.approved` |
| `addRoleAssignment` | `assignment.manage`; privileged path when applicable | Complete role/scope; no recombination or self-escalation | `role_assignment.granted` |
| `replaceAssignmentScope` | `assignment.manage`; privileged path when applicable | Effective-dated atomic replacement and valid hierarchy | `assignment_scope.replaced` |
| `removeRoleAssignment` | `assignment.manage` | Last-admin and impact checks; reason | `role_assignment.ended` |
| `suspendPrincipal` | `principal.manage` | Last-admin check; reason; immediate deny | `principal.suspended` |
| `reactivatePrincipal` | `principal.manage` | Suspended only; mapping/package/current-authority validation | `principal.reactivated` |
| `revokePrincipal` | `principal.manage` | Last-admin check; terminal confirmation and reason | `principal.revoked` |

Every command takes an optimistic lock/version where applicable, resolves actor/tenant on the backend, uses a transaction, and records safe before/after summaries without invitation secrets or JWT content.

## N. Frontend routes

Implemented task routes:

```text
/admin/people
/admin/people/invite
/admin/people/invitations/[invitationId]
/admin/people/[principalId]
/admin/people/[principalId]/access
/admin/people/[principalId]/history
/invitations/accept
```

Route visibility never substitutes for Encore authorisation. Administrative routes call `auth: true` APIs; the candidate route calls only the sensitive candidate-acceptance workflow.

## O. Required tests

Milestone 2C implementation must include:

- exact invitation state transitions, 72-hour boundary, cancellation, resend rotation, replay and concurrent acceptance;
- 256-bit secret generation, keyed-digest storage, constant-time verification, redaction and absence from URLs/logs beyond the intended opaque link;
- forwarded-link/wrong-employee, missing correlation claim, email change, guest ambiguity, foreign tenant, wrong audience/scope/token type and mapping-conflict denial;
- standard-package atomic activation with no second approval and no pre-activation membership/assignment/scope;
- every privileged role/package requiring a distinct current approver, inviter/self-approval denial, package mutation invalidating approval, and concurrent approval/acceptance;
- exact role/scope matrix, explicit Educator multi-centre and Area Manager portfolio selection, hierarchy validation and no cross-assignment capability/scope recombination;
- multiple independent assignments, effective-dated mover replacement without transient widening, and immediate per-request revocation;
- pending/active/suspended/reactivated/revoked lifecycle, revoked-terminal enforcement and preserved history;
- last-administrator protection for principal, mapping, membership, assignment, scope and role-capability mutations, including concurrent removal attempts;
- outbox transaction rollback, dispatcher retry, Pub/Sub duplicate delivery, provider failure and resend idempotency;
- tenant/cross-centre list/object negative tests and generic non-disclosing errors;
- accessible mobile People & Access, invite, review, mismatch, expiry, approval and lifecycle states;
- generated-client reproducibility, migrations on clean and representative data, dependency/security audits, auth-scope guard, and all Milestone 1/2A/2B regression gates;
- no Graph SDK/permission, Entra group/app-role business authority, local/temporary auth bypass, production bootstrap endpoint, client secret, raw token, or real employee fixture.

## P. Remaining Product Owner decisions

The architecture decisions in this document are approved, Milestone 2B was accepted, and Milestone 2C is **IMPLEMENTED — ACCEPTANCE REMEDIATION IN PROGRESS** pending targeted independent re-review and Product Owner acceptance. The email-provider architecture is implemented through the outbox/Pub/Sub design with a provider-neutral adapter; concrete production provider selection remains deferred. Still-open bounded decisions:

- transactional email provider, sender domain, template owner, delivery/retention policy and support path;
- exact safe email-correlation claim/procedure available in the BSA token configuration, with uncertain guest/member cases remaining review-only;
- retention periods for invitations, intended-email data, delivery attempts and access history;
- authoritative operational source and SLA for joiner/mover/leaver requests until HR integration exists;
- exact policy classification for any role/scope package not in the four standard combinations;
- production first-administrator Encore Cloud mechanism and separate approval;
- break-glass/recovery, support impersonation, MFA/Conditional Access/step-up and access-review operating policy where relevant.

## Q. Milestone name and scope

**MILESTONE 2C — PEOPLE & ACCESS + USER INVITATIONS**

Scope after the implementation gate opens:

- forward-only invitation/principal-lifecycle/outbox schema;
- reviewed capability and canonical System Administrator template update;
- strict invitation state machine and identity-correlation boundary;
- standard atomic activation and privileged two-person approval;
- workflow APIs and approved responsive routes;
- transactional outbox, Encore Pub/Sub dispatch and provider adapter boundary;
- effective-dated access changes, suspension/reactivation/revocation and last-admin protection;
- complete audit history and deterministic security/concurrency tests;
- preserved M2A authentication and M2B business-authorisation boundaries.

Out of scope: HR sync, Microsoft Graph, Entra groups/app roles as business authority, password/local login, production bootstrap implementation, break-glass, support impersonation, other business modules, and real employee seed data.

## R. Authorised implementation checklist — delivered

The authorised implementation followed this checklist:

1. Re-read this document, ADR-0014, AGENTS, security, permissions, database and current authentication/authorisation implementation.
2. Perform a read-only preflight and report conflicts before writes, especially the unmapped invitation-acceptance gateway boundary, existing principal-state migration, email correlation evidence, and production-bootstrap exclusion.
3. Add only reviewed forward migrations for invitation proposals/token generations/events/approval/outbox/delivery concepts, principal lifecycle, capabilities and last-admin database protection.
4. Keep all pending proposals out of active membership/assignment/scope tables.
5. Implement workflow commands/queries with backend actor/tenant resolution, serializable activation, optimistic concurrency, safe audit events and generic errors.
6. Reuse the strict Entra verifier; bind permanent identity only as `tid + oid`; add no Graph, client secret, group/app-role authority, email identity, or auth bypass.
7. Implement standard activation and independent privileged approval exactly as classified, including last-admin protection.
8. Add the outbox/Pub/Sub boundary and a provider interface; use only a separately approved provider/configuration and never log invitation secrets.
9. Build only the approved task-oriented routes with generated Encore client calls and accessible mobile states.
10. Add the complete negative, concurrency, lifecycle, outbox, authorisation and regression test matrix above.
11. Regenerate the client and run backend typecheck, unit/authentication/authorisation tests, PostgreSQL integration tests, frontend tests/lint/typecheck/build, dependency audits, auth-scope guard and diff check.
12. Perform no Git operation, production bootstrap, real-user provisioning, or later milestone work; report evidence and stop for Product Owner acceptance.

## S. Acceptance-remediation evidence

The contained 12 August 2026 remediation preserves the accepted security core while adding migration 018's transaction-local last-administrator validation set, canonical package-format version 2, successful-delivery ciphertext erasure, complete atomic portfolio replacement, exact human-readable approval packages, action-specific destructive confirmations, safe reason-code guidance, and focused migration/replay/tamper/tenant/self-approval/real-verifier/audit-leakage tests. The local gate passed 101 unit, 72 Encore/PostgreSQL integration, and 70 frontend tests plus typecheck, lint, production build, generated-client reproduction, dependency/security guards, fresh migrations through version 18 with `dirty = false`, the unchanged-timeout M2B regression, concurrent mutual-administrator removal, and deployment-style Encore build. Milestone 2C remains **IMPLEMENTED — ACCEPTANCE REMEDIATION IN PROGRESS** until targeted independent re-review and Product Owner acceptance.
