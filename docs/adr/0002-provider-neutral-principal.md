# ADR-0002: Provider-neutral principal and runtime identity boundary

## Status

Accepted for Milestone 1.

## Context

Bright Steps has not approved an identity provider, session model, MFA,
recovery, or step-up policy. Authorization still needs a stable internal actor
that is not coupled to a future provider subject.

## Decision

Represent an internal principal separately from external identity mappings.
The PostgreSQL authorization-context loader accepts a principal identifier only
from trusted server-side code or synthetic tests. Milestone 1 adds no runtime
authentication, client-selected principal, temporary identity header, or
protected public business endpoint.

## Consequences

The internal access model can be tested now without inventing authentication.
The sole public endpoint remains the non-sensitive health route. Before a
protected endpoint exists, an approved Encore authentication handler must map a
verified provider identity to the internal principal and active tenant.
