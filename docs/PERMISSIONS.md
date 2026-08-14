# Permissions and Backend Authorisation

## Security objective

No user, integration, background job, or AI tool may read or change a resource unless the Encore backend has independently established identity, capability, tenant, resource scope, data classification, purpose, and applicable conditions.

Hiding a route, button, field, dashboard card, or centre selector in Next.js is usability only. It is never authorisation.

## Model: RBAC plus scoped attributes

Centre Success combines:

- **role-based capability:** what kind of action the user may perform;
- **attribute/resource scope:** which organisation, state/region, centres, assigned records, data classes, and time window the capability applies to;
- **relationship rules:** participant, assignee, owner, auditor, verifier, or explicitly named support recipient;
- **policy conditions:** separation of duties, record state, delegation validity, purpose, and step-up assurance.

Effective access is evaluated per request from server-side records. Claims may identify a session and stable user subject, but mutable centre assignments and role scope must not live only in a long-lived token.

For Milestone 2A, Microsoft Entra ID in the single Bright Steps Australia tenant proves identity only. A strictly verified `tid + oid` pair maps to an active internal principal; Entra groups, app roles, token roles, authentication method, and frontend state never grant a Centre Success capability or scope. PostgreSQL remains the authorisation source of truth.

## Scope types

| Scope | Meaning | Typical use |
| --- | --- | --- |
| Organisation | All permitted resources in one tenant, still limited by classification/capability | Compliance Manager, Operations Leadership, Finance, or Executive |
| State/region | Current descendant centres resolved through an effective-dated organisational-unit hierarchy | Operations Leadership |
| Assigned centres | Explicit effective-dated portfolio or centre-group set from current assignment data | Area Manager or Operations Leadership |
| Centre | One or more named centres | Centre Director or contributor |
| Record | A named task, audit, action, coaching cycle, or support request | Contributor/reviewer |
| Self | User’s own low-risk profile/preferences | All users |
| Aggregate-only | Approved de-identified/suppressed aggregate, no drill-through | Wellbeing or Executive view |

An organisation scope does not override sensitive-data rules. A user with several organisations must operate within one explicit active tenant context resolved by the backend.

## Approved Milestone 1 role bundles

Roles are data-driven convenience bundles. Versioned canonical templates are stored in PostgreSQL and provision organisation-owned role definitions without creating memberships or assignments. The authoriser evaluates capability plus the effective scope of the assignment that granted it; it does not contain role-name shortcuts.

| Canonical role | Foundation capabilities | Normal foundation test scope | Required negative boundary |
| --- | --- | --- | --- |
| Educator | `centre.read` | Assigned centre | Other centres and organisation administration |
| Assistant Director | `centre.read`; additional management only by explicit grant | Assigned centre | Other centres; no implied Centre Director equivalence |
| Centre Director | `centre.read`, `centre.manage` | Assigned centre(s) | Unrelated centres |
| Area Manager | `centre.read` | Effective-dated assigned centres | Unassigned centres |
| Compliance Manager | `organisation.read`, `centre.read` | Assigned organisation | Other organisations; no Finance, wellbeing, or system administration |
| Operations Leadership | `organisation.read`, `centre.read`, `assignment.read` | Explicit organisation, state/region, or assigned-centres group | Anything outside assignment; no technical or sensitive-domain privilege |
| Finance | `organisation.read`, `centre.read`, synthetic `budget.summary.read` | Explicitly assigned organisation/region/centres | No compliance, coaching, wellbeing, or system administration |
| Executive | `organisation.read`, `centre.read` | Explicit organisation strategic/read scope | No mutation or administration merely from the role |
| System Administrator | `principal.read`, `principal.manage`, `identity.mapping.manage`, `assignment.read`, `assignment.manage`, `system.configure`, `system.health.read` | Authorised technical scope | No business-content read through technical privilege |

`budget.summary.read` proves that a scoped financial capability can be represented; it does not authorise a budget module in Milestone 1. The same applies to future business capabilities: they require their own domain approval and resource/classification policy.

### Approved Milestone 2B domain capability bundles

The following capabilities extend new canonical role-template versions. Existing organisation assignments are migrated to matching reviewed role definitions; the authoriser still evaluates capability and scope, never the role name.

