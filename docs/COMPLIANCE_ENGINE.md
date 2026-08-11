# Compliance Engine

## Purpose

The Compliance Engine converts **approved, versioned controls** into accountable work, evidence expectations, findings, and follow-through. It is a workflow and assurance engine—not a machine that determines whether Bright Steps has complied with law.

Controls may originate from verified external sources, Bright Steps policy, insurer or contract requirements, or local operating practice. Origin and authority are always visible.

## Core concepts

### Source

An authoritative or internal document with issuer, jurisdiction, version, publication/access dates, effective dates, hash/reference, licence/storage conditions, and verification status.

### Control definition and version

An approved statement of expected outcome or activity with:

- owner and control family;
- source references and interpretation rationale;
- applicable centre characteristics and jurisdiction;
- risk tier and escalation policy;
- recurrence or event trigger;
- due-window calculation and centre-local time zone;
- acceptable evidence types and freshness;
- attestation and verification requirements;
- separation-of-duties rule;
- failure-to-finding mapping; and
- effective dates, approval, and supersession.

Control versions are immutable after activation. Corrections create a new version.

### Obligation instance

The application of one control version to one centre and occurrence/window. It retains the version, why it applied, due dates, ownership, and outcome even if configuration later changes.

### Task

Actionable work generated from an obligation, finding, audit, QIP item, coaching commitment, certification, budget warning, or manual authorised request. Tasks do not replace their source records.

### Evidence and attestation

Evidence is an object or reference supporting an assertion. Attestation is a signed user statement under a defined wording/version. The engine records acceptance criteria and review; it does not treat file presence as proof of compliance.

### Finding and corrective action

A finding is a fact pattern requiring triage. A corrective action is an owned change intended to address an accepted finding. One finding may have multiple actions and effectiveness checks.

## Control lifecycle

`draft -> under_review -> approved -> scheduled -> active -> superseded/retired`

- Drafts cannot generate production work.
- Approval records author, reviewer, evidence, decision, and effective date.
- Activation may require impact analysis for open instances.
- A material emergency change uses the same audit trail and receives retrospective review under approved policy; it is not a silent shortcut.
- Retiring a control stops future instances but preserves historical work.

## Applicability evaluation

The evaluator receives only trusted server-side attributes: organisation, centre, jurisdiction, service characteristics, effective time, and approved exceptions. It produces:

- `applicable` with an explanation and control version;
- `not_applicable` with rule and supporting attributes; or
- `review_required` when data or interpretation is insufficient.

Users cannot mark a legal/control requirement not applicable merely through a task completion response. Approved exceptions are effective-dated, reasoned, reviewed, and audited.

## Scheduling

Supported trigger categories are architectural options, activated only through approved control configuration:

- recurring calendar schedule;
- relative to a known event or expiry;
- source-system event;
- risk or threshold event;
- one-off campaign; and
- authorised manual trigger.

Encore cron/scheduled jobs should materialise upcoming instances in a bounded, idempotent horizon and perform overdue/expiry sweeps. Stable occurrence keys prevent duplicates. Schedule changes never rewrite completed instances.

## Evidence controls

- Store binary objects in private Encore Object Storage; store metadata and relationships in PostgreSQL.
- Scan uploads and validate declared type, size, extension, signature, checksum, and malware status before availability.
- Use short-lived, authorised access rather than permanent public links.
- Classify evidence and restrict sensitive subjects, child information, and staff records.
- Reuse through links only when purpose, scope, freshness, and permissions remain valid.
- Record capture time separately from upload time.
- Support supersession, retention, legal hold, approved deletion, and export manifests.
- Audit sensitive reads and all downloads/exports according to risk.

## Findings, severity, and escalation

Bright Steps must approve names and rules for severity. The architecture supports a versioned matrix considering:

- potential impact, including safety and rights;
- immediacy and exposure;
- breadth and duration;
- recurrence;
- evidence strength and uncertainty;
- required external notification pathway, if verified and configured; and
- mitigating controls.

Automation can propose a provisional tier from explicit inputs. An authorised person confirms it. Critical safety concerns follow an approved urgent pathway and cannot be hidden by an aggregate score.

Escalation rules define recipient role/scope, timing, acknowledgement, fallback, and quiet-hours exception. They avoid exposing the underlying sensitive content in notifications.

## Corrective-action quality

An accepted action states:

- finding and root-cause context where appropriate;
- desired outcome, owner, due date, milestones, and dependencies;
- resources/support required;
- completion evidence;
- verifier and independence rule;
- effectiveness test and review date; and
- closure or recurrence rationale.

Overdue status does not alter the due date. Extensions append an approved history. Closing the task does not automatically close the finding unless configured review criteria pass.

## Certifications and expiries

Certification records may represent externally sourced facts such as a credential or expiry. They require subject, type, issuer where appropriate, issue/expiry date, verification source/status, attachment classification, and source-system identifier. Reminder windows are configuration, not invented regulation. The system must not imply a person is legally eligible or ineligible without an approved rule and current source data.

## Automation and events

Candidate domain events include `control_activated`, `obligation_opened`, `task_overdue`, `evidence_submitted`, `finding_accepted`, `action_verified`, and `certification_expiring`.

Use Pub/Sub for decoupled notifications, score refresh, search/index refresh, and integrations where asynchronous behaviour is acceptable. Delivery is treated as at least once; subscribers are idempotent. The authoritative state change and its audit record commit together. Where publishing consistency matters, use a transactional outbox pattern before dispatch.

## Command Centre projections

Compliance Manager views are derived from authoritative records and include:

- urgent/unacknowledged findings;
- overdue actions by tier and age;
- repeated findings/control failures;
- evidence gaps and stale evidence;
- upcoming source/control changes;
- centres without current assigned ownership;
- sync failures affecting assurance; and
- positive completion and sustained-improvement signals.

Projections carry `as_of`, source freshness, filters, and permission scope. They do not become a competing source of truth.

## Quality controls and tests

- Control versions cannot activate without required source/review fields.
- Applicability tests cover boundary dates, jurisdiction, missing attributes, and supersession.
- Schedule tests cover time zones, daylight saving, retries, duplicate prevention, and changeover.
- Permission tests prove cross-organisation and cross-centre denial.
- Evidence tests cover restricted access, malicious upload, expired link, and legal hold.
- State-machine tests reject invalid transitions and unauthorised closures.
- Event tests prove idempotency, replay, failure isolation, and audit correlation.

## Open decisions

- Bright Steps control taxonomy, risk matrix, and escalation policy.
- Authorised compliance owners and approval workflow.
- Evidence classes, retention periods, and legal-hold authority.
- Certifications and source systems in MVP.
- Urgent safety operating procedure and external notification boundaries.
- Whether any control supports self-verification and under what risk threshold.
