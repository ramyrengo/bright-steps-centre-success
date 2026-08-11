# ADR-0004: Effective-dated hierarchy resolution

## Status

Accepted for Milestone 1.

## Context

Operations Leadership and Area Manager access depends on changing portfolios
and nested organisational units. Requiring each API caller to construct centre
ancestor lists would duplicate security logic and permit stale or untrusted
hierarchy claims.

## Decision

Use half-open effective windows (`effective_from <= at < effective_to`) for
memberships, assignments, assignment scopes, centre placement, and hierarchy
facts. Resolve a centre's current unit and all ancestors centrally with a
recursive PostgreSQL query constrained to the active organisation. Multiple
simultaneously effective centre placements, inactive lineage nodes, and cycles
are conflicting resource context and deny access.

## Consequences

Ancestor grants reach nested centres without per-endpoint flattening. Centre
moves and portfolio removals take effect at an exact timestamp while history is
retained. A centre with no current unit can still match an explicit centre
scope, but it cannot inherit organisational-unit scope.
