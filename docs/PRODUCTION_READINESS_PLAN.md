# Production Readiness Plan — Release Boundary P1

**Status:** Draft for Product Owner decision. This plan carries no authority of
its own. [ADR-0021](adr/0021-production-readiness-and-first-release-boundary.md)
governs; where the two differ, the ADR is normative.

This is the delivery expression of ADR-0021. It sequences the work standing
between the current accepted implementation and a system real staff use at a real
centre, and it separates that work honestly into three kinds: what engineering
can deliver, what only an authorised operator can do, and what requires a
qualified professional's judgement.

**P1 is the accepted contents of `main` at migrations 001–019** — foundation,
authentication, People & Access, the quarterly review to corrective-action loop,
Daily Success, and Centre Quality & Performance. Centre Standards and the Area
Manager form builder are **P2** and proceed in parallel; nothing here delays
them.

**P1 is a Centre Director, Area Manager, and Compliance release.** Per ADR-0021
D13 it carries no Educator surface. That shapes the pilot and how the release is
described internally.

---

## How to read this plan

Work is grouped into **stages**. Each states its goal, what engineering delivers,
what an owner must do, the **evidence** that closes it, and the **gate** it opens.
A stage closes only when its evidence exists — per ADR-0021 D6 an unexercised
criterion is recorded as unexercised, never inferred from a neighbouring pass.

Stages are not strictly serial. Dependencies are stated per stage; the sequencing
notes at the end identify what runs in parallel and what is long-pole.

---

## Who can do what

This split is not a disclaimer. It determines the critical path.

| Capability | Engineering (including an AI agent) | Authorised operator | Qualified professional |
| --- | --- | --- | --- |
| Write code, migrations, tests, runbooks, ceremony tooling | ✅ | | |
| Configure environments, CI, promotion workflow | ✅ | ✅ approves | |
| Entra app registration and redirect URIs | drafts exact values | ✅ performs | |
| **Entra administrator consent** | | ✅ **only** | |
| **Production secret values** | names and validates presence | ✅ **only** | |
| Cloud region, residency, subprocessors | states the requirement | ✅ decides | ✅ confirms obligation |
| Run the production first-administrator ceremony | builds and proves it in staging | ✅ **only** | |
| Data inventory and privacy impact assessment | supplies the field inventory | ✅ commissions | ✅ **signs off** |
| **Image evidence decision (ADR-0021 D11)** | states the exposure and controls | ✅ decides | ✅ **assesses** |
| Retention, deletion, and legal-hold schedule | implements | ✅ approves | ✅ **defines** |
| Incident owners and notification decisions | builds detection and evidence | ✅ names owners | ✅ **decides notification** |
| **Audit thresholds and score bands** | implements as versioned configuration | ✅ **approves the numbers** | |
| **What a standard asserts and what it maps to** | | | ✅ **only** |
| Penetration test | remediates findings | ✅ commissions | ✅ performs |
| Pilot observation and go/no-go | supplies evidence | ✅ decides | |

The rows marked **only** with no engineering column are hard boundaries.
Administrator consent and production secret entry are performed by a person in
the Bright Steps tenant. Score bands and regulatory content are decided by people
whose judgement carries them. None of these is a process obstacle to route
around, and none may be closed by an automated agent.

---

## Stage 0 — Decisions that precede engineering

**Goal:** close the owner decisions in ADR-0021 D9 so later stages are not built
against assumptions.

**Owner actions**

- Accept or amend the P1 boundary, including its exclusions and the D13
  consequence that Educators see nothing in P1.
- Decide **image evidence** (ADR-0021 D11) — restrict P1 evidence to PDF and
  text, or retain images under the named control set. Nothing real is uploaded
  until this is decided.
- Name the cloud region and confirm **Australian data residency**, account
  ownership, and approved subprocessors.
- Commission the data inventory and privacy impact assessment, explicitly
  covering staff identity, centre operational records, audit evidence including
  incidental imagery of children, and invitation email delivery.
