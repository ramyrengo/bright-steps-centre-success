# MVP Build Plan

## Delivery status and stop gate

**Milestone 0 — architecture documentation: complete and approved.**

**Milestone 1 — Centre Success foundation: accepted / complete.** The Product Owner formally accepted Milestone 1 after pull request #1 was merged into `main` and the Foundation CI and local quality gates passed. The Encore application and Cloud connection were preserved.

**Milestone 2 — accepted / complete under controlled sub-milestone gates.** Milestones 2A, 2B, and **Milestone 2C — People & Access + User Invitations** are **ACCEPTED / COMPLETE**.

**Milestone 3 — started under controlled sub-milestone gates. Milestone 3A — Daily Success is ACCEPTED / COMPLETE. Milestone 3B and later work remain locked, except for the narrow Centre Quality & Performance product slice authorised on 12 August 2026 under ADR-0017.**

**Milestone 4 — Centre Standards Milestone 4A has PASSED ITS LOCAL IMPLEMENTATION GATE at integration commit `1bf06b7`.** The recorded local evidence is: frontend tests 280/280 passed; frontend typecheck passed; frontend production build passed; migrations 020–022 passed; Encore/PostgreSQL database-backed integration tests passed; the Centre Standards query-budget gate passed; and the integration worktree was clean. This is local implementation evidence only. It is not hosted CI, a deployment, production acceptance, or a production-readiness decision, and no independent review or Product Owner acceptance of the 4A implementation is recorded. **Exactly one next product slice is authorised by the Product Owner on 13 August 2026: Area Manager Template & Form Builder, under ADR-0020, with no milestone number assigned or implied.** Milestones 4B, 4C and 4D are LOCKED. Milestones 5 and 6 and Composite Centre Health remain LOCKED; ADR-0021 proposes a production-readiness boundary for independent review and authorises no implementation.

Milestone 3A acceptance evidence, recorded 12 August 2026, in sequence: implementation completed; first independent review **PASS WITH CHANGES**; acceptance remediation completed; targeted independent re-review **PASS**; the full local regression gate green (backend typecheck, 141 unit tests, 100 database-backed integration tests, 90 frontend tests, frontend lint/typecheck/production build, generated-client reproducibility, authentication scope guard, `git diff --check`); hosted Foundation CI green; Encore Build green; merged to `main` through pull request #6. Migrations remain 001–018 and Milestone 3A added none. Acceptance is an implementation acceptance only and does not make Centre Success production-ready.

Non-blocking follow-ups recorded at acceptance, deliberately not expanded into Milestone 3A: eligible verification items render in both the Area Manager **VERIFY TODAY** queue and their ordinary priority section; `WorkflowShell` still defaults to a fixed workspace navigation that may include destinations the current principal is not authorised for; the `daily-card__why` description list retains a grid display that drops its assistive-technology term/description mapping; `Cache-Control` is asserted against a fixture rather than a built response; mobile-layout behaviour has no automated evidence; and compliance/administration perspectives still share the centre layout below their summary.

## MVP objective

Deliver a secure, mobile-first Centre Director and Area Manager operating loop:

`daily priorities -> internal assurance/compliance task -> evidence -> finding -> corrective action -> verification -> QIP/recognition -> portfolio visibility`

The MVP should prove that Bright Steps can create consistent, explainable follow-through across centres with strong scope enforcement and an architecture that can later add coaching, budget, wellbeing, and AI safely.

## Proposed MVP scope

### Core MVP

- Organisation, state/region, centre, user membership, roles, assignments, and delegations.
- Authentication through an approved provider and Encore auth handler.
- Backend capability/resource-scope authorisation and audit events.
- Centre Director daily success view.
- Approved internal control/task schedules and evidence metadata/Object Storage.
- Findings and corrective actions with verification/escalation.
- Area Manager quarterly audit and spot-check template/version workflow.
- Internal scoring, critical flags, draft actions from failed items, and comparable-quarter view.
- NQS-aligned source references, self-assessment, strengths, and living QIP basics.
- Compliance Manager scoped exception view.
- Notifications and operational observability.

### Conditional MVP modules

Include only after business decisions, privacy/security review, and capacity validation:

- certification/expiry sync;
- simple budget approved/actual/forecast visibility;
- coaching cycles;
- Centre Health dimensions (prefer dimensions before one score);
- tightly scoped citation-based AI knowledge assistant.

