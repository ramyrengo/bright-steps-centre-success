# Security and Privacy Architecture

## Objectives

Centre Success must protect children, families, staff, operational evidence, financial information, and organisational assurance data while remaining useful during busy centre operations. Security is enforced through identity, backend authorisation, minimisation, secure defaults, traceability, resilient operations, and reviewed human processes.

The architecture is risk-based and requires legal/privacy validation. It does not assert that any named law applies to Bright Steps without organisational review.

## Reference frame

- [OAIC — Australian Privacy Principles guidelines](https://www.oaic.gov.au/privacy/australian-privacy-principles/australian-privacy-principles-guidelines) provides current guidance on collection, use/disclosure, data quality, security, access/correction, and governance where the Privacy Act applies.
- [OAIC — Notifiable Data Breaches](https://www.oaic.gov.au/privacy/notifiable-data-breaches) is the official entry point for applicable breach-assessment and notification guidance.
- [ACECQA — current NQF child-safety changes](https://www.acecqa.gov.au/nqf-child-safety-changes-1-september-2025-and-1-january-2026) is a source input for the governed compliance process, not a substitute for jurisdiction-specific advice.
- Encore’s [automatic infrastructure](https://encore.dev/features/automatic-infrastructure) and [TypeScript platform overview](https://encore.dev/ts) describe the confirmed platform capabilities; environment configuration must still be security-reviewed.

Sources were checked 11 August 2026 and must be revalidated before implementation.

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

The identity provider is an open decision. Milestone 1 implements the identity-provider-neutral internal principal, external-identity mapping seam, persisted role baseline, data-driven assignments, pure policy tests, and a database-backed internal authorization-context seam. It does not implement passwords, a temporary login, client-supplied identity headers, or runtime authentication.

After Bright Steps approves authentication assurance, MFA, recovery, invitation, federation, and joiner/mover/leaver processes, an Encore authentication handler will validate credentials and establish the trusted internal principal and active organisation. The implemented loader then reads current membership, assignment-bound capability, effective scope, and resource ancestry from one PostgreSQL snapshot. Sessions require secure transport, expiry, rotation/revocation, browser protections appropriate to the chosen token/cookie model, and reauthentication for approved high-risk actions.

Until then, no protected business API is exposed. The sole public Milestone 1 endpoint is a minimal health check that returns no tenant, centre, user, configuration, dependency, version, or diagnostic detail beyond the approved operational contract.

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
- CSRF protection if cookie authentication is selected; restrictive CORS based on approved frontend origins. Milestone 1 local CORS allows only uncredentialed requests from `http://localhost:3000`; wildcard or credentialed CORS is not enabled.
- Rate limits and abuse controls by endpoint, identity, organisation, and IP where appropriate.
- Idempotency for retried commands, webhook events, Pub/Sub subscribers, imports, and action generation.
- Optimistic concurrency and state-machine validation for material workflows.
- Generic not-found/denial responses to reduce resource enumeration.
- Safe pagination and bounded queries/exports.
- Security headers, TLS, and no sensitive data in URLs.
- Generated Encore API documentation/explorer access restricted by environment and endpoint exposure.

## Evidence and Object Storage

- Private buckets by default; no public evidence bucket.
- Random object keys and short-lived authorised access.
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

Use Encore secrets for credentials and keys when implementation is approved. Secrets are environment-scoped, least-privilege, rotatable, never committed, never exposed to Next.js client code, and redacted from logs/traces/errors. Configuration that changes business behaviour—control versions, thresholds, score methods, template versions—is governed application data, not an untracked environment variable.

## Logging, audit, and observability

Encore tracing, structured logging, and metrics support debugging and reliability. Business audit events are a separate durable record. Foundation events are append-only and enforce that every non-system scope, actor, and known foundation resource belongs to the recorded organisation; system events cannot claim tenant scope. Each future domain must add equivalent resource-target validation before emitting its first event type.

Logs and traces:

- use correlation/request IDs and safe identifiers;
- exclude tokens, secrets, raw evidence, personal responses, child details, financial detail, and unrestricted request bodies;
- apply controlled retention and access;
- alert on error rates, suspicious denials, export anomalies, auth changes, job backlog, and integration failures; and
- never use centre or user names as high-cardinality metric labels.

Audit records cover permission changes, privileged access, evidence/export activity, source/control/template releases, audit finalisation/amendment, high-risk action closure, budget import/config, wellbeing administration/access, and AI-assisted material actions. Runtime authorization allow/deny audit policy is deferred until an authenticated protected endpoint exists; the public health route is not logged into the durable audit ledger to manufacture traffic. Integration tests instead prove tenant event attribution and append-only update/delete rejection directly at the approved audit seam.

## Infrastructure and delivery

- Encore Cloud and GitHub-connected deployment are the confirmed deployment path; production cloud/provider/region and account ownership require approval.
- Protect the default branch, require reviewed pull requests and passing checks, and restrict environment/deployment permissions.
- Separate local, test, preview/staging, and production data/secrets. Never copy production personal data into lower environments without an approved minimisation process.
- Pin and review dependencies. The Milestone 1 GitHub Actions definition performs frozen installs, dependency audits, backend and authorization tests, frontend lint/tests/build, generated-client verification, and repository consistency checks. It authenticates the Encore CLI with a least-privilege, repository-secret-backed application auth key but performs no deployment or production automation.
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

## Milestone 1 foundation constraints and deferred gates

Milestone 1 foundation work is authorised with synthetic, non-sensitive data and the approved role/scope baseline. Its release boundary is deliberately narrow:

- no protected runtime endpoint before the identity provider and session/MFA model are approved;
- no real personal, child, finance, evidence, coaching, or wellbeing data;
- no business module beyond organisation/centre/access/audit foundations;
- no production deployment or support-access path merely because local foundation work runs; and
- no break-glass behaviour.

Before the relevant later capability or production release, Bright Steps must still approve the data inventory/privacy plan; evidence and retention/legal-hold design; cloud region, backup, deployment, and support access; incident owners; and AI/wellbeing privacy decisions.

## Open decisions

- Applicable privacy, employment, records, child-safety, and jurisdictional obligations confirmed by qualified owners.
- Data residency and subprocessors.
- Security assurance standard, penetration-test cadence, and vulnerability SLAs.
- Recovery objectives and business continuity process.
- Support access and break-glass design.
- Retention/deletion schedule and audit-log retention.