- Confirm the retention and deletion schedule, including audit-log retention and
  **evidence object retention**.
- Name incident owners: privacy, security, child-safety, operational.
- **Approve the audit score bands** — the deduction model, the expected result,
  and the escalation threshold. These decide when a centre is judged to require
  intervention and must be approved business configuration, never an engineering
  default.
- Name the authority for standards and regulatory content.
- **Decide production invitation email** — see the conflict below.

**A sequencing conflict to resolve here.** P1 includes People & Access
invitations, delivered by email through `peopleInvitationOutboxCron`. ADR-0016
authorises Graph email delivery for the exact `staging` environment only, behind
a fixed mailbox; production email enablement, provider, sender identity, and
template operations are explicitly deferred. P1 cannot ship as scoped unless one
of these is chosen:

1. authorise production email as part of P1, requiring its own provider, mailbox,
   sender identity, and template decision;
2. ship P1 with invitations issued through a reviewed operator-mediated path,
   accepting the manual cost for a single pilot centre; or
3. narrow P1 to exclude invitations, provisioning pilot users through a bounded
   extension of the production ceremony.

Option 2 is the smallest change for a single-centre pilot and keeps the email
gate intact. It is a Product Owner choice, not an engineering one.

**Evidence:** a decision record per item, each with a named owner and date.
**Gate:** opens Stages 2, 3, 4 and 7. Stages 1 and 5 may begin before it closes.

---

## Stage 1 — Environments and the promotion path

**Goal:** a production environment exists, is reachable only through a gated
promotion, and refuses to start misconfigured.

**Engineering delivers**

- The `production` environment in Encore Cloud, in the approved region.
- `production` added to `REQUIRED_ENVIRONMENT_TYPES` in
  `.github/scripts/secret-configuration-guard.mjs`, so a missing production
  secret fails a pull request rather than a deploy log — the exact failure that
  guard was written for after Milestones 2A and 2C each hit it.
- The exact approved production frontend origin in `encore.app` under
  `allow_origins_with_credentials`. No wildcard, no cookie-credential mode.
- A promotion workflow: `main` → staging on green CI → production **only** by
  explicit human action, from a commit already green in staging.
- Branch protection on `main`, restricted environment and deployment permissions,
  and a documented rollback to the previous production release.
- The **evidence Object Storage bucket** provisioned for production as
  private-by-default, with no public URL and no anonymous read.

**Operator must:** approve the production origin; configure all seven declared
secrets for production — `EntraTenantId`, `EntraApiClientId`, `EntraWebClientId`,
`InvitationTokenDigestKey`, `InvitationDeliveryEncryptionKey`,
`InvitationPublicBaseUrl`, and, subject to the Stage 0 email decision,
`MicrosoftGraphClientSecret`.

**Evidence:** a production deploy that starts clean and serves the health route;
the secret guard failing correctly on a deliberately removed secret; a rehearsed
rollback; migrations 001–019 applied in production with `dirty = false`; the
evidence bucket proven non-public.

**Gate:** opens Stage 2.

---

## Stage 2 — Production identity and the first administrator

**Goal:** exactly one System Administrator exists in production, created by a
reviewed ceremony, with the local guards intact.

This stage has no current implementation at all, and most needs independent
review before it is written.

**Engineering delivers**

- The production bootstrap ceremony specified in ADR-0021 D5: operator-invoked,
  no API surface, refuses to run if any principal exists, takes the first
  administrator's Entra `tid + oid` as explicit out-of-band input, creates one
  canonical System Administrator assignment and one external-identity mapping,
  and writes append-only bootstrap-sourced audit events carrying no credential.
- Tests proving it refuses a second run, refuses a populated database, and
  refuses to accept identity from a request rather than from the operator.
