# Conceptual Database Schema

## Status

This document remains the logical data architecture for the whole product. The foundation, authentication, Milestone 2B quarterly-review and Milestone 2C People & Access physical subsets are implemented through reviewed forward migrations. Milestone 3A Daily Success is implemented without a physical Daily Success table: it is a request-time projection over those source subsets. Later modules remain logical architecture only until separately authorised.

## Persistence strategy

The MVP default is one Encore-managed PostgreSQL database owned by one cohesive Centre Success deployable service. Logical modules own their aggregates and expose internal application interfaces; modules do not write another module’s records through ad hoc queries.

Binary evidence and generated exports belong in private Encore Object Storage. PostgreSQL stores metadata, checksums, classification, retention, and relationships. Encore-managed infrastructure is the confirmed baseline; Supabase is not used.

A separate database or service requires demonstrated security, operational ownership, scaling, availability, or deployment independence—not merely a new domain noun.

## Implemented Milestone 1 physical subset

The source-controlled migrations in `foundation/migrations/` create one Encore-managed PostgreSQL database named `centre_success`. The first migration contains only the organisation, centre, principal, authorisation, and system-audit foundation. Small forward migrations make audit events append-only, enforce tenant/scope integrity, require attributable privileged grants, add optimistic-concurrency tokens, persist and provision the canonical role baseline, and effective-date assignment scopes.

| Physical table | Foundation purpose |
| --- | --- |
| `organisations` | Tenant root and default timezone |
| `organisational_units` | Effective-dated state, region, or centre-group hierarchy nodes |
| `centres` | Organisation-owned service locations and jurisdiction/timezone metadata |
| `centre_organisational_unit_memberships` | Effective-dated centre-to-unit relationships |
| `principals` | Identity-provider-neutral internal user identity |
| `external_identity_mappings` | Provider-neutral external identity to internal principal mapping; Milestone 2A stores `provider_key = 'microsoft_entra:27026100-3522-48b5-8e95-80230afc4127'` and the raw lower-case Entra `oid` as `provider_subject`, with no credentials, roles, capabilities, or scopes |
| `organisation_memberships` | Effective-dated tenant membership that grants no content capability by itself |
| `capabilities` | Canonical foundation capability catalogue |
| `canonical_role_templates`, `canonical_role_template_capabilities` | Versioned nine-role foundation baseline and reviewed capability mappings |
| `role_definitions`, `role_capabilities` | Organisation-owned, versioned, data-driven role bundles linked to their source template where applicable |
| `role_assignments`, `assignment_scopes` | Effective-dated grants and independently effective-dated organisation, organisational-unit, or centre scopes, with an explicit grant source/actor and nonblank reason |
| `system_audit_events` | Generic append-only security/system events with tenant-consistent scope, actor, and known foundation target; separate from future Area Manager audits |

Application-owned identifiers are UUIDs. Composite foreign keys prevent an assignment or scope from linking records across organisations. Mutable foundation aggregates carry `lock_version`; the first approved mutation repositories must compare and increment it and record the actor/source in the audit ledger. The capability catalogue and versioned canonical role templates are migration data. Each organisation receives matching evolvable role definitions, but provisioning creates no principal, membership, assignment, employee, or access grant. Database tests compare every canonical role/capability mapping with the reviewed TypeScript contract. No business-module table, development employee seed, child record, compliance score, or production data is created.

## Global conventions

