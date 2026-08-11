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

When a principal has multiple roles, access is the union of complete valid grants. Each allow path must independently supply both the requested capability and a matching current scope. Capabilities and scopes from unrelated assignments cannot be recombined to manufacture broader access.

## Data classes

1. **Public/approved publication:** explicitly approved for public or broad family access.
2. **Internal:** routine centre operational information.
3. **Confidential:** findings, staff information, budget detail, coaching, restricted evidence.
4. **Highly restricted:** identifiable wellbeing/support data, child-related sensitive evidence, credentials/security data, legal matters, break-glass records.

Classification controls read, search, aggregation, download, export, notification content, AI retrieval, logging, and retention. A lower-class target record cannot be used to launder a higher-class attachment or comment.

## Authorisation decision sequence

For every protected endpoint or internal command:

1. Require authentication and load current account/membership status.
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
- Resolve a centre's effective organisational-unit ancestry through the one canonical recursive data-layer query; callers never submit ancestor IDs.
- Keep domain-specific rules beside the owning module, invoked through one consistent decision interface.
- Require organisation predicates in repository/query interfaces so accidental unscoped access is difficult.
- Return only authorised fields through explicit response models; avoid serialising database rows directly.
- Treat exports, counts, search, autocomplete, logs, metrics labels, object metadata, and notifications as data disclosure surfaces.
- Cache only non-sensitive decisions briefly and invalidate on membership, role, assignment, delegation, or resource changes.

PostgreSQL row-level security is not assumed. If evaluated later as defence in depth, it would supplement—not replace—Encore application authorisation and require an approved architecture decision.

### Milestone 1 authentication seam

The external identity provider, session, and MFA model remain unapproved. Milestone 1 therefore exercises the pure policy and database-backed context/hierarchy loaders with synthetic internal principals. The loaders are internal functions, not APIs, and do not accept a principal, role, organisation, centre, or ancestry asserted by an untrusted HTTP client. No protected business API is exposed until an approved runtime authentication handler can establish trusted identity and active tenant. The only public endpoint is a minimal non-sensitive health check.

## Audit and monitoring

Always audit privileged assignment changes, control/template approval, audit finalisation/reopening, high-risk closure, evidence export/restriction changes, finance import/configuration, wellbeing administration/access, AI administrative changes, and break-glass activity. Monitor repeated denials, identifier probing, unusual export volume, cross-centre access patterns, and stale privileged accounts without logging sensitive payloads.

## Required authorisation tests

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

## Decisions deferred beyond the authorised foundation

- Identity provider, session model, MFA and step-up policy before any protected runtime endpoint.
- Future domain capability catalogues and role-bundle changes beyond the approved Milestone 1 set.
- Authoritative organisation/portfolio source, assignment owner, and propagation SLA; recursive foundation hierarchy evaluation is implemented.
- Wellbeing aggregation thresholds and support roles.
- Finance category visibility.
- Break-glass and external-review access.
- Detailed access-audit retention and review cadence.
