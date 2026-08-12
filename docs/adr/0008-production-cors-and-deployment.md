# ADR-0008: Production CORS, deployment, and security operations

## Status

Deferred for production origins, deployment, and security operations. ADR-0012
supersedes only the local-origin authentication portion for Milestone 2A.

## Context

Milestone 1 allowed only uncredentialed browser calls from
`http://localhost:3000`. ADR-0012 subsequently approved Bearer-token requests
from that same exact local origin for the authentication gate, with no wildcard,
cookie forwarding, or browser cookie-credential mode. No production frontend
origin is approved. The Encore staging backend/API origin is now confirmed as
`https://staging-bright-steps-centre-success-uwhi.encr.app`, but no staging
frontend is approved or deployed.

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

Record the confirmed staging API origin without approving a complete staging
browser flow. Continue to defer staging frontend/CORS/redirect configuration,
production CORS origins, environment promotion, and deployment and security
operations. The controlled path remains the CI gate in
`.github/workflows/foundation-ci.yml`; nothing is promoted automatically.

Until this is decided, do not add a production or wildcard origin, do not enable
cross-origin cookie authentication, and do not introduce a deployment workflow
that publishes from an unreviewed branch. The exact local authenticated origin
in ADR-0012 is the sole exception.

## Deferred invitation delivery origin

`InvitationPublicBaseUrl` is deliberately **left unset** in Encore Cloud. It is
the origin of the link emailed to an invited employee, so it must be a real,
approved, reachable Centre Success frontend. No such Development or Preview
frontend origin has been approved. The confirmed staging URL recorded above is
the API transport origin and must never be substituted for it, and the reviewed
local value `http://localhost:3000` is not a cloud destination.

The two Milestone 2C cryptographic secrets are configured for Development and
Preview only, never Production. Their values are generated key material and
appear in no document, example file, log, or commit.

Current state, recorded 12 August 2026:

- the Encore application build is green, and Foundation CI is green;
- Encore Cloud **deployment** to Development/Preview fails while
  `InvitationPublicBaseUrl` is undefined, which is the intended deferral rather
  than a defect;
- Preview and staging invitation delivery is therefore **unavailable**, and no
  invitation email may be treated as operational in those environments until an
  approved frontend origin exists;
- this is a deployment-readiness item and did not block Milestone 3A
  implementation acceptance.

When the Next.js frontend is deployed to an approved Development/Preview origin,
that exact URL is approved separately and only then is `InvitationPublicBaseUrl`
set.

## What would unblock this

- An approved hosting origin for the frontend in each environment.
- The approved production frontend origin and environment-specific Entra trust
  configuration.
- A security review covering environment separation, secret handling, backup and
  restore, and the incident runbook required by the Milestone 5 hardening gate.

## Consequences

The committed configuration remains deliberately narrow. The confirmed staging
API may be addressed at
`https://staging-bright-steps-centre-success-uwhi.encr.app`, but it is not an
approved end-to-end staging release until a staging frontend origin and its
CORS and Entra redirect configuration are separately approved. Encore's documented
local-development convenience permits all origins while running locally, so the
exact list governs deployed behaviour and is not represented as a local runtime
origin rejection. The generated client keeps its environment helpers, so adding
approved origins later is configuration rather than rework. The Encore API URL
must never be substituted for the app-registration-derived Entra audience.