- Use opaque, non-sequential public identifiers; internal database identifiers must not reveal tenant volume.
- Every tenant-owned aggregate carries immutable `organisation_id`.
- Centre-owned aggregates also carry `centre_id`, validated as belonging to the same organisation.
- State/region membership and assignment scope are effective-dated with half-open intervals; historical events retain the applicable centre and hierarchy snapshot/reference.
- Centre ancestry is resolved centrally from one effective leaf placement through a recursive, tenant-constrained PostgreSQL query; simultaneous placements, inactive lineage, and cycles fail closed.
- Store canonical timestamps with timezone semantics and record centre-local business date where workflow depends on it.
- Material records include creation/update actor and version for optimistic concurrency.
- Activated/finalised/versioned content is immutable; correction uses supersession, amendment, or reopening.
- Monetary values use fixed precision, explicit currency, financial period, and source date—not floating point.
- External identifiers are namespaced by connection/source and never serve as the sole tenant boundary.
- Free text is classified, length-limited, sanitised for display, and excluded from logs by default.
- Soft deletion is not a universal retention policy. Each record follows an approved retention, legal-hold, anonymisation, or deletion rule.

## Organisation and identity module

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Organisation | Tenant root, status, default timezone/policy references |
| Organisational unit | Effective-dated state/region or future hierarchy node |
| Centre | Operational service location, jurisdiction, timezone, active status, source identifiers |
| Centre hierarchy membership | Effective-dated link from centre to organisational unit |
| Person | Minimal human profile independent of login identity |
| User account | Identity-provider subject, login status, last assurance metadata |
| Organisation membership | Links user/person to organisation without granting content access alone |
| Role definition | Versioned capability bundle |
| Role assignment | Role, scope type/id, grantor, reason, effective dates, status |
| Centre assignment | Direct or portfolio assignment, source, effective dates |
| Delegation | Capabilities/scopes delegated for a bounded period and approval |
| Access review | Campaign, reviewer, decisions, remediation, completion evidence |
| Break-glass grant | Exceptional access request/approval/use/review if later approved |

Identity-provider tokens, passwords, and raw credentials do not belong in application tables.

For Milestone 2A, `tid + oid` is the durable external identity pair. Tenant and
object GUIDs are validated and canonicalised before lookup; email, UPN,
`preferred_username`, and pairwise `sub` are not identity keys. The existing
unique `(provider_key, provider_subject)` constraint prevents one Entra tenant
object from mapping to multiple internal principals. Mapping status and internal
principal status are checked on every authenticated request; sign-in creates no
mapping or access record. Provider-neutral migration 009 preserves attributable
mapping-audit target integrity and does not embed an authentication-provider-specific schema.

## Source and control-governance module

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Source document | Issuer, jurisdiction, publication/access date, URI/object, hash, licence conditions |
| Source version | Effective dates, verification state, reviewer, supersession |
| Framework | NQF/NQS or another governed taxonomy |
| Framework version | Version root and source linkage |
| Framework node | Hierarchical Quality Area/standard/element/concept reference |
| Control definition | Stable internal control identity and owner |
| Control version | Immutable wording, source mappings, risk, schedule/evidence/verification policy |
| Control applicability rule | Versioned rule evaluated from trusted centre attributes |
| Control exception | Approved centre/time-bounded exception with reason and reviewer |
| Control release | Groups reviewed versions and activation communication/impact assessment |

Internal policy and external-source text remain distinguishable in origin metadata.

## Daily success and compliance-work module

**Milestone 3A physical decision:** Daily Success persists no aggregate or entity. It reads source-owned corrective actions/findings, quarterly reviews/acknowledgements, and People & Access invitations/events at request time. `centres.timezone` and `organisations.default_timezone` are the authoritative business-date fields. No daily plan/check-in, task, snapshot, copied status/due/owner, preference, snooze, completion, manual priority, cache, or materialized projection is implemented.

The following table remains possible later compliance-work architecture only; it does not describe Milestone 3A persistence and requires separate approval:

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Obligation instance | One control version applied to a centre occurrence/window |
| Task | Actionable work linked to a source aggregate, owner, due history, state |
| Task assignment | Current/history of assignees and delegation |
| Task update | Progress, blocker, comment, transition, author |
| Attestation | Versioned statement accepted by a user at a time |
| Daily plan/check-in | Deferred stateful planning concept; expressly not implemented by Milestone 3A |
| Certification type | Governed type and reminder policy |
| Certification record | Subject, issuer/source, verification, dates, restricted attachment link |
| Expiry reminder | Derived delivery state, never the authoritative expiry |

