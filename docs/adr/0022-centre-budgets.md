# ADR-0022: Centre Budgets

## Status

**Proposed for independent review.** Implementation is authorised by the Product
Owner takeover instruction under which this record is written; **acceptance is
separate** and is not conferred by that authorisation, by this record, or by the
module passing a local gate.

This record decides the shape, boundary, and invariants of a Centre Budgets
module. It does not accept an implementation, does not make Centre Success
production-ready, and does not place budget inside Release Boundary P1 — ADR-0021
D2 explicitly excludes budget from P1 and nothing here amends that exclusion.

It does supersede `docs/BUDGET_ACCOUNTABILITY.md` on exactly one question — who
may enter an actual — under a Product Owner decision of 14 August 2026 recorded in
D5. That supersession is confined to that question. `docs/BUDGET_ACCOUNTABILITY.md`
otherwise remains the governing business material for this domain.

Three governance documents currently state that budget functionality is out of
scope: `AGENTS.md` (current delivery gate, and the Milestone 2B/2C scope
paragraphs), `docs/MVP_BUILD_PLAN.md` ("Milestone 6 — approved conditional
modules", which requires budget to pass its own mini-gate, data/privacy/security
assessment, domain acceptance criteria and permission tests), and ADR-0017, which
closes by stating it does not authorise budget. Those documents are the authority
on the delivery gate, not this record. ADR-0017 was accompanied by explicit
amendments to `AGENTS.md`, `docs/MVP_BUILD_PLAN.md` and `docs/adr/README.md`; the
equivalent amendments for Centre Budgets are named under *What would unblock
this* and are deliberately not made here.

## Context

`docs/BUDGET_ACCOUNTABILITY.md` is the governing business material for this
domain and it is unusually careful. It opens by stating that Budget
Accountability "does not replace Bright Steps' general ledger, procurement,
payroll, accounts-payable, budgeting, or financial-approval systems", and then
states something stronger and more consequential: "No Bright Steps finance
system, chart of accounts, reporting calendar, thresholds, approval authority, or
integration mechanism is assumed in this architecture." Its closing section lists
nine open decisions, the last of which is whether any budget capability belongs in
the first MVP release at all.

That document describes a mature, import-first module: Finance supplies approved
budget and posted actuals from a nominated system of record, every value carries
currency, period, source batch, cutoff, mapping version and reconciliation state,
and Centre Directors comment, forecast, acknowledge and own responses to
information they are permitted to see. `docs/DATABASE_SCHEMA.md`
("Budget-accountability module") sketches the same shape — finance connection,
financial period, budget version, budget line, actual batch/line, commitment
snapshot, forecast version, warning, commentary, reconciliation.

Centre Budgets as authorised is deliberately smaller and starts from the opposite
end. There is no nominated finance system, so there is nothing to import from.
What exists is a Centre Director who needs to see, for their centre and a given
month, what was budgeted by category, what was spent, what is left, and how far
through the budget they are; and an Area Manager who needs the same across a
portfolio, with month comparison and a way to see which centres are exposed. The
interim source of an actual is therefore a person, not a batch.

That inversion is the whole architectural risk of this module, and it is why this
record exists rather than a build ticket. An import-fed number is absent until a
batch arrives, and its absence is visible as an unreconciled or stale batch. A
human-entered number is absent because nobody typed it, which looks exactly like
nothing having been spent. `docs/BUDGET_ACCOUNTABILITY.md` already anticipates
the general form of this failure — "Partial or stale imports are visibly marked
and must not create misleading warnings" — and Centre Success already holds the
sharper version of the same rule elsewhere. ADR-0017 requires that only an
authorised source that actually answered may report a zero, and that a
contributing field is absent from the payload rather than present as `0`.
ADR-0015 records that a source outage yields an honest partial response without
fabricating dependent counts or claiming on track. ADR-0021 D7 makes the same
property a production release criterion. `AGENTS.md` states it as a repository
invariant. Money makes that rule matter more, not less: a fabricated zero here
does not merely understate a count, it produces a reassuring financial statement
about a centre nobody has looked at.

