# ADR-0014: People & Access invitation architecture

## Status

Accepted as architecture; implementation gated until Milestone 2B Product Owner acceptance.

## Context

The local synthetic first-administrator and identity-linking tools are not a production provisioning workflow. Centre Success needs a secure way for authorised administrators to invite BSA employees, bind verified Entra identity, activate reviewed role/scope packages, and manage joiner/mover/leaver access while preserving the existing separation between Microsoft authentication and PostgreSQL authorisation.

## Decision

- The milestone is **Milestone 2C — People & Access + User Invitations**.
- Entra User assignment required remains **No**. Authentication alone grants no Centre Success access; unmapped identities remain `not_provisioned`.
- Email is delivery/correlation data only. Permanent identity is `tid + oid`.
- Invitations use at least 256-bit one-time opaque secrets, keyed-digest storage, exact 72-hour expiry, generation rotation on resend, cancellation invalidation, and no role/scope data in the URL.
- Pending access proposals remain invitation-owned and outside active memberships, role assignments, and assignment scopes.
- System Administrator is initially the only invitation manager. Standard Educator, Assistant Director, Centre Director, and explicit-portfolio Area Manager packages may activate atomically after successful verified correlation without another approval.
- System Administrator, Executive, Finance, Compliance Manager, organisation-wide Operations Leadership, and any policy-designated privileged package require an independent second approval of the exact package.
- Multiple assignments remain independent and cannot recombine capability and scope.
- Principal states are `pending`, `active`, `suspended`, and terminal `revoked`.
- Every access mutation preserves at least one reachable active System Administrator; operations target at least two.
- Invitation delivery uses a transactional provider behind a PostgreSQL outbox and Encore Pub/Sub worker. Microsoft Graph is not used merely for delivery or guest/member discovery.
- Production first-administrator bootstrap requires a separately validated Encore Cloud operational mechanism and Product Owner approval; no permanent bootstrap endpoint is permitted.
- Centre Success manages application access, not employment records or Microsoft accounts. HR integration is deferred.

Detailed workflows, schemas, capabilities, routes, APIs, threats, tests and the future implementation prompt are normative in `docs/PEOPLE_AND_ACCESS.md`.

## Consequences

The normal business authoriser remains unchanged because pending proposals never enter active grant tables. Activation is a security-sensitive serializable transaction. Privileged onboarding needs two reachable administrators. Invitation acceptance needs a narrow pre-provisioning identity-proof boundary that must be validated against Encore gateway behavior before implementation. Email provider, retention, correlation evidence and production bootstrap operations remain implementation gates.

## Rejected alternatives

- Entra groups/app roles or user assignment as the Centre Success business-authorisation source.
- Email/UPN as a permanent identity key.
- Pending rows in active membership/assignment/scope tables.
- Automatic activation of any same-tenant identity.
- Microsoft Graph solely for invitation email or guest/member classification.
- Plaintext, replayable, non-expiring, or permission-bearing invitation links.
- A permanent production bootstrap API, default administrator, magic header, or local-script reuse.
