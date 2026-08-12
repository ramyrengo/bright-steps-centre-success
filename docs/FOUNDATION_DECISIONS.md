# Foundation and Authentication-Gate Decisions

## Status and boundary

The foundation decisions were accepted with **Milestone 1 — Centre Success foundation**. The identity/runtime additions in this document are approved only for **Milestone 2A — Authentication Gate**. Together they establish the minimum technical, authentication, and authorisation boundary without approving later business modules or production access.

Milestone 2A contains no compliance, internal-audit, QIP, daily-success, coaching, wellbeing, budget workflow, notification, AI, HR synchronisation, Microsoft Graph, or other business functionality.

## Deployment and persistence boundary

- Preserve the existing Encore application, App ID, and Encore Cloud connection at the repository root.
- Start with one cohesive Encore business service and one Encore-managed PostgreSQL database.
- Keep identity/access, centres, and system audit as internal modules; a domain noun does not justify another service or database.
- Place the Next.js application in `frontend/`.

## Identity and runtime API boundary

The database represents a minimal internal principal independently from authentication. Microsoft Entra ID tenant `27026100-3522-48b5-8e95-80230afc4127` is approved in Milestone 2A to prove who signed in. The verified Entra `tid + oid` pair maps through `external_identity_mappings` to that principal as `provider_key = 'microsoft_entra:27026100-3522-48b5-8e95-80230afc4127'` and the raw `oid` provider subject. Centre Success—not Entra—loads current membership, assignment-bound capabilities, and scopes and decides access.

Two single-tenant Entra app registrations separate Centre Success Web client `b490189d-37c1-422c-a54a-b12d55646947` from Centre Success API client `5e8ce11c-ade3-4baa-82f6-351919b444ca`. The Next.js application uses MSAL Authorization Code with PKCE and the `/redirect` bridge to obtain a delegated Centre Success API access token for `api://5e8ce11c-ade3-4baa-82f6-351919b444ca/access_as_user`; it never sends an ID token or Microsoft Graph token to Encore. The connected smoke proves the current Web registration accepts the exact `/redirect` SPA URI; the confirmed root URI remains the post-logout landing. One central Encore auth handler resolves rotating signing keys through the BSA tenant OIDC/JWKS metadata and strictly validates RS256, `kid`, the exact v2 issuer, `tid`, API-client-ID `aud`, Web-client-ID `azp`, `ver`, time claims, and scope. It resolves an active mapping and active principal and returns minimum AuthData containing only the internal principal UUID as Encore `userID`.

The Product Owner's final local proof on 11 August 2026 exercised that complete chain with a real BSA Microsoft session and Centre Success API access token. After the approved local `tid + oid` mapping was created, protected `/foundation/me` resolved the synthetic Local System Administrator principal and its active synthetic organisation context; the browser displayed Connected and Ready. The synthetic records and explicit local mapping are evidence of the seam only and are not a production provisioning mechanism.

Consequently:

- no client-supplied principal, user, role, capability, organisation, centre, or ancestry is trusted;
- a valid unmapped Entra identity and an inactive mapping or internal principal receive no Centre Success access;
- Entra groups, app roles, claims, and authentication methods grant no Centre Success business authority;
- zero active organisation memberships return only `provisioningStatus: "not_provisioned"`, exactly one is resolved server-side, and multiple fail closed for Milestone 2A;
- the protected self-context endpoint reloads `PrincipalAuthorisationContext` from PostgreSQL for every request; and
- the public health API remains minimal and non-sensitive.

No temporary login, trusted test identity header, public self-registration, auto-provisioning, Microsoft Graph permission, or business endpoint is approved. MFA, recovery, Conditional Access, step-up, multi-organisation selection, and future business API decisions remain separately gated. See ADR-0012.

### Implemented People & Access boundary

ADR-0014 supersedes the earlier operational recommendation to require Entra enterprise-application user assignment. The approved setting is **User assignment required = No**. An exact-tenant Entra identity may authenticate, but authentication creates no internal principal mapping, membership, capability, scope, or application access; unmapped and uninvited identities remain `not_provisioned`.

Milestone 2C is **ACCEPTED / COMPLETE**. The workflow uses System-Administrator-created invitations, 72-hour one-time token generations, pending proposals outside active authorisation tables, permanent `tid + oid` identity, standard atomic activation, independent approval for privileged packages, non-recombining assignments, and at least one reachable active System Administrator. Microsoft Graph, Entra groups/app roles, email identity, HR synchronisation, and a permanent production bootstrap remain outside the approved boundary. See `docs/PEOPLE_AND_ACCESS.md` and ADR-0014.