The second architectural risk is that this module is the first in Centre Success
to hold a business number that a person typed and that no upstream system owns.
Every accepted module to date either derives from source workflow state
(ADR-0015, ADR-0017) or holds records whose authority is internal by construction
(quarterly reviews, People & Access). A budget figure is different: Finance will
eventually own it, and the module must be built so that transfer does not require
reshaping the domain.

Some relevant scaffolding already exists and is easy to over-read.
`foundation/migrations/001_foundation.up.sql` registers the capability
`budget.summary.read`; `foundation/migrations/006_canonical_role_templates.up.sql`
grants it to canonical Finance role template version 1;
`foundation/authorization/capabilities.ts` and `foundation/authorization/roles.ts`
carry the corresponding constants; and `foundation/authorization/policy.test.ts`
asserts that Finance is allowed and an unrelated role is denied. None of that is a
budget module. `docs/PERMISSIONS.md` says so directly: the key "proves that a
scoped financial capability can be represented; it does not authorise a budget
module in Milestone 1", and `docs/USER_ROLES.md` calls it a synthetic Finance
authorisation marker. Across the accepted contents of `main` — migrations 001–019
under ADR-0021 D2 — there is no budget table, no budget domain migration, no
budget endpoint, and no budget frontend route.

## Decision

Add **Centre Budgets** as a domain module inside the existing Encore modular
monolith and the single application database (ADR-0001, `AGENTS.md`), owning a
small number of authoritative tables and presenting every derived figure as a
request-time projection over them. Its migrations are forward-only under ADR-0007.

### D1 — Scope boundary, and what is excluded

The unit of work is **one centre, one budget period, one category**. Against that
unit the module holds a budget amount and an actual amount, and presents the two
derived figures a leader actually uses: remaining, and how far through the budget
the centre is.

**Centre Director** sees their own authorised centre or centres: the categories
for the current period, what was budgeted, what has been recorded as spent, what
remains, and — where the business process requires it — records or confirms an
approved actual for a category and period. **Area Manager** sees the same
information across the effective-dated assigned portfolio, with comparison
between periods, an exception list, and an overspend-risk view. Neither view
invents a figure that was not entered or approved.

Centre Budgets explicitly is **not**, and no part of this record may be read as
authorising:

- **an accounting ledger.** `docs/BUDGET_ACCOUNTABILITY.md` states that Centre
  Success "never creates a shadow ledger or silently changes source financial
  data". Centre Budgets holds period aggregates by category, never transactions,
  never a chart of accounts, and never a double-entry structure.
- **journal entries.** Nothing in this module posts, reverses, accrues, or
  otherwise writes to any accounting record, internal or external.
- **payroll.** No salary, wage, individual remuneration, superannuation, or
  employment-cost record enters this module. `docs/BUDGET_ACCOUNTABILITY.md`
  excludes "restricted payroll, personal remuneration, bank, tax, or vendor
  details unless specifically authorised" from the Centre Director view, and
  Centre Budgets does not seek that authorisation.
- **an approvals or procurement workflow.** No purchase request, no delegation of
  spending authority, no approval routing. `docs/BUDGET_ACCOUNTABILITY.md` is
  explicit that "Financial delegations and spending approval remain in the
  authoritative finance/procurement process unless a later approved decision
  brings them into scope." This is not that decision.
- **forecasting or commitments.** `docs/BUDGET_ACCOUNTABILITY.md` describes both,
  and the Centre Director experience it specifies includes forecast, assumptions,
  and committed value. Centre Budgets deliberately delivers neither, so this
  module must not be described internally as completing Budget Accountability. It
  implements a strict subset.

### D2 — Categories are governed application data, never a code enum

Budget categories are rows in a governed, organisation-owned table with an
approving owner, effective dates, and a stable internal identifier separate from
the display name. They are never a TypeScript union, a database `CHECK`
constraint over literals, a PostgreSQL enum type, or a hard-coded list in a
frontend component.

