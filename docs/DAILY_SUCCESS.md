# Daily Success — Milestone 3A

## Status and boundary

**Milestone 3A is ACCEPTED / COMPLETE.** The Product Owner accepted the implementation on 12 August 2026 after, in sequence, implementation, a first independent review returning PASS WITH CHANGES, acceptance remediation, a targeted independent re-review returning PASS, a green local regression gate, green hosted Foundation CI and Encore Build, and merge to `main` through pull request #6. This document records the approved Daily Success architecture, remediation evidence, and implementation boundary. Every later milestone remains locked.

Acceptance is an implementation acceptance only. Centre Success is not production-ready, and pilot/production readiness remains separately gated.

Daily Success is a live, read-only orchestration and priority projection over existing Centre Success source workflows. Corrective actions, quarterly reviews, and People & Access remain authoritative. Daily Success may read, prioritise, safely summarise, and deep-link; it owns no workflow mutation or duplicate state.

Milestone 3A creates no Daily Success table, daily task, snapshot, copied status/due date/owner, generic task, completion, acknowledgement, dismissal, snooze, preference, notification, manual priority, or materialised projection. A source workflow change appears on the next request.

## Approved perspectives

| Perspective | Qualification | Content boundary |
| --- | --- | --- |
| Centre | A current capability-and-scope grant for Centre Director source work such as remediation or review acknowledgement | Only currently authorised centre corrective actions, finalised reviews needing acknowledgement, waiting state, and derived completed-today context |
| Portfolio | A current capability-and-scope grant to conduct assigned reviews or verify corrective actions | Currently assigned centres only; top attention centres, verification, active assigned audits, and safe counts |
| Compliance | Current `compliance.oversight.read` at the active organisation | Up to five organisation-scoped critical/high exceptions and safe authorised aggregates only |
| Administration | Current invitation read plus invitation manage or privileged approval at the active organisation | Eligible independent privileged approvals and administrator-review identity cases only |

System Administrator technical privilege alone never confers audit, finding, corrective-action, evidence, Centre Director, Area Manager, or compliance projection access. Assistant Director, Operations Leadership, Educator, Finance, and Executive perspectives are deferred; the implementation does not infer them from a role name.

A principal may have several independently authorised perspectives. The backend returns all available choices and reauthorises the requested perspective and optional centre on every request. The browser may retain the selected view only in session storage. Selection is presentation context, never authority. A provisioned principal with no supported perspective receives a safe authenticated landing state with only workspaces independently authorised by current capabilities.

## Source adapters and authority

The modular monolith composes three ordinary internal TypeScript adapters:

- `CorrectiveActionDailySource`
- `QuarterlyReviewDailySource`
- `PeopleAccessDailySource`

There is no plugin framework, service per adapter, event bus, or materialised read model. Source rows are queried only after current authorization filtering. Source-owned routes and APIs independently resolve and authorize the record again when a CTA is opened.

Corrective-action projection includes active critical/immediate, overdue, due-today, seven-day due-soon, returned/rejected, remediation-required, and verification states. Closed and withdrawn actions are not active. Completed today is derived from authoritative close events in the centre timezone and includes only records still currently readable. The home response never includes evidence filenames or detailed evidence/narrative payloads.

Quarterly-review projection includes active assigned audit runs and finalised reviews requiring acknowledgement. It never treats `review_period_start` as a due date and makes no overdue/upcoming scheduling claim. The conditional `/centre/reviews/:auditId` route reads the existing authorised review and invokes only the existing acknowledgement workflow.

People & Access projection includes only eligible, unexpired independent privileged approvals and administrator-review cases. It preserves inviter/approver separation and does not expose a generic invitation list.

## Authorization and request consistency

`GET /daily-success` is protected by Encore authentication. One request captures one decision timestamp and runs under one read-only repeatable-read PostgreSQL snapshot. The implementation:

1. obtains only the trusted internal principal UUID from Encore AuthData;
2. resolves exactly one active organisation and loads the principal authorization context once;
3. loads active centres and effective hierarchy facts with one set-wise recursive query;
4. evaluates the existing pure capability-plus-same-assignment-scope policy separately for every required source capability;
5. builds separate authorised centre sets;
6. restricts each source SQL query to those IDs; and
7. aggregates only the rows that survived current authorization.