- **No change** to `local-first-administrator-bootstrap.ts` or
  `local-identity-linker.ts` beyond shared extraction; their non-local refusal is
  preserved and covered by a test that fails if it is weakened.
- A staging rehearsal against a staging Entra identity.

**Operator must:** complete the production Entra app registration and redirect
URIs; **grant administrator consent in the Bright Steps tenant**; supply the first
administrator's `tid + oid`; run the ceremony.

**Evidence:** the staging rehearsal; the production run producing exactly one
assignment and one mapping; audit events present and correctly minimised; a
second invocation refused; that administrator signing in and — per ADR-0009 —
being unable to read business content.

**Gate:** opens Stages 3 and 7. Production is now administrable.

---

## Stage 3 — Data protection under real data

**Goal:** the invariants in ADR-0021 D7 and D11 hold against real-shaped records,
proven rather than asserted.

**Engineering delivers**

- An induced source-failure exercise with real-shaped data, showing Daily Success
  and Centre Quality & Performance render partial coverage and no fabricated
  zero, all-clear, or steady state.
- Proof that the synthetic path to production is closed: development seeds and
  staging fixtures cannot execute against production, and no synthetic marker
  originating in a lower environment can appear in production data.
- A live telemetry sample under real-shaped load confirming no personal data,
  token, evidence body, or high-cardinality centre or user label in logs, traces,
  or metrics.
- **Evidence-path controls per the Stage 0 D11 decision** — either media types
  restricted to PDF and text, or upload guidance, private object access, and
  evidence retention implemented. Verified by attempting a disallowed upload and
  by confirming no object is reachable without authorisation.
- Retention and deletion implemented to the Stage 0 schedule, for both database
  records and evidence objects.

**Evidence:** each exercise recorded with date, inputs, and observed output. The
unknown-is-not-zero exercise is recorded as a named scenario, not as a passing
test suite.

**Gate:** contributes to Stage 9.

---

## Stage 4 — Resilience, scale, and proven restore

**Goal:** the system can be recovered, the recovery preserves what makes it
trustworthy, and it performs at the real organisation's size.

**Engineering delivers**

- Confirmed Encore Cloud PostgreSQL backup configuration, point-in-time recovery
  window, and regional behaviour — **and the equivalent for the evidence Object
  Storage bucket**, which is not covered by database backup.
- A **restore test into an isolated environment** proving organisation and centre
  scope integrity, evidence linkage from row to stored object, continuous audit
  history, and database/object consistency. A restore that recovers rows but
  orphans evidence objects is a failed restore.
- **Scale evidence at twenty centres** across NSW and Victoria with realistic
  accumulated history — query budgets held, Daily Success and Centre Quality
  projections within their established operation counts, and no
  centre-count-dependent regression.
- Idempotent scheduled work, bounded retries, dead-letter handling, and
  reconciliation for the invitation outbox — the one cron job in production.
- Verified safe degradation: high-priority operational records remain
  discoverable when downstream notification or integration fails.

**Operator must:** approve recovery objectives per workflow — how much data loss
and downtime is acceptable, workflow by workflow. These are business decisions
and they determine the backup configuration, not the reverse.

**Evidence:** a dated restore report naming what was restored, how long it took,
and each integrity property verified; a scale report at twenty centres.

**Gate:** contributes to Stage 9. Long-pole — start early.

---

## Stage 5 — Observability, alerting, runbooks and on-call

**Goal:** a failure is detected by the system rather than reported by a Director.

This stage carries extra weight in P1 because, per ADR-0021 D10, there is **no
notification subsystem**. Nothing tells a Director their corrective action is
overdue. Operational alerting is the only automated attention in the release.

**Engineering delivers**

- Alerts on the categories `docs/SECURITY.md` names: error rates, suspicious
  denials, authentication changes, job backlog, integration failure — each routed
  to a named owner from Stage 0.
- **Invitation outbox backlog alerting specifically**, since that cron job is the
  only scheduled work in production and its silent failure looks identical to
  nobody being invited.
