# ADR-0003: Assignment, capability, and scope authorization

## Status

Accepted for Milestone 1.

## Context

Role names alone cannot express tenant, state/region, centre, portfolio, time,
or sensitive-data boundaries. Combining a capability from one role assignment
with scope from another could manufacture unintended privilege.

## Decision

Authorize from a server-resolved active organisation, exactly one current
principal-owned membership, and current database role assignments. One
assignment must independently provide both the requested capability and a
matching effective scope. Missing, stale, malformed, ambiguous,
cross-organisation, or conflicting context denies by default. Frontend
visibility and PostgreSQL row-level security are not authorization controls.

## Consequences

Multiple roles form a union of complete grants without privilege recombination.
Protected repositories must resolve the resource first and call the central
authorizer. A future authenticated API may expose only a generic denial even
though internal tests retain structured denial reasons.
