# ADR-0020: Area Manager Template & Form Builder

## Status

Accepted as exactly one next product-slice authorisation by the Product Owner on
13 August 2026. This decision deliberately assigns no Milestone 4B, 4C or 4D
number to the slice.

This is a governance authorisation for implementation within the boundary below.
It does not record implementation or acceptance of this slice, hosted CI,
deployment, production data use, production acceptance, or production readiness.

The preceding Centre Standards Milestone 4A implementation passed its **local
implementation gate** at integration commit `1bf06b7`. The recorded evidence is:

- frontend tests passed 280/280;
- frontend typecheck passed;
- frontend production build passed;
- migrations 020–022 passed;
- Encore/PostgreSQL database-backed integration tests passed;
- the Centre Standards query-budget gate passed; and
- the integration worktree was clean.

That evidence is local only. No hosted-CI or production claim is made from it.

## Context

The locally gated Centre Standards Milestone 4A implementation provides the
operational occurrence/completion engine. The next authorised need is for Area
Managers to define reusable operational templates and forms that run through
that engine. A separate forms subsystem would duplicate scheduling, occurrence,
completion, authorisation, audit and remediation concepts and would create
competing workflow truths.

Milestone 2B's Quarterly Area Manager Audit remains an accepted, distinct
workflow. This slice does not turn that workflow into builder-authored content
and does not redesign it.

## Decision

Add an **Area Manager Template & Form Builder** as the authoring and assignment
surface for reusable Centre Standards operational templates/forms. The builder
must use the existing Centre Standards occurrence/completion engine; it is not a
general-purpose or disconnected forms system.

### Template library and content

The authorised product boundary includes:

- a reusable operational template/form library;
- sections and questions with explicit ordering;
- initial question types of Yes/No, single select, multi-select, text, number
  and date;
- required or optional configuration for each question; and
- a phone preview that must be available before publication.

Phone preview is a pre-publication representation of the operational form. It
does not itself publish a version, assign a centre, create an occurrence, record
a completion, or confer authority.

### Lifecycle and version history

Templates use the lifecycle **Draft**, **Published** and **Retired**. A published
version is immutable and remains in version history. Later changes must not
rewrite a published version or the version lineage of occurrences and
completions that used it. Retirement must not erase or mutate published history.

### Centre assignment and scheduling

A published operational template may be assigned to:

- one centre within the Area Manager's authorised scope;
- selected centres, each within that authorised scope; or
- the Area Manager's backend-authorised portfolio.

The portfolio option is resolved from current PostgreSQL authority and scope; it
is not a client-supplied list or a role-name grant. The backend must validate
every centre affected by any assignment.

Authorised schedules are daily, weekly, monthly, quarterly and ad-hoc. The slice
also includes due-time/configuration. Schedule and due configuration must feed
the existing Centre Standards occurrence/completion engine and preserve its
trusted server-side time, centre-scope and completion boundaries. This decision
does not invent additional recurrence types or due-date semantics.

### Answer and remediation rules

Published versions may carry configurable answer/remediation rules. Where a
configured answer outcome requires follow-up, those rules may feed the
**existing** finding/corrective-action architecture.

The builder must not create parallel finding, corrective-action, remediation or
verification state. Existing source lineage, authorisation, auditability,
idempotency, corrective-action ownership, remediation and independent
verification boundaries continue to govern. Not every answer must create a
finding or corrective action; the published configuration determines whether
the existing architecture is invoked.

### Authorisation and audit

All protected library, draft, preview, publish, retire, assignment, scheduling,
occurrence, completion and remediation operations must be authorised in the
backend using current PostgreSQL capabilities and resource scope. Frontend
visibility, an Area Manager role name, a client-supplied centre list, or a
client-supplied portfolio is never authority. Exact new capability names are not
invented by this governance decision and require review within this boundary.

Material template, version, lifecycle, assignment, schedule, due-configuration
and answer/remediation-rule changes require an attributable audit trail. Existing
authentication and authorisation boundaries remain unchanged: Entra proves
identity; Centre Success PostgreSQL grants business access; System Administrator
technical privilege does not confer operational content access.

## Explicitly not authorised

This slice does not authorise:

- Centre Budgets;
- redesign of the existing Quarterly Area Manager Audit workflow;
- Centre Health Score or any composite Centre Health methodology;
- AI business functionality;
- production deployment;
- production data;
- unrelated later modules; or
- any other expansion beyond the product boundary in this ADR.

All other later business modules remain locked.

## Consequences

The builder extends the existing Centre Standards operational loop with governed
authoring, versioning, assignment and scheduling. Published version history and
completed operational records remain stable, while configured negative outcomes
can enter the already accepted finding/corrective-action path without creating a
second remediation system.

Implementation must retain the repository's established vertical-slice gates:
backend capability and resource-scope enforcement, denied cross-scope tests,
attributable audit tests, lifecycle/version immutability tests, occurrence and
completion integrity, failure/retry behaviour, bounded portfolio queries,
accessible mobile-first presentation, and synthetic non-production evidence.
Passing those gates would still require a separate acceptance decision and
would not by itself authorise deployment or production data.
