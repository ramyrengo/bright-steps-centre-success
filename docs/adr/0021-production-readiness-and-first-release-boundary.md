# ADR-0021: Production readiness and the first production release boundary

## Status

Proposed for Product Owner decision and independent review. Not authorised for
implementation.

This record does not by itself approve a production deployment, a production
origin, a cloud region, or the processing of any real person's data. It decides
*what production readiness means for Centre Success, what the first release
contains, and in what order its gates close.* Several gates named here can only
be closed by named human owners; this record makes them explicit rather than
leaving them implied.

If accepted, this record supersedes the deferral in ADR-0008 for the **promotion
path and sequence only**. The production frontend origin, cloud region, account
ownership, and Entra production trust configuration remain operator decisions,
and are recorded here as gates rather than resolved. ADR-0009 remains deferred
and unchanged.

## Context

Every milestone acceptance recorded in `docs/MVP_BUILD_PLAN.md` carries the same
sentence, deliberately and correctly: *acceptance is an implementation acceptance
only and does not make Centre Success production-ready.* Six module groups are
accepted and merged on `main` — foundation and authorisation, Entra
authentication, People & Access with invitations, the quarterly review to
corrective-action slice, Daily Success, and Centre Quality & Performance —
together with hosted Foundation CI, migrations 001–019, and a committed generated
client.

Further work is in flight and not on `main`: the Centre Standards execution
engine and the Area Manager template and form builder, carrying migrations
020–025 and the `centre-standards` and `operational-templates` modules across
several worktrees. That work has passed a local implementation gate but has no
independent review or Product Owner acceptance, and at the time of writing it is
mid-stabilisation. This record does not gate it, delay it, or judge it. It is
described here only because a production boundary must state what it excludes and
why.

The remaining distance to a system real staff use is mostly not feature work. It
is environment, identity, evidence, and content. `docs/SECURITY.md` closes with
nine open decisions, none of which are code. ADR-0008 defers production CORS,
environment promotion, and security operations. ADR-0009 defers break-glass.

Four facts about the current codebase matter more than the open decisions,
because they are structural rather than administrative:

1. **There is no production path to a first administrator.** Both
   `foundation/authentication/local-first-administrator-bootstrap.ts` and
   `foundation/authentication/local-identity-linker.ts` assert an exact local
   development environment and throw otherwise. A deployed production database
   would contain no principal, no assignment, and no external-identity mapping,
   and no API exists to create the first one. Production is not merely
   unapproved; it is currently unreachable by design.
2. **No secret is required to be configured for production.**
   `.github/scripts/secret-configuration-guard.mjs` requires configuration only
   for `development` and `preview`, with one exact `staging` exception for the
   Graph client secret. A production deploy would fail at start-up.
3. **No production origin is committed.** `encore.app` permits credentialed
   browser calls from exactly two origins, both non-production.
4. **Evidence already accepts photographs.**
   `foundation/quarterly-reviews/evidence.ts` writes to an Encore Object Storage
   bucket and admits `image/jpeg`, `image/png`, and `application/pdf`. This is
   the most privacy-sensitive path in the accepted system and is addressed in
   D11.

The first three are not defects. They are the accumulated effect of the project's
governance working as intended: nothing acquires a production capability as a
side effect of being built. But they mean production readiness cannot be declared
incrementally as modules land. It is its own body of work, and this record scopes
it.

## Decision

### D1 — Production readiness is a property of a named release boundary

Centre Success is not declared production-ready as a repository. A specific,
enumerated set of capabilities is declared ready for a specific population of
users at a specific set of centres. Anything outside that boundary remains
non-production regardless of its implementation-acceptance status.

This mirrors how every milestone has been governed and prevents the failure mode
where an accepted module is assumed live because the system as a whole went live.

### D2 — Release Boundary P1

The first production release boundary, **P1**, is the accepted contents of `main`
at migrations 001–019:

- the foundation, effective-dated hierarchy, and PostgreSQL-owned authorisation;
- Microsoft Entra ID single-tenant authentication under ADR-0012;
- People & Access, including invitations and the acceptance boundary;
- quarterly reviews, findings, corrective actions, evidence, and independent
  verification (Milestone 2B);
- Daily Success as a live read-only projection (ADR-0015);
- Centre Quality & Performance as a read-side projection (ADR-0017); and
- authorised navigation.

