# ADR-0011: Clerk authentication with Centre Success-owned authorisation

## Status

**SUPERSEDED BY ADR-0012.**

This record is preserved as decision history. Microsoft Entra ID single-tenant
authentication replaced Clerk before Milestone 2A acceptance; see ADR-0012.

This supersedes ADR-0002 only where that record deferred the provider and
runtime handler. ADR-0002's provider-neutral internal-principal boundary remains
in force.

## Context

Milestone 1 deliberately separated provider-neutral internal principals from
external identities and exposed no protected endpoint. Milestone 2A must prove a
production-oriented human authentication chain without moving mutable Bright
Steps roles, centre access, or permissions into an identity-provider token.

The Next.js frontend and Encore backend use separate local origins. Bright Steps
has selected Clerk in restricted sign-up mode, with email/password and Microsoft
sign-in configured by the Clerk instance. The backend must not depend on which
approved sign-in method established the Clerk session.

## Decision

Clerk is the authentication provider only. The frontend obtains a Clerk session
token and sends it to Encore as `Authorization: Bearer <token>`. One central
Encore auth handler strictly parses the header and verifies the token
cryptographically with the environment-specific Clerk JWT public key. It also
validates expiry, not-before and issued-at timing, the exact approved issuer,
and the allowed `azp` origin. Invalid or malformed credentials fail closed with
a generic unauthenticated response.

The verified immutable Clerk `sub` is resolved through
`external_identity_mappings` with `provider_key = 'clerk'`. The mapping and
internal principal must both be active. An unmapped Clerk account receives no
business access, and a valid Clerk session never overrides internal principal
deactivation. AuthData contains only the Encore-required `userID`, set to the
internal principal identifier; it contains no provider subject, role,
capability, organisation, centre, email, raw token, or Clerk secret.

Centre Success PostgreSQL remains authoritative for active organisation
membership, role assignment, capabilities, organisational and centre scopes,
effective dates, and authorisation decisions. The protected foundation
self-context endpoint reloads `PrincipalAuthorisationContext` through the
Milestone 1 database boundary. Milestone 2A supports exactly one current active
organisation context for that endpoint; zero or multiple candidates deny by
default. A multi-organisation selection/session design requires a later decision.

The existing generated Encore client remains the frontend API contract. One
frontend adapter obtains the current Clerk token and supplies its Bearer header;
React components do not construct identity headers. The committed authenticated
CORS allowlist contains only `http://localhost:3000`, without a wildcard or
production origin, and the frontend does not forward cookies to Encore. Encore's
documented permissive local-development override does not broaden the exact
`ClerkAuthorizedParties` token check. Production origins remain deferred by
ADR-0008.

Local mapping is performed only through an explicit `encore exec` operator
script. It refuses non-local environments, links an operator-supplied Clerk
subject to an existing synthetic principal, requires the operator to hold a
current `identity.mapping.manage` grant in the supplied organisation, fails on
conflicting mappings, and records a minimised audit event attributed to that
operator without retaining the external subject. It is not an HTTP endpoint,
does not bootstrap access, and does not provision a principal, role, membership,
assignment, capability, scope, or Clerk account.

## Security boundary

- Clerk verifies the sign-in account and session; it grants no Centre Success
  business permission.
- Clerk Organizations, roles, public/private metadata, authentication method,
  and client-visible state are never an authorisation source.
- The client may present a resource identifier, but it cannot select its
  principal or assert tenant, capability, scope, centre ancestry, or decision
  time.
- Networkless backend verification uses `ClerkJwtKey`; `ClerkIssuer` and
  `ClerkAuthorizedParties` are environment-scoped trusted values. The Next.js
  server secret is never sent to Encore or the browser.
- Tests use generated test-only signing material and require no Clerk account,
  network call, or production secret.
- Raw tokens, passwords, keys, and authentication credentials are excluded from
  application tables, audit context, logs, traces, fixtures, and error responses.

## Consequences

Authentication method configuration and account invitations stay in Clerk,
while joiner/mover/leaver access remains a controlled Centre Success
administrative process. Each protected business API added by a future approved
milestone must still call the existing capability-and-scope authorisation
boundary; `auth: true` establishes identity but is never sufficient authority.

Milestone 2A adds a Clerk runtime dependency and environment configuration. The
operator must configure restricted sign-up, approved sign-in methods, frontend
keys, backend verification material, issuer, and authorised parties. MFA,
recovery, step-up authentication, multi-organisation context selection,
automated employee provisioning, HR synchronisation, production CORS, and
break-glass access remain separately gated decisions.