| Canonical role | Milestone 2B capabilities |
| --- | --- |
| Area Manager | `quarterly_audit.read`, `quarterly_audit.conduct`, `quarterly_audit.finalise`, `finding.read`, `corrective_action.read`, `corrective_action.verify`, `evidence.read` |
| Centre Director | `quarterly_audit.read`, `quarterly_audit.acknowledge`, `finding.read`, `corrective_action.read`, `corrective_action.remediate`, `evidence.read`, `evidence.upload` |
| Compliance Manager | `compliance.oversight.read`, `quarterly_audit.read`, `finding.read`, `corrective_action.read`, `corrective_action.verify`, `evidence.read` |
| System Administrator | No Milestone 2B business-content capability |
| Executive | No Milestone 2B mutation capability |

Template publication remains migration/local-development seed governance in this slice; no generic template-administration API is introduced.

### Authorised Area Manager Template & Form Builder capability bundle

The ADR-0020 implementation adds `template.read`, `template.create`,
`template.publish`, and `template.assign`. Canonical Area Manager template
version 3 carries those four capabilities alongside its accepted quarterly
review bundle. Each allow path still obtains the capability and a matching
current centre or portfolio scope from the same PostgreSQL assignment.

Operational templates are organisation-owned reusable content, but draft
mutation and publication require an Area Manager with at least one current
authorised centre and are owner-bound in the initial slice. Assignment resolves
and validates every target centre from the current backend authorisation
context. The `PORTFOLIO` target is never a client-provided centre list. System
Administrator receives none of these business-content capabilities through
technical privilege.

When a principal has multiple roles, access is the union of complete valid grants. Each allow path must independently supply both the requested capability and a matching current scope. Capabilities and scopes from unrelated assignments cannot be recombined to manufacture broader access.

### Implemented Milestone 2C capability boundary

Milestone 2C implements the reviewed keys `invitation.read`, `invitation.manage`, `privileged_access.approve`, and `access_history.read` alongside existing `principal.read`, `principal.manage`, `identity.mapping.manage`, `assignment.read`, and `assignment.manage`. Canonical System Administrator template version 2 owns that exact technical administration bundle. `access.change.request` is registered but remains ungranted and reserved for a later approved Operations Leadership request workflow; it is not direct grant or activation authority. No other canonical role receives People & Access administration automatically.

Only a current, appropriately scoped System Administrator may initially create/manage invitations. The four standard packages—Educator with explicit centre(s), Assistant Director with centre scope, Centre Director with centre scope, and Area Manager with an explicit selected-centre portfolio—may activate after verified identity without another approval when the current invitation package passes all checks. System Administrator, Executive, Finance, Compliance Manager, organisation-wide Operations Leadership, and any policy-designated privileged package require a distinct current System Administrator to approve the exact package. The requester/inviter cannot provide their own independent approval.

Invitation proposals confer no authority and must not appear in active organisation memberships, role assignments, or assignment scopes. Activation creates independent grants atomically. A policy allow path must still obtain capability and matching scope from the same assignment. Every mutation that could remove the final reachable active System Administrator is denied under a cross-table transactional/database invariant; the operational target is at least two. Full rules are in `PEOPLE_AND_ACCESS.md` and ADR-0014.

### Implemented Milestone 3A Daily Success projection boundary

Daily Success adds no new grant and never authorises from a role name or selected perspective. It reuses current source capabilities under the existing capability-plus-same-assignment-scope policy:

- Centre perspective qualification and rows derive from current `corrective_action.read`/`corrective_action.remediate`, `quarterly_audit.read`, and `quarterly_audit.acknowledge` decisions for the requested centre.
- Portfolio qualification and rows derive separately from current `quarterly_audit.conduct` and `corrective_action.verify` decisions for each effective assigned centre.
- Compliance qualification requires current organisation-scoped `compliance.oversight.read`; returned source facts remain limited to the approved corrective-action/finding exception subset.
- Administration qualification requires current organisation-scoped `invitation.read` plus `invitation.manage` or `privileged_access.approve`; People & Access independence rules still apply.