The reason is operational rather than aesthetic. A category set for early
childhood centre operations is a business taxonomy that changes for business
reasons — a category is renamed for clarity, split when it stops being
interpretable, or added when the organisation starts tracking something new.
Encoding those names in code makes each of those a schema migration, a pull
request, a review, a generated-client regeneration (ADR-0005), and a deploy, in
order to change a word on a screen. It also makes the taxonomy engineering's to
decide by default, which `AGENTS.md` invariant 5 forbids: "Do not invent
legislation, ACECQA requirements, financial rules, or Bright Steps policy."
`docs/SECURITY.md` already sets the general rule — "Configuration that changes
business behaviour — control versions, thresholds, score methods, template
versions — is governed application data, not an untracked environment variable" —
and this is the same rule applied to a taxonomy.

Renames must not rewrite history: a historical period continues to resolve the
category identity it was recorded against, and a display name change is a new
effective version of the category rather than an update in place. This is the
effective-dated pattern ADR-0004 already establishes for hierarchy and that
`docs/DATABASE_SCHEMA.md` states as a referential invariant ("A versioned
reference used by a finalised record cannot be deleted while retained records
depend on it").

**`docs/BUDGET_ACCOUNTABILITY.md` names no budget categories at all, and neither
does any other document in this repository.** It refers only to "permitted
categories", "approved reporting category", and an "approved, versioned mapping"
of external identifiers; `chart/category mapping` is listed among its open
decisions, and `docs/DATABASE_SCHEMA.md` lists exact budget taxonomies as a
decision required before future domain schemas. The initial category set is
therefore an **owner decision** (D9.1). Engineering may build the mechanism that
holds categories; it may not populate it.

### D3 — Thresholds and bands are versioned governed configuration with a named owner

Any band that classifies a centre-period as comfortable, tight, or exposed, and
any rule that identifies overspend risk, is approved business configuration. It
carries a version, effective dates, an approving owner, and a change record, and
it lives in the database as governed application data — never as a constant in
source, never as an environment variable, and never as a value chosen because a
test needed one.

This mirrors ADR-0021 D9, which places audit thresholds and score bands among the
gates engineering cannot close, and states the reasoning that applies verbatim
here: "an engineering-chosen threshold produces a system that states a centre is
meeting an obligation, confidently and in good visual order, without anyone
qualified having decided that it does." A budget band is the same object. A
threshold decides when a Centre Director is told they are fine.

Two consequences follow and are load-bearing.

**Historical interpretability.** A period is presented under the configuration
version in force for that period, not under the current one. Changing a band
boundary in October must not silently restate August. The projection therefore
resolves the effective configuration version from the period being displayed,
which is the same effective-dated resolution ADR-0004 established for hierarchy.
Where two displayed periods fall under different configuration versions, the
comparison discloses that rather than presenting the two as like-for-like —
ADR-0017 already refuses to silently compare review scores from two template
versions and reports `NOT_COMPARABLE` with a stated reason.

**Presentation.** `docs/BUDGET_ACCOUNTABILITY.md` requires that the view "avoids
red/green-only meaning", and `docs/DESIGN_SYSTEM.md` independently requires that
severity, trend and status always include words and that state never depends on
colour. A band is a label with a word, and colour is a secondary signal.

**`docs/BUDGET_ACCOUNTABILITY.md` approves no thresholds.** Its warning framework
states plainly that its list comprises "Candidate categories—not approved
thresholds", and its open decisions include "Warning rules, thresholds,
severities, response/approval authorities." Band count, band labels, band
boundaries, the overspend-risk rule, and the configuration's approving owner are
therefore **owner decisions** (D9.2). This record records no percentage, and any
number appearing in an implementation before D9.2 closes is a defect regardless
of how reasonable it looks.

### D4 — Unknown is not zero, and absence is a distinct state

This is the invariant that matters most in this module and the one most likely to
be lost in implementation, because the wrong behaviour requires no code at all —
it is what a default-initialised number does.

A centre-period-category for which no actual has been recorded **must not** render
as `$0 spent`, as `100% remaining`, as a comfortable band, or as any figure
derived from treating the missing actual as zero. It means *we do not know what
this centre spent*, and a leader reading `$0 spent` will conclude the opposite of
the truth. **A period with no entry and a period with a deliberate zero entry are
different states and must be different values**, because a recorded zero is a
finding and an absent entry is a gap in the record.

The rule is enforced by the type system rather than by convention in each
consumer, following ADR-0017 exactly: where an actual has not been recorded, the
field is **absent from the response payload**, not present as `0`. Concretely:

1. Every value derived from a missing input is itself absent. Remaining and
   percent-used are computable only where both a budget amount and an actual
   exist; where the actual is absent, both derived fields are omitted and the
   unit reports its state.
2. A band or risk classification is never assigned to a unit with no recorded
   actual. A reassuring conclusion requires the coverage that supports it —
   ADR-0017 suppresses `STEADY` in favour of `INFORMATION_INCOMPLETE` for exactly
   this reason, and that record is the precedent to follow, not to re-derive.
3. Aggregates across categories, centres, or periods are omitted whenever any
   contributing unit lacks a recorded actual, because a partial sum understates
   the portfolio and reads as a complete one. ADR-0017 applies the same rule to
   portfolio totals. Where an aggregate is omitted, what is reported is the
   coverage, not a smaller number.
4. Positive evidence of a problem is still reported when other units are
   unknown. ADR-0017's reasoning holds here: concealing a known overspend behind
   an information notice is the more dangerous failure. Incompleteness suppresses
   reassurance, never a known exposure.
5. A missing **budget** amount is likewise not zero. A category with no approved
   budget for a period is unbudgeted, which is a different statement from
   budgeted at nil.

`docs/BUDGET_ACCOUNTABILITY.md` supports the general principle — stale or partial
data "must not create misleading warnings", and the Centre Director view carries
"data freshness/reconciliation caveats" — and ADR-0021 D7 makes it a production
release criterion tested under real partial coverage. This record makes the
absent-not-defaulted representation a requirement of the domain model itself, so
that no consumer can reintroduce the zero by convenience.

### D5 — Centre Directors record actuals, and every actual records its source

Each recorded actual carries the **source** it came from: at minimum whether it
was entered by a person in Centre Success, and by which principal, at what time,
under what confirmation state; or supplied by an external finance system, with
that system's identity, its batch or reference, and its stated cutoff. Source is a
first-class attribute of the value, not an inference from which table a row sits
in and not a property of the module as a whole.

This is what makes the seam real rather than aspirational. When a finance system
is nominated, imported actuals become an additional source for the same
centre-period-category unit rather than a parallel model, the shape of a budget
figure does not change, and existing periods remain interpretable. Reconciliation
then becomes an answerable question — *this figure was entered by a person on this
date and the finance system now reports this other figure* — instead of an
archaeology exercise. Without recorded provenance, a later reconciliation cannot
be performed at all, which is the failure `docs/PERSONAS.md` attributes to the
Finance persona's pain risks and `docs/BUDGET_ACCOUNTABILITY.md` addresses through
immutable batches and governed correction paths.

Two constraints hold from the outset. First, an entered value is never silently
overwritten by an imported one; correction follows the governed paths
`docs/BUDGET_ACCOUNTABILITY.md` already specifies, which preserve the original
record. Second, no finance product, protocol, file format, or vendor is named,
assumed, or built toward — `docs/BUDGET_ACCOUNTABILITY.md` states that no
integration mechanism is assumed, and `docs/INTEGRATIONS.md` records the finance
row as a candidate whose vendor and scope require discovery.

#### Centre Directors enter and confirm actuals — decided, and superseding

`docs/BUDGET_ACCOUNTABILITY.md` does not contemplate a Centre Director entering an
actual. It defines an actual as "posted expenditure/revenue supplied by the system
of record as of a stated cutoff"; its ingestion path admits "a signed/authorised
API response, governed file, or manual Finance import" — manual, but under
**Finance** authority; and its accountability section limits Centre Directors to
comment, forecast, acknowledge, and owning permitted responses.
`docs/PERMISSIONS.md` gives the Centre Director column of the Budget row
"Permitted centre summary/detail/comment", and the reserved capability family in
`docs/USER_ROLES.md` contains `budget.summary.read`, `budget.detail.read`,
`budget.import`, `budget.configure` and `budget.comment` — and no entry key at all.
Centre Director entry of actuals is therefore not a gap in the source material; it
is a **change of authority relative to it**.

**Decided on 14 August 2026 by the Product Owner: Centre Directors do enter and
confirm actuals.** The decision was taken with knowledge of the conflict above,
which this record surfaced before it was made. The Product Owner's product scope
**supersedes `docs/BUDGET_ACCOUNTABILITY.md` on this single question — who may
enter an actual — and on nothing else.** That document continues to govern this
domain everywhere else without qualification, including its concept definitions,
its system-of-record relationship, its governed correction paths, its warning
framework, its security and privacy requirements, and in particular its constraint
that Centre Success "never creates a shadow ledger or silently changes source
financial data". No other sentence of it is weakened, and no second supersession
may be inferred from this one.

That constraint is precisely why **the source requirement in this sub-decision
becomes more important under this decision, not less.** While actuals arrived only
as a Finance import, provenance was largely self-evident from the batch that
carried them. Now that the interim source of an actual is a person at a centre,
`source_kind` — manual entry versus finance-system import — together with the
recording principal, the time, and the confirmation state is the only thing
distinguishing a figure a Director typed from a figure the organisation's books
report. Without it, a table of centre-entered numbers with no recorded origin is
indistinguishable from a ledger, which is the exact outcome
`docs/BUDGET_ACCOUNTABILITY.md` warns against and `docs/PERSONAS.md` records as the
Finance persona's first pain risk. With it, a later finance system becomes an
added source for the same unit rather than a reshaped domain, and the
reconciliation question stays answerable. Recording source on every actual is
therefore not optional under this decision; it is the control that keeps the
decision compatible with the document it supersedes.

Two boundaries follow and are not widened by this decision. Confirmation is a state
on the centre's own record, not a second-person approval and not a spending
authorisation: D1 excludes approvals and procurement workflow, and
`docs/BUDGET_ACCOUNTABILITY.md` keeps financial delegations and spending approval
in the authoritative finance/procurement process. And `docs/USER_ROLES.md` still
requires under separation of duties that "Finance import and reconciliation/approval
should be separable", so if a Finance reconciliation step is introduced later it is
a distinct authority from the one decided here.

**This decision requires a new capability key.** The reserved budget family in
`docs/USER_ROLES.md` contains no entry capability of any kind, so the authority
decided here cannot be expressed by any existing or reserved key, and D6's
preference for reusing the reserved family cannot be satisfied for entry.
Amending that reserved family in `docs/USER_ROLES.md` — and stating the resulting
concrete key in `docs/PERMISSIONS.md` with its scope and negative boundaries — is a
**documentation amendment the Product Owner needs to make**, not an engineering
choice, since `docs/USER_ROLES.md` is explicit that these family names are
architectural planning vocabulary until an approved milestone records a concrete
key. It is listed under *What would unblock this*.

### D6 — Authorisation is PostgreSQL-owned, scoped, and denies System Administrators

Centre Budgets introduces its own capability keys and grants no access through
role names, frontend state, Entra claims, or client-supplied identifiers. It uses
the existing authorisation architecture unchanged: ADR-0003's assignment,
capability and scope model; the decision sequence in `docs/PERMISSIONS.md`; and
ADR-0002's provider-neutral principal. Capability and matching scope must come
from the *same* assignment, per `docs/PERMISSIONS.md` — "Capabilities and scopes
from unrelated assignments cannot be recombined to manufacture broader access."

Reading is scoped per centre; portfolio reading is scoped to the effective-dated
assigned centres, which `docs/PERMISSIONS.md` requires be derived from assignment
data and never from a client-provided region filter. Every query is restricted to
the authorised centre-id set *before* aggregation, following ADR-0017 and
ADR-0015, so that an unauthorised centre cannot influence a total. Client-supplied
centre and period identifiers are requested resources, validated and re-checked
against the authorised set, failing closed and identically for unknown, malformed
and cross-organisation values.

The capability keys should be drawn from the reserved family in
`docs/USER_ROLES.md` where one fits — `budget.summary.read` (already registered in
`foundation/migrations/001_foundation.up.sql` and held by canonical Finance role
template version 1), `budget.detail.read`, `budget.configure`, `budget.comment` —
with a new key required for recording an actual, since the reserved family
contains none. `docs/USER_ROLES.md` is explicit that these family names "are
architectural planning vocabulary unless a separately approved milestone records a
concrete key", so only the keys this module concretely implements become real, and
the exact set is stated in `docs/PERMISSIONS.md` at implementation. Because
canonical role templates are versioned under ADR-0006, granting Centre Directors
and Area Managers any budget capability requires new canonical template versions
rather than editing the accepted ones, and the existing synthetic Finance grant
becomes a real capability at that point rather than a marker.

**A System Administrator gains no budget content through technical
administration.** `docs/BUDGET_ACCOUNTABILITY.md` states that "System
Administrators manage technical connections but cannot read financial content by
default"; `AGENTS.md` and `docs/USER_ROLES.md` state the same for business content
generally; and ADR-0017 already implements the pattern by returning
`status: "unsupported"` and no business content whatsoever. Centre Budgets follows
that pattern. Administering the application confers no authority over what a
centre spent. Break-glass remains deferred under ADR-0009, so there is no
supported path by which an administrator reads budget content to diagnose a
problem; support is performed by correcting grants and reading audit events, as
ADR-0021 D10 already accepts for P1.

Material events — recording or confirming an actual, changing a budget amount,
publishing a category version, publishing a threshold version — are auditable
under `AGENTS.md` invariant 8, and `docs/SECURITY.md` already requires audit
coverage of budget import and configuration.

### D7 — Financial figures are Confidential, and are minimised everywhere else

Budget figures are **Confidential** — class 3 in `docs/PERMISSIONS.md` ("findings,
staff information, budget detail, coaching, restricted evidence") and the same
class in the `docs/SECURITY.md` data-classification table ("Findings, audit
detail, QIP drafts, coaching, staff and budget information"), carrying least
privilege, purpose limits, export controls, and encryption. Classification follows
the most sensitive linked content, and it is checked as its own step in the
`docs/PERMISSIONS.md` decision sequence, after capability and scope.

Nothing in this module is Highly restricted, because nothing payroll-, remuneration-,
bank-, tax-, or vendor-related enters it under D1. If a later decision admits any
of that content, its classification is reassessed before it is stored, not after.

Confidential classification is inherited by every derived surface.
`docs/SECURITY.md` requires that logs and traces exclude financial detail and that
centre names never become high-cardinality metric labels; responses are
`private, no-store` as in ADR-0015 and ADR-0017; and no budget figure appears in a
URL, a notification, an AI prompt, or an analytics event. There is no export in
this module — exports with manifests remain locked under `docs/MVP_BUILD_PLAN.md`
Milestone 5 and are excluded from P1 by ADR-0021 D10.

### D8 — What is authoritative, and what is a projection

Centre Budgets differs from ADR-0015 and ADR-0017 in a way that must be stated
plainly, because those two records established a house pattern of owning nothing:
**Centre Budgets owns a real source of truth.** Entered and approved values live
nowhere else and cannot be recomputed from another module.

**Authoritative** — stored, migrated, audited, and the only place these facts
exist:

| Authoritative record | Holds |
| --- | --- |
| Budget category version | Organisation-owned category identity, display name, effective dates, approving owner |
| Threshold/band configuration version | Bands, overspend-risk rule, effective dates, approving owner |
| Budget amount | Centre, period, category version, approved amount, currency, provenance |
| Recorded actual | Centre, period, category version, amount, currency, **source**, recording principal, time, confirmation state |
| Budget audit event | Attributable record of each material change above |

**Projections** — computed per request from the authoritative records and the
configuration version effective for the period, stored nowhere, cached nowhere,
and carrying no independent lifecycle:

| Projection | Derived from |
| --- | --- |
| Remaining | Budget amount less recorded actual, where both exist |
| Percent used | Recorded actual against budget amount, where both exist |
| Band | Percent used against the threshold version effective for that period |
| Overspend risk | The approved rule against the same effective configuration |
| Centre Director period view | Authoritative records for one authorised centre |
| Area Manager portfolio, comparison, exception views | The same records across the authorised portfolio |

No derived value is stored. A band is never persisted alongside the actual it
describes, because persisting it would make a historical figure interpretable only
under whichever configuration happened to be current when it was written — the
precise failure D3 exists to prevent. `docs/DATABASE_SCHEMA.md` states the
governing invariant already: "Derived projections can be rebuilt from
authoritative records and carry freshness."

The referential invariants in `docs/DATABASE_SCHEMA.md` apply without exception:
every record resolves to exactly one organisation, every cross-record relationship
checks matching `organisation_id`, and a category or configuration version
referenced by a retained record cannot be deleted.

### D9 — Owner decisions this record does not close

`AGENTS.md` requires that unresolved business decisions be recorded explicitly
rather than silently turned into requirements. The following are open, are not
engineering's to close, and no implementation is complete while any of them is
answered by a value someone chose to make a screen render.

One decision that was open when this record was drafted has since been closed:
Centre Director entry of actuals was decided by the Product Owner on 14 August
2026 and is recorded in D5. Its numbered slot below is retained as a closed
cross-reference rather than removed, so that the identifiers of the decisions that
remain open do not shift. **Nothing else in this list is resolved**, and the
closure of item 3 must not be read as closing any neighbouring item.

1. **The category set.** No document in this repository names a budget category.
   `docs/BUDGET_ACCOUNTABILITY.md` lists chart/category mapping among its open
   decisions and `docs/DATABASE_SCHEMA.md` lists exact budget taxonomies as
   required before a domain schema. Needs an owner and an approved initial set.
2. **Bands, thresholds, and the overspend-risk rule**, with an approving owner and
   a change process. `docs/BUDGET_ACCOUNTABILITY.md` states its list is candidates
   and not approved thresholds.
3. ~~**Whether a Centre Director may record an actual at all**~~ — **closed.**
   Decided by the Product Owner on 14 August 2026: Centre Directors enter and
   confirm actuals, superseding `docs/BUDGET_ACCOUNTABILITY.md` on that single
   question. Recorded in D5, which also states the source-provenance requirement
   the decision depends on and the `docs/USER_ROLES.md` capability amendment it
   requires. No longer open.
4. **The period grain.** This record says "period" rather than "month" because
   `docs/BUDGET_ACCOUNTABILITY.md` lists "Financial calendar, currency,
   chart/category mapping, and source identifiers" among its open decisions and
   speaks of a financial period against an organisation calendar. A calendar-month
   grain is a plausible reading of the requirement and is not an approved one.
5. **Currency.** `docs/BUDGET_ACCOUNTABILITY.md` requires each value to carry
   currency and lists currency among its open decisions. No currency is assumed
   here.
6. **The definition of remaining and of percent used.**
   `docs/BUDGET_ACCOUNTABILITY.md` requires that definitions "must be supplied by
   Finance and versioned", defines remaining as approved budget less included
   categories "under the declared method", and does not define percent used at
   all. The denominator and the treatment of any excluded category are Finance's
   to declare.
7. **Which categories each role may see.** `docs/USER_ROLES.md` already carries
   "Which budget line items Centre Directors and executives may view" as an open
   decision and `docs/PERMISSIONS.md` defers "Finance category visibility". This
   record does not resolve either.
8. **Retention and deletion of budget records**, open in
   `docs/BUDGET_ACCOUNTABILITY.md` and in the `docs/SECURITY.md` open decisions.
9. **Whether Centre Budgets belongs in a production release, and which one.**
   `docs/BUDGET_ACCOUNTABILITY.md` closes with exactly this question. ADR-0021 D2
   excludes budget from P1 and this record does not change that.

### D10 — What this record does not authorise

No part of this record authorises, and no implementation may introduce:

forecasting of any kind, including run-rate projection, trend extrapolation, or a
stored forecast version; multi-year or annual planning, budget setting, or
scenario modelling; purchase orders, requisitions, invoice capture, receipt
capture, or supplier records; integration with any named finance, accounting,
procurement, or payroll product, or any inbound import endpoint, file drop,
webhook, or scheduled sync; a Centre Health input, dimension, contribution, or
confidence signal — `docs/CENTRE_HEALTH_SCORE.md` reserves a Budget accountability
dimension, and ADR-0017 and `AGENTS.md` both keep the Centre Health methodology
locked until an approved versioned methodology, weights and thresholds exist;
exposure of budget figures in any executive, organisation-wide, or command view
not separately approved, notwithstanding the Executive and Compliance columns of
the Budget row in `docs/PERMISSIONS.md`, which that document itself describes as
"a design baseline for later milestones" that "does not add Milestone 1
capabilities"; notifications, escalation, or alerting on any budget condition,
which remain excluded by ADR-0021 D10; exports of budget data; AI drafting,
summarisation, or commentary over budget figures; and any Educator, Assistant
Director, or Operations Leadership budget surface.

## What would unblock this

- **Independent review of this record**, and Product Owner acceptance of the D1
  boundary — in particular the deliberate exclusion of forecasting and commitments,
  which means Centre Budgets implements a strict subset of
  `docs/BUDGET_ACCOUNTABILITY.md` and must not be described as completing it.
- **The eight owner decisions still open in D9**, each with a named owner and a
  date. D9.1 and D9.2 block implementation rather than acceptance: without them the
  module has no categories to hold and no bands to apply. D9.3 is closed —
  see D5.
- **Amendment of the reserved budget capability family in `docs/USER_ROLES.md`,
  and the concrete key statement in `docs/PERMISSIONS.md`.** The 14 August 2026
  decision that Centre Directors enter and confirm actuals requires a capability
  the reserved family does not contain. Naming it is a Product Owner amendment,
  not an engineering choice.
- **Explicit amendment of the delivery-gate documents.** `AGENTS.md` and
  `docs/MVP_BUILD_PLAN.md` currently state that budget functionality is out of
  scope and that Milestone 6 requires its own mini-gate. ADR-0017 was accompanied
  by matching amendments to those files and to `docs/adr/README.md`; the
  equivalent amendment for Centre Budgets is a Product Owner action and is not
  made by this record.
- **A data and privacy assessment covering financial figures**, as
  `docs/MVP_BUILD_PLAN.md` requires for each Milestone 6 module and
  `docs/SECURITY.md` requires before collection.
- **The `docs/PERMISSIONS.md` capability statement**: the exact capability keys,
  the canonical role template versions that carry them under ADR-0006, and the
  negative boundaries, recorded before implementation rather than after.
- **A production decision, separately**, since ADR-0021 D2 excludes budget from P1
  and this record proposes no boundary of its own.

## Consequences

Centre Success acquires its first module that holds a business number a person
typed and that no other system owns. That is a real increase in responsibility:
until a finance system is nominated, a figure on a Centre Director's screen is as
correct as the last person who entered it, and the module's honesty depends
entirely on D4 and D5 holding — absence represented as absence, and every value
carrying the source that produced it.

The unknown-is-not-zero requirement will make the product look emptier than a
naive implementation would. A newly configured centre will show categories with no
actuals and no percentages, and no comfortable band, which will read as the
feature being incomplete. It is the feature working. The alternative — a portfolio
of centres each showing full remaining budget because nobody has entered anything
— is a system that reassures an Area Manager about twenty centres it knows nothing
about.

Holding categories and thresholds as governed data rather than code costs a
configuration surface, an approving owner, and effective-dated versioning that a
constant would not need. The return is that a renamed category is a business
action rather than a release, that a historical period stays interpretable when a
band boundary moves, and that the question *who decided this threshold* has an
answer other than a commit.

Recording source on every actual costs storage and a modest amount of ceremony now,
in exchange for a finance integration that later adds a source rather than
reshaping a domain, and for a reconciliation that is possible at all. If provenance
is skipped at the start, it cannot be reconstructed later.

Excluding forecasting and commitments means the Centre Director view specified in
`docs/BUDGET_ACCOUNTABILITY.md` is not delivered by this module. That gap should
be visible in the product's own language rather than papered over: what is shown
is what was budgeted and what has been recorded as spent, not a projection of where
the period will end.

Finally, this module sits outside every current delivery gate and outside Release
Boundary P1. Building it does not move it inside either. Acceptance, a production
boundary, and the owner decisions in D9 remain separate, and none of them is
conferred by the implementation passing its tests.
