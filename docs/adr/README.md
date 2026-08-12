# Architecture Decision Records

This directory records material architecture decisions. Later decisions receive a
new numbered record; accepted records are not silently rewritten to describe a
different architecture.

A record with status **Deferred** is a decision the product owner has not made
yet. It states what the current authorised delivery gate must not do while the
decision is open, and what would unblock it. Deferred records are as binding as
accepted ones.

A record under **Superseded** is retained unchanged as engineering history but
no longer governs the current architecture; its replacement record is normative.

## Accepted

- [ADR-0001: Encore modular monolith](0001-encore-modular-monolith.md)
- [ADR-0002: Provider-neutral principal and runtime identity boundary](0002-provider-neutral-principal.md)
- [ADR-0003: Assignment, capability, and scope authorization](0003-assignment-capability-scope-authorisation.md)
- [ADR-0004: Effective-dated hierarchy resolution](0004-effective-dated-hierarchy-resolution.md)
- [ADR-0005: Committed generated Encore client](0005-committed-generated-encore-client.md)
- [ADR-0006: Canonical role templates provisioned per organisation](0006-canonical-role-template-provisioning.md)
- [ADR-0007: Forward-only migrations and recovery posture](0007-forward-only-migrations.md)
- [ADR-0012: Microsoft Entra ID single-tenant authentication](0012-microsoft-entra-id-single-tenant-authentication.md)
- [ADR-0013: Milestone 2B quarterly review vertical slice](0013-milestone-2b-quarterly-review-vertical-slice.md) — accepted and complete
- [ADR-0014: People & Access invitation architecture](0014-people-and-access-invitation-architecture.md) — accepted / complete
- [ADR-0015: Daily Success as a live read-only priority projection](0015-daily-success-live-priority-projection.md) — accepted and complete
- [ADR-0016: Microsoft Graph staging invitation email delivery](0016-microsoft-graph-staging-invitation-email-delivery.md) — accepted architecture; implementation acceptance remediation in progress

## Superseded

- [ADR-0011: Clerk authentication with Centre Success-owned authorisation](0011-clerk-authentication-centre-success-authorisation.md) — superseded by ADR-0012; retained as decision history

## Deferred

- [ADR-0008: Production CORS, deployment, and security operations](0008-production-cors-and-deployment.md)
- [ADR-0009: Break-glass and support impersonation](0009-break-glass-and-support-access.md)
- [ADR-0010: Authoritative hierarchy and assignment source](0010-authoritative-hierarchy-and-assignment-source.md)