### Post-MVP by default

- wellbeing pulse/support handling;
- advanced financial forecasting;
- broad system integrations beyond essential identity/master data/notification;
- autonomous or consequential AI actions;
- offline audit sync;
- data warehouse, public benchmarking, native mobile apps, and arbitrary custom workflow builder;
- service/database extraction without measured need.

## Approved foundation decisions and later gates

The product owner approved the canonical foundation role/scope baseline, one Encore service/database, an identity-provider-neutral principal, persisted and evolvable role templates, database-backed capability/scope authorization tests, a public health endpoint, the restricted local frontend origin, and a committed generated frontend client.

Milestone 2A approves Microsoft Entra ID in the single Bright Steps Australia tenant for authentication only. Two app registrations, MSAL Authorization Code with PKCE, a Centre Success API access token, strict OIDC/JWKS verification, `tid + oid` external-identity mapping, the central Encore auth handler, and PostgreSQL-owned authorisation form the gate. It does not approve Entra groups/app roles/claims as business authority, auto-provisioning, Microsoft Graph, business APIs, or a temporary bypass. MFA/recovery/Conditional Access/step-up, multi-organisation context selection, the authoritative organisation/portfolio source and propagation process, access review, privacy/retention, cloud production operations, and all business-module decisions remain gates before the affected capability or release.

## Delivery milestones

### Milestone 1 — secure foundation

**Goal:** Prove tenant and centre isolation before adding sensitive workflows.

Deliver organisation/hierarchy/centre identity, an identity-provider-neutral internal principal, memberships, data-driven role/scope assignments, pure and database-backed policy enforcement, audit-event foundation, environment strategy, and a minimal tested responsive shell. Keep one Encore business service and one PostgreSQL database. Runtime authentication and protected business APIs wait for provider approval; only the public health endpoint connects the shell to Encore in this milestone.

Exit evidence:

- concise architecture decision records for accepted foundation decisions;
- cross-organisation, cross-centre, ancestor/portfolio scope, effective-date, multi-role, ambiguity, deactivation, and System-Administrator-without-business-content tests;
- threat/privacy review and data classification;
- a non-deploying CI definition for quality/security checks, with the existing controlled Encore Cloud deployment path unchanged;
- observable public health request with safe logs/traces and no protected data;
- no business module can bypass the authorisation interface.

### Milestone 2 — controlled vertical-slice delivery

**Status:** Started.

#### Milestone 2A — Authentication Gate

**Status:** Accepted / complete. On 11 August 2026 the Product Owner completed the live local proof and observed `Welcome, Local System Administrator`, `Authentication: Connected`, and `Centre Success: Ready`. The real BSA chain succeeded from Microsoft sign-in and Centre Success API access-token acquisition through strict Encore validation, `tid + oid` mapping, the provider-neutral internal principal, active synthetic local organisation membership, PostgreSQL authorisation context, protected `/foundation/me`, and the provisioned application state. The linked Centre Success principal and organisation records are synthetic local-development data; this evidence is not a production provisioning workflow.

**Goal:** Establish trusted human identity before the first protected business endpoint is built.

Deliver single-tenant BSA Entra sign-in/sign-out in the existing Next.js application using MSAL Authorization Code with PKCE, an actual `/redirect` bridge and root post-logout destination; acquire only the delegated Centre Success API access token; validate rotating tenant OIDC/JWKS keys and the exact issuer/`tid`/API `aud`/Web-client `azp`/version/time/scope contract in one Encore auth handler; map `tid + oid` to the active internal principal; provide one minimal protected self-context endpoint that reloads database authorisation; retain one generated-client token adapter; provide the separately approved local-only synthetic first-administrator bootstrap plus the explicit local Entra mapping tool; add deterministic authentication/authorisation tests; and update the security decision and operating documentation.