The backend loads one principal context and centre hierarchy set-wise, evaluates each capability independently, restricts source SQL by the resulting centre IDs, and aggregates only afterwards. A capability from one assignment cannot borrow scope from another. Requested perspective/centre values are presentation selectors and are denied when not present in the newly derived available set. System Administrator has no Daily Success business-content view through technical capabilities. Counts, completed-today context, centre attention bands, and on-track state contain only currently authorised records. See `DAILY_SUCCESS.md` and ADR-0015.

## Data classes

1. **Public/approved publication:** explicitly approved for public or broad family access.
2. **Internal:** routine centre operational information.
3. **Confidential:** findings, staff information, budget detail, coaching, restricted evidence.
4. **Highly restricted:** identifiable wellbeing/support data, child-related sensitive evidence, credentials/security data, legal matters, break-glass records.

Classification controls read, search, aggregation, download, export, notification content, AI retrieval, logging, and retention. A lower-class target record cannot be used to launder a higher-class attachment or comment.

## Authorisation decision sequence

For every protected endpoint or internal command:

1. Require authentication, map the verified provider subject to the active internal principal, and load current account/membership status.
2. Resolve the target resource by opaque identifier without returning data.
3. Confirm target `organisation_id` equals the active authorised organisation.
4. Load active role assignments/delegations and calculate capabilities.
5. Derive centre/region/record relationships server-side.
6. Check capability plus scope.
7. Check classification, purpose, record state, step-up, and separation-of-duties conditions.
8. Deny on missing/ambiguous data using a generic response that does not disclose existence.
9. Record material allow/deny/security audit data under policy.
10. Execute the query or state transition with organisation/scope constraints and concurrency control.

Bulk endpoints authorise every resource, not just the filter. Search results and counts are filtered before return. File access is authorised at URL issuance and uses short expiry.

## Future domain capability summary

Legend: `M` manage/perform in scope; `R` read in scope; `A` aggregate/summary only; `—` none by default. Fine-grained capabilities and record-state rules still apply.

| Domain | Centre Director | Area Manager | Compliance | Finance | Executive | Educator | Wellbeing Admin | System Administrator |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Centre/daily work | M centre | R/M assigned | R authorised | — | A/R authorised | Assigned records | — | Config only |
| Controls/tasks | M centre tasks, R controls | M assigned | M authorised, approve by duty | — | A | Assigned tasks | — | — |
| Evidence | M permitted centre | M assigned/permitted | M authorised/permitted | — | A/R only if permitted | Assigned purpose | — | — |
| Findings/actions | M centre response | M assigned | M authorised | — | A/R permitted | Assigned action | — | — |
| Internal audits | Respond/read centre | Perform assigned | Govern/moderate | — | A/R permitted | Assigned contribution | — | — |
| QIP/quality | M centre | R/M assigned | R authorised | — | A | Contribute assigned | — | — |
| Coaching | Participant | Participant/manager | — by default | — | A only if approved | — | — | — |
| Wellbeing | Own participation; safe aggregate | Safe aggregate only if approved | — by default | — | Safe aggregate | Own participation | Campaign/aggregate; support only explicit | — |
| Budget | Permitted centre summary/detail/comment | Permitted assigned summary | — | M authorised | A/R authorised | — | — | — |
| Centre Health | R centre | R assigned | R authorised | Finance dimension only as approved | A/R authorised | — | Safe aggregate contribution only | — |
| Identity/access | — | — | — | — | — | — | — | M assignments without content read |
| Audit log/export | Own/centre limited | Assigned limited | Authorised | Finance limited | Authorised | — | Wellbeing audit limited | Security/technical limited |

This broader-domain matrix remains a design baseline for later milestones. It does not add Milestone 1 capabilities. Assistant Director never inherits every Centre Director capability automatically, and Operations Leadership receives future operational/quality summary capabilities only when they are explicitly added and scoped.

## Sensitive wellbeing scope

- Participation eligibility does not grant response read access.
- Anonymous/confidential campaign configuration defines whether identity is collected at all.
- Raw individual responses are excluded from Area Manager, Centre Director, Operations Leadership, Executive, Compliance, Finance, System Administrator, AI, audit, and Centre Health access by default.
- Aggregate reads require minimum cohort and anti-reidentification rules; filtered slices that fall below threshold are suppressed.
- An identified support request is a separate record visible only to the requestor and explicitly authorised support recipients.
- Emergency/support workflows disclose only under an approved process and applicable law; no architecture document assumes such a basis.