The implemented Daily Success view is a query/projection over source records and never duplicates their status as an independent truth. ADR-0015 governs this boundary.

## Evidence module

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Evidence item | Metadata root: organisation/centre, classification, purpose, owner, retention |
| Evidence object version | Bucket/key, checksum, media metadata, scan state, capture/upload time |
| Evidence link | Typed link to control, task, audit item, finding, action, QIP item, or certification |
| Evidence review | Reviewer, criteria version, decision, reason, time |
| Evidence access event | Sensitive view/download/export/restriction events where policy requires |
| Legal hold | Scope, authority, reason, dates, release |
| Export package | Requester, approved scope, manifest, expiry, delivery/access events |

Object keys are random and contain no personal names or centre-sensitive labels. An evidence link never grants access independently of the evidence classification and target resource.

## Findings and corrective-actions module

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Finding | Source, facts, provisional/confirmed tier, triage, centre, confidentiality |
| Finding relationship | Duplicate, recurrence, parent/child, or related finding linkage |
| Corrective action | Desired outcome, owner, due history, verification/effectiveness method |
| Action milestone/update | Progress, blockers, evidence, changes |
| Action verification | Reviewer, independence check, result, evidence, review date |
| Escalation | Rule version, trigger, recipient scope, acknowledgement, resolution |

Due-date changes and severity changes are histories, not overwrites.

## Internal audit module

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Audit template | Stable methodology identity and type |
| Audit template version | Approved immutable release, scoring policy, effective dates |
| Audit section/item version | Ordered content, outcome rules, mappings, weight/critical flags |
| Audit schedule | Centre, window, assigned auditor, cadence reference |
| Audit | Pinned template, state, participants, timestamps, score/coverage snapshot |
| Audit item response | Outcome, observation, evidence links, author, version |
| Audit moderation | Submitted/final decision and changes |
| Audit amendment | Controlled post-finalisation before/after history |
| Audit comparison | Reproducible mapping/version and calculated deltas |
| Recognition | Strength, evidence, audience, consent/classification |

Final results keep both calculated components and the methodology version; a mutable current formula is never applied invisibly to history.

### Approved Milestone 2B physical shape

The implementation normalises stable templates from immutable versions, ordered sections/items, versioned outcome rules and performance bands. An audit run pins one template version; responses reference that version's items; final section/overall results are snapshots. Stable item lineage supports repeat findings and comparison without wording matching. Template items have an optional, reference-only Quality Area mapping seam; the synthetic development template leaves it unset and no regulatory corpus or assertion is embedded.

Findings retain their originating response. Corrective actions retain owner, due/severity/evidence/verification configuration and an append-only transition history. Immediate configured findings/actions may exist before audit finalisation; uniqueness constraints make reconciliation retry-safe. A response correction can move the paired records to `WITHDRAWN` only with actor, time, and reason metadata; later qualifying outcomes reactivate the same IDs. `CRITICAL` or immediate outcome configuration is invalid unless independent verification is required. Performance bands use complete half-open ranges with the final `100` inclusive and carry the versioned internal-threshold classification used by oversight. Acknowledgements and positive observations are separate immutable records. Private evidence metadata and object versions link through target-specific, tenant-constrained join tables rather than an unchecked cross-tenant polymorphic identifier.

## Quality and QIP module

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Centre philosophy version | Approved centre philosophy and effective dates |
| Self-assessment | Centre, framework version/node, practice, reflection, review date |
| Strength | Positive practice/evidence with permitted audience |
| QIP working plan | Centre and current workflow state |
| QIP improvement | Outcome, rationale, priority, owner, measures, status |
| QIP milestone/update | Planned step, progress, reflection, evidence |
| QIP mapping | Framework/control/audit/coaching relationship with rationale |
| QIP snapshot | Immutable approved publication/export at a point in time |
| Participation note | Carefully minimised contribution context; no unnecessary child details |