- Runbooks for the failures this system can actually have: Entra outage or token
  rejection, invitation delivery failure and outbox backlog, a migration failing
  mid-deploy, an authorisation defect, evidence object unavailability, and
  restore-from-backup.
- A production health and readiness signal distinct from the public health route.
- An on-call expectation: who is called, in what window, and what they do.

**Evidence:** one deliberately triggered alert per category reaching its owner;
one runbook rehearsed end-to-end.

**Gate:** contributes to Stage 9. May begin immediately, in parallel with Stage 1.

---

## Stage 6 — Security assurance

**Goal:** an independent party has tried to break it.

**Engineering delivers:** remediation of findings, tracked to closure with the
severity discipline the quality gates already apply — no critical or high issue
unresolved at release. Scope should include the authorisation boundary, the
evidence object path, and the invitation acceptance flow.

**Operator must:** commission the assessment; approve the assurance standard,
penetration-test cadence, and vulnerability SLAs left open in `docs/SECURITY.md`.

**Evidence:** the report, and the remediation record for every critical and high
finding.

**Gate:** contributes to Stage 9. Long lead time to commission — start at Stage 0.

---

## Stage 7 — Real content and real data

**Goal:** the system contains the business's actual centres, people, roles, and
approved thresholds.

**Engineering delivers**

- Reviewed import or provisioning tooling for organisation, centres, hierarchy,
  and effective-dated assignments — idempotent, attributable, and validated
  against the same authorisation rules as any other write.
- A dry-run mode reporting what would change without changing it.
- The approved audit score bands loaded as **versioned governed configuration**,
  not as constants, so a later change is attributable and historical results
  remain interpretable under the bands in force when they were produced.
- Authoring support for review content, so a qualified person can enter and
  version it without engineering involvement.

**Owner and professional must:** supply the authoritative centre and hierarchy
data; decide each person's role; approve the score bands; and **author the review
content** — what is assessed, how it is worded, and what it maps to. Per ADR-0021
D9 this cannot be generated, inferred, or drafted from a public framework by an
automated agent.

**Evidence:** a dry run reviewed and approved before the real import; the import
producing expected records with correct attribution; the loaded score bands
matching the approved numbers exactly; a spot check by the content author
confirming the content says what they intended.

**Gate:** opens Stage 8.

---

## Stage 8 — Single-centre pilot

**Goal:** find the failures no test produces.

**Population:** one centre. **Centre Director and Area Manager** — per ADR-0021
D13 there is no Educator surface in P1, and involving Educators would test
nothing while implying the system is live for them.

**Engineering delivers:** daily observation, defect triage, and a rehearsed
rollback returning the centre to its previous way of working without data loss.

**Exit criteria, agreed before the pilot starts**

- The Director completes their real accountability work in the system without a
  parallel spreadsheet.
- The Area Manager completes a real quarterly review, and a resulting corrective
  action reaches verified closure with real evidence.
- No critical defect open; no unresolved data-integrity concern.
- Every alert that fired was actionable, and every one that should have fired did.
- **The absence of notifications did not cause a missed action** — or, if it did,
  that is recorded as a finding gating wider release.
- The Director-facing language survived contact with someone who did not write it.
- The team is willing to run the second centre.

**Evidence:** a pilot report against each exit criterion, including defects found
and what they changed.

**Gate:** opens Stage 9.

---

## Stage 9 — Production release decision

Not an engineering step. The Product Owner reviews the readiness register and
decides whether P1 releases beyond the pilot centre. Per ADR-0021 D8 this is a
distinct decision, not an automatic consequence of the pilot ending.

A likely output is that **notifications become a P1.1 requirement** before a
twenty-centre release, since the pilot's engaged daily rhythm will not generalise.

---

## Readiness register

The artefact that closes P1. Every row carries evidence and a date, or is
recorded as not exercised. Nothing is inferred.