### Implemented Daily Success boundary

Milestone 3A is implemented for independent review, not accepted. ADR-0015 adds one protected read-only request-time projection and makes `/` the operational home without changing the provider-neutral principal, PostgreSQL authorization source, modular-monolith deployment, or database ownership model. Current source capabilities and scopes—not role names or selected perspectives—derive Centre, Portfolio, Compliance, and administration-only views. One set-wise hierarchy query replaces per-centre authorizer calls. There is no Daily Success persistence, source-fact copy, notification, task mutation, or authorization cache. See `docs/DAILY_SUCCESS.md`.

## Authorisation model

Roles are data-driven bundles. Runtime policy evaluates:

`active principal + server-resolved active organisation + principal-owned active membership + capability + matching active scope + resource attributes + conditions`

Missing, stale, ambiguous, conflicting, cross-organisation, target-selected-tenant, other-principal, or unassigned context is denied. An organisation membership alone grants no business content. A complete valid grant may allow a request; capabilities and scopes from separate assignments cannot be recombined to create wider access. The internal loader reads principal, active membership, active role definition, capabilities, and effective assignment scopes from one repeatable PostgreSQL snapshot. It is not an API.

Centre resources obtain their effective organisational-unit ancestry from one tenant-constrained recursive PostgreSQL query. API callers do not construct ancestry. Membership, role assignment, assignment scope, and centre placement windows use `effective_from <= at < effective_to`; simultaneous centre placements, inactive lineage, or hierarchy cycles deny access.

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

The versioned nine-role template baseline and capability mappings are persisted by migration. New organisations receive linked organisation-owned role definitions so later changes can create a new version; this provisioning creates no principal, membership, assignment, or access grant. Automated tests keep the database mappings and TypeScript capability model in exact agreement.

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

## Required foundation policy evidence

Pure and database-backed tests cover:

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

Database integration evidence also covers nested state/region ancestry, centre moves, effective portfolio removal, future assignments, overlapping valid grants, canonical role provisioning, and append-only audit records.

## Environment frontend/backend contract

- Local browser calls to protected Encore APIs carry only a Centre Success API access token as a Bearer header. The committed authenticated CORS origin is exactly `http://localhost:3000`; Encore's all-origin local-development convenience does not change the deployed allowlist.
- The confirmed staging backend/API origin is `https://staging-bright-steps-centre-success-uwhi.encr.app`. It is an API transport origin only, not an Entra SPA redirect URI, post-logout URI, or authentication audience.
- No staging frontend has been approved or deployed. Its browser origin, CORS entry, Entra redirect URI, and post-logout URI remain unconfigured until separately approved.
- The API app registration defines authentication trust: Application ID URI `api://5e8ce11c-ade3-4baa-82f6-351919b444ca`, delegated scope `api://5e8ce11c-ade3-4baa-82f6-351919b444ca/access_as_user`, and exact version 2 token `aud = 5e8ce11c-ade3-4baa-82f6-351919b444ca`. Never derive these from an Encore deployment URL.
- Do not enable wildcard origins or cookie-based cross-origin credentials.
- The frontend calls the real local Encore public health and protected self-context endpoints.
- One central frontend adapter obtains the Entra API token from MSAL and configures the generated client; React components do not acquire tokens independently or construct identity headers.
- Use Encore's official generated TypeScript client rather than duplicating API contracts.
- Commit the generated frontend client. Regenerate it whenever an Encore API contract changes and review the generated diff.
- Generated output is not hand-edited.

## Deferred decisions

- MFA, recovery, session-revocation expectations, authentication assurance, and step-up;
- multi-organisation active-context selection/persistence beyond the exact-one Milestone 2A gate;
- Milestone 3B and later product workflows beyond the approved Daily Success read projection;
- authoritative organisation/portfolio source integration, hierarchy ownership, and propagation SLA;
- break-glass or support impersonation;
- production CORS origins and deployment/security operations; and
- capabilities, data policies, and workflows for later business modules.
- People & Access operational decisions still enumerated in `docs/PEOPLE_AND_ACCESS.md`, including the production email provider, correlation-claim operations, retention, JML operating source/SLA, production first-administrator mechanism, and break-glass/recovery policy.
