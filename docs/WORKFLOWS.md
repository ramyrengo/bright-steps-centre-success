# Workflows

## Workflow conventions

Every workflow carries `organisation_id` and the applicable `centre_id` or approved broader scope. The backend checks capability and scope on every transition. Material transitions record actor, time, reason, source state, destination state, correlation identifier, and changed fields.

Automation may create drafts, reminders, calculations, and escalations. It does not silently attest, approve evidence, finalise an audit, close a high-risk action, publish a QIP, make a financial decision, or make a wellbeing/employment decision.

## 1. Centre Director daily success

1. At the centre’s configured local start time, the system assembles a daily view from active tasks, due and overdue actions, evidence requests, expiries, audit follow-ups, QIP milestones, budget warnings, acknowledgements, and recognitions.
2. A deterministic priority policy groups items as urgent, due soon, planned, or informational and explains each placement.
3. The Centre Director acknowledges the day, selects focus items, and may assign permitted contributions.
4. During the day, users record progress, link evidence, request help, or explain a blocker.
5. High-priority blockers route to the defined Area or Compliance Manager; routine items remain local.
6. The end-of-day check-in records completion, carry-over reason, new risk, and positive progress. It does not require artificial completion of work that remains legitimately open.

Daily state: `not_started -> acknowledged -> active -> completed`; `skipped` requires an allowed reason. Underlying actions retain their own lifecycles.

## 2. Recurring compliance task and evidence

1. An approved control version and centre applicability rule generate a scheduled obligation instance.
2. The instance creates a task with an owner, due window, required evidence type, escalation policy, and source link.
3. The owner completes the activity and submits evidence or an attestation permitted by the control.
4. Automated checks validate file type, integrity, metadata, required fields, duplication, and freshness; these checks do not decide legal compliance.
5. Where verification is required, an authorised reviewer accepts, requests more information, or rejects the submission with a reason.
6. Accepted completion closes the instance; rejection or overdue state may create a finding under approved policy.

Task state: `scheduled -> open -> in_progress -> submitted -> verified -> closed`, with `blocked`, `returned`, `overdue`, `cancelled`, and `superseded` as controlled variants.

## 3. Finding and corrective action

1. A finding originates from an internal audit item, evidence review, missed control, user observation, approved integration, or authorised manual entry.
2. The creator records facts, source, affected centre, date, evidence, and provisional severity; legal conclusions are not generated.
3. An authorised owner triages validity, severity, immediacy, confidentiality, root-cause need, and escalation.
4. One or more corrective actions receive an owner, due date, expected outcome, verification method, and dependency.
5. The owner posts progress and completion evidence. A due-date change keeps the original date and an approved reason.
6. Where independence is required, a verifier confirms effectiveness or returns the action.
7. Closure records the rationale; recurrence can reopen or create a linked finding rather than rewrite the closed record.

Finding state: `draft -> triaged -> accepted -> actioning -> resolved -> closed`; also `duplicate`, `not_substantiated`, and `reopened` with reasons.

Action state: `draft -> accepted -> in_progress -> submitted -> verified -> closed`; also `blocked`, `overdue`, `returned`, `cancelled`, and `reopened`.

## 4. Evidence lifecycle

1. A user uploads or references evidence under an authorised centre and purpose.
2. The system scans and validates the object before it becomes available.
3. Metadata records owner, classification, capture/source time, centre, permitted purpose, checksum, retention class, and any subject restrictions.
4. Evidence is linked to controls, tasks, audits, findings, actions, or QIP items without duplicating the file.
5. Each read, download, export, relink, restriction change, and deletion request is authorised; sensitive access is audited.
6. Supersession creates a new object/version. Legal hold or required retention prevents deletion until released.

Evidence acceptance means it met the configured review rule; it is not a universal legal attestation.

## 5. Living QIP and self-assessment