P1 explicitly **excludes**, and no P1 gate may be read as authorising:

- Centre Standards and the Area Manager template and form builder, with
  migrations 020–025 — in flight, not accepted, and addressed by D14;
- break-glass, impersonation, and support view-as, deferred under ADR-0009;
- budget, coaching, QIP, wellbeing, AI, Centre Health, and the executive command
  view — every Milestone 6 module;
- exports with manifests, recognition, and automated access review — the
  remainder of Milestone 5;
- any notification or escalation subsystem, per D10;
- multi-organisation active-context selection beyond the existing server-side
  zero/one/multiple rules; and
- automated employee provisioning, HR synchronisation, and Entra-owned business
  authorisation.

P1 holds staff identity, centre operational records, audit responses, corrective
actions, and evidence. It holds no enrolment, attendance, billing, payroll, or
child record. It does not deliberately collect information about a child — but
see D11, which corrects the naive form of that claim.

### D3 — Environment topology and a one-directional promotion path

Five environments with distinct data and secrets: `local`, `development`,
`preview` (per pull request), `staging`, and `production`.

Promotion is one-directional and gated. A commit reaches production only by
explicit human action, only from `main`, and only after that exact commit has run
green in staging. No branch deploys to production automatically, and no
deployment workflow publishes from an unreviewed branch — preserving the
constraint ADR-0008 already sets.

Data moves downward only. Production data is never copied into a lower
environment without an approved minimisation process, and lower environments
never hold production secrets.

### D4 — Production is unreachable until its gates close, by configuration

The current unreachability described in Context is retained as a deliberate
control, not removed as an obstacle.

The secret-configuration guard gains `production` in its required environment
types only as part of the authorised P1 work, so an attempt to deploy production
before its secrets exist fails a pull-request check rather than a deploy log —
the failure mode that guard was written for after Milestones 2A and 2C each hit
it. The production browser origin remains absent from `encore.app` until the
exact origin is approved, then is added as an exact origin with no wildcard and
no cross-origin cookie authentication.

### D5 — The first administrator is created by a separate production ceremony

**The local guards are not relaxed.** `local-first-administrator-bootstrap.ts`
and `local-identity-linker.ts` continue to refuse every non-local environment,
and no P1 work weakens that assertion. Widening an existing local-only path to
accept production would make the most privileged operation in the system
reachable from the environment with the least supervision.

Production receives its own reviewed, single-use ceremony:

- invoked by an operator out-of-band, in the manner of `encore exec`, exposing no
  API and reachable from no browser;
- **refuses to run if any principal already exists**, so it is a bootstrap and
  never a recovery or escalation tool;
- takes the first administrator's Entra `tid + oid` as explicit operator input,
  supplied out-of-band; it discovers nobody and trusts no claim from a request;
- creates exactly one canonical System Administrator assignment and exactly one
  external-identity mapping, reusing the canonical role template under ADR-0006;
- writes append-only audit events explicitly marked as a production bootstrap,
  carrying no credential and no Entra identifier beyond what the existing
  minimised mapping event already records; and
- is exercised end-to-end in staging, against a staging Entra identity, before it
  is ever run in production.

That the resulting System Administrator holds no business-content capability is
retained from ADR-0009 and is what makes this ceremony safe to run at all.

### D6 — Readiness is declared only from positive evidence

The product invariant that governs Centre Quality & Performance governs the
release process itself: **readiness may be asserted only where every criterion
was positively checked and passed. Unverified is not ready, and an absent result
is never a pass.**

A P1 readiness declaration lists each criterion with the evidence that closed it
and the date it was produced. A criterion that was not exercised is recorded as
not exercised. No criterion is inferred from the success of another, and green CI
is not evidence for anything CI does not run.

### D7 — Real-data invariants that only production can test

Four properties are cheap to hold in staging and consequential in production.
Each is a P1 release criterion with its own evidence:

1. **Unknown is not zero, under real partial coverage.** With real sources
   occasionally unavailable, a partial-coverage state stops being cosmetic and
   becomes the difference between "no open critical actions" and "we could not
   check". Evidence is a deliberately induced source failure with real-shaped
   data, showing no fabricated zero and no all-clear.
