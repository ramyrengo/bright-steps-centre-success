# ADR-0012: Microsoft Entra ID single-tenant authentication

## Status

Accepted for Milestone 2A.

ADR-0014 supersedes this record only where this record recommended enabling Entra enterprise-application user assignment. The approved setting is now **User assignment required = No**; authentication alone still grants no Centre Success access.

This record supersedes ADR-0011. It also supersedes ADR-0002 only where that
record deferred selection of the authentication provider and runtime handler;
ADR-0002's provider-neutral internal-principal boundary remains in force.

## Context

All Centre Success users are Bright Steps Australia (BSA) workforce users with
company Microsoft 365 accounts. BSA therefore selected its single Microsoft
Entra ID tenant as the Milestone 2A authentication authority instead of adding
Clerk as another identity layer. Centre Success still needs immediate internal
revocation, effective-dated organisation and centre scope, and business
permissions that must not be inferred from Microsoft identity claims.

The browser application and Centre Success API are different OAuth parties.
The frontend must obtain an access token intended for the Centre Success API,
not send an ID token or a Microsoft Graph token to Encore. Microsoft signing
keys rotate, so a permanently pinned signing PEM is not a safe production trust
model.

## Decision

### Entra registration and browser flow

Use two single-tenant app registrations in the BSA Entra tenant:

1. **Centre Success API** has application/client ID
   `5e8ce11c-ade3-4baa-82f6-351919b444ca`, exposes Application ID URI
   `api://5e8ce11c-ade3-4baa-82f6-351919b444ca`, delegated scope
   `access_as_user`, and requests version 2 access tokens.
2. **Centre Success Web** has application/client ID
   `b490189d-37c1-422c-a54a-b12d55646947` and is a public SPA registration. It uses OAuth 2.0
   Authorization Code with PKCE, has no client secret, and receives delegated
   permission only for
   `api://5e8ce11c-ade3-4baa-82f6-351919b444ca/access_as_user`. Admin consent is
   confirmed. The local post-logout destination is `http://localhost:3000/`.

The BSA tenant ID is `27026100-3522-48b5-8e95-80230afc4127`. The Product Owner
confirmed `http://localhost:3000` for the local Web registration. The pinned
MSAL Browser v5 architecture additionally uses the dedicated
`http://localhost:3000/redirect` bridge. A connected smoke on 11 August 2026
successfully returned through that exact bridge without a redirect mismatch,
proving the current registration accepts it. Preserve `/redirect` for login and
silent browser flows and root for post-logout landing; root must not replace the
dedicated bridge.

The confirmed Encore staging backend/API origin is
`https://staging-bright-steps-centre-success-uwhi.encr.app`. It is a transport
origin only and is not a Web SPA redirect URI, post-logout URI, Application ID
URI, requested scope, or token audience. No staging frontend is yet approved or
deployed, so its redirect and post-logout URIs remain undecided under ADR-0008.
The API registration—not the Encore deployment URL—continues to define the
`api://5e8ce11c-ade3-4baa-82f6-351919b444ca` Application ID URI and the
delegated `api://5e8ce11c-ade3-4baa-82f6-351919b444ca/access_as_user` scope;
the version 2 token `aud` remains the exact API application/client-ID GUID
`5e8ce11c-ade3-4baa-82f6-351919b444ca`.

The Next.js application uses the current official `@azure/msal-browser` and
`@azure/msal-react` libraries in the browser. One MSAL v5-compatible redirect
bridge owns `/redirect`, completes redirect handling, establishes the explicit
active account, and returns to the application root. Account selection must
never depend on the unordered first entry in MSAL's account cache. Sign-out
returns to the root only after the Entra logout flow. Authorization Code with
PKCE is required; the legacy implicit grant is disabled.

One central frontend adapter waits for MSAL readiness, calls
`acquireTokenSilent` for the Centre Success API scope, handles
`InteractionRequiredAuthError` without redirect loops, and supplies the access
token to the generated Encore client as `Authorization: Bearer <token>`.
Components neither acquire tokens independently nor construct identity
headers. MSAL's supported cache uses `sessionStorage`; Centre Success adds no
custom token cache and never manually places tokens in `localStorage`, URLs,
application tables, logs, or traces.

No Microsoft Graph delegated or application permission is requested for
Milestone 2A.

