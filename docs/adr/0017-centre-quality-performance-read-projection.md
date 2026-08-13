# ADR-0017: Centre Quality & Performance as a narrow read-side projection

## Status

Accepted as a **narrow product-slice authorisation**, granted by the Product
Owner on 12 August 2026 after preflight review and reaffirmed on 13 August 2026
when the Product Owner authorised the governance amendments and the acceptance
remediation that followed the first independent review. Those amendments are
now applied to `AGENTS.md`, `docs/MVP_BUILD_PLAN.md` and `docs/adr/README.md`.
Implementation is complete on `feature/centre-success-next-product-slice` and
is not merged.

This authorisation is deliberately narrow. It does **not** unlock Milestone 5,
it does **not** unlock Milestone 6, and it does **not** authorise the reserved
Centre Health methodology. Acceptance is an implementation acceptance only and
does not make Centre Success production-ready.

## Context

Milestone 3A established Daily Success: a live, read-only orchestration over
source-owned corrective-action, quarterly-review and People & Access facts,
answering "what matters today?". Milestone 2B already owns the quarterly
internal review, its findings, its corrective actions, its positive practice,
and the internal score, performance band and risk status it calculates and
stores on `audit_runs`.

What did not exist was the next question a Centre Director or Area Manager
asks after today's list is clear: *where does this centre actually stand, and
which of my centres needs help first?* That question was being answered by
reading several workflow screens and holding the result in someone's head.

Milestone 5 ("command views and operational hardening") and Milestone 6
(Centre Health, budget, coaching) both remain locked. A full Milestone 5 is
not being brought forward. Instead, the Product Owner has authorised one
narrow slice that answers the standing question using only facts the source
workflows already own.

## Decision

Add **Centre Quality & Performance** as a live, read-only projection in the
same architectural family as Daily Success.

- It is a read-side projection. It creates no table, no migration, no workflow
  state, no snapshot, no cache and no mutation endpoint. A source workflow
  change appears on the next request.
- It reads only existing Milestone 2B source data: `audit_runs`, `findings`,
  `corrective_actions`, `corrective_action_events`, `positive_observations`
  and `audit_acknowledgements`.
- It owns no business source of truth. Every deep link returns to the owning
  workflow, which independently resolves and reauthorises the record.
- It uses only existing capabilities and scopes. No capability, role or scope
  type was added: `quarterly_audit.read`, `quarterly_audit.acknowledge`,
  `quarterly_audit.conduct`, `finding.read`, `corrective_action.read`,
  `corrective_action.remediate`, `corrective_action.verify` and
  `compliance.oversight.read`.
- Two authenticated reads, both `Cache-Control: private, no-store`:
  `GET /centre-quality` and `GET /centre-quality/centres/:centreId`.

### What it displays, and where each number comes from

Every value is either counted from currently authorised source rows or copied
from a value the quarterly-review module already calculated and stored.

| Shown | Source |
| --- | --- |
| BSA internal review score | `audit_runs.overall_score` |
| Performance band | `audit_runs.performance_band_label` |
| Risk status | `audit_runs.risk_status` |
| Quarter label | formatted from `audit_runs.review_period_start` |
| Critical / high finding counts | `audit_runs` counters |
| Positive practice | `positive_observations` |
| Corrective-action state | `corrective_actions` |
| Recently completed | `corrective_action_events` close events |
| Previous-quarter comparison | two finalised `audit_runs` for one centre |

### Explicit non-inference rules

- **No composite score.** No Centre Health value, no weighted average, no
  derived index. The reserved Centre Health methodology in
  `CENTRE_HEALTH_SCORE.md` remains separately gated until an approved
  versioned methodology, weights and thresholds exist.
- **No regulatory inference.** Nothing is presented as an ACECQA assessment,
  an NQS rating or a legal compliance determination. Internal results retain
  the approved BSA internal framing.
- **No invented dates.** Due dates come from `corrective_actions.due_at`.
  `review_period_start` is never treated as a due date and no scheduling claim
  is made.
- **No invented data.** A centre with no finalised review reports
  `AWAITING_FIRST_REVIEW` and renders an empty state. A missing previous
  quarter reports `available: false`, not a zero or a flat trend. Scores from
  two different template versions are reported `NOT_COMPARABLE` with a stated
  reason rather than silently compared.