2. **Synthetic content cannot reach production.** Development seeds and staging
   fixtures must have a proven-closed path to production, not merely an absent
   one.
3. **No personal data in logs, traces, or metrics.** Verified by sampling live
   telemetry with real-shaped records, not by asserting the policy.
4. **Restore proves integrity, not just recovery** — organisation and centre
   scope integrity, evidence linkage including objects, audit history continuity,
   and database/object consistency.

### D8 — A single-centre pilot is a required stage, not an optional one

P1 releases first to one centre, with named users, a bounded duration, defined
exit criteria, and a rollback that has been rehearsed rather than described.

Release beyond that centre is a separate Product Owner decision informed by the
pilot, not an automatic consequence of the pilot ending. The pilot exists to
discover the failures no test can produce: the tablet that lives in the office,
the part of the centre with no signal, the Director who reads a label differently
than its author intended.

### D9 — Gates that engineering cannot close

The following are owner decisions or professional judgements, named so that no
engineering plan can appear complete while they are open, and so that no
automated agent — including the one that drafted this record — is treated as
having closed them:

- **Entra production trust:** app registration, redirect URIs, and administrator
  consent in the Bright Steps tenant. Consent is a Global Administrator action.
- **Production secrets:** all seven declared secrets, configured for production
  by an authorised operator. Values appear in no document, log, or commit.
- **Cloud region, account ownership, and subprocessors,** with data residency
  confirmed — see D12.
- **Privacy:** the data inventory and privacy impact assessment required by
  `docs/SECURITY.md` before real collection, signed off by qualified owners, and
  explicitly covering the evidence path in D11.
- **Incident owners:** named privacy, security, child-safety, and operational
  owners who receive alerts and can act.
- **Audit thresholds and score bands.** The intended model deducts from 100% with
  an expected result near 80% and escalation below roughly 70%. Those numbers
  decide when a centre is judged to require intervention. They are approved
  business configuration, versioned as governed application data under the rule
  `docs/SECURITY.md` already sets — never hard-coded, and never chosen by
  engineering because a test needed a value.
- **Standards and regulatory content:** what a check asserts and what it maps to.

The last two are the load-bearing ones. Centre Success may hold, schedule,
evidence, escalate, and score a standard. It may not be the authority on what the
standard *is*, or on where the line between acceptable and unacceptable falls. A
generated requirement or an engineering-chosen threshold produces a system that
states a centre is meeting an obligation, confidently and in good visual order,
without anyone qualified having decided that it does. That is a worse outcome
than having no system, and no delivery pressure justifies it.

### D10 — What P1 accepts going live without

P1 ships **without break-glass**. ADR-0009 stays deferred and the operational
consequence is accepted explicitly rather than discovered later: when a user
cannot see what they expect, an administrator corrects their access and cannot
read their business content to diagnose it. Support is performed by fixing
grants, restoring data, and reading audit events — never by becoming the user.

P1 ships **without notifications or escalation**. There is no notification module,
and exactly one scheduled job exists — `peopleInvitationOutboxCron` in
`foundation/people-access/outbox.ts`, which drives invitation delivery only. An
overdue corrective action therefore notifies nobody; accountability depends
entirely on someone opening Daily Success. That is acceptable for one pilot
centre with engaged users and a daily rhythm. It must not be carried silently
into a wider release, where "nobody looked" becomes indistinguishable from
"nothing was wrong" — the same failure the unknown-is-not-zero rule exists to
prevent, arriving through absence of attention rather than absence of data.

P1 also ships without exports, without automated access review, and without
step-up authentication for high-risk actions. Each remains a separate gate.

### D11 — Evidence is P1's most sensitive path, and photographs are not neutral

Corrective-action evidence writes to an Encore Object Storage bucket and admits
`image/jpeg` and `image/png` as well as `application/pdf`. A Centre Director
proving that a hazard was remediated will photograph a physical space — a sleep
room, a nappy-change area, a playground, a kitchen. **Those photographs may
incidentally contain a child.**

P1 therefore cannot honestly claim to process no information about a child while
leaving that path open and unconsidered. One of the following is decided before
any real evidence is uploaded:

- **(a)** P1 evidence is restricted to `application/pdf` and text, removing image
  upload from the first release; or