## Finance scope

Finance capabilities distinguish summary, permitted category detail, import/reconciliation, configuration, forecast, and export. Centre Directors see only their centres and allowed categories. Area Managers and executives receive the exact scope explicitly assigned. Restricted payroll, individual remuneration, bank, tax, or vendor-sensitive detail is excluded unless separately approved.

## Area, Compliance, and Operations Leadership scope

- Area Manager access derives from effective-dated centre assignments, not from a client-provided region filter.
- Moving a centre changes future portfolio access promptly; historical audit authorship remains.
- Compliance Manager foundation scope is organisation-wide Quality & Compliance access for the explicitly assigned organisation, still limited by capability and data class.
- None of these roles automatically gains individual wellbeing access; Area Manager and Compliance Manager do not gain Finance access by default.
- Operations Leadership is business oversight within an explicit organisation, state/region, or assigned-centres group. It gains neither unassigned-centre access nor technical administration and must receive Finance or future domain capabilities separately.

## Delegation and exceptional access

Delegation specifies grantor, grantee, capabilities, centres/resources, start/end, reason, approval, and notification. It cannot grant a capability the delegator is not authorised to delegate. Expiry is automatic and active sessions re-evaluate access.

Break-glass, if approved, requires strong re-authentication, reason, incident/reference, minimal duration, immediate alert to data/security owners, enhanced logging, and retrospective review. It is never a support convenience.

## Service, job, integration, and AI identities

- Background jobs use a named service principal with only required capabilities and a declared organisation scope per item.
- Pub/Sub messages carry identifiers, not trusted authorisation decisions; the subscriber reloads and reauthorises current state as appropriate.
- Integrations have connection-specific scope, secret references, permitted operations, rate limits, and revocation.
- AI tools execute through the same authorised application services; the model never receives database or bucket credentials.
- Server-to-server Encore calls preserve actor/correlation context while the receiving module owns final authorisation.

## Enforcement architecture

- Centralise policy evaluation and typed scope helpers in the modular monolith.
- Construct principal context from PostgreSQL in one consistent read snapshot, using a trusted internal principal and independently established active organisation.
- Obtain that trusted principal only from the central Encore AuthData created after strict Entra API access-token verification and active external-mapping resolution; AuthData carries no provider identity, role, capability, scope, organisation, or centre authority.
- Resolve a centre's effective organisational-unit ancestry through the one canonical recursive data-layer query; callers never submit ancestor IDs.
- Keep domain-specific rules beside the owning module, invoked through one consistent decision interface.
- Require organisation predicates in repository/query interfaces so accidental unscoped access is difficult.
- Return only authorised fields through explicit response models; avoid serialising database rows directly.
- Treat exports, counts, search, autocomplete, logs, metrics labels, object metadata, and notifications as data disclosure surfaces.
- For Milestone 2A, do not cache business authorisation decisions across requests; reload mapping, principal, membership, assignment, capability, and scope facts so internal revocation applies immediately. A separately approved later cache must be short-lived and safely invalidated.

PostgreSQL row-level security is not assumed. If evaluated later as defence in depth, it would supplement—not replace—Encore application authorisation and require an approved architecture decision.

### Milestone 2A authentication connection

Microsoft Entra ID tenant `27026100-3522-48b5-8e95-80230afc4127` is the approved authentication provider. The central Encore auth handler accepts only an RS256 version 2 access token for the Centre Success API with the exact BSA issuer/`tid`, `aud = 5e8ce11c-ade3-4baa-82f6-351919b444ca`, `azp = b490189d-37c1-422c-a54a-b12d55646947`, valid time window, and `access_as_user` scope. It resolves canonical `provider_key = 'microsoft_entra:27026100-3522-48b5-8e95-80230afc4127'` plus the raw lower-case Entra `oid` through `external_identity_mappings` and returns only the active internal principal UUID in Encore's required `userID` field. Missing/inactive mappings and inactive principals deny access. Entra permissions, groups, roles, email, UPN, and other mutable claims are ignored for business authorisation.

