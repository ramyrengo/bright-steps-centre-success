# ADR-0001: Encore modular monolith

## Status

Accepted for Milestone 1.

## Context

Centre Success needs strong business boundaries and Encore-managed PostgreSQL,
but the MVP has no evidence that separate deployment units or databases would
improve ownership, scale, reliability, or security.

## Decision

Use one Encore application with one cohesive `foundation` service and one
Encore SQL database. Keep identity/access, centres, and system audit as internal
modules. Extract a service or database only after a reviewed need demonstrates
independent ownership, scaling, availability, security, or deployment value.

## Consequences

Local development, tracing, migrations, and transactions remain simple, while
module interfaces preserve future seams. Domain folders do not imply network
boundaries, and later extraction requires an ADR plus a data and failure plan.
