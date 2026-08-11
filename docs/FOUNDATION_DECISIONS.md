# Milestone 1 Foundation Decisions

## Status and boundary

These decisions are approved for **Milestone 1 — Centre Success foundation**. They resolve the minimum technical and authorisation choices needed to build the foundation without approving later business modules or production access.

Milestone 1 contains no compliance, internal-audit, QIP, coaching, wellbeing, budget workflow, notification, AI, or integration functionality.

## Deployment and persistence boundary

- Preserve the existing Encore application, App ID, and Encore Cloud connection at the repository root.
- Start with one cohesive Encore business service and one Encore-managed PostgreSQL database.
- Keep identity/access, centres, and system audit as internal modules; a domain noun does not justify another service or database.
- Place the Next.js application in `frontend/`.

## Identity and runtime API boundary

The database represents a minimal internal principal independently from authentication. A future approved identity provider will map its stable subject to that principal; the provider proves identity, while Centre Success loads current membership, capabilities, and scopes and decides access.

No external identity provider, password flow, temporary login, trusted test header, or runtime authentication handler is approved in Milestone 1. Consequently:

- policy is exercised with synthetic principals in automated tests;
- no client-supplied principal, role, organisation, or centre is trusted;
- no protected business endpoint is publicly exposed; and
- the only public API is a minimal, non-sensitive health endpoint.

Adding a protected runtime endpoint requires the identity-provider/session/MFA decision and an approved Encore authentication handler.

## Authorisation model

Roles are data-driven bundles. Runtime policy evaluates:

`active principal + server-resolved active organisation + principal-owned active membership + capability + matching active scope + resource attributes + conditions`

Missing, stale, ambiguous, cross-organisation, target-selected-tenant, other-principal, or unassigned context is denied. An organisation membership alone grants no business content. A complete valid grant may allow a request; capabilities and scopes from separate assignments cannot be recombined to create wider access.

The canonical foundation roles are:

1. Educator
2. Assistant Director
3. Centre Director
4. Area Manager
5. Compliance Manager
6. Operations Leadership
7. Finance
8. Executive
9. System Administrator

Do not create `Operations` or `Super Admin`. Future roles or capability changes require a documented decision.

### Approved foundation access

| Role | Representative allowed scope | Important exclusion |
| --- | --- | --- |
| Educator | `centre.read` for assigned centre | Unrelated centres and organisation administration |
| Assistant Director | `centre.read` for assigned centre | No automatic equivalence to Centre Director |
| Centre Director | `centre.read` and `centre.manage` for assigned centre(s) | Unrelated centres |
| Area Manager | `centre.read` for effective-dated assigned centres | Unassigned centres |
| Compliance Manager | `organisation.read` and `centre.read` for assigned organisation | Other organisations; Finance, wellbeing, and technical administration |
| Operations Leadership | `organisation.read`, `centre.read`, and relevant `assignment.read` for assigned organisation, state/region, or centre group | No unassigned scope, technical administration, Finance, individual wellbeing, finalised-audit mutation, or compliance closure by default |
| Finance | `organisation.read`, necessary `centre.read`, and synthetic `budget.summary.read` within explicit scope | No budget module in Milestone 1; no compliance, coaching, wellbeing, or system administration |
| Executive | Strategic `organisation.read` and `centre.read` for explicitly assigned organisation | No mutation or system administration merely from Executive role |
| System Administrator | Principal, identity-mapping, assignment, system-configuration, and operational-health administration within authorised technical scope | No automatic centre or other business-content read |

Individual wellbeing data is never implied by Educator, Assistant Director, Centre Director, Area Manager, Compliance Manager, Operations Leadership, Finance, Executive, or System Administrator access.

Multiple roles remain separate grants. For example, Operations Leadership for one state plus Centre Director for one centre grants each capability only within its own assignment. System Administrator plus Compliance Manager is different from System Administrator alone.

## Required synthetic policy evidence

Tests cover:

- Educator and Centre Director own-centre allow and other-centre deny;
- Area Manager assigned-centres allow and unassigned-centre deny;
- Compliance Manager assigned-organisation allow and cross-organisation deny;
- Operations Leadership region/state allow, out-of-scope deny, organisation-scope allow, and no-assignment deny;
- Finance capability recognition without compliance authority;
- Executive read scope without implied mutation or administration;
- System Administrator technical administration without business-content access;
- multi-role grants without cross-scope capability borrowing;
- cross-organisation denial and unassigned-principal denial; and
- deactivated, expired, missing, ambiguous, and conflicting context denial.

## Local frontend/backend contract

- Local browser calls are uncredentialed and allowed only from `http://localhost:3000`.
- Do not enable wildcard or credentialed CORS.
- The frontend calls the real local Encore public health endpoint.
- Use Encore's official generated TypeScript client rather than duplicating API contracts.
- Commit the generated frontend client. Regenerate it whenever an Encore API contract changes and review the generated diff.
- Generated output is not hand-edited.

## Deferred decisions

- identity provider, auth handler, session/cookie-or-token model, MFA, recovery, and step-up;
- protected organisation/centre APIs and any authenticated frontend experience;
- detailed hierarchy nesting and authoritative assignment integration;
- the server-side database context loader that will filter current role definitions, assignments, and effective hierarchy before the first protected API;
- break-glass or support impersonation;
- production CORS origins and deployment/security operations; and
- capabilities, data policies, and workflows for later business modules.