The authentication-gate self-context endpoint then uses the existing database-backed context loader; it does not duplicate policy. Zero current active organisation memberships return only `provisioningStatus: "not_provisioned"`, exactly one is resolved server-side, and multiple fail closed. An organisation or centre identifier supplied in a future request is a requested resource, never identity context or proof of access, and remains subject to independent backend resolution and capability/scope checks. The public health check stays unauthenticated and non-sensitive.

## Audit and monitoring

Always audit privileged assignment changes, control/template approval, audit finalisation/reopening, high-risk closure, evidence export/restriction changes, finance import/configuration, wellbeing administration/access, AI administrative changes, and break-glass activity. Monitor repeated denials, identifier probing, unusual export volume, cross-centre access patterns, and stale privileged accounts without logging sensitive payloads.

## Required authorisation tests

- Missing/malformed credentials, invalid signatures, expired/not-yet-valid tokens, wrong `tid`/issuer/API audience/Web-client `azp`, wrong version, missing/wrong scope, and unknown signing keys are rejected with no provider detail leak.
- SPA/ID-token and Microsoft Graph/unrelated-resource audiences are rejected; an Entra `roles` claim cannot replace the delegated `access_as_user` scope or grant a business permission.
- Unknown `kid` causes at most one controlled, single-flight, cooldown-governed JWKS refresh; rotation to a current key succeeds and a still-unknown key is denied.
- A valid Entra identity with no active external mapping, an inactive mapping, or an inactive internal principal receives no Centre Success access.
- A mapped active principal with zero active memberships receives only the authenticated `not_provisioned` projection; exactly one loads context and multiple fail closed.
- A malformed Bearer credential on the public health route is exercised through the actual Encore gateway and documents Encore's public-route authentication behaviour rather than assuming direct-handler semantics.
- Frontend tests cover MSAL initialization/redirect completion, explicit active-account selection, silent API-token acquisition, interaction-required handling without loops, sign-out/root return, safe UI states, and the one generated-client adapter without exposing token material.
- A valid token cannot bypass cross-organisation, expired-assignment, capability, or scope denial; the client cannot select its principal.
- User from organisation A cannot infer or access organisation B by ID, search, count, file, export, or event.
- Educator and Assistant Director can read their assigned centre but not another centre; neither receives organisation administration.
- Centre Director cannot access another centre by changing a route/body/filter.
- Area Manager loses an unassigned centre promptly and gains only approved new scope.
- Compliance Manager can read centres in the assigned organisation but not another organisation and receives no Finance or system-administration capability.
- Operations Leadership can read centres in an assigned state/region or organisation, cannot read outside that scope, and receives nothing without an assignment.
- Effective portfolio removal and centre moves change access at their half-open effective-date boundary.
- Finance has its explicitly scoped financial capability and necessary centre metadata but no Compliance Manager capability.
- Executive read scope does not imply mutation, administration, or unrestricted drill-through.
- System Administrator can perform authorised principal/assignment administration but cannot read business content through technical privilege.
- A multi-role principal receives the union of complete scoped grants without borrowing capability or scope between assignments.
- An unassigned principal is denied by default.
- Expired delegation and deactivated membership are rejected on the next request.
- Wellbeing suppression cannot be bypassed through filters, exports, AI, or repeated queries.
- Evidence access is denied when target access exists but evidence classification/purpose does not.
- Bulk operations do not partially process unauthorised resources unless the API contract safely and explicitly supports it.
- Pub/Sub replay cannot apply a transition under a stale or wrong-tenant context.

## Decisions deferred beyond the authorised Milestone 2B slice

- MFA, recovery, session-revocation, assurance and step-up policy before affected high-risk operations.
- Multi-organisation active-context selection/persistence beyond the Milestone 2A exact-one fail-closed rule.
- Any People & Access capability/template expansion beyond the implemented System Administrator version-2 bundle, including an Operations Leadership request workflow.
- Future domain capability catalogues and role-bundle changes beyond the approved Milestone 2B and People & Access architecture sets.
- Authoritative organisation/portfolio source, assignment owner, and propagation SLA; recursive foundation hierarchy evaluation is implemented.
- Wellbeing aggregation thresholds and support roles.
- Finance category visibility.
- Break-glass and external-review access.
- Detailed access-audit retention and review cadence.