- **(b)** image evidence is retained under an explicit control set: guidance at
  the point of upload directing that images capture the remediated condition and
  not children, private-by-default object access with no public URL, a retention
  and deletion schedule for evidence objects, and a privacy impact assessment
  that addresses incidental imagery of children by name.

**(b) is recommended.** Photographic proof is the most convincing evidence that a
physical hazard was actually fixed, and removing it weakens precisely the loop
this product exists to close. But it must be a decided position with controls,
not an inherited default nobody examined. The choice belongs to the privacy owner
and the Product Owner, not to engineering.

Either way, evidence objects are in scope for backup, restore, retention, and
access control at the same standard as the database, and the restore test in D7
must prove object linkage rather than rows alone.

### D12 — Scale, jurisdiction, and residency

P1 is sized for the real organisation, not for a demonstration:

- **Twenty centres** across at least New South Wales and Victoria. Load,
  query-budget, and resilience evidence is produced at twenty centres with
  realistic accumulated history, not at one.
- **More than one state regulator.** A standard or control may apply to a subset
  of centres. The existing centre-assignment model already permits this; no
  jurisdiction is hard-coded, and no requirement is presumed national.
- **Australian data residency is the working expectation** for staff personal
  data and evidence, to be confirmed by the privacy owner. Engineering states the
  requirement and configures the region; it does not decide the obligation.

### D13 — P1 has no Educator-facing surface, and that is deliberate

Quarterly reviews are Area Manager work. Corrective actions are Centre Director
work. Daily Success in P1 carries no Educator perspective, and ADR-0018
explicitly leaves an Educator Daily Success perspective to a separate decision.

The consequence must be stated plainly rather than discovered at the pilot: **P1
is a Centre Director, Area Manager, and Compliance release.** The Educator
experience — the simple "tap the check, answer, submit" surface the product is
ultimately for — arrives with Centre Standards, in the boundary after this one.

The pilot population is therefore Centre Director and Area Manager. P1 must not
be described internally as Centre Success going live for centres, because to an
Educator nothing will have changed.

### D14 — Centre Standards and the form builder form the next boundary, P2

The in-flight Centre Standards engine and Area Manager form builder — the latter
authorised under ADR-0020 — are excluded from P1 for sequencing reasons, not
quality ones. They have no independent review
or acceptance yet, and shipping them inside the first production release would
place a module's first real-data exposure and the system's first production
exposure on the same day, where neither failure is diagnosable from the other.

They form the next boundary, **P2**, whose readiness inherits every closed P1
gate — environment, identity, backup, alerting, privacy — and adds only what is
genuinely new: the Educator surface, the template lifecycle and its immutable
published versions, schedule revisions, occurrence generation, and the
configurable remediation rules that turn an answer into a finding. That
inheritance is the return on doing P1 as a bounded boundary rather than as a
single large launch.

Nothing in this record delays P2 development. P1 and P2 proceed in parallel.

## What would unblock this

- Product Owner acceptance of the P1 boundary in D2, including its exclusions and
  the honest consequence in D13.
- A decision on D11, image evidence, before any real evidence is uploaded.
- A decision on production invitation email, which P1 currently depends on and
  ADR-0016 authorises for staging only.
- Independent review of this record, and of the production ceremony in D5 before
  it is implemented.
- The owner decisions in D9, each with a named owner and a date.
- Authorisation to begin the sequenced work in
  `docs/PRODUCTION_READINESS_PLAN.md`, which is the delivery expression of this
  record and carries no authority of its own.

## Consequences

Production readiness becomes a bounded, evidenced body of work with an explicit
scope rather than an open-ended condition the system drifts toward. The cost is
that P1 excludes capabilities that are nearly built, and that the first
production release will not be visible to an Educator at all. That will feel like
an anticlimax, and it is the correct trade: the Directors and Area Managers who
carry accountability get a real system, and the Educator surface arrives on a
platform whose backups, alerts, and identity path have already been proven under
real load.

Keeping the local bootstrap guards intact costs one purpose-built production
ceremony that will be used approximately once. That is the correct price for not
having the most privileged operation in the system reachable from a developer's
laptop configuration.

Declaring readiness only from positive evidence will make the first declaration
slower and will surface criteria nobody has evidence for. That is the intended
behaviour, and it is the same rule the product already applies to the people who
depend on it.
