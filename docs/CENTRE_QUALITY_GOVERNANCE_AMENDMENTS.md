# Prepared governance amendments — Centre Quality & Performance

**Do not apply these yet.** `AGENTS.md`, `docs/MVP_BUILD_PLAN.md` and
`docs/adr/README.md` are all currently modified in the parallel Microsoft
Graph lane. Applying them now would create an avoidable governance merge
conflict.

Apply after Lane A lands, then delete this file.

Each amendment below gives the exact anchor text to find and the exact
replacement, so the edit can be made mechanically.

---

## 1. `AGENTS.md`

### 1.1 Current delivery gate (first paragraph of "## Current delivery gate")

**Find**

> Milestone 3B and every later milestone remain locked; no later milestone is
> authorised.

**Replace with**

> Milestone 3B and every later milestone remain locked, with one exception:
> the Product Owner granted a narrow product-slice authorisation for Centre
> Quality & Performance on 12 August 2026, recorded in ADR-0017. That
> authorisation covers only a live, read-only projection over existing
> Milestone 2B quarterly-review, finding and corrective-action data, using
> existing capabilities and scopes, with no new source-of-truth table, no new
> workflow state, no invented due date, no NQS or ACECQA rating inference and
> no composite Centre Health score. It does not unlock the remainder of
> Milestone 5, does not unlock Milestone 6, and does not authorise the
> reserved Centre Health methodology.

### 1.2 New paragraph, inserted immediately after the Milestone 3A paragraph

**Insert**

> Centre Quality & Performance is a live, read-only projection in the same
> architectural family as Daily Success. It must not add a table, migration,
> workflow state, snapshot, cache, mutation endpoint, composite score,
> regulatory rating inference, invented due date, or per-centre database
> authorizer loop. Approved views are Centre Director (single authorised
> centre), Area Manager (authorised portfolio) and Compliance Manager
> (organisation). System Administrator technical privilege confers no quality
> projection. Centres are grouped by the support they need and are never
> ranked. See `docs/adr/0017-centre-quality-performance-read-projection.md`.

### 1.3 Required invariant 6

**Find**

> 6. **Internal indicators are labelled.** Centre Health and internal audit
>    scores are management signals, not regulatory ratings, legal
>    determinations, or clinical assessments.

**Replace with**

> 6. **Internal indicators are labelled.** Centre Health and internal audit
>    scores are management signals, not regulatory ratings, legal
>    determinations, or clinical assessments. The reserved Centre Health
>    concept stays locked until an approved versioned methodology, weights and
>    thresholds exist; surfaces may present source-owned BSA internal review
>    score, performance band and risk status, and must not relabel those as
>    Centre Health.

### 1.4 Confirmed technical baseline — new bullet after the Frontend bullet

**Insert**

> - Frontend design language: the shared Bright Steps "Greenhouse" system,
>   matching the Bright Steps Site Launch Planner. Tokens, primitives and
>   conventions are recorded in `docs/DESIGN_SYSTEM.md`. Build screens from the
>   shared primitives rather than styling pages independently, and do not
>   introduce a UI framework for appearance alone.

---

## 2. `docs/MVP_BUILD_PLAN.md`

### 2.1 Delivery status line

**Find**

> **Milestone 3 — started under controlled sub-milestone gates. Milestone 3A —
> Daily Success is ACCEPTED / COMPLETE. Milestone 3B and later work remain
> locked.**

**Replace with**

> **Milestone 3 — started under controlled sub-milestone gates. Milestone 3A —
> Daily Success is ACCEPTED / COMPLETE. Milestone 3B and later work remain
> locked, except for the narrow Centre Quality & Performance product slice
> authorised on 12 August 2026 under ADR-0017.**

### 2.2 "#### Milestone 3B and later — locked"

**Find**

> Stateful daily planning/check-in, living QIP, notifications, manual
> priorities, additional user perspectives, and every other later module
> require separate Product Owner authorisation. Milestone 3A does not imply or
> pre-authorise them.

**Replace with**

> Stateful daily planning/check-in, living QIP, notifications, manual
> priorities, additional user perspectives, and every other later module
> require separate Product Owner authorisation. Milestone 3A does not imply or
> pre-authorise them.
>
> One exception has been granted. **Milestone 3C — Centre Quality &
> Performance** is authorised as a narrow read-side projection under ADR-0017:
> a live, read-only view over existing Milestone 2B quarterly-review, finding
> and corrective-action data, with no migration, no new source of truth, no
> composite score and no regulatory rating inference. It adds Centre Director,
> Area Manager and Compliance Manager quality views and the shared Centre
> Success design system. It does not unlock the remainder of Milestone 5 or
> any part of Milestone 6.

### 2.3 "### Milestone 5 — command views and operational hardening"

**Append to that section**

> The narrow Centre Quality & Performance slice authorised under ADR-0017
> delivers part of the scoped-oversight goal ahead of this milestone. The rest
> of Milestone 5 — recognition, exports with manifests and expiry, access
> reviews, reconciliation jobs, incident runbooks, load and resilience
> testing, backup and restore evidence, and production readiness review —
> remains locked.

### 2.4 "### Milestone 6 — approved conditional modules"

**Append to that section**

> Centre Health remains locked in particular. ADR-0017 deliberately computes
> no composite score, and the reserved methodology, weights, thresholds,
> coverage rules and band labels remain open decisions requiring their own
> mini-gate.

---

## 3. `docs/adr/README.md`

### 3.1 Accepted list — add after the ADR-0015 line

**Insert**

> - [ADR-0017: Centre Quality & Performance as a narrow read-side projection](0017-centre-quality-performance-read-projection.md) — accepted as a narrow product-slice authorisation

Note: Lane A is expected to add an ADR-0016 line for the Microsoft Graph
staging invitation-email decision. This entry sits after it.

---

## 4. Files this branch deliberately did not touch

`AGENTS.md`, `docs/MVP_BUILD_PLAN.md`, `docs/adr/README.md`,
`docs/PEOPLE_AND_ACCESS.md`, `docs/INTEGRATIONS.md`, `docs/SECURITY.md`,
`docs/DEVELOPER_SETUP.md`, `docs/DATABASE_SCHEMA.md`, `docs/WORKFLOWS.md`,
`docs/FOUNDATION_DECISIONS.md`, `README.md`, `docs/adr/0008*`,
`docs/adr/0012*`, `docs/adr/0014*`, `docs/adr/0016*`,
`foundation/people-access/**`, `foundation/authentication/**`, and both
`.github/scripts` guards.

No migration was added. Migration 019 remains free for the parallel lane.