## Coaching module

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Coaching relationship | Participants, scope, dates, confidentiality agreement |
| Coaching cycle | Purpose, cadence, goals, status |
| Coaching goal | Outcome and measures, links shared by agreement |
| Coaching session | Date, participant-authored/agreed summary, visibility |
| Coaching commitment | Owner, due/review date, completion |
| Coaching access grant | Participant and exceptional explicit access history |

Private personal notes should remain outside the organisational product unless a later privacy design establishes a safe, necessary use.

## Wellbeing module

This module uses a stricter access boundary even if it shares physical PostgreSQL infrastructure.

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Wellbeing campaign | Purpose, audience, lawful/privacy review, anonymity model, threshold |
| Question version | Approved wording, response type, use restriction |
| Participation token | Eligibility/one-response control designed to minimise identity linkage |
| Response | Campaign/question answers under the approved identity model |
| Aggregate release | Cohort definition, threshold check, suppression, calculated result |
| Support request | Explicit identified opt-in routed to named authorised recipients |
| Resource acknowledgement | Optional low-sensitivity delivery/acknowledgement data |

Identifiable responses and support requests must not feed Centre Health, audits, performance, coaching, or AI knowledge. Aggregate derivations use privacy thresholds and cannot be reverse queried to reveal a person.

## Budget-accountability module

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Finance connection/source | System of record, owner, mapping/version |
| Financial period | Organisation calendar, lock/reconciliation status |
| Budget version | Approved budget snapshot, source batch, effective/approval metadata |
| Budget line | Centre, approved reporting category, amount, currency, sensitivity |
| Actual batch/line | Immutable source import and external reference |
| Commitment snapshot | Optional source-supplied committed spend with freshness |
| Forecast version/line | User/system forecast with method and assumptions |
| Budget warning | Rule version, values, severity, state, owner |
| Budget commentary/action | Explanation, response, approval where needed |
| Reconciliation | Batch totals, exceptions, finance reviewer, status |

Centre Success never edits source ledger transactions. Corrections arrive as new source data or governed adjustments that preserve provenance.

## Centre Health module

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Score methodology version | Dimensions, weights, caps, exclusions, freshness/confidence rules |
| Centre Health snapshot | Centre, as-of time, methodology, score/band, confidence, publication state |
| Dimension result | Input window, result, coverage, freshness, cap/gate |
| Factor contribution | Human-readable contribution and source aggregate reference |
| Score annotation | Authorised context without modifying the calculation |
| Recognition signal | Positive source and display lifecycle |

Snapshots are append-only. Corrections publish a new snapshot or explicit recalculation version.

## Notifications and integrations module

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Notification preference | User/channel/category/quiet-hours choices within mandatory-policy bounds |
| Notification intent | Business event, recipient resolution, safe template/data |
| Delivery attempt | Provider reference, status, retry, redacted error |
| Integration connection | Type, scope, owner, status, secret reference—not secret value |
| Mapping version | External-to-internal identifiers and transformations |
| Sync run/batch | Watermark, counts, status, reconciliation, error summary |
| Quarantine item | Invalid/ambiguous input and authorised resolution |
| Webhook receipt | Provider event ID, signature result, replay/idempotency state |
| Outbox event | Transactionally recorded event awaiting publication |

### Implemented People & Access physical subset

Migrations 016–019 implement organisation-owned `access_invitations`, immutable `invitation_role_proposals` and `invitation_scope_proposals`, one-time `invitation_token_generations`, append-only `invitation_events`, `privileged_invitation_approvals`, `people_notification_outbox`, append-only delivery outcomes, durable pre-provider attempt reservations, expiring dispatch leases, and a transaction-local administrator-guard validation queue. The provider-attempt table is delivery infrastructure only: the database serializes contiguous attempt numbers 1–3 on each outbox/generation, preserves crash/ambiguous reservations as consumed slots, and rejects a fourth reservation. Pending proposal rows remain outside `organisation_memberships`, `role_assignments`, and `assignment_scopes` and confer no current authority. Activation alone writes the active external mapping, membership, independent assignments/scopes, and audit events in one serializable transaction after identity, package, scope, approval, and uniqueness checks.