Exit evidence includes missing/malformed/invalid/expired/not-yet-valid/wrong-issuer/wrong-tenant/wrong-client/wrong-audience/wrong-version/wrong-scope token denial; SPA/ID and Graph-like token rejection; controlled JWKS refresh and key-rotation proof; unmapped/inactive mapping and inactive-principal denial; zero membership returning only `not_provisioned`, exactly one membership loading server-selected context, and multiple failing closed; cross-organisation and expired-assignment denial after valid authentication; no client-selected identity or organisation; exact configured local authenticated CORS with the documented Encore local-development behaviour; accessible signed-out/loading/not-provisioned/denied/unavailable/signed-in states; a local-only first-administrator bootstrap that refuses every non-local environment, reuses the exact canonical technical role, remains duplicate-free and audited on repeat/concurrent runs, creates no real identity or HTTP surface, and enables the existing linker through backend authorisation; reproducible generated client; passing existing foundation checks; and a real local BSA Entra session/API access-token smoke test. CI uses test-only cryptographic material and no production Microsoft secret.

The final live proof closed the previously operator-dependent criteria: a real BSA Microsoft 365 login obtained a real access token for the Centre Success API; Encore validated it; the approved local `tid + oid` mapping resolved the synthetic internal principal and its one active local organisation; and protected `/foundation/me` returned the provisioned Local System Administrator projection. The earlier safe `Account not provisioned` state disappeared only after the reviewed local bootstrap and mapping workflow completed.

For this gate, zero current active organisations produce only the authenticated `not_provisioned` projection, exactly one is resolved server-side, and multiple fail closed. A multi-organisation selection/session experience is a later decision, not an implicit choice of the first membership.

#### Milestone 2B — Area Manager Audit to Corrective Action vertical slice

**Status:** **ACCEPTED / COMPLETE.** Formally accepted by the Product Owner on 11 August 2026. Acceptance evidence: implementation and acceptance remediation complete; independent re-review returned PASS with all required findings (H1, H2, M1, M3–M7) closed; 205 local tests passing; clean-database migrations through version 15; pull request #2 merged with hosted Foundation CI green; no critical findings, no authentication or authorisation regression, and no deferred-module scope creep. The known N+1 multi-centre authorisation behaviour is an explicitly accepted non-blocking follow-up that must be addressed before broad 20+ centre rollout. The accepted scope is the synthetic internal quarterly-review workflow from assigned-centre audit through scoring, findings, corrective action, Centre Director remediation/evidence, independent Area/Compliance verification, acknowledgement, positive practice, comparable-quarter support, and minimal Compliance Manager oversight.

**Goal:** Complete one assigned-centre quarterly review and follow every configured failed item to verified corrective-action closure without duplicate entry.

Deliver a versioned synthetic development template, pinned audit run, weighted/configurable internal scoring, critical risk override, immediate and finalisation-time findings/actions, private evidence with environment-safe availability, acknowledgement, recurrence/comparison support, and scoped operational views. No content is presented as an official regulatory assessment.

The 25-item Milestone 2B gate remains the acceptance target. Local evidence now includes assignment isolation, immutable version history, controlled response-correction withdrawal/reactivation, idempotent immediate/final findings, versioned score-band threshold interpretation, score/risk separation, database-enforced independent verification, private evidence controls, accessible mobile workflows, negative/concurrency regression checks, and no later business module. This wording records implementation evidence only; it does not pre-empt Product Owner acceptance. A hosted workflow run can be recorded after reviewed changes are committed and pushed; this repository update does not perform Git operations.

The 11 August 2026 acceptance-remediation gate passed locally on Node 24.16.0 and Encore 1.57.13: backend typecheck, 92 unit tests, 56 Encore/PostgreSQL integration tests, 57 frontend tests, frontend lint/typecheck/production build, generated-client byte comparison, both dependency audits, the authentication scope guard, and `git diff --check`. A fresh isolated Encore namespace applied every migration through version 15, served the health endpoint, and recorded `schema_migrations` version 15 with `dirty = false`; the temporary namespace was then removed. Independent review, hosted CI and Product Owner acceptance subsequently closed Milestone 2B.

#### Milestone 2C — People & Access + User Invitations

**Status:** **ACCEPTED / COMPLETE.** The Product Owner accepted Milestone 2C on 12 August 2026 after implementation, acceptance remediation, targeted independent re-review, and the final targeted acceptance check all passed. Pull request #4 passed hosted Foundation CI and the separately reported Encore Build, then merged to `main` as `09af2029ab8d261ec4d4e5a96ce7ce29b4f59e18`. Forward migrations 016–018, workflow APIs, the candidate-only acceptance boundary, PostgreSQL outbox/Pub/Sub delivery seam, last-reachable-administrator invariant, task-focused Next.js routes and deterministic tests are the accepted implementation. ADR-0016 later authorises a staging-only fixed-mailbox Graph adapter behind the accepted delivery seam. Its implementation is awaiting independent review, exact staging-secret configuration and deployment proof; Production email and the production first-administrator ceremony remain separately gated.

