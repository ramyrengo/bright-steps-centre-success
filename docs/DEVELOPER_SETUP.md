# Foundation and Milestone 2A Developer Setup

## Prerequisites

- Node.js 20.9 or newer. The verified local runtime is Node.js 24.16.0.
- npm.
- Encore CLI 1.57.13 or newer.
- OrbStack, or another Docker-compatible runtime supported by Encore, running locally.

Diagnose every matching binary and confirm the active toolchain before setup:

```sh
type -a node npm encore
command -v node
command -v npm
command -v encore
node --version
npm --version
encore version
docker version
```

If nvm is installed, matching `.nvmrc` files at the repository root and in
`frontend/` select the verified runtime from either working directory:

```sh
nvm use
node --version
```

If `encore version` resolves an older standalone installation while Homebrew has
the verified version, keep the nvm-selected Node binary ahead of Homebrew while
selecting Homebrew's Encore for the current shell:

```sh
nvm use
verified_node_bin="$(dirname "$(command -v node)")"
export PATH="$verified_node_bin:/opt/homebrew/bin:$PATH"
hash -r
command -v node
node --version
command -v encore
encore version
```

On the verification workstation, `~/.encore/bin/encore` resolves 1.57.5 while
`/opt/homebrew/bin/encore` resolves the verified 1.57.13 release. Homebrew also
contains Node 18.20.8 on that workstation, so prepending Homebrew without first
preserving the nvm Node directory is unsafe for this project. The commands above
resolve Node 24.16.0 and Encore 1.57.13 and change only the current shell.
Persistent shell-profile changes are user-owned and should be reviewed before
editing. Do not work around an old CLI by changing the Encore App ID or
recreating the application.

## Install reviewed dependencies

From the repository root:

```sh
npm ci
cd frontend
npm ci
```

These install the dependency graphs recorded in the two lockfiles. The Milestone 2A provider pivot must leave the frontend with the approved MSAL browser/React packages and the backend with one standards-compliant JWT/JWKS verifier; no Clerk runtime package may remain after the pivot is implemented.

## Confirmed environment endpoints

| Environment | Frontend origin | Backend/API origin | Entra SPA redirect URI |
| --- | --- | --- | --- |
| Local | `http://localhost:3000` | `http://localhost:4000` | `http://localhost:3000/redirect` for the MSAL v5 bridge; root is the post-logout landing |
| Staging | `https://bright-steps-centre-success-staging.vercel.app` | `https://staging-bright-steps-centre-success-uwhi.encr.app` | Configured separately in Entra; the staging backend URL is not a redirect URI |

The confirmed staging backend value is the Encore API transport/base origin
used by the approved Vercel staging frontend as `NEXT_PUBLIC_ENCORE_API_URL`.
The exact Vercel origin is approved in Encore's authenticated CORS allowlist,
and its Entra staging redirect URIs are configured separately. Do not register
the Encore deployment URL as a SPA redirect or derive token trust from it.

The Entra API trust boundary remains tied to the Centre Success API app
registration. Its confirmed Application ID URI is
`api://5e8ce11c-ade3-4baa-82f6-351919b444ca`, the delegated scope is
`api://5e8ce11c-ade3-4baa-82f6-351919b444ca/access_as_user`, and the backend
validates `aud = 5e8ce11c-ade3-4baa-82f6-351919b444ca` for a version 2 access
token. The `encr.app` deployment origin defines none of these authentication
values.

## Configure Microsoft Entra ID for local development

Milestone 2A uses the confirmed Bright Steps Australia tenant
`27026100-3522-48b5-8e95-80230afc4127` and two single-tenant app
registrations:

1. **Centre Success API** — client ID `5e8ce11c-ade3-4baa-82f6-351919b444ca`: “Accounts in this organisational directory only”, Application ID URI `api://5e8ce11c-ade3-4baa-82f6-351919b444ca`, delegated scope `access_as_user` (“Access Centre Success as the signed-in user”), and version 2 access tokens.
2. **Centre Success Web** — client ID `b490189d-37c1-422c-a54a-b12d55646947`: public SPA registration in the same tenant, no implicit ID/access-token grant, no client secret, and only delegated `api://5e8ce11c-ade3-4baa-82f6-351919b444ca/access_as_user` permission to the API. Admin consent is confirmed.
3. On the relevant Centre Success enterprise application, set **User assignment required** to **No**. This permits exact-tenant authentication only; it does not provision or authorise Centre Success access. Unmapped or uninvited identities remain `not_provisioned`. Do not grant Microsoft Graph, directory, mailbox, calendar, SharePoint, Teams, contacts, or unrelated API permissions.

The Product Owner confirmed `http://localhost:3000` for the local Web
registration. The pinned MSAL Browser v5 flow also requires the dedicated
`http://localhost:3000/redirect` bridge. The connected smoke on 11 August 2026
returned through `/redirect` successfully without `AADSTS50011`, which proves
the current Entra configuration accepts that exact bridge URI. Preserve it
under the Web registration's **Single-page application** platform and retain
root as the post-logout landing URL. Do not downgrade the browser flow, make the
application root act as the bridge, or use an Encore API URL as the redirect.

Store the browser's public registration values in the untracked `frontend/.env.local`. The committed `frontend/.env.example` contains the confirmed non-secret public IDs and safe local URL defaults:

```text
NEXT_PUBLIC_ENTRA_TENANT_ID=27026100-3522-48b5-8e95-80230afc4127
NEXT_PUBLIC_ENTRA_WEB_CLIENT_ID=b490189d-37c1-422c-a54a-b12d55646947
NEXT_PUBLIC_ENTRA_API_CLIENT_ID=5e8ce11c-ade3-4baa-82f6-351919b444ca
NEXT_PUBLIC_ENTRA_REDIRECT_URI=http://localhost:3000/redirect
NEXT_PUBLIC_ENTRA_POST_LOGOUT_REDIRECT_URI=http://localhost:3000/
NEXT_PUBLIC_ENCORE_API_URL=http://localhost:4000
```

These values are intentionally browser-visible identifiers and URLs, not credentials. The adapter derives the only requested API scope as `api://<NEXT_PUBLIC_ENTRA_API_CLIENT_ID>/access_as_user`; do not add an arbitrary scope environment variable. The `/redirect` path is a real MSAL v5-compatible redirect bridge that completes redirect processing and returns to the root. Sign-out uses the Entra logout flow and returns to `http://localhost:3000/`. The SPA must never have a client secret.

Configure the matching integrity-sensitive backend trust values through Encore's supported environment secrets/configuration mechanism:

```sh
encore secret set --type local EntraTenantId
encore secret set --type local EntraApiClientId
encore secret set --type local EntraWebClientId
```

Enter, respectively, `27026100-3522-48b5-8e95-80230afc4127`,
`5e8ce11c-ade3-4baa-82f6-351919b444ca`, and
`b490189d-37c1-422c-a54a-b12d55646947`. The backend derives the exact issuer
`https://login.microsoftonline.com/27026100-3522-48b5-8e95-80230afc4127/v2.0`
and tenant OIDC discovery endpoint, expects the API client-ID GUID—not the
`api://` URI—as the version 2 `aud`, and requires the Web client ID as `azp`.
It obtains rotating signing keys from tenant metadata; do not configure a
pinned PEM, SPA client secret, or API client secret merely to validate inbound
tokens. Empty, malformed, conflicting, or non-GUID values fail closed. The
staging backend/API and frontend origins are confirmed above. The exact staging
frontend origin is approved for authenticated CORS, its Entra redirect URIs are
configured separately, and Production values remain separately gated.

The JWKS resolver makes remote work single-flight, attempts its normal refresh hourly, refuses to trust a cached key set after 24 hours, applies a five-second remote timeout, and shares a five-minute cooldown across normal and unknown-`kid` refreshes. Network, metadata, stale-cache, or still-unknown-key failure denies authentication. These values are part of the reviewed Milestone 2A trust policy, not ad hoc local tuning.