### Support classification, not a ranking

Centres are grouped by the leadership response they need —
`NEEDS_SUPPORT`, `MONITOR`, `AWAITING_FIRST_REVIEW`, `STEADY` — derived only
from uncovered critical findings, open critical actions, overdue actions,
returned remediation, work awaiting verification and due proximity. Within a
group, centres are ordered by name. There is no best-to-worst ordering and no
league-table language; a test asserts that ranking vocabulary appears in no
user-visible string. The tone is coach first, auditor second.

### Role and access boundaries

- **Centre Director** — a per-centre view where the principal both reads the
  facts and holds responsibility for the centre.
- **Area Manager** — a portfolio view over centres they conduct reviews for or
  verify remediation for.
- **Compliance Manager** — an organisation view gated on
  `compliance.oversight.read`.
- **System Administrator** — receives `status: "unsupported"` and no business
  content whatsoever. Technical administration confers no quality projection.

Authorization runs on one decision timestamp inside one read-only
repeatable-read snapshot. Centre and hierarchy facts load set-wise; capability
evaluation is the existing pure policy in memory, so there is no per-centre
database authorizer call. Each source query is restricted to its own
capability's authorised centre-id array before any aggregation, so an
unauthorised row cannot affect a count. Client-supplied centre identifiers are
validated and re-checked against the authorised set; unknown, malformed and
cross-organisation identifiers fail closed and identically.

### Source coverage: unknown is never zero

Source adapters are savepoint-isolated, and every source domain carries an
explicit per-centre coverage state of `AVAILABLE`, `NOT_AUTHORIZED` or
`UNAVAILABLE`. Coverage is per centre because authorisation is evaluated per
centre per capability, so one centre in a portfolio can be fully known while
another is not.

Only an authorised source that actually answered may report a zero. Where
coverage is not `AVAILABLE`, the contributing field is **absent from the
payload** rather than present as `0` or `[]`, which makes the rule enforceable
by the type system rather than by convention in each consumer.

A reassuring classification requires complete coverage. `STEADY` and
`AWAITING_FIRST_REVIEW` are suppressed and replaced by
`INFORMATION_INCOMPLETE`, which is a statement about source coverage and not a
performance category. Positive evidence of a support need is still reported
when another source is missing, because concealing a known critical action
behind an information notice would be the more dangerous failure. Portfolio
focus counts remain a complete partition because `INFORMATION_INCOMPLETE`
absorbs the unknown centres; summed totals are omitted whenever any
contributing centre lacks that source, since a partial sum would understate the
portfolio.

### Previous quarter

A centre can finalise more than one run inside a single quarter, for example on
two different template versions. The projection therefore collapses to the
latest finalised run per quarter before ranking quarters, so the previous
review is always a strictly earlier `review_period_start` and never another run
from the same quarter. The existing template-version comparability rule is
unchanged.

### Navigation authority

Navigation was originally cached in `sessionStorage` by Daily Success and read
back by every other page. That made client storage the effective authority for
which destinations rendered, because any syntactically valid path written there
would appear. Browser storage is no longer consulted for navigation at all.

A minimal authenticated read-only projection at `GET /navigation` returns the
capability-derived destinations for the current principal, using the same
set-wise loading and pure in-memory capability evaluation as the rest of this
slice, and the same derivation function Daily Success uses so the two cannot
drift. It owns no state, adds no capability, and returns only labels and
routes. Until the backend answers, the shell shows Daily Success alone, and a
denial or outage falls back to that same baseline. Every destination still
reauthorises independently on arrival.

## Consequences

The slice adds no migration and no index. Database operations are constant at
14 for the workspace across 1, 3 and 20-centre portfolios, and **17** for
centre detail regardless of portfolio size: the 14 workspace queries plus the
three centre-detail list queries. The source-coverage correction introduced no
additional query and no per-centre loop. The navigation projection is a
separate bounded request of 8 operations, independent of portfolio size.

Frontend routes `/quality` and `/quality/centres/:centreId` are reachable from
the capability-derived Centre Success navigation. The accompanying design
system is recorded in `DESIGN_SYSTEM.md`.

This decision does not authorise Leadership & Coaching, Centre Health, budget,
wellbeing, AI, exports, recognition, access reviews, notifications, or any
other Milestone 5 or Milestone 6 capability. Each remains separately gated.
