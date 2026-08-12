# ADR-0015: Daily Success as a live read-only priority projection

- **Status:** Accepted architecture; implementation acceptance remediation in progress
- **Date:** 2026-08-12

## Context

Centre Success needs an operational home that tells an accountable user what needs attention without creating a second workflow truth. Corrective actions, quarterly reviews, and People & Access already own their states, dates, actors, evidence, and authorization. Copying those facts into daily tasks or snapshots would create reconciliation, stale-authority, and phantom-risk failure modes.

## Decision

Daily Success is a request-time, read-only orchestration inside the existing Encore modular monolith. `CorrectiveActionDailySource`, `QuarterlyReviewDailySource`, and `PeopleAccessDailySource` read existing source tables through a single request timestamp and repeatable-read snapshot. The service loads authorization context once, resolves centre hierarchy set-wise, evaluates the existing pure capability/same-assignment-scope policy, restricts source queries to separately authorised centre sets, and aggregates only after filtering.

One protected `GET /daily-success` returns available authorised perspectives, priority items, structured explanations/responsibility, centre-local due information, controlled relative CTAs, positive context, and adapter health with `private, no-store`. `/` becomes the operational home. A small `/centre/reviews/:auditId` route may read and acknowledge an existing finalised review; it creates no new review or Daily Success state.

Critical/immediate risk is preserved before ordinary responsibility ordering. Centre-local dates use `centres.timezone`; organisation-only work uses `organisations.default_timezone`; invalid IANA values fail safely. Review due dates are never inferred from review-period data.

No Daily Success table, copied workflow fact, generic task, completion, acknowledgement, dismissal, snooze, preference, notification, manual priority, materialized projection, plugin system, service split, or cross-request authorization cache is introduced.

## Consequences

- Source updates and access revocation appear on the next request with no reconciliation job.
- A classified source outage can yield an honest partial response without erasing safe item data, fabricating dependent counts, or claiming on track; unexpected/invariant failures fail safely.
- Invalid hierarchy facts are isolated per centre for portfolio views and never contribute data, while an invalid Centre Director centre fails closed.
- Independent-verification eligibility is workflow metadata, separate from the human explanation used to display critical risk.
- Query count is bounded as portfolio size grows because authorization facts are loaded set-wise.
- The browser may remember a perspective only for the session; the backend reauthorizes every request.
- Source deep links remain independent authorization boundaries.
- Larger-scale read optimization, notifications, stateful daily planning/check-in, manual priorities, and later perspectives require separate evidence and approval.

## Alternatives rejected

- Persistent `daily_tasks` or `daily_success_items`: duplicates authority and lifecycle state.
- Event/materialized Daily Success projection: premature operational and revocation complexity without measured need.
- One database authorizer call per centre: creates N+1 behavior and fails the approved 20-centre boundary.
- Role-name branching: bypasses capability/scope policy and risks System Administrator business-content leakage.
- Browser-derived timezone or due dates: inconsistent and untrusted.