### Encore verification boundary

One central auth handler remains inside the existing Encore foundation modular
monolith. It keeps separate seams for key resolution, token/claim validation,
external-identity lookup, and internal-principal resolution. A request is
authenticated only when all of the following hold:

- the JWT header declares `RS256`, contains a `kid`, and the signature verifies
  against the corresponding current key from the BSA tenant JWKS;
- `iss` exactly equals
  `https://login.microsoftonline.com/27026100-3522-48b5-8e95-80230afc4127/v2.0`;
- `tid` exactly equals `27026100-3522-48b5-8e95-80230afc4127`;
- `aud` exactly equals `5e8ce11c-ade3-4baa-82f6-351919b444ca`. For a
  version 2 Entra access token this claim is the API client ID, while
  `api://5e8ce11c-ade3-4baa-82f6-351919b444ca/access_as_user` is the requested scope;
- `azp` exactly equals `b490189d-37c1-422c-a54a-b12d55646947`, so another
  client cannot use a delegated token to cross this application boundary;
- `ver` is exactly `2.0`;
- `exp` and `nbf` pass with only a small documented clock skew; and
- the space-delimited `scp` claim contains `access_as_user`.

Wrong-tenant, wrong-client, SPA/ID-token-audience, Microsoft
Graph/unrelated-audience, wrong-version, wrong-scope, expired, not-yet-valid,
malformed, unknown-key, and invalid-signature tokens fail closed with generic
public errors. Entra groups, app roles, `roles`, authentication method, email, UPN, and
`preferred_username` grant no Centre Success authority.

The resolver obtains the tenant-specific `jwks_uri` through the BSA tenant v2
OIDC discovery document. It coalesces concurrent remote work, attempts a normal
refresh hourly, never trusts a cached key set for more than 24 hours, and applies
a five-second remote timeout. A previously unknown `kid` can cause one
controlled refresh only when the global remote-fetch cooldown of five minutes
allows it; key-spray requests cannot cause one fetch per token. Discovery,
JWKS, timeout, key-shape, stale-cache, or refresh failure denies authentication
when verification cannot be established. The resolver is injectable so
deterministic tests use generated test-only RSA keys without a Microsoft login
or production credential.

AuthData contains only the Encore-required `userID` set to the opaque internal
Centre Success principal UUID. It contains no raw `oid`, `tid`, token, claim
payload, email, Entra role/group, BSA role, capability, organisation, centre, or
scope.

### Internal identity and authorisation

The durable Entra identity key is the pair `tid + oid`, never `sub`, email, UPN,
or display name. The existing `external_identity_mappings` table represents it
as:

- `provider_key = 'microsoft_entra:27026100-3522-48b5-8e95-80230afc4127'`; and
- `provider_subject = '<lowercase-raw-Entra-oid-GUID>'`.

The tenant and object identifiers are validated and canonicalised before
lookup. An active mapping and active internal principal are required. Sign-in
never auto-provisions a principal, membership, assignment, role, capability, or
scope. Entra is the authentication authority only; PostgreSQL remains the
authority for every Centre Success business permission.

The protected `GET /foundation/me` proof reloads current PostgreSQL facts for
each request:

- zero active organisation memberships returns only
  `provisioningStatus: "not_provisioned"`, with no principal, organisation, or
  business information;
- exactly one active membership resolves that organisation server-side and may
  return the approved safe principal/organisation projection with
  `provisioningStatus: "provisioned"`; and
- multiple active memberships fail closed until a later approved
  organisation-selection design exists.

The browser never supplies an active organisation as identity context. No
business authorisation decision is cached across requests. A still-valid Entra
token cannot override an inactive mapping, principal, membership, assignment,
capability, or scope.

### Operations and local development

The original Milestone 2A recommendation to enable **User assignment required**
is superseded by ADR-0014. The approved setting is **No**. Any valid exact-tenant
identity may authenticate, but guest/B2B accounts and all other identities still
receive no Centre Success access without an explicit active internal mapping and
current PostgreSQL authority.