Principal lifecycle states are `pending`, `active`, `suspended`, and terminal `revoked`; migration 016 fails closed if a legacy `inactive` row requires human classification. Invitation generations store only keyed digests, generation/expiry/consumption/invalidation facts, and never plaintext. Delivery-only token material is authenticated-encrypted in the transactional outbox, excluded from business/audit projections, and erased after terminal successful delivery while retry metadata remains. Privileged approvals bind a distinct approver to the exact canonical package digest/version. Row-level collectors, a transaction-local affected-organisation set, one deferred validation per affected organisation, and transaction advisory locks preserve at least one reachable active System Administrator under concurrent mapping, membership, principal, assignment, scope, role-template, or capability changes.

The implemented entities, invariants, activation transaction, migration preflight, and test matrix are detailed in `PEOPLE_AND_ACCESS.md`. Production email-provider configuration and production first-administrator operations are deliberately absent.

## AI and knowledge module

| Aggregate/entity | Purpose and key relationships |
| --- | --- |
| Knowledge source/version | Approved document provenance, classification, effective state |
| Knowledge chunk/index record | Derived retrieval unit with source version and access attributes |
| AI conversation/message | User, purpose, scoped context, retention class |
| AI run | Provider/model/config version, prompt template, tools, outcome, latency |
| AI citation | Exact source/version/location presented with output |
| AI feedback/correction | User assessment and governed correction workflow |
| AI action proposal | Draft action, required approver, accepted/rejected decision |

Prompts and outputs must not store secrets or unneeded raw sensitive content. Index deletion/supersession follows source lifecycle.

## Audit and observability records

### Business audit event

Append-only record of material user/system changes with actor, effective user, organisation, action, resource type/id, centre/scope, before/after summary or patch, reason, request/correlation ID, time, and source. Sensitive payloads are referenced or redacted.

### Security/access event

Authentication, denial, privileged assignment, break-glass, export, sensitive evidence access, wellbeing access, admin operation, and suspicious activity event under controlled retention.

### Operational telemetry

Encore traces, structured logs, and metrics support reliability. They are not the business audit ledger and must avoid sensitive business payloads.

## Referential and tenant invariants

- A centre, user membership, assignment, and business record must resolve to exactly one organisation.
- Every relationship across tenant-owned records checks matching `organisation_id`.
- Parent/child resource scope is derived server-side and cannot be reparented through arbitrary updates.
- Historical authors remain attributable after account deactivation.
- A versioned reference used by a finalised record cannot be deleted while retained records depend on it.
- `not_applicable`, waiver, cancellation, reopening, extension, and suppression always require typed reason and authority.
- Derived projections can be rebuilt from authoritative records and carry freshness.

## Reporting strategy

Start with transactional PostgreSQL and carefully designed read models/materialised projections where needed. Avoid a separate warehouse in MVP. Portfolio queries must enforce scope before aggregation and again before drill-through. Exports use asynchronous generation, immutable manifests, short expiry, and audited access.

If analytics needs later justify a warehouse, feed it through minimised, classified, versioned events with an independently reviewed authorisation model.

## Decisions required before future domain schemas or production use

- Retention and deletion schedule by record/classification/jurisdiction.
- Organisation hierarchy and source identifiers.
- Identity and finance systems of record.
- Exact control, audit, QIP, wellbeing, and budget taxonomies.
- PostgreSQL isolation controls and backup/restore requirements in Encore Cloud.
- Search/index technology and permitted content.
- Data residency, AI provider, and export constraints.
- People & Access invitation/email retention, safe identity-correlation evidence, Production email enablement/provider, joiner/mover/leaver operating source, and production first-administrator mechanism. ADR-0016 resolves only staging invitation sending and adds no schema.
