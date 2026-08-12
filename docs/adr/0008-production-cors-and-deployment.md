# ADR-0008: Production CORS, deployment, and security operations

## Status

Deferred for production origins, deployment, and security operations. The exact
staging browser origin is approved; this does not approve Production.

## Context

Milestone 1 allowed only uncredentialed browser calls from
`http://localhost:3000`. ADR-0012 subsequently approved Bearer-token requests
from that same exact local origin for the authentication gate, with no wildcard,
cookie forwarding, or browser cookie-credential mode. No production frontend
origin is approved. The Encore staging backend/API origin is
`https://staging-bright-steps-centre-success-uwhi.encr.app`, and the approved
staging frontend origin is
`https://bright-steps-centre-success-staging.vercel.app`.

That staging URL identifies only the API transport/base origin. It is not a
Microsoft Entra SPA redirect URI, post-logout URI, Application ID URI, scope,
or access-token audience. Those authentication values remain defined by the
Centre Success Entra app registrations; the confirmed API Application ID URI
is `api://5e8ce11c-ade3-4baa-82f6-351919b444ca` and the version 2 token audience
is the client-ID GUID `5e8ce11c-ade3-4baa-82f6-351919b444ca`.

`docs/MVP_BUILD_PLAN.md` names a controlled deployment path as Milestone 1 exit
evidence. Continuous integration now runs the documented quality and security
gates on every pull request, but promotion into a deployed environment is a
separate decision that depends on choices that have not been made.

## Decision

Allow authenticated browser requests from the exact approved Vercel staging
origin while preserving the exact localhost development origin. The Entra
staging redirect URIs and Pre-Production `InvitationPublicBaseUrl` are configured
separately. Continue to defer production CORS origins, environment promotion,
and production deployment and security operations. The controlled path remains
the CI gate in `.github/workflows/foundation-ci.yml`; nothing is promoted
automatically.

Until this is decided, do not add a production or wildcard origin, do not enable
cross-origin cookie authentication, and do not introduce a deployment workflow
that publishes from an unreviewed branch. Only the exact local and approved
staging authenticated origins are committed.

## Pre-Production invitation delivery origin

`InvitationPublicBaseUrl` is configured for the approved Pre-Production
environment using the approved staging frontend. It is the origin of the link
emailed to an invited employee and is kept distinct from the Encore staging API
transport origin. The reviewed local value `http://localhost:3000` is not a
cloud invitation destination.

The two Milestone 2C invitation cryptographic secrets are configured for
Development and Preview only, never Production. ADR-0016 declares a separate
`MicrosoftGraphClientSecret` for the exact `staging` environment only; it is not
configured during implementation and must never be assigned by broad
environment type. Secret values appear in no document, example file, log, or
commit.

Current state, recorded 12 August 2026:

- the Encore application build is green, and Foundation CI is green;
- the exact Vercel staging origin is approved for authenticated Encore CORS;
- the Entra staging redirect URIs and Pre-Production
  `InvitationPublicBaseUrl` are configured separately;
- the Graph staging invitation adapter is code-complete only after review; its
  exact staging secret and deployment/live-email proof remain operator gates;
- this is a deployment-readiness item and did not block Milestone 3A
  implementation acceptance.

## What would unblock this

- The approved production frontend origin and environment-specific Entra trust
  configuration.
- A security review covering environment separation, secret handling, backup and
  restore, and the incident runbook required by the Milestone 5 hardening gate.

## Consequences

The committed configuration remains deliberately narrow. The approved staging
frontend may call
`https://staging-bright-steps-centre-success-uwhi.encr.app` from the exact origin
`https://bright-steps-centre-success-staging.vercel.app`; this does not make the
system production-ready. Encore's documented local-development convenience
permits all origins while running locally, so the exact list governs deployed
behaviour and is not represented as a local runtime origin rejection. The
Encore API URL must never be substituted for the app-registration-derived Entra
audience.
