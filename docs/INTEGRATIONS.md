# Integrations Architecture

## Principles

1. Name a system of record and business owner for every imported field.
2. Integrate through a domain adapter; do not leak vendor schemas throughout the modular monolith.
3. Minimise data and scope by organisation, centre, purpose, and classification.
4. Preserve source identifier, version/batch, source timestamp, ingestion time, mapping version, and reconciliation state.
5. Treat external data as untrusted until authenticated, validated, mapped, and reconciled.
6. Design for duplicate, delayed, out-of-order, partial, replayed, and corrected data.
7. Surface freshness/failure to users when it affects decisions.
8. Never let an integration bypass backend authorisation or write final consequential states without a governed command.

Microsoft Entra ID in the single Bright Steps Australia tenant is approved only
as the Milestone 2A authentication provider. Two app registrations and the
delegated Centre Success API scope do not approve business, HR, Microsoft Graph,
or any other external application integration.

## Candidate integration register

Actual vendors and scope require discovery.

| Capability | Potential system of record | Direction | Centre Success purpose | Key constraints |
| --- | --- | --- | --- | --- |
| Identity | Microsoft Entra ID — single BSA tenant | Inbound/access token | Strictly verified `tid + oid` identity for mapped BSA workforce users only | Two app registrations; API access token and `access_as_user`; User assignment required = No; authentication alone grants nothing; no auto-provisioning, Graph, groups/app-role authority, or email identity; PostgreSQL-owned authorisation |
| People/centre assignments | HR/people or operations master | Inbound | Person status, Centre Director/Area Manager assignments | Effective dates, rapid offboarding, no unnecessary HR fields |
| Centre hierarchy | Operations/master data | Inbound | Organisation, region/state, centre scope | Jurisdiction/timezone and historical hierarchy |
| Roster/staffing facts | Roster/workforce system | Inbound aggregates/facts | Approved compliance or readiness controls | Do not become a shadow roster; minimise personal details |
| Training/certifications | LMS/HR/credential source | Inbound | Verified status and expiry | Source freshness, issuer, legal interpretation reviewed |
| Finance | Accounting/budget/procurement system | Inbound | Approved/actual/committed/forecast context | Immutable batches, mapping, reconciliation, restricted detail |
| Notifications | Transactional email provider (vendor deferred) | Outbound/status | Future People & Access invitations, reminders, and escalations | PostgreSQL outbox plus Encore Pub/Sub worker; idempotent delivery; minimal content; no Graph; provider, sender, retention, and support policy require approval |
| Document repository | Approved document system | Inbound/reference | Policies and knowledge sources | Licence, version, classification, deletion, no open crawl |
| ACECQA/jurisdictional sources | Official sites/manual registrar | Controlled reference | Change monitoring and source registry | Human verification; no auto-activation or invented law |
| AI provider | Approved model/embedding service | Request/response | Assistant functions | Privacy, region, retention/training, prompt injection, cost |
| GitHub/Encore Cloud | Source/deployment platform | Deployment metadata | CI/CD and environments | Branch protection, least privilege, secret separation |

Centre Success is authoritative for its task/action/audit/QIP/coaching/health workflow records unless a later integration decision assigns another owner.

## Integration patterns

### Synchronous API query

Use when a current answer is essential and the source offers reliable latency/availability. Apply timeouts, bounded retries for safe idempotent calls, circuit breaking/degradation, schema validation, and no secrets in traces. Do not make the core daily view wholly dependent on many live systems.

### Scheduled incremental sync

Use source watermarks/cursors and immutable batches. Validate, quarantine errors, reconcile, then atomically publish. Scheduled full reconciliation detects missed changes. Store source cutoff and display freshness.

### Webhook/event ingestion

Verify signature, timestamp/nonce where supported, connection scope, content type, and event schema. Persist event ID and idempotency state before processing. Handle out-of-order correction and replay; acknowledge safely without accepting invalid business state.

### Governed file import

Use for initial or vendor-limited integrations. Upload to quarantine, scan, hash, validate schema/version, preview mapping and totals, obtain Finance/owner approval where needed, publish atomically, and retain an import manifest under policy. Spreadsheet upload is not an excuse to bypass mapping or tenant checks.

### Outbound command

Avoid in MVP unless the external system remains authoritative and supports safe idempotency/status. Require user authority, explicit confirmation for consequential actions, correlation, durable outbox, retry/reconciliation, and clear partial-failure handling.