**Goal:** Allow an authorised System Administrator to invite a BSA employee, safely correlate verified Entra identity, and activate a reviewed PostgreSQL role/scope package without making Entra, email, or a pending proposal an authorisation source.

The approved architecture uses 72-hour one-time invitation generations, invitation-owned pending proposals outside active grant tables, `tid + oid` permanent identity, standard package activation after verified acceptance, independent second approval for privileged packages, multiple non-recombining assignments, effective-dated joiner/mover/leaver changes, a PostgreSQL outbox with Encore Pub/Sub delivery, and last-reachable-System-Administrator protection. Entra user assignment remains **No**; unmapped/uninvited identities remain `not_provisioned`; ADR-0016's staging invitation-email adapter adds no identity or business authority; and production first-administrator operations remain separately gated. See `docs/PEOPLE_AND_ACCESS.md`, ADR-0014 and ADR-0016.

Implementation evidence includes zero pending grants, one-time/resend/replay and concurrent-acceptance controls, exact-email correlation with guest/mismatch review, standard multi-centre activation, privileged independent approval, independent assignment scope enforcement, suspension/revocation, database-enforced last-administrator protection, append-only history, retryable idempotent notification delivery, and mobile-first task routes.

The 12 August 2026 implementation gate passed locally on Node 24.16.0 and Encore 1.57.13: backend/Encore typecheck, 100 unit tests, 68 Encore/PostgreSQL integration tests, 65 frontend tests, frontend lint/typecheck/production build, generated-client byte/hash comparison, backend and frontend dependency audits, the authentication scope guard, and `git diff --check`. An isolated fresh Encore namespace built the complete app graph, applied migrations 001–017, served health, and recorded schema version 17 with `dirty = false`. A separate representative pre-M2C administrator upgraded to System Administrator template v2 and remained reachable; migration 016 deliberately refused an unclassified legacy `inactive` principal. A deployment-style Encore linux/amd64 Docker export also completed. Temporary namespace, migration container and build image were removed. The later remediation, review, hosted checks, merge, and Product Owner acceptance closed the evidence gates that were outstanding at this implementation checkpoint.

The 12 August 2026 acceptance-remediation gate passed locally with the same pinned toolchain and unchanged 15-second test timeout: backend/Encore typecheck, 101 unit tests, 72 Encore/PostgreSQL integration tests, frontend tests (74 after the final in-dialog error acceptance fix), frontend lint/typecheck/production build, byte-identical generated client, zero backend/frontend dependency vulnerabilities, authentication scope guard and `git diff --check`. The formerly timing-out M2B stable-lineage recurrence test completed in 181–490 ms across three consecutive measured runs; its complete 10-test file completed in 2.54–3.44 seconds, while a cold reset/migration run completed in 11.21 seconds without raising the timeout. The full integration suite completed in 5.90 seconds (4.37 seconds test time). The concurrent mutual-administrator-removal race separately passed and retained exactly one reachable administrator. An isolated namespace built the application graph, applied migrations 001–018, served health, and recorded schema version 18 with `dirty = false`; it was then removed. A deployment-style Encore linux/amd64 build completed. Independent review and the final targeted review both returned PASS; hosted Foundation CI and Encore Build passed before merge.

**Post-acceptance staging invitation adapter — IMPLEMENTED / ACCEPTANCE REMEDIATION IN PROGRESS.** ADR-0016 adds the fixed-sender Graph adapter behind the already accepted outbox/Pub/Sub seam without an API change. Forward migration 019 adds only provider-attempt reservations and expiring dispatch leases. Each possible Graph send now consumes a database-serialized reservation 1–3 before Graph is reachable; crash, rollback and ambiguous completion remain consumed, and no fourth reservation is possible. The dispatcher safely reclaims stale `PUBLISHED` leases without overwriting later worker outcomes. Resend now materialises `expires_at <= trusted now` as terminal `EXPIRED` and creates no generation/outbox replacement. Existing one-refresh-only `401` recovery, bounded `403` retry with `graph.mailbox_authorization`, fixed sender, absent `message.from`, disabled Sent Items and cancel/delivery ordering remain intact. The secret-configuration guard correctly remains red because `MicrosoftGraphClientSecret` is not yet configured for exact `staging`; targeted independent re-review, out-of-band secret configuration, deployment, and a newly approved live invitation remain the explicit completion gates. No Graph request is made during remediation verification.