There is no per-centre database authorizer call and no cross-request authorization cache. Effective portfolio removal is reflected on the next request. Counts, centre cards, completed-today context, and on-track context are calculated only after filtering; unauthorized rows cannot affect them.

An adapter is isolated with a transaction savepoint. Only a classified source-availability failure is recoverable: that adapter is marked unavailable, the response becomes partial, and safe item data from other adapters may remain. Programmer, invariant, and unexpected failures fail the request safely rather than being disguised as partial availability. A partial response says “Some priorities could not be checked.” Aggregate counts, per-centre counts, and positive/on-track context that depend on incomplete coverage are omitted rather than fabricated as zero.

Hierarchy resolution is isolated per centre. A portfolio may retain valid authorised centres while reporting partial authorisation health for an ambiguous, cyclic, or inactive centre hierarchy; the invalid centre contributes no source query, item, count, or identifier to the response. A Centre Director requesting their own invalid centre receives a safe `centre_context_unavailable` denial rather than a partial centre view.

## Business dates and due policy

`centres.timezone` is the authoritative IANA timezone for centre work. `organisations.default_timezone` is authoritative for organisation-only work. Both existed before Milestone 3A. Runtime validation rejects missing, abbreviated, non-IANA, or unsupported values; there is no browser/client/inferred fallback.

Due buckets use the centre-local calendar and the one request timestamp:

- `OVERDUE`: due instant is earlier than the request timestamp;
- `TODAY`: due later on the same centre-local date;
- `TOMORROW`: next centre-local calendar date;
- `DUE_SOON`: two through seven centre-local calendar days; and
- `LATER`: eight or more days.

The policy is tested across NSW daylight saving, Queensland/NSW differences, UTC-midnight boundaries, leap day, month end, and year end.

## Priority and payload policy

Human sections are **DO FIRST**, **TODAY**, **NEXT**, **WAITING**, and **ON TRACK**. Internal attention bands are `URGENT`, `TODAY`, `UPCOMING`, `WAITING`, and `AWARENESS`. Every item carries a structured reason and one responsibility value:

- `YOU_NEED_TO_ACT`
- `YOUR_CENTRE_NEEDS_TO_ACT`
- `WAITING_ON_SOMEONE_ELSE`
- `FOR_YOUR_AWARENESS`

Ordering is deterministic. Critical/immediate risk visibility is preserved before ordinary responsibility ordering. Within equivalent risk and attention classes, current-user action precedes centre responsibility, waiting, and awareness; due timing and stable source identifiers break remaining ties. Critical items are never truncated from DO FIRST. An Area Manager centre card inherits the worst currently authorised active risk even if a Centre Director owns remediation. No score can suppress critical risk.

Centre responses restrain ordinary direct urgent work to three items and upcoming/waiting sections to five while preserving every critical item. Portfolio responses ordinarily return five attention centres and five verification items; incomplete authorisation coverage may return bounded incomplete centre cards so omitted centres are not falsely described as clear. The Area Manager **VERIFY TODAY** queue is a distinct risk-ordered surface. Verification eligibility is explicit workflow metadata and is independent of the display reason used to explain why a critical item is prominent. Compliance and administration return no more than five exceptions. Source workspace links and authorised aggregates replace bulk record dumps.

## API and CTA contract

The one API is `GET /daily-success`; there is no Daily Success mutation endpoint. It returns:

- `asOf` and authoritative business-date context;
- available and active authorised perspectives;
- human sections and attention items;
- responsibility, structured `whyShown`, and centre-local due details;
- server-generated controlled relative Centre Success CTAs;
- portfolio attention summaries and safe aggregate counts;
- derived completed-today/positive context; and
- per-adapter health and a safe partial warning.

The response sends `Cache-Control: private, no-store`. No CTA is read from free text or accepted from a client. Every destination source API repeats object resolution and current authorization, so Daily Success visibility is not mutation authority.

## Frontend and language

