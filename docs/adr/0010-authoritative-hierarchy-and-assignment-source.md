# ADR-0010: Authoritative hierarchy and assignment source

## Status

Deferred. Not approved for Milestone 1.

## Context

ADR-0004 decides how a centre's current organisational unit and ancestors are
*resolved*, and the foundation stores hierarchy, placement, membership, and
assignment as effective-dated records. It does not decide where those records
authoritatively come from, who owns them, or how quickly a change elsewhere in
the business must be reflected.

This matters because access follows assignment. `docs/PERMISSIONS.md` requires
that an Area Manager loses an unassigned centre promptly and that moving a
centre changes future portfolio access promptly — "promptly" is currently an
intention with no owner, source, or measured target.

## Decision

Defer the authoritative source, ownership, and propagation service level for
organisation hierarchy, centre placement, and role assignment. Milestone 1
treats the foundation database as the authority and populates it only with
synthetic data.

Until this is decided, do not build an import, sync, or reconciliation job
against an external system of record, and do not assume any particular upstream
shape in the schema.

## What would unblock this

- A named business owner for organisation structure and for centre portfolios,
  which may not be the same owner.
- The system of record for each — an HR or payroll system, a finance hierarchy,
  or Centre Success itself — and whether Centre Success is authoritative or a
  replica for each fact.
- An agreed propagation target for an access-affecting change, plus what happens
  in the gap: effective-dated records already support a future-dated move, but
  only if the upstream change arrives before it takes effect.
- A reconciliation and drift-detection approach, since a replica that silently
  diverges from its source grants stale access.

## Consequences

The effective-dated model is deliberately source-agnostic and can absorb either
answer later. The cost of deferring is that no access review or reconciliation
job can be built yet, so both remain part of the Milestone 5 operational
hardening gate rather than the foundation.