Keep credentials, tokens, private signing keys, real user data, and unreviewed environment values out of source. The reviewed browser-public tenant and client IDs in `frontend/.env.example` are a deliberate non-secret exception. The repository root and `frontend/` must otherwise ignore `.env*` while allowing only a deliberately safe `.env.example` where used. Never commit a client secret, token, private signing key, credential, or real login data. The Entra tenant and client IDs are public identifiers but remain integrity-sensitive configuration; verify them through the approved BSA app registrations rather than accepting values copied from a token.

## Run locally

Start Encore from the repository root:

```sh
encore run
```

Encore builds the application graph, starts the `centre_success` PostgreSQL database through the local container runtime, and applies pending migrations. The public health endpoint is available at:

```text
http://localhost:4000/foundation/health
```

Encore applies authentication optionally to a public endpoint and mandatorily
to an `auth: true` endpoint. Verify the actual gateway boundary, not only the
endpoint functions:

```sh
curl -i http://localhost:4000/foundation/health
curl -i -H 'Authorization: Bearer malformed' http://localhost:4000/foundation/health
curl -i http://localhost:4000/foundation/me
curl -i -H 'Authorization: Bearer malformed' http://localhost:4000/foundation/me
```

Both health requests return the same minimal `200` contract because an
`unauthenticated` auth-handler result on a public route proceeds anonymously;
neither creates AuthData. Both self-context requests return `401`. This is
Encore gateway behaviour, not acceptance of the malformed token.

The local Encore dashboard is normally available at `http://localhost:9400`. It provides the API catalogue, infrastructure view, database explorer, and request traces.

In a second terminal, start Next.js:

```sh
cd frontend
npm run dev
```

Open `http://localhost:3000`. Signed-out visitors can start `loginRedirect`; Entra returns only to the registered `/redirect` bridge. After MSAL establishes an explicit active account, the central adapter calls `acquireTokenSilent` for the derived Centre Success API scope and configures the generated Encore client. Interactive renewal is used only for `InteractionRequiredAuthError` and must not loop. The authenticated shell links to the approved `/area-manager`, `/centre`, `/compliance`, and `/admin/people` workspaces. These links are navigation only: each business request is independently authorised by Encore and PostgreSQL.

Connected smoke evidence on 11 August 2026 used an approved BSA development
session and the confirmed public registration IDs. Microsoft returned through
the `/redirect` bridge, the frontend obtained the Centre Success API access
token, and Encore accepted its signature and strict claim contract. Before the
approved local mapping existed, the identity was rejected with the safe
`account_not_provisioned` result and the UI rendered “Account not provisioned.”

The Product Owner then completed the reviewed local bootstrap and identity
mapping workflow and repeated the live browser proof. The application showed
`Welcome, Local System Administrator`, `Authentication: Connected`, and
`Centre Success: Ready`. This proves the real BSA Microsoft login, Centre
Success API access token, strict Encore validation, `tid + oid` mapping,
provider-neutral internal principal, active synthetic local organisation
membership, PostgreSQL authorisation context, and protected `/foundation/me`
projection as one end-to-end seam. Sign-out also completed through Entra and
returned to the local application root. No token, token payload, `oid`, email,
UPN, or other user identifier is persisted in repository evidence. The linked
principal and organisation records are synthetic local-development data and
must not be described or reused as a production user-provisioning process.

The committed authenticated CORS allowlist contains exactly `http://localhost:3000` and `https://bright-steps-centre-success-staging.vercel.app` for Bearer-token requests. Encore's development server permits all origins as a documented local convenience, so that exact list describes deployed behaviour and is not a local runtime origin rejection. The backend still requires exact API `aud` and approved Web-client `azp`. No wildcard or production origin, cookie authentication, `credentials: include`, trusted test identity header, or environment verification bypass is configured.

## Tests and quality checks

The repository separates pure policy tests from tests that require Encore's
isolated PostgreSQL infrastructure. Run from the repository root:

```sh
npm test
npm run test:unit
npm run test:integration
npm run test:backend
npm run test:frontend
npm run test:all
npm run typecheck
npm run lint
npm audit
npm --prefix frontend audit
```

`npm test` and `npm run test:unit` run the pure authorization policy, deterministic Entra token/JWKS tests, scoring rules, and protected business-API surface checks without infrastructure, Microsoft login, or live network request. `npm run test:integration` invokes Encore with the integration Vitest configuration; Encore provisions an isolated PostgreSQL test database, applies every migration, and runs authentication/foundation tests plus the quarterly-review, action, evidence, role/scope, comparison, and recurrence workflow suite serially against that database. `npm run test:backend` runs both backend suites. `npm run test:all` adds frontend tests. Use these scripts rather than bare Vitest or an unconfigured `encore test`, so the intended suite and infrastructure are unambiguous.

`npm run typecheck` first runs `encore gen wrappers`, then TypeScript. The wrapper step is required on a clean checkout because Encore's generated `~encore/auth` context is deliberately ignored from Git.

Run frontend checks from `frontend/`:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

The frontend tests cover the authentication loading, signed-out/sign-in,
provisioning denial, access denial, backend-unavailable, signed-in shell, and
sign-out states, plus central token-adapter behaviour. Milestone 2B tests also
cover assigned-centre preparation/start, audit response and finalisation,
Centre Director follow-up/remediation, independent verification, Compliance
oversight, and accessible loading/error/empty states. They use generated-client
contract fakes and do not replace the connected BSA Entra smoke test.

## Continuous integration

`.github/workflows/foundation-ci.yml` performs frozen root/frontend installs,
pins the Encore CLI, authenticates it with the required `ENCORE_AUTH_KEY`
GitHub Actions repository secret, verifies Docker, runs backend authentication,
authorisation, scoring, quarterly-review/action/evidence and database checks,
runs frontend lint/typecheck/authentication/workflow tests/build,
audits dependencies, regenerates the Encore client, and fails on tracked
repository drift. Authentication tests use generated test-only signing material
and require no Microsoft account, live JWKS request, or production Microsoft secret. The auth
key must be a least-privilege Encore machine credential for this application;
never place its value in workflow YAML, source, logs, or a pull-request
variable. The workflow has read-only GitHub repository permission and contains
no deployment or production automation. A remote GitHub run is evidence only
after the workflow is committed, the secret is configured, and GitHub executes
the workflow.

## Generated API client

The reviewed generated client is committed at `frontend/src/lib/client.generated.ts`. It includes Encore's authenticated-client support, while `frontend/src/lib/` contains the single MSAL token adapter used to configure it. React components do not call `acquireTokenSilent` or construct headers themselves. After changing an exposed Encore API contract, regenerate it from `frontend/`:

```sh
npm run client:generate
```

The script generates only the `foundation` service client for the local Encore environment. Never hand-edit the generated file or manually duplicate its request/response contracts. Review and commit its diff with the backend contract change.

## Database access and behaviour

The database is declared in `foundation/db.ts`; migrations are in `foundation/migrations/`. Inspect the local database with:

```sh
encore db shell centre_success
```

Encore can use a containerised `psql` client when one is not installed locally. Migrations contain the foundation capability catalogue and canonical role templates plus the approved versioned quarterly-review, scoring, finding, action, acknowledgement, positive-observation, and private-evidence model. Creating an organisation provisions role definitions but no principal, membership, assignment, employee, or access grant. No production records, credentials, Supabase configuration, or official regulatory corpus are included.

## Bootstrap the synthetic local System Administrator

The identity linker deliberately accepts only existing Centre Success records. Before the first local link, create the reviewed synthetic organisation, local bootstrap operator, and target System Administrator through the separate non-HTTP bootstrap:

```sh
encore exec -- npx --no-install tsx scripts/bootstrap-local-system-administrator.ts
```

The equivalent package command is `npm run identity:bootstrap:local`. A successful run prints only:

```text
organisation-id:
b5c00000-0000-4000-8000-000000000001

principal-id:
b5c00000-0000-4000-8000-000000000003

operator-principal-id:
b5c00000-0000-4000-8000-000000000002
```

The utility reads the actual Encore environment and refuses staging, preview, production, every cloud environment, and local near misses before opening a transaction. It uses stable identifiers and a transaction-scoped advisory lock, rejects conflicting or ambiguous records, and is idempotent under sequential or concurrent invocation. It creates only the synthetic **Bright Steps Academy — Local Development** organisation, **Local Bootstrap Operator**, and **Local System Administrator**, with one active membership each. Both principals receive one organisation-scoped assignment to the existing persisted canonical `system_administrator` definition because no narrower approved canonical role contains `identity.mapping.manage`; no role or capability is invented. The role's current exact technical capability bundle is validated, and it contains no organisation, centre, budget, or other business-content capability. Each privileged assignment has a separate append-only bootstrap audit event. The utility creates no Entra identity, external identity mapping, email, employee profile, token, credential, HTTP route, authentication bypass, or cloud provisioning mechanism.

## Seed the synthetic Milestone 2B review data

After the local foundation bootstrap, create the reviewed development-only
quarterly-review scenario:

```sh
npm run quarterly-review:seed:local
```

The equivalent direct command is:

```sh
encore exec -- npx --no-install tsx scripts/seed-quarterly-review-development.ts
```

The seed refuses every non-local environment and requires the stable synthetic
local organisation created by the bootstrap. It idempotently creates three
synthetic centres, one state/region portfolio, one Area Manager, three Centre
Directors, one Compliance Manager, their reviewed version-2 canonical role
assignments/scopes, and one 12-item four-section **BSA Quarterly Centre Review
— Development Template**. The scoring factors, internal performance bands,
severity, due period, automatic-action, and independent-verification behaviour
are stored as versioned development configuration. The content is not an
ACECQA assessment or assertion of legislation. The seed creates no Entra
identity mapping, real employee/child record, production data, or external
integration.

## Link the approved local Entra identity

After reviewing the three bootstrap IDs, obtain the approved BSA development account's immutable Entra object ID (`oid`) through the authorised administrator process. Use the confirmed BSA tenant ID and the reviewed stable synthetic IDs with the existing local operator command:

```sh
encore exec -- npx --no-install tsx scripts/link-entra-identity.ts \
  --tenant-id 27026100-3522-48b5-8e95-80230afc4127 \
  --oid <APPROVED_ENTRA_OBJECT_ID> \
  --principal-id b5c00000-0000-4000-8000-000000000003 \
  --organisation-id b5c00000-0000-4000-8000-000000000001 \
  --operator-principal-id b5c00000-0000-4000-8000-000000000002 \
  --reason "Milestone 2A real Entra authentication proof"
```

The equivalent package form starts with `npm run identity:link:local --`. Substitute the approved `oid` only in the operator's local terminal; do not commit it to source, documentation, shell history shared with others, screenshots, tickets, or logs. The final reviewed handoff may provide the one-time complete command directly to the authorised operator.

The package script runs an `encore exec` program against the active local namespace. It refuses non-local environments, requires the supplied tenant to exactly equal the configured BSA tenant, validates and canonicalises every GUID, requires the operator principal to have a current complete `identity.mapping.manage` grant in the supplied audit organisation, and fails closed on an existing conflicting tenant/`oid` mapping. It is idempotent only for an identical active mapping and records a minimised append-only event attributed to the operator without storing the tenant/`oid`, token, or credentials in audit context.

The local database inspected during the initial 11 August 2026 connected smoke contained no principal or organisation-membership rows. The separately approved bootstrap subsequently created only the reviewed synthetic foundation records, and an authorised operator used the linker to complete the Product Owner-observed live proof. That local mapping must remain an explicitly controlled development record. Do not repeat or repurpose it as production onboarding, bypass either command, create a real employee record, broaden the synthetic role, or use email/UPN/display name as the identity key.