Acceptance does not make the system production-ready. ADR-0016 resolves staging invitation delivery only. Production readiness remains gated by explicit Production email enablement/provider and template/support process, operational Entra email-claim configuration, retention policy, rate/abuse controls, authoritative JML source and SLA, the production first-administrator ceremony, access reviews, and break-glass/recovery.

Accepted non-blocking follow-ups are dialog focus trapping and Escape handling, the privileged-approval confirmation UX decision, human-readable history labels, remaining internal PostgreSQL wording, clearing invitation codes after failed acceptance, and multi-centre authorisation batching before broad 20+ centre rollout.

### Milestone 3 — controlled daily operating experience

#### Milestone 3A — Daily Success

**Status:** **ACCEPTED / COMPLETE.** The Product Owner accepted Milestone 3A on 12 August 2026. Architecture and implementation authorisation were received the same day; the first independent review returned PASS WITH CHANGES; the identified acceptance findings were then remediated and locally verified; and the targeted independent re-review returned PASS. Pull request #6 passed hosted Foundation CI and the separately reported Encore Build, then merged to `main`. Acceptance is an implementation acceptance only and does not make Centre Success production-ready.

**Goal:** Make `/` a clear, permission-safe operational home that tells each approved perspective what needs attention, why, when, and where to continue, without creating another workflow truth.

The implemented slice is one live, read-only, private/no-store projection over corrective actions/findings, quarterly reviews/acknowledgements, and eligible People & Access cases. It supports Centre Director, Area Manager, minimal Compliance Manager, and administration-only eligible System Administrator perspectives. It uses current PostgreSQL capabilities/scopes, one decision timestamp, set-wise centre hierarchy loading, source-ID-restricted queries, deterministic critical-first priority, validated centre/organisation IANA timezones, controlled source CTAs, partial-source health, derived completed-today context, and bounded portfolio query count. `/centre/reviews/:auditId` is the minimal source-owned review/acknowledgement route.

Milestone 3A adds no database migration or index. It creates no Daily Success task/table/snapshot/cache, copied status/due/owner, generic task, completion/acknowledgement/dismissal/snooze/preference, manual priority, notification, QIP, analytics platform, or materialized projection. Source workflows remain authoritative and reauthorize every deep link. See `DAILY_SUCCESS.md` and ADR-0015 for the 30-item review baseline.

Acceptance-remediation evidence includes honest partial-source coverage with no fabricated aggregate or per-centre zero counts; independent critical-verification eligibility; the Area Manager **VERIFY TODAY** queue; per-centre hierarchy-failure isolation; controlled CTA validation; rendered accessibility, live-region, focus, native-list, review-navigation, and acknowledgement-refresh tests; and persisted-source negative cases. The complete local gate passed with 141 backend unit tests, 100 database-backed integration tests, and 90 frontend tests. Representative 1/5/20-centre portfolios with real source rows held database operations at `14 / 14 / 14`; a controlled 25-sample 20-centre run with 40 source rows recorded cold `14.5 ms`, p50 `12.5 ms`, and p95 `17.0 ms`. Migrations 001–018 applied in a fresh namespace with `dirty = false`; the generated client reproduced byte-for-byte at SHA-256 `46f9faf7ff00c82b0b6c79208a4275f103f85558ae1636ea660b30e5513db5cd`; frontend lint/typecheck/production build, zero-vulnerability dependency audits, authentication scope guard, `git diff --check`, and Linux/amd64 Encore build compatibility all passed. No migration was added for Milestone 3A. These gates supported the targeted independent re-review, which returned PASS; acceptance remains an implementation acceptance only and does not make Centre Success production-ready.

#### Earlier sequencing proposal — superseded by accepted Milestone 2B

The earlier plan placed Area Manager internal audits in Milestone 3. Product Owner approval moved and completed that vertical slice as Milestone 2B. Its accepted evidence remains above; this note is retained only to explain the sequencing change.

#### Milestone 3B — locked