1. A centre records strengths and reflections against the applicable NQS framework version and approved internal prompts.
2. Users identify a proposed improvement with outcome, rationale, actions, measures, owner, timeframe, and participation notes.
3. An authorised centre or quality leader approves inclusion in the working QIP.
4. Progress updates connect actions, evidence, internal audits, coaching, and recognition.
5. Periodic review asks whether the improvement remains relevant, is effective, needs revision, or is ready for completion.
6. Publication creates a time-stamped QIP snapshot suitable for approved sharing while the working plan continues evolving.

The workflow supports annual and directed review without assuming one national submission process; jurisdiction-specific requirements are governed in the source library.

## 6. Quarterly Area Manager audit

1. The organisation schedules an audit for the centre and pins an approved template version.
2. The Centre Director receives preparation prompts and can link existing evidence; the system avoids requiring duplicate uploads.
3. The Area Manager reviews prior results, open actions, QIP context, and evidence within assignment scope.
4. During the audit, each item receives an outcome, observations, evidence, and required comments based on template rules.
5. The engine calculates a provisional internal score, critical-item flags, missing-information state, and comparison eligibility.
6. Failed items create draft findings/actions according to the approved mapping; the Area Manager confirms owners, severity, and due dates.
7. Moderation occurs where policy requires. Finalisation freezes item responses and score inputs.
8. The Centre Director acknowledges the result and may add a response without changing the finalised audit.
9. Follow-through flows through the corrective-action lifecycle and the next-quarter comparison.

### Approved Milestone 2B state detail

- Audit runs follow `DRAFT -> IN_PROGRESS -> READY_FOR_REVIEW -> FINALISED`. A finalised run, its pinned template/methodology, responses, score inputs, and score snapshots are immutable.
- A configured `IMMEDIATE_ACTION_REQUIRED` response creates or escalates its finding and action immediately. Ordinary partial/non-compliant results are reconciled at finalisation; retry is idempotent.
- Correcting an in-progress response so the active finding/action is no longer required needs an explicit reason and moves both records to historical `WITHDRAWN` state; later qualifying responses reactivate the same IDs.
- Remediation submission persists and records the single truthful `IN_PROGRESS -> VERIFICATION_REQUIRED` transition. Successful verification persists and records `VERIFICATION_REQUIRED -> CLOSED`; no ceremonial intermediate state is emitted.
- Corrective actions follow `OPEN -> IN_PROGRESS -> VERIFICATION_REQUIRED -> CLOSED`, with `MORE_INFORMATION_REQUIRED` or `REJECTED` returning the work to `IN_PROGRESS` through explicit events. `WITHDRAWN` is the non-active historical state for a pre-finalisation response correction.
- Critical/immediate remediation must be verified by another currently authorised principal, never its submitter.

## 7. Area Manager spot check

1. An authorised trigger or documented risk rationale selects a narrow approved template.
2. The Area Manager records the purpose and whether the check is announced.
3. Only in-scope items and necessary evidence are captured.
4. Findings follow the same triage and action workflow as quarterly audits.
5. The result is labelled as a spot check and is never made statistically comparable to a full quarterly audit unless methodology explicitly supports it.

## 8. Coaching and mentoring cycle

1. The Centre Director and Area Manager open a cycle with purpose, privacy level, cadence, and shared goals.
2. Audit or Centre Health signals may suggest a conversation but do not expose restricted source data or automatically create a performance process.
3. Sessions record an agreed summary, strengths, commitments, support needed, and next check-in; private notes are not a hidden organisational record.
4. Actions link to operational records only with participant awareness and appropriate access.
5. At review, participants assess progress and continue, complete, or refer an operational issue through the proper workflow.

## 9. Wellbeing pulse and support request

1. An approved campaign states purpose, audience, anonymity/confidentiality model, minimum reporting threshold, use restrictions, and support resources before collection.
2. Participation is voluntary unless Bright Steps obtains and documents a lawful, appropriate basis for another model.
3. Responses are stored separately from operational performance records.
4. Aggregates publish only when threshold and anti-reidentification rules pass; suppressed slices remain unavailable.
5. An explicit support request is routed only to the named authorised support pathway and is not inferred from an anonymous response.
6. Urgent or emergency language presents approved external and internal contact pathways; the platform is not an emergency service.

