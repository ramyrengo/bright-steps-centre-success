# ADR-0008: Production CORS, deployment, and security operations

## Status

Deferred. Not approved for Milestone 1.

## Context

`encore.app` currently allows uncredentialed browser calls from
`http://localhost:3000` only, with no wildcard and no credentialed origin.
Milestone 1 exposes one public non-sensitive health endpoint and no protected
business API, so no production origin, cookie, or token needs to cross an
origin boundary yet.

`docs/MVP_BUILD_PLAN.md` names a controlled deployment path as Milestone 1 exit
evidence. Continuous integration now runs the documented quality and security
gates on every pull request, but promotion into a deployed environment is a
separate decision that depends on choices that have not been made.

## Decision

Defer production CORS origins, credentialed CORS, environment promotion, and
deployment and security operations. Milestone 1's controlled path is the CI
gate in `.github/workflows/foundation-ci.yml`; nothing is promoted
automatically.

Until this is decided, do not add a production or wildcard origin, do not enable
credentialed CORS, and do not introduce a deployment workflow that publishes
from an unreviewed branch.

## What would unblock this

- An approved hosting origin for the frontend in each environment.
- The session and token model from ADR-0002, since credentialed CORS is
  meaningful only once a protected endpoint and a session exist.
- A security review covering environment separation, secret handling, backup and
  restore, and the incident runbook required by the Milestone 5 hardening gate.

## Consequences

Local development stays deliberately narrow and cannot accidentally accept a
foreign origin. The generated client keeps its environment helpers, so adding
approved origins later is configuration rather than rework. Until this record is
superseded, an Encore Cloud environment may exist but is not part of an approved
release path.
