# MVP Build Plan

## Delivery status and stop gate

**Milestone 0 — architecture documentation: complete and approved.**

**Milestone 1 — Centre Success foundation: implementation complete; awaiting product-owner acceptance.** The Encore application and Cloud connection were preserved. Later business modules remain outside this authorisation, and Milestone 2 must not begin without explicit approval.

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

The product owner approved the canonical foundation role/scope baseline, one Encore service/database, an identity-provider-neutral principal, data-driven capabilities, synthetic authorisation tests, a public health endpoint, the local uncredentialed CORS origin, and a committed generated frontend client.

The identity provider and runtime session/MFA/recovery design are intentionally deferred. Milestone 1 must not expose a protected business endpoint or invent temporary authentication while that decision is open. Broader organisation hierarchy, assignment sources, access review, privacy/retention, cloud production operations, and all business-module decisions remain gates before the affected capability or production release; they do not authorise scope expansion during the synthetic foundation.

## Delivery milestones

### Milestone 1 — secure foundation

**Goal:** Prove tenant and centre isolation before adding sensitive workflows.

Deliver organisation/hierarchy/centre identity, an identity-provider-neutral internal principal, memberships, data-driven role/scope assignments, synthetic policy enforcement, audit-event foundation, environment strategy, and a minimal responsive shell. Keep one Encore business service and one PostgreSQL database. Runtime authentication and protected business APIs wait for provider approval; only the public health endpoint connects the shell to Encore in this milestone.

Exit evidence:

- architecture decision records for open foundation decisions;
- cross-organisation, cross-centre, assigned/unassigned scope, multi-role, deactivation, and System-Administrator-without-business-content tests;
- threat/privacy review and data classification;
- CI quality/security checks and controlled deployment path;
- observable public health request with safe logs/traces and no protected data;
- no business module can bypass the authorisation interface.

### Milestone 2 — compliance work vertical slice

**Goal:** Complete one approved control from activation to verified completion.

Deliver source/control version, applicability, scheduled obligation, task, private evidence upload/review, finding/action, notification, and audit history for a small validated control set.

Exit evidence includes source approval, idempotent scheduling, malware/file controls, overdue/escalation behaviour, independent verification where configured, accessibility/mobile testing, and restore/link-integrity test.

### Milestone 3 — Area Manager internal audits

**Goal:** Complete one quarterly audit and follow every failed item to action.

Deliver versioned templates, scheduling/assignment, item capture/evidence, provisional/final internal score, critical gates, draft finding/actions, moderation/finalisation, centre response, spot checks, and comparable-quarter mapping.

Exit evidence includes score reproducibility, retry without duplicate actions, post-finalisation amendment history, non-comparable template handling, assignment denial, and explicit internal-not-regulatory labels.

### Milestone 4 — daily success and living QIP

**Goal:** Make the Centre Director’s daily experience the primary operating surface.

Deliver explainable priority assembly, acknowledge/focus/wrap-up, blocker/help routing, strengths/self-assessment, QIP improvements/milestones/snapshots, and links to evidence/audits/actions.

Exit evidence includes user validation with Centre Directors, notification-load controls, no duplicate source statuses, QIP source/jurisdiction review, and accessible responsive journeys.

### Milestone 5 — command views and operational hardening

**Goal:** Give Area/Compliance leaders reliable scoped oversight and prepare production operations.

Deliver material exception/trend projections, recognition, exports with manifests/expiry, access reviews, reconciliation jobs, incident/runbooks, load/resilience testing, backup/restore evidence, and production readiness review.

### Milestone 6 — approved conditional modules

Budget, coaching, Centre Health, AI, wellbeing, and additional integrations each require their own mini-gate, data/privacy/security assessment, domain acceptance criteria, and permission tests. They are not bundled merely because documents exist.

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