## 10. Budget accountability

1. Finance imports or synchronises an approved budget and actuals from the nominated system of record.
2. Validation checks centre mapping, period, currency, totals, duplicate batch, source freshness, and reconciliation state.
3. Allowed users see approved, actual, committed if supplied, remaining, forecast, and variance for permitted line groupings.
4. Versioned rules create warning drafts. Finance confirms policy and thresholds; Centre Directors acknowledge, explain, forecast, or request support.
5. Adjustments come from the finance source or a governed workflow and never overwrite import history.
6. Executive views aggregate permitted data with freshness and reconciliation caveats.

## 11. Compliance Manager command workflow

1. The command centre groups material exceptions by severity, overdue duration, recurrence, source version, centre, and owner.
2. The manager can drill into authorised evidence and action history, assign support, request re-triage, or escalate.
3. Bulk operations are restricted to safe transitions, preview their scope, require confirmation, and write per-record audit events.
4. Resolution is reflected through source workflows; command views do not maintain a competing status.

## 12. Control or framework change

1. A source owner registers a newly published or amended authoritative document.
2. A compliance specialist assesses jurisdiction, effective dates, impacted controls, and required expert advice.
3. Proposed control versions are drafted and tested against sample centres and schedules.
4. An independent authorised reviewer approves, rejects, or requests changes.
5. Activation is effective-dated. The system identifies impacted future and open instances and applies an explicit migration policy.
6. Historical tasks, audits, evidence, and scores retain the version originally applied.

## 13. People & Access invitation and lifecycle — architecture only

1. A current, appropriately scoped System Administrator creates a 72-hour invitation with intended delivery/correlation email, an approved role/scope package, explicit centres where required, and a reason. Pending proposals grant nothing.
2. The invitation and transactional outbox intent commit together. An Encore Pub/Sub-backed worker later sends through an approved transactional provider; Microsoft Graph is not used.
3. The recipient presents the current one-time token and authenticates through the exact BSA Entra tenant. Centre Success validates the API token and correlation evidence; permanent identity is `tid + oid`, never email or UPN.
4. A standard Educator, Assistant Director, Centre Director, or explicit-portfolio Area Manager package may activate atomically when the authorised System Administrator's unchanged invitation and all current checks pass.
5. System Administrator, Executive, Finance, Compliance Manager, organisation-wide Operations Leadership, and future policy-designated privileged packages wait for a distinct current System Administrator to approve the exact package. The inviter/requester cannot self-approve.
6. Activation consumes the token generation and atomically creates the mapping, membership, independent assignments/scopes, audit events, and active principal state. Capabilities and scopes from separate assignments never recombine.
7. Resend rotates and invalidates the prior generation; cancel and expiry prevent activation. Identity mismatch, ambiguous guest/member evidence, mapping conflict, or package drift enters administrator review without automatically changing email or identity.
8. Movers receive effective-dated replacements without temporary widening. Leavers are suspended or revoked in Centre Success independently of Microsoft account actions. `revoked` is terminal; reactivation from `suspended` is an authorised audited command.
9. No operation may remove the final reachable active System Administrator; operations target at least two.

Approved conceptual routes and the full invitation state machine, threat model, APIs, tests, and remaining decisions are in `PEOPLE_AND_ACCESS.md`. This section does not authorise implementation before the Milestone 2C gate.

## Failure and recovery rules

- Background delivery is at least once; handlers must be idempotent and use stable event identifiers.
- Partial integration imports are quarantined, not silently accepted.
- A failed notification never rolls back the business transaction; it is retried and surfaced operationally.
- Scheduled jobs use centre-local business dates but store canonical timestamps.
- Concurrent edits use version checks; finalised records require controlled amendment or reopening.
- Users see stale-data and sync-failure indicators where these affect decisions.