The first local proof uses a separate, explicit non-HTTP `encore exec`
bootstrap. It accepts no Entra identity and creates only stable synthetic local
records: one development organisation, a bootstrap operator, a target System
Administrator, one active membership for each, and one organisation-scoped
assignment for each to the existing canonical `system_administrator` role.
Both assignments are unavoidable bootstrap grants because no narrower approved
canonical role contains the linker's `identity.mapping.manage` capability.
The utility validates the role's exact seven technical capabilities, rejects
ambiguous or conflicting facts, serialises concurrent runs with a transaction
advisory lock, writes a separate append-only event for each privileged grant,
and is idempotent. It refuses every non-local environment before mutation and
has no HTTP, browser, authentication-bypass, Entra-tenant mutation, external
mapping, real-person, or cloud-provisioning path.

Local identity mapping remains a separate explicit non-HTTP `encore exec`
operator workflow. It links an operator-supplied BSA tenant ID and Entra `oid`
only to the existing synthetic target principal, refuses non-local
environments, requires the operator's current `identity.mapping.manage`
authority in the audit organisation, rejects conflicts, is idempotent for an
identical active mapping, and writes a minimised attributable audit event. The
linker creates no Microsoft account, principal, membership, role, assignment,
capability, or scope and is not a production onboarding path.

The exact local browser origin `http://localhost:3000` is allowed for
authenticated Bearer-header requests to `http://localhost:4000`. There is no
wildcard, production origin, cookie authentication, or browser
`credentials: include`. Encore permits all origins as a local-development
convenience, so the committed exact allowlist describes deployed behaviour and
must not be misrepresented as a local runtime origin rejection. Production
origins remain deferred by ADR-0008.

Encore still invokes the auth handler when an `Authorization` header is sent to
the public health route. An `unauthenticated` result is treated as anonymous on
that route, so a malformed credential establishes no AuthData while the minimal
health response remains available. The same missing or malformed credential is
denied on the protected self-context route. This distinction is covered by the
live local gateway smoke and grants no protected access.

Offboarding requires both actions under the applicable BSA processes:

1. disable or revoke the Microsoft account/session; and
2. deactivate the Centre Success internal principal or mapping.

The second action provides application-side revocation even while an already
issued Entra access token remains cryptographically valid. Operational
authentication telemetry uses correlation IDs and generic reason codes only;
raw tokens, claim payloads, credentials, signing material, and provider error
detail are never logged. Routine successful authentication does not append a
durable audit row.

## Consequences

Milestone 2A adds MSAL browser dependencies and a standards-compliant JWT/JWKS
verification dependency, but no Microsoft Graph integration or second backend
service. The tenant, API application/client ID, Web SPA application/client ID,
API scope, admin consent, and working local MSAL v5 `/redirect` path are
confirmed. The connected proof first demonstrated real BSA sign-in, API
access-token acquisition, strict Encore verification, safe unmapped denial,
and Entra sign-out/root return. On 11 August 2026 the Product Owner completed
the reviewed synthetic local bootstrap and mapping workflow and repeated the
browser proof. The application then showed `Welcome, Local System
Administrator`, `Authentication: Connected`, and `Centre Success: Ready`,
closing the live `tid + oid` mapping, internal-principal, active-membership,
PostgreSQL-context, and protected `/foundation/me` criteria. The mapped Centre
Success principal and organisation are synthetic local-development data, not a
production provisioning workflow.
Frontend public
configuration is limited to `NEXT_PUBLIC_ENTRA_TENANT_ID`,
`NEXT_PUBLIC_ENTRA_WEB_CLIENT_ID`, `NEXT_PUBLIC_ENTRA_API_CLIENT_ID`,
`NEXT_PUBLIC_ENTRA_REDIRECT_URI`,
`NEXT_PUBLIC_ENTRA_POST_LOGOUT_REDIRECT_URI`, and
`NEXT_PUBLIC_ENCORE_API_URL`; the API scope is derived from the API client ID,
not accepted as an arbitrary environment value. Backend trusted configuration
uses `EntraTenantId`, `EntraApiClientId`, and `EntraWebClientId`. The SPA has no
client secret; CI uses synthetic keys and requires no production Microsoft
secret.

Microsoft access tokens can outlive an application permission change. Current
PostgreSQL mapping, principal, membership, assignment, capability, and scope
facts therefore continue to be evaluated per request. MFA, recovery,
Conditional Access policy, step-up assurance, production CORS/deployment,
multi-organisation selection, automated joiner/mover/leaver integration,
support access, and all Milestone 2B business functionality remain separately
gated.