## Adapter boundary

Each adapter defines:

- vendor-independent domain contract;
- connection owner and authorised organisation/scope;
- credentials as Encore secret references;
- supported operations and direction;
- schema/mapping version;
- rate, timeout, retry, idempotency, and ordering semantics;
- data classification and allowed fields;
- reconciliation and correction behaviour;
- health/freshness metrics and support runbook; and
- disable/revoke and data-deletion process.

Vendor payloads are kept at the edge. Domain modules receive validated commands/facts and remain testable with contract fixtures.

## Data mapping and master data

- Never match centres or people by display name alone.
- Keep external IDs namespaced by connection and effective-dated where reused.
- Unknown/ambiguous mappings enter quarantine for an authorised owner.
- Mapping changes are versioned and audited; reprocessing identifies the mapping used.
- A source deletion/status change follows an approved deactivation/retention rule rather than cascading blindly.
- Imported fields record source authority. Local override is permitted only where the field’s governance allows and remains visibly distinct.

## Event architecture

Candidate internal events include task/action/audit/score changes, integration batch publication, and notification intent. Encore Pub/Sub is appropriate for asynchronous side effects, but the modular monolith should not use events merely to imitate microservices.

Design assumptions:

- delivery can be at least once;
- subscribers are idempotent using stable event IDs and target version;
- business writes and outbox records commit together where consistency matters;
- poison messages are isolated with retry/dead-letter handling and operational alerting;
- consumers re-check tenant and current resource state;
- event payloads minimise sensitive data and use identifiers; and
- schema versions remain backward compatible or use coordinated migration.

## Notifications

Domain workflows create a notification intent, not a provider call inline. Recipient resolution uses current authorised role/scope. Templates are versioned and keep email/SMS/push content minimal; users follow an authenticated link for detail.

Respect approved mandatory categories, user channel preferences, quiet hours, centre time zone, digesting, deduplication, and escalation. Delivery failure does not roll back the business action and remains visible for retry/support.

For the approved-but-gated People & Access architecture, an invitation transaction commits its current token generation and outbox intent together. A bounded dispatcher publishes to Encore Pub/Sub and an idempotent subscriber calls the later-approved transactional email provider. Resend/cancel invalidates the old generation; delivery records never contain the plaintext token, role, scope, Entra claims, or Microsoft object identifier. Microsoft Graph is not used merely to send invitations or classify guest/member identities. HR/recruitment integration is deferred and cannot silently activate access.

## Official-source monitoring

Automated monitoring may flag that an ACECQA or jurisdictional page/document changed. It must not convert a diff into an active legal control. The source workflow requires an authorised person to verify the official publication, jurisdiction, effective dates, interpretation, affected controls/templates/AI knowledge, and release plan.

## Security and operations

- Least-privilege connection credentials, environment separation, rotation, and rapid revocation.
- Egress allow-listing or provider controls where supported.
- No secrets or raw sensitive payloads in logs/traces/errors.
- Metrics for success/failure, lag/freshness, backlog, rate limits, quarantine, reconciliation, and duplicates.
- Traces correlate external call, batch/event, domain change, outbox, and notification.
- Audit connection/config/mapping changes, manual replay, quarantine resolution, imports, and exports.
- Contract tests with redacted/synthetic fixtures; never commit production payloads.
- Runbooks for provider outage, expired credentials, schema drift, replay, bad batch, and rollback.

## Encore alignment

- Encore secrets: credentials and signing keys.
- Cron: bounded incremental sync, reconciliation, expiry, and review jobs.
- Pub/Sub: asynchronous processing, notifications, and index/score refresh.
- Object Storage: quarantined imports, approved source documents, and export packages.
- PostgreSQL: connections, mappings, sync state, outbox, provenance, and domain snapshots.
- APIs: webhook/import boundaries and authorised status endpoints.
- Tracing/logging/metrics: operational visibility with redaction.

## Open decisions

- Vendor/system inventory and named data owners.
- Identity and master-data sources.
- Finance definitions and integration mechanism.
- Required refresh/freshness and outage behaviour by domain.
- Notification channels/providers and communication policy.
- People & Access transactional email provider, sender domain, invitation template ownership, delivery retry/support policy, and retention.
- Approved source-monitoring method.
- Data residency, subprocessors, support access, and retention for every provider.
- Integration priorities within MVP.