Stateful daily planning/check-in, living QIP, notifications, manual priorities and additional Daily Success perspectives require separate Product Owner authorisation. Milestone 3A does not imply or pre-authorise them. The separate Centre Standards 4A architecture gate is recorded below.

### Milestone 4 — Centre Standards

#### Milestone 4A — operational loop

**Status:** **LOCAL IMPLEMENTATION GATE PASSED at integration commit `1bf06b7`.** The integrated implementation passed 280/280 frontend tests, frontend typecheck, frontend production build, migrations 020–022, Encore/PostgreSQL database-backed integration tests, and the Centre Standards query-budget gate, with a clean integration worktree.

This status records local implementation evidence only. It does not state or imply hosted CI, deployment, production acceptance, production data use, or production readiness, and no independent review or Product Owner acceptance of the 4A implementation is recorded.

ADR-0018 defines the Centre Standards product's internal **Operational Assurance** architecture: a minimal `/standards` landing and `/standards/checks/[occurrenceId]` route family, one synthetic **Centre Standards Pilot — Staging** standard with one daily centre-local schedule, `OPEN`/`COMPLETED` occurrences, derived minute-precision timeliness, online atomic Educator completion with a typed already-completed result, PostgreSQL-enforced quarterly-versus-operational template subtype, and an open-occurrence-only Daily Success projection for already-supported perspectives. ADR-0019 defines discriminated source-family findings/action origin while keeping `corrective_actions` structurally unchanged and preserving every accepted M2B quarterly invariant. Neither record changes the separately authorised ADR-0017 Quality read-projection boundary.

`operational_check.read` and `operational_check.complete` are the only approved capability concepts for 4A. They are implemented by forward migrations 020–022 and granted through a versioned Educator role bundle; neither is granted to System Administrator through technical-admin status.

The initial design scale is 20 centres with one daily standard. The representative future validation volume is 20 centres with four daily checks and approximately 12 responses per check. One set-wise Daily Success source has an expected relevant-perspective database-operation budget of approximately `14 -> 17`, invariant across one, multiple and 20-centre portfolios.

Independent review and Product Owner acceptance of the 4A implementation remain outstanding. The synthetic assessed questions, permitted outcome configuration, `due_days` rule, staging centre/deployment, effective dates and DST-safe daily wall times are implemented as staging-only synthetic content and remain subject to that review. No real Bright Steps or regulatory requirement is invented, and none may be.

#### Milestones 4B, 4C and 4D — locked

Milestone 4C is the earliest possible gate for separately governed cross-source recurrence; existing lineage strings cannot establish cross-template semantic identity. No governed-requirement structure is part of 4A. A builder and author/approve/publish/deploy workflows remain locked. Milestones 4B and 4D carry no implied scope or authorisation from 4A. An Educator Daily Success/home perspective also requires a separate Product Owner decision.

One exception has been granted. **Milestone 3C — Centre Quality & Performance** is authorised as a narrow read-side projection under ADR-0017: a live, read-only view over existing Milestone 2B quarterly-review, finding and corrective-action data, with no migration, no new source of truth, no composite score and no regulatory rating inference. It adds Centre Director, Area Manager and Compliance Manager quality views and the shared Centre Success design system. It does not unlock the remainder of Milestone 5 or any part of Milestone 6.

### Milestone 5 — command views and operational hardening

**Goal:** Give Area/Compliance leaders reliable scoped oversight and prepare production operations.

Deliver material exception/trend projections, recognition, exports with manifests/expiry, access reviews, reconciliation jobs, incident/runbooks, load/resilience testing, backup/restore evidence, and production readiness review.

The narrow Centre Quality & Performance slice authorised under ADR-0017 delivers part of the scoped-oversight goal ahead of this milestone. The rest of Milestone 5 — recognition, exports with manifests and expiry, access reviews, reconciliation jobs, incident runbooks, load and resilience testing, backup and restore evidence, and production readiness review — remains locked.

### Milestone 6 — approved conditional modules

Budget, coaching, Centre Health, AI, wellbeing, and additional integrations each require their own mini-gate, data/privacy/security assessment, domain acceptance criteria, and permission tests. They are not bundled merely because documents exist.

Centre Health remains locked in particular. ADR-0017 deliberately computes no composite score, and the reserved methodology, weights, thresholds, coverage rules and band labels remain open decisions requiring their own mini-gate.

## Engineering architecture for MVP