| # | Criterion | Stage | Evidence | Date | State |
| --- | --- | --- | --- | --- | --- |
| 1 | P1 boundary accepted, including D13 consequence | 0 | | | |
| 2 | Image-evidence decision made (D11) | 0 | | | |
| 3 | Privacy assessment signed off, covering incidental imagery | 0 | | | |
| 4 | Residency and region confirmed | 0 | | | |
| 5 | Retention schedule approved, records and objects | 0 | | | |
| 6 | Incident owners named | 0 | | | |
| 7 | Audit score bands approved | 0 | | | |
| 8 | Standards content authority named | 0 | | | |
| 9 | Production email decision made | 0 | | | |
| 10 | Production environment deploys clean | 1 | | | |
| 11 | Secret guard covers production | 1 | | | |
| 12 | Production origin exact, no wildcard | 1 | | | |
| 13 | Evidence bucket private, no anonymous read | 1 | | | |
| 14 | Promotion gated, rollback rehearsed | 1 | | | |
| 15 | Migrations 001–019 applied, `dirty = false` | 1 | | | |
| 16 | Entra consent granted | 2 | | | |
| 17 | Ceremony rehearsed in staging | 2 | | | |
| 18 | First administrator created, second run refused | 2 | | | |
| 19 | Local bootstrap guards intact | 2 | | | |
| 20 | Unknown-is-not-zero holds under induced failure | 3 | | | |
| 21 | Synthetic path to production proven closed | 3 | | | |
| 22 | No personal data in live telemetry | 3 | | | |
| 23 | Evidence controls implemented and verified | 3 | | | |
| 24 | Retention implemented | 3 | | | |
| 25 | Recovery objectives approved | 4 | | | |
| 26 | Restore proves scope, evidence objects, audit, consistency | 4 | | | |
| 27 | Scale evidence at twenty centres | 4 | | | |
| 28 | Degradation verified | 4 | | | |
| 29 | Alerts reach named owners | 5 | | | |
| 30 | Outbox backlog alerting proven | 5 | | | |
| 31 | Runbook rehearsed | 5 | | | |
| 32 | On-call defined | 5 | | | |
| 33 | Security assessment complete | 6 | | | |
| 34 | Critical and high findings closed | 6 | | | |
| 35 | Centre and hierarchy data imported and verified | 7 | | | |
| 36 | Score bands loaded as versioned configuration | 7 | | | |
| 37 | Review content authored and confirmed | 7 | | | |
| 38 | Pilot exit criteria met | 8 | | | |

---

## Sequencing

**Start immediately, in parallel:** Stage 0 decisions, Stage 1 environment work,
Stage 5 observability. None depends on the others.

**Commission early, because lead time dominates:** the security assessment
(Stage 6) and the privacy assessment (Stage 0). Both are external and neither
compresses.

**Critical path:** Stage 0 email and evidence decisions → Stage 1 → Stage 2
(blocked on Entra consent) → Stage 7 (blocked on content and score bands) →
Stage 8 pilot.

**The three most likely sources of delay are not engineering.** They are
administrator consent in the tenant, approval of the audit score bands, and the
authoring of review content by the person qualified to write it. All three should
start before the code that depends on them.

**P2 runs in parallel throughout.** Centre Standards and the form builder
continue on their own branches and their own review cycle. Every gate closed here
— environment, identity, backup, alerting, privacy, residency — is inherited by
P2 rather than repeated, which is the return on treating production readiness as
a bounded boundary instead of a single large launch.

---

## Explicitly out of scope

Per ADR-0021 D2 and D10, and not implied by any gate here: Centre Standards and
the form builder (P2); break-glass and impersonation; notifications and
escalation; budget, coaching, QIP, wellbeing, AI, Centre Health, and the
executive command view; exports; automated access review; step-up authentication;
multi-organisation context selection; and HR or directory provisioning.

Each is a separate decision with its own record.