This command links an identity only. It never creates an Entra account, principal, organisation membership, role definition, role assignment, capability, or scope, and it is not an authentication/authorisation bootstrap or production onboarding path. Use synthetic Centre Success data only; do not enter real employee information into application fixtures. There is no public identity-linking API in Milestone 2A.

## Milestone 2C local invitation delivery configuration

People & Access uses three additional Encore-managed values. Configure only local development values through the prompt-driven CLI; do not place their values in source or shell arguments:

```sh
encore secret set --type local InvitationTokenDigestKey
encore secret set --type local InvitationDeliveryEncryptionKey
encore secret set --type local InvitationPublicBaseUrl
```

`InvitationTokenDigestKey` is independent HMAC key material. `InvitationDeliveryEncryptionKey` is a base64-encoded 32-byte AES key and must be independent from the digest key. `InvitationPublicBaseUrl` is an origin only; the reviewed local value is `http://localhost:3000`. Non-loopback HTTP, credentials, paths, query strings and fragments fail closed. Production/staging values are not approved merely because these local names exist.

The development adapter is deliberately deterministic and performs no network or email delivery. Send/resend still exercises the real transaction, HMAC verifier record, AES-GCM outbox ciphertext, Pub/Sub dispatch boundary, idempotency and delivery-attempt state. After a successful terminal delivery, the implementation clears the ciphertext, IV and authentication tag while retaining non-sensitive delivery metadata; retryable/unpublished rows retain the complete encrypted tuple. A broader production retention policy remains a Product Owner/operations decision. A real production email provider, sender domain, template ownership, retention and support process remain separately deferred. Never use Microsoft Graph for this delivery path and never put role/scope details in the email.

For browser testing, use only synthetic Centre Success people/invitations. An authorised System Administrator can create a draft at `/admin/people/invite`; the candidate opens `/invitations/accept`, authenticates through the existing BSA Entra flow and enters the separately delivered opaque code. The candidate endpoint is the sole pre-provisioning boundary. It does not create Encore AuthData for an unmapped identity, and every administration/business endpoint remains provisioned-only. Exact verified `email` is correlation evidence for automatic activation; missing, mismatched or guest evidence results in administrator review with zero grants.

## Current boundary

The public non-sensitive surface remains health plus the single sensitive
candidate command `POST /invitations/accept`. The self-context, Milestone 2B,
and People & Access administration/workflow APIs are `auth: true`; they use
server-resolved internal identity plus current PostgreSQL capability,
assignment, effective-date, and resource-scope checks. The candidate command
reuses strict Entra verification but confers no authority before atomic
activation. No generic administrator table-CRUD surface exists. Frontend routes
are usability surfaces, not authority. Milestone 2C is **ACCEPTED /
COMPLETE**; production email delivery and production first-administrator
bootstrap remain separately gated.

## Framework references

- [Next.js installation and supported Node.js baseline](https://nextjs.org/docs/app/getting-started/installation)
- [Encore SQL databases and migrations](https://encore.dev/docs/ts/primitives/databases)
- [Encore testing](https://encore.dev/docs/ts/develop/testing)
- [Encore CI/CD](https://encore.dev/docs/ts/self-host/ci-cd)
- [Encore CORS configuration](https://encore.dev/docs/ts/frontend/cors)
- [Encore authentication handlers](https://encore.dev/docs/ts/develop/auth)
- [Next.js Vitest testing](https://nextjs.org/docs/app/guides/testing/vitest)
- [MSAL Browser initialization](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/initialization)
- [MSAL React](https://learn.microsoft.com/en-us/entra/msal/javascript/react/getting-started)
- [MSAL Browser token caching](https://learn.microsoft.com/en-us/entra/msal/javascript/browser/caching)
- [Microsoft access-token validation](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens)
- [Microsoft access-token claims](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference)
- [Microsoft signing-key rollover](https://learn.microsoft.com/en-us/entra/identity-platform/signing-key-rollover)