- **Frontend:** one responsive Next.js application when approved; generated/typed Encore client boundary; server/client rendering choices based on security and UX rather than exposing secrets.
- **Backend:** Encore.ts modular monolith with one initial deployable business service and internal modules for identity/access, centres, daily, compliance, quality/QIP, audits, findings/actions, evidence, notifications, and later conditional modules.
- **Data:** one Encore SQL PostgreSQL database; module-owned aggregates and repository interfaces; private Object Storage for evidence/exports.
- **Async:** Pub/Sub only for genuinely asynchronous side effects; transactional outbox where state/event consistency matters; idempotent consumers.
- **Scheduling:** Encore cron for bounded materialisation, overdue/expiry, reconciliation, retention, and review jobs.
- **Operations:** Encore secrets, auth handler, API schemas/docs, service calls if later extracted, traces, structured logs, metrics, and local developer dashboard.
- **Local/cloud:** Encore CLI and OrbStack where local Docker compatibility is required; Encore Cloud with GitHub-connected environments.
- **Supabase:** no Supabase Auth, RLS, Storage, Edge Functions, or database architecture.

The official Encore-generated TypeScript client used by `frontend/` is committed so a checkout has the reviewed contract. Developers regenerate it whenever an Encore API contract changes and review the generated diff; backend request/response types are not manually duplicated in frontend source.

## Module boundaries

Logical modules communicate through explicit application interfaces and domain events, not direct mutation of another module’s aggregates. Start inside one service/repository. Consider extraction only when there is evidence of:

- distinct team/data ownership;
- materially different availability, scaling, or security boundary;
- independent deployment need;
- unacceptable coupling demonstrated by change patterns; or
- regulatory/contractual isolation requirement.

Extraction requires an architecture decision, API/event contract, data migration/ownership plan, failure model, and observability—not a folder rename.

## Delivery method

Build vertical slices rather than completing all tables or APIs for a domain first. For each slice:

1. Confirm user outcome, source/business rules, classification, owner, and permission matrix.
2. Threat-model and define state transitions, invariants, audit events, and failure modes.
3. Write migrations and rollback/recovery approach only after schema review.
4. Implement typed Encore command/query boundary and domain logic.
5. Implement the smallest accessible mobile-first UI.
6. Test happy path, validation, denied scope, concurrency, idempotency, audit, retry, and accessibility.
7. Observe in a non-production environment with synthetic data.
8. Obtain business/security acceptance and record decisions.

## Quality gates

Every milestone requires:

- no critical/high unresolved security issue under the approved policy;
- tenant/scope negative tests and object/export/search/file coverage;
- state-machine and audit-attribution tests;
- migrations reviewed, forward-safe, source-controlled, and tested on representative synthetic volume;
- no secrets/personal data in source, fixtures, logs, or traces;
- accessible responsive workflows and plain-language errors;
- idempotent jobs/events/imports and failure/reconciliation tests;
- monitoring, alert, ownership, and runbook for new operational dependencies;
- source provenance and authorised approval for regulated/internal controls; and
- product-owner demonstration and acceptance.

## MVP success evidence

- Centre Directors can identify and act on the right priorities without duplicate systems/statuses.
- Area Managers can complete a consistent internal audit and coach/follow up within assigned scope.
- Failed items reliably produce reviewed actions and verified closure.
- Compliance can trace source/control/template versions and material exceptions.
- Strengths and improvement are visible alongside risk.
- Cross-tenant/centre, restricted evidence, export, admin, and delegated-access tests pass.
- Users understand that internal audits/Centre Health are not regulatory ratings.
- Operational owners can detect, diagnose, reconcile, restore, and audit the system.

## Milestone 0 handoff checklist

- [x] Product vision and non-goals.
- [x] Personas, roles, and scope model.
- [x] Core workflows and state boundaries.
- [x] NQS/source-governance and QIP approach.
- [x] Compliance and Area Manager audit architecture.
- [x] Conceptual data model.
- [x] Backend authorisation and security architecture.
- [x] Centre Health, coaching, wellbeing, budget, AI, and integration boundaries.
- [x] Cross-document terminology and invariant review.
- [x] Product-owner architecture approval.
- [x] Foundation role/scope clarification and identity-provider deferral recorded.
- [x] Explicit authorisation to begin Milestone 1.
- [ ] Later business/security decisions before affected modules or production release.