`/` is the authenticated Daily Success home. It has distinct centre, portfolio, compliance, and administration presentations; loading, empty, partial, denied, unavailable, selection, and unsupported states; semantic headings/lists; visible focus; non-colour labels; 44-pixel minimum controls; a mobile-first centre layout; and a two-column portfolio layout at tablet width. Cards use one dominant CTA and remain structurally usable under zoom.

Product language is direct and non-punitive: “Needs attention”, “Action required”, “Due today”, “Waiting for verification”, and “On track”. Genuine critical risk is labelled **CRITICAL**. Internal audit results retain the approved BSA internal/not-ACECQA framing.

## Performance and operational evidence

The database query count is constant for representative 1-, 5-, and 20-centre portfolios populated with source-owned quarterly-review and corrective-action rows; authorization does not add one query per centre. The controlled remediation run recorded `13 / 13 / 13` database operations for 1 / 5 / 20 centres, down from `14 / 14 / 14` once the principal existence and active-status check was folded into the organisation-resolution query instead of being read separately ahead of it. A separate 25-sample 20-centre run with 40 representative source rows recorded cold `14.5 ms`, p50 `12.5 ms`, and p95 `17.0 ms`, comfortably inside the 500 ms objective. These local timings are evidence rather than a shared-CI wall-clock gate. Source adapter duration is measured internally for diagnostics but no sensitive narrative, employee score, or individual performance ranking is recorded.

The representative corrective-action `EXPLAIN (ANALYZE, BUFFERS)` used the existing `corrective_actions_owner_status_idx` and completed in `0.044 ms` in the controlled remediation fixture. No index migration was added: the existing source predicates and indexes support the initial pilot, and a new index requires representative evidence first.

The full local remediation gate passed on Node 24.16.0 and Encore 1.57.13: backend typecheck, 141 unit tests, 100 database-backed integration tests, 90 frontend tests, frontend lint/typecheck/production build, migrations 001–018 from a fresh namespace with `dirty = false`, deterministic generated-client regeneration (SHA-256 `46f9faf7ff00c82b0b6c79208a4275f103f85558ae1636ea660b30e5513db5cd`), authentication scope guard, `git diff --check`, both dependency audits with zero vulnerabilities, and a Linux/amd64 Encore Docker build using external infrastructure configuration. Health was operational against the isolated clean namespace; it and the temporary image were removed after proof. No Daily Success table or migration was added. These are implementation/remediation facts, not independent acceptance.

## Thirty-item review baseline

Independent review should verify:

1. Daily Success is live/read-only and source-owned.
2. No Daily Success persistence or mutation exists.
3. Only four approved perspectives are implemented.
4. System Administrator receives no business-content projection.
5. Unsupported principals get a safe landing.
6. Multiple perspectives are independently reauthorised.
7. One trusted principal/context/decision timestamp is used.
8. Centre facts and hierarchy are loaded set-wise.
9. Capability and matching scope come from the same assignment.
10. Source queries are restricted before aggregation.
11. Cross-organisation and cross-centre rows affect no counts.
12. Portfolio removal applies on the next request.
13. Query count is bounded for 1/5/20 centres.
14. Controlled 20-centre p95 evidence is recorded.
15. Centre and organisation timezone sources are authoritative.
16. Invalid timezone fails safely.
17. Due buckets use centre-local calendar semantics.
18. Audit dates are not invented.
19. Critical/immediate risk is never hidden by responsibility order.
20. Area centre band comes from worst authorised risk.
21. Ordering and tie-breaks are deterministic.
22. Closed/withdrawn source records are not active.
23. Completed today is event-derived and currently authorised.
24. Partial failure cannot produce false on-track state.
25. People approvals preserve independence and are not a list dump.
26. CTAs are controlled relative routes and deep links reauthorise.
27. Response caching is private/no-store.
28. Frontend states, mobile layout, keyboard/focus and non-colour labels pass.
29. Milestones 1, 2A, 2B and 2C regressions pass.
30. No later/deferred module or notification/manual-priority work is present.

This baseline passed, the targeted independent re-review returned **PASS**, and the Product Owner accepted Milestone 3A on 12 August 2026. Acceptance is an implementation acceptance only and does not make Centre Success production-ready.
