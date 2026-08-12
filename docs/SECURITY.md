# Security and Privacy Architecture

## Objectives

Centre Success must protect children, families, staff, operational evidence, financial information, and organisational assurance data while remaining useful during busy centre operations. Security is enforced through identity, backend authorisation, minimisation, secure defaults, traceability, resilient operations, and reviewed human processes.

The architecture is risk-based and requires legal/privacy validation. It does not assert that any named law applies to Bright Steps without organisational review.

## Reference frame

- [OAIC — Australian Privacy Principles guidelines](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines) provides current guidance on collection, use/disclosure, data quality, security, access/correction, and governance where the Privacy Act applies.
- [OAIC — Notifiable Data Breaches](https://www.oaic.gov.au/privacy/notifiable-data-breaches) is the official entry point for applicable breach-assessment and notification guidance.
- [ACECQA — current NQF child-safety changes](https://www.acecqa.gov.au/nqf-child-safety-changes-1-september-2025-and-1-january-2026) is a source input for the governed compliance process, not a substitute for jurisdiction-specific advice.
- Encore’s [automatic infrastructure](https://encore.dev/features/automatic-infrastructure) and [TypeScript platform overview](https://encore.dev/ts) describe the confirmed platform capabilities; environment configuration must still be security-reviewed.
- Microsoft's [MSAL React guidance](https://learn.microsoft.com/en-us/entra/msal/javascript/react/getting-started), [access-token claims reference](https://learn.microsoft.com/en-us/entra/identity-platform/access-token-claims-reference), [access-token validation guidance](https://learn.microsoft.com/en-us/entra/identity-platform/access-tokens), and [signing-key rollover guidance](https://learn.microsoft.com/en-us/entra/identity-platform/signing-key-rollover) define the approved browser and API trust inputs. Centre Success adds its exact single-tenant/client contract and PostgreSQL mapping/authorisation boundary.
- Encore's [authentication handler documentation](https://encore.dev/docs/ts/develop/auth) defines the central handler, trusted AuthData, and `auth: true` endpoint boundary.

Platform and authentication sources were checked 11 August 2026 for Milestone 2A. External regulatory and privacy references must still be revalidated before the affected business capability is implemented or released.

## Data classification

| Class | Examples | Baseline controls |
| --- | --- | --- |
| Public/approved | Approved public policy or publication | Integrity, publication approval, provenance |
| Internal | Routine centre tasks and non-sensitive guidance | Authenticated scoped access, audit for changes |
| Confidential | Findings, audit detail, QIP drafts, coaching, staff and budget information | Least privilege, purpose limits, export controls, encryption |
| Highly restricted | Identifiable wellbeing/support data, sensitive child evidence, credentials, legal/security cases | Separate capabilities, strict minimisation, enhanced access audit, restricted search/AI/export, step-up where approved |

Classification follows the most sensitive linked content. Notifications, logs, analytics, search indexes, support tools, backups, and exports inherit the classification rules.

## Threat model

Priority threats include:

- cross-organisation or cross-centre access through missing object-level checks;
- excessive access by privileged, support, finance, executive, or Area Manager roles;
- insecure direct object reference and bulk/export leakage;
- compromised sessions, phishing, stale accounts, and overlong delegation;
- malicious or accidental upload, unsafe object links, and sensitive file metadata;
- injection and unsafe rendering of notes, imported data, documents, and AI output;
- integration/webhook forgery, replay, duplicate events, or mapping errors;
- secrets in source, logs, prompts, generated files, or client bundles;
- reidentification of wellbeing respondents through small cohorts or repeated filtering;
- AI prompt injection, permission bypass, hallucinated requirements, or sensitive data disclosure;
- tampering with audit, scoring, control, budget, or source versions;
- dependency, build, CI/CD, cloud-account, and GitHub compromise;
- denial of service, background-job storms, and notification floods;
- unavailable or unrecoverable PostgreSQL/Object Storage data; and
- insider misuse or covert employee/child surveillance.

## Identity and session architecture

Microsoft Entra ID in the single Bright Steps Australia tenant is approved for authentication only. Entra **User assignment required** is **No**: any valid identity from the exact BSA tenant may authenticate, but authentication alone creates no Centre Success access. Unmapped or uninvited identities remain `not_provisioned`; guest/B2B identities are never auto-provisioned and ambiguous cases require administrator review. Centre Success neither implements public self-registration nor stores the authentication method in its domain model. Authentication adds no Microsoft Graph, directory, mailbox, calendar, SharePoint, Teams, or other business-integration permission.

Two single-tenant app registrations separate the public Centre Success Web SPA from the Centre Success API. The browser uses MSAL Authorization Code with PKCE, an actual `/redirect` bridge, root post-logout destination, and `sessionStorage` cache. The connected local smoke proves the current Web registration accepts the exact MSAL v5 `/redirect` URI; root remains the post-logout landing and is not a bridge substitute. One central frontend adapter acquires the delegated `api://5e8ce11c-ade3-4baa-82f6-351919b444ca/access_as_user` token and supplies it as `Authorization: Bearer <access-token>` to the generated client. It never sends an ID token or Microsoft Graph token, manually stores an access token, accepts an arbitrary scope environment variable, or lets components construct identity headers.

Environment URLs do not define OAuth trust. Local frontend and backend origins
are `http://localhost:3000` and `http://localhost:4000`. The confirmed staging
backend/API origin is
`https://staging-bright-steps-centre-success-uwhi.encr.app`; it is not an Entra
SPA redirect URI, post-logout URI, Application ID URI, scope, or token audience.
No staging frontend origin is approved or deployed, so no staging browser CORS
or Entra redirect value is approved. The API registration continues to define
the confirmed `api://5e8ce11c-ade3-4baa-82f6-351919b444ca` Application ID URI,
delegated scope, and exact `aud = 5e8ce11c-ade3-4baa-82f6-351919b444ca`
version 2 token validation.

One central Encore handler strictly parses the Bearer header and validates RS256 signature by `kid`; `iss = https://login.microsoftonline.com/27026100-3522-48b5-8e95-80230afc4127/v2.0`; `tid = 27026100-3522-48b5-8e95-80230afc4127`; `aud = 5e8ce11c-ade3-4baa-82f6-351919b444ca` (the API client-ID GUID, not the `api://` URI); `azp = b490189d-37c1-422c-a54a-b12d55646947`; `ver = 2.0`; `exp` and `nbf` with a small documented clock skew; and space-delimited `scp` containing `access_as_user`. Missing, malformed, expired, not-yet-valid, wrong-issuer, wrong-tenant, wrong-client, SPA/ID/Graph/unrelated-audience, wrong-version, wrong-scope, unknown-key, or invalid-signature credentials receive generic public responses.

The handler obtains signing keys only through the BSA tenant v2 OIDC discovery document and its `jwks_uri`. Remote work is single-flight, normal refresh is attempted hourly, cached keys are trusted for no more than 24 hours, the remote timeout is five seconds, and all remote fetches—including an unknown-`kid` forced refresh—share a five-minute cooldown. Unresolved or stale trust fails closed. Key resolution is injectable; deterministic tests use generated test-only RSA material without a Microsoft login or production credential.

The verified lower-case `tid + oid` resolves through `external_identity_mappings` as `provider_key = 'microsoft_entra:27026100-3522-48b5-8e95-80230afc4127'` and raw lower-case `oid` provider subject. A missing/inactive mapping or inactive principal receives no Centre Success access; a valid Entra token never provisions access. Trusted AuthData contains only the internal principal UUID in Encore's required `userID` field. It contains no provider identity, Entra group/app role/claim, Centre Success role, capability, scope, organisation, centre, email, raw JWT, or credential.

The protected authentication-gate self-context endpoint reloads current membership and assignment-bound capability/scope facts from PostgreSQL for every request. Zero active organisation memberships return only `provisioningStatus: "not_provisioned"`; exactly one is selected server-side; multiple fail closed pending a future organisation-selection decision. No client-supplied active organisation is identity context, and no business authorisation decision is cached across requests. Future protected business endpoints must continue through the capability-and-resource-scope authoriser.

The Product Owner completed the live local seam proof on 11 August 2026: a real BSA Microsoft session obtained the Centre Success API access token; Encore validated it; the approved local `tid + oid` mapping resolved the synthetic Local System Administrator principal; PostgreSQL loaded its one active synthetic organisation context; and protected `/foundation/me` returned the provisioned state. The earlier unmapped denial disappeared only after that reviewed mapping. This is local-development evidence, not a production onboarding or auto-provisioning path, and no token, claim payload, `oid`, email, or UPN is recorded in documentation or logs.

The public health endpoint remains minimal and non-sensitive. Encore invokes the declared auth handler when an `Authorization` header is supplied even to this public route. If that handler returns `unauthenticated`, Encore deliberately continues the health request as anonymous: a malformed Bearer credential establishes no AuthData but the minimal health response remains `200`. The protected self-context route denies the same missing or malformed credential with `401`. This observed gateway behaviour does not authenticate the caller or grant access to protected data.

For a provisioned principal the self-context endpoint returns only provisioning status, authenticated principal ID, safe display name, and active organisation ID/name needed to prove the chain; it exposes no assignments, raw capabilities, other users, raw Entra identity, provider configuration, or business data. For zero membership it returns no principal or organisation information.

Because Entra access tokens can remain valid after an account or internal access change, offboarding requires both Microsoft account/session disablement or revocation under BSA IT process and immediate Centre Success mapping/principal deactivation. The application-side action independently denies subsequent requests even when the presented token is still cryptographically valid.

## Authorisation

[Permissions](PERMISSIONS.md) is normative for product access. Key controls are:

- deny by default and fail closed;
- organisation and object scope checked on every protected read/write;
- assignment-aware Area Manager access;
- explicitly scoped Compliance Manager, Operations Leadership, Finance, Executive, export, and wellbeing capabilities;
- System Administrator technical access without implicit business-content access;
- field/attachment classification in addition to record access;
- time-bounded delegation and reviewed exceptional access;
- server-side filtering for search, aggregation, count, object download, and exports; and
- negative tests for cross-tenant and cross-centre access.

Milestone 1's composed database authorizer is internal-only. It receives no client identity or hierarchy claims and is not exposed through the public API.

Supabase RLS is not used. PostgreSQL RLS is not assumed as the primary control; Encore backend policy enforcement is mandatory.

## Application and API security

- Type and schema validation at API boundaries with size, range, enum, and normalisation constraints.
- Parameterised database access and explicit response schemas.
- Output encoding and sanitised rich text; never render imported or AI content as trusted executable markup.
- Cross-origin Encore calls use only a Bearer header, and the committed authenticated CORS allowlist contains exactly `http://localhost:3000`; wildcard and production origins are absent. Encore's documented `encore run` convenience permits all origins locally, so the committed exact list governs deployed behaviour rather than providing a local runtime origin rejection. Exact API `aud` and Web-client `azp` validation remain mandatory. The frontend does not use cookie authentication, cross-origin cookie forwarding, or browser `credentials: include`.
- Rate limits and abuse controls by endpoint, identity, organisation, and IP where appropriate.
- Idempotency for retried commands, webhook events, Pub/Sub subscribers, imports, and action generation.
- Optimistic concurrency and state-machine validation for material workflows.
- Generic not-found/denial responses to reduce resource enumeration.
- Safe pagination and bounded queries/exports.
- Security headers, TLS, and no sensitive data in URLs.
- Generated Encore API documentation/explorer access restricted by environment and endpoint exposure.

### Implemented People & Access invitation security boundary

Milestone 2C is **ACCEPTED / COMPLETE**. Invitation secrets use 256 bits of cryptographic randomness, exact 72-hour expiry, one-time consumption, resend/cancel generation invalidation, HMAC-SHA-256 verifier storage, constant-time comparison, generic errors, and no role/scope or identity data in the URL. Delivery-only ciphertext uses AES-256-GCM under a separate Encore secret in the transactional outbox and is cleared atomically after successful terminal delivery; non-sensitive delivery and attempt metadata remains. Raw invitation secrets, Entra tokens, JWT claims, email/UPN, and Microsoft object identifiers must not appear in logs or audit payloads.

### Milestone 3A Daily Success security boundary

Daily Success is a protected, private/no-store read projection. AuthData supplies only the internal principal UUID. Each request establishes one decision timestamp and repeatable-read snapshot, resolves one active organisation, loads authorization context once, resolves active centres/hierarchy set-wise, and evaluates the existing pure same-assignment capability/scope policy. Source SQL receives only separately authorised centre ID sets and aggregation occurs after filtering. There is no cross-request authorization/result cache, so effective portfolio removal applies on the next request.

Threat controls explicitly cover cross-organisation/centre aggregate leakage, unauthorized inferred counts, role/capability-scope recombination, unsupported perspective escalation, System Administrator business-content leakage, stale portfolio access, critical risk suppression, invalid timezone, source update between requests, and adapter outage. A failed adapter yields an honest partial warning and suppresses on-track claims. Source summaries exclude evidence filenames and detailed narratives. CTAs are code-generated relative application routes; no stored or client-provided URL is returned, and destination APIs independently resolve and authorize opaque IDs.

Centre-local dates use validated `centres.timezone`; organisation-only cases use validated `organisations.default_timezone`. Browser/client timezone input and state abbreviations are never trusted. Daily Success creates no persistent completion, snooze, preference, notification, manual priority, or task state. Minimal source timing/query diagnostics contain no item narrative, token, employee ranking, or hidden score. See `DAILY_SUCCESS.md` and ADR-0015.

Email is only delivery/correlation evidence; permanent identity remains exact `tid + oid`. A forwarded link, same-tenant token, mutable email match, Entra group/app role, or frontend state cannot activate access. Missing/ambiguous/mismatched correlation, guest uncertainty, mapping conflicts, and changed role/scope packages fail closed to administrator review. Pending proposals stay outside active authorisation tables.

Privileged packages require a distinct current System Administrator to approve the exact immutable package. Every access mutation is attributable and preserves at least one reachable active System Administrator under concurrency; operations target two. Administrative APIs require normal provisioned AuthData plus PostgreSQL authority. Only sensitive `POST /invitations/accept` admits an unmapped invitation candidate: it reuses the strict Entra verifier but never creates internal AuthData or confers business access. Invitation email delivery uses a PostgreSQL outbox and idempotent Encore Pub/Sub worker with a separately approved transactional provider—never Microsoft Graph for email or guest discovery. See `PEOPLE_AND_ACCESS.md` and ADR-0014.

## Evidence and Object Storage

- Private buckets by default; no public evidence bucket.
- Random object keys and short-lived authorised access.
- Milestone 2B local synthetic uploads remain explicitly `not_scanned`; the API and UI disclose that state. Non-local access to a newly uploaded unscanned object fails closed until an approved scanning control exists.
- Upload quarantine, content signature/type/size checks, malware scanning, and checksum verification before use.
- Prevent active content execution; force safe download/render policy for risky formats.
- Strip or account for sensitive image/document metadata where appropriate.
- Store classification, centre, purpose, retention, uploader, and scan status in PostgreSQL.
- Authorise every view/download/export independent of possession of a database record ID.
- Version rather than overwrite; enforce legal hold and audited deletion.

## Privacy by design

- Complete a data inventory and privacy impact assessment before Milestone 1 data collection.
- Record purpose and necessity for each personal or sensitive field.
- Provide approved collection notices and consent/choice mechanisms where required.
- Avoid child names and personal details unless strictly necessary for a defined workflow.
- Separate identifiable wellbeing support from operational/performance data.
- Apply safe aggregation, suppression, and query controls to wellbeing reporting.
- Define access/correction, complaint, retention, deletion, and legal-hold processes with authorised owners.
- Review overseas processing, subprocessors, cloud/data regions, AI providers, telemetry, email/SMS providers, and support access before use.

## AI security

- Retrieve only sources and records the requesting user can access.
- Treat documents, evidence, imported text, and user prompts as untrusted content; tool instructions never come from retrieved documents.
- Keep model tools narrow, typed, scoped, and read-only by default.
- Consequential actions are drafts requiring normal backend authorisation and human approval.
- Require citations and verification state for compliance answers; abstain when sources conflict or are unavailable.
- Redact or exclude highly restricted data unless a separately approved use case requires it.
- Prevent provider training/retention beyond approved terms and document region/subprocessors.
- Log model/config/tool decisions without logging unnecessary prompt payloads.
- Run prompt-injection, data-exfiltration, cross-scope, hallucination, and unsafe-action evaluations before release.

## Secrets and configuration

Frontend public configuration is limited to `NEXT_PUBLIC_ENTRA_TENANT_ID`, `NEXT_PUBLIC_ENTRA_WEB_CLIENT_ID`, `NEXT_PUBLIC_ENTRA_API_CLIENT_ID`, `NEXT_PUBLIC_ENTRA_REDIRECT_URI`, `NEXT_PUBLIC_ENTRA_POST_LOGOUT_REDIRECT_URI`, and `NEXT_PUBLIC_ENCORE_API_URL`. The API scope is derived as `api://5e8ce11c-ade3-4baa-82f6-351919b444ca/access_as_user`, not accepted from an arbitrary environment value. The SPA registration is a public client and has no client secret.

Backend integrity-sensitive trusted configuration uses Encore-supported environment configuration/secrets named `EntraTenantId`, `EntraApiClientId`, and `EntraWebClientId`. The issuer and discovery endpoints are derived from the validated tenant ID; a caller cannot supply them. No permanent Microsoft signing PEM or client secret is configured. Root and frontend `.env*` files must be ignored except deliberately safe examples. Values are environment-scoped, never committed as real credentials, and redacted from logs, traces, errors, and generated clients.

CI authentication tests generate test-only signing material and require no Microsoft account, live JWKS request, or production Microsoft secret. Configuration that changes business behaviour—control versions, thresholds, score methods, template versions—is governed application data, not an untracked environment variable.

## Logging, audit, and observability

Encore tracing, structured logging, and metrics support debugging and reliability. Business audit events are a separate durable record. Foundation events are append-only and enforce that every non-system scope, actor, and known foundation resource belongs to the recorded organisation; system events cannot claim tenant scope. Each future domain must add equivalent resource-target validation before emitting its first event type.

Logs and traces:

- use correlation/request IDs and safe identifiers;
- exclude tokens, secrets, raw evidence, personal responses, child details, financial detail, and unrestricted request bodies;
- apply controlled retention and access;
- alert on error rates, suspicious denials, export anomalies, auth changes, job backlog, and integration failures; and
- never use centre or user names as high-cardinality metric labels.

Audit records cover permission changes, privileged access, evidence/export activity, source/control/template releases, audit finalisation/amendment, high-risk action closure, budget import/config, wellbeing administration/access, and AI-assisted material actions. The local-only first-administrator bootstrap writes one minimised append-only event for each of its two synthetic canonical System Administrator assignments; both are explicitly bootstrap-sourced with no fabricated human actor and contain no Entra identity or credential. The separate local external-identity linker records a minimised, attributable security event without the Entra tenant/object identifiers or credentials. Routine successful page authentication is not appended per request, and expected unprovisioned-account traffic must not become an unauthenticated write-amplification path. Investigation-worthy authentication categories may use correlation IDs and generic internal reason codes in rate-limited operational telemetry under an approved retention/alert policy; raw access/ID tokens, JWT payloads, secrets, credentials, and provider error detail are never logged. The public health route remains outside the durable audit ledger.

## Infrastructure and delivery

- Encore Cloud and GitHub-connected deployment are the confirmed deployment path; production cloud/provider/region and account ownership require approval.
- Protect the default branch, require reviewed pull requests and passing checks, and restrict environment/deployment permissions.
- Separate local, test, preview/staging, and production data/secrets. Never copy production personal data into lower environments without an approved minimisation process.
- Pin and review dependencies. Foundation CI performs frozen installs, dependency audits, backend authentication/authorisation/database tests, frontend lint/tests/build, generated-client verification, and repository consistency checks. It authenticates the Encore CLI with a least-privilege, repository-secret-backed application auth key but requires no production Microsoft secret and performs no deployment or production automation.
- Treat `.encore` and `encore.gen` as generated, not hand-edited product source.
- OrbStack is only the local Docker-compatible runtime where Encore infrastructure requires it; it is not the production architecture.
- Limit Encore dashboard, service catalog, logs, and cloud-console access by environment and job need.

## Resilience and recovery

Before production, approve recovery objectives per workflow; confirm Encore Cloud/PostgreSQL/Object Storage backup, point-in-time recovery, replication, restore testing, and regional behaviour. Design idempotent scheduled/event work, bounded retries, dead-letter handling, reconciliation, and safe degradation.

High-priority operational records should remain discoverable during downstream notification/integration failure. A restore test must prove tenant integrity, evidence linkage, audit history, and object/database consistency.

## Incident response

Define and exercise:

1. detection and internal reporting;
2. containment and credential/session revocation;
3. evidence preservation and scoped investigation;
4. assessment by authorised privacy, legal, child-safety, security, and operational owners;
5. applicable notification decisions based on current law and policy;
6. recovery and data-integrity validation;
7. communication; and
8. post-incident corrective actions and control updates.

The product may support workflow evidence but does not autonomously decide whether a regulatory or privacy notification is required.

## Current delivery constraints and deferred gates

Milestone 1 and Milestone 2A are accepted. Milestone 2B authorises only the synthetic Area Manager quarterly-review-to-corrective-action vertical slice. Its release boundary remains deliberately narrow:

- the self-context and approved quarterly-review business APIs are protected through the same central authentication and PostgreSQL authorisation boundary;
- a real BSA development Entra account may map only to controlled synthetic Centre Success data through the local-only operator workflow;
- the first local synthetic operator and target administrator may be created only by the reviewed `encore exec` bootstrap, which refuses non-local environments, reuses the canonical System Administrator role, creates no mapping, and exposes no API;
- no child data, finance, coaching, wellbeing, QIP, regulatory corpus, or other business module is introduced;
- audit/remediation evidence is private, centre/organisation scoped, purpose-bound, and unavailable when non-local and unscanned;
- no production deployment or support-access path is created merely because local authentication runs; and
- no break-glass, impersonation, automated employee provisioning, HR synchronisation, Microsoft Graph, or Entra-owned business authorisation is introduced.

Milestone 2C People & Access is **ACCEPTED / COMPLETE** within the approved architecture: migrations, the invitation acceptance boundary, APIs, the outbox/Pub/Sub worker, provider-neutral development delivery, and frontend routes are present. This is not a production-readiness declaration. The production first-administrator ceremony remains separately gated until the Encore Cloud operational mechanism is validated, and the concrete production transactional-email provider, sender/domain/template/support process, Entra email-claim operations, retention, rate/abuse controls, JML source/SLA, access reviews, and break-glass/recovery remain deferred decisions.

Before the relevant later capability or production release, Bright Steps must still approve the data inventory/privacy plan; evidence and retention/legal-hold design; cloud region, backup, deployment, and support access; incident owners; and AI/wellbeing privacy decisions.

## Open decisions

- Applicable privacy, employment, records, child-safety, and jurisdictional obligations confirmed by qualified owners.
- Data residency and subprocessors.
- Production frontend origins, Entra app-registration operations, and environment configuration.
- MFA, recovery, session-revocation expectations, step-up authentication, and assurance levels for future high-risk actions.
- Multi-organisation active-context selection and persistence beyond the Milestone 2A zero/one/multiple server-side rules.
- Security assurance standard, penetration-test cadence, and vulnerability SLAs.
- Recovery objectives and business continuity process.
- Support access and break-glass design.
- Retention/deletion schedule and audit-log retention.
