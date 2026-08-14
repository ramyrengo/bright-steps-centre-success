# Bright Steps Centre Success — repository instructions

## Current delivery gate

**Milestone 1, Milestone 2A: Microsoft Entra Authentication Gate, Milestone 2B: Area Manager Audit to Corrective Action, Milestone 2C: People & Access + User Invitations, and Milestone 3A: Daily Success are accepted and complete.** Preserve the Encore application, Cloud connection, PostgreSQL authorisation foundation, authentication architecture, and existing tests. Milestone 3B and every later milestone remain locked, with one exception: the Product Owner granted a narrow product-slice authorisation for Centre Quality & Performance on 12 August 2026, recorded in ADR-0017. That authorisation covers only a live, read-only projection over existing Milestone 2B quarterly-review, finding and corrective-action data, using existing capabilities and scopes, with no new source-of-truth table, no new workflow state, no invented due date, no NQS or ACECQA rating inference and no composite Centre Health score. It does not unlock the remainder of Milestone 5, does not unlock Milestone 6, and does not authorise the reserved Centre Health methodology. Centre Standards Milestone 4A, defined by ADR-0018 and ADR-0019, is implemented and passed its local implementation gate at integration commit `1bf06b7`; that is local implementation evidence only and records no independent review, Product Owner acceptance, hosted CI, deployment or production readiness. Exactly one further product slice is authorised — Area Manager Template & Form Builder, granted by the Product Owner on 13 August 2026 under ADR-0020, with no milestone number assigned or implied. Milestones 4B, 4C and 4D remain locked. Acceptance of Milestone 3A is an implementation acceptance only and does not make Centre Success production-ready.

Milestone 4A architecture is one synthetic staging-only daily operational standard under `/standards`, online atomic completion, PostgreSQL-enforced template subtype and source-family findings. Educator contracts expose only check content, occurrence timing/progress and completion state; downstream severity, remediation, verification and finding/action internals remain hidden. A future Daily Success adapter may project only authorised `OPEN` occurrences and must not duplicate a generated corrective action. It adds no real Bright Steps requirement, cross-source recurrence, later finding-to-action promotion, photos, durable/offline browser drafts, or Production activation. `operational_check.read` and `operational_check.complete` exist through forward migrations 020–022 and a versioned role bundle. The standards builder is separately authorised under ADR-0020 and is not part of 4A. See ADR-0018 and ADR-0019. Nothing in those records narrows or supersedes the separately authorised ADR-0017 Quality read projection.

Milestone 3A is a live, read-only orchestration over source-owned corrective-action, quarterly-review, and People & Access facts. It must not add Daily Success persistence, copied workflow facts, snapshots, completion/acknowledgement/dismissal/snooze state, generic tasks, notifications, manual priorities, materialisation, role-name authorization, or a per-centre database authorizer loop. Only the Centre Director, Area Manager, Compliance Manager, and administration-only eligible System Administrator perspectives are approved. See `docs/DAILY_SUCCESS.md` and ADR-0015.

Centre Quality & Performance is a live, read-only projection in the same architectural family as Daily Success. It must not add a table, migration, workflow state, snapshot, cache, mutation endpoint, composite score, regulatory rating inference, invented due date, or per-centre database authorizer loop. Approved views are Centre Director (single authorised centre), Area Manager (authorised portfolio) and Compliance Manager (organisation). System Administrator technical privilege confers no quality projection. Centres are grouped by the support they need and are never ranked. A source that is not authorised or could not be checked is reported as unknown and never as zero. See `docs/adr/0017-centre-quality-performance-read-projection.md`.

Milestone 2C did not originally implement HR synchronisation, Microsoft Graph, SharePoint, QIP, coaching, wellbeing, budget, AI, Daily Success, an executive dashboard, unrelated compliance features, or a production first-administrator bootstrap. A later Product Owner decision authorises Microsoft Graph only as the staging invitation-email delivery adapter recorded in ADR-0016; it grants no directory, provisioning, authorisation, HR, mailbox-read, or general-notification scope. Milestone 3A adds only the separately authorised Daily Success projection described above. The production bootstrap remains separately gated until the Encore Cloud operational mechanism is validated.

Milestone 2B may add only the approved synthetic quarterly-review vertical slice: versioned internal audit templates, assigned-centre audit runs and scoring, immediate and finalisation-time findings/actions, Centre Director remediation, private evidence, independent verification, acknowledgement, positive practice, comparable-quarter/recurrence support, and minimal Compliance Manager oversight. Keep development audit content explicitly internal and non-regulatory. Do not implement a regulatory corpus, QIP, daily success, coaching, wellbeing, budget functionality, notifications, AI, HR synchronisation, or other later modules. The separately approved ADR-0016 Graph adapter remains confined to People & Access staging invitation email and does not expand Milestone 2B.

The authorised Milestone 2C design is recorded in `docs/PEOPLE_AND_ACCESS.md` and ADR-0014. Entra user assignment remains **No**: a valid BSA tenant identity may authenticate but gains no Centre Success access without an active internal mapping and PostgreSQL grant. Pending invitations/proposals must remain outside active membership/assignment/scope tables; email is correlation only and permanent identity is `tid + oid`; privileged packages require an independent second System Administrator; and at least one reachable active System Administrator must always remain. Invitation generations expire in exactly 72 hours, are one-time, and are persisted only as a keyed digest.

Microsoft Entra ID in the single Bright Steps Australia tenant is the approved authentication provider and is responsible only for proving who signed in. The browser must send an access token for the Centre Success API, never an ID token or Microsoft Graph token. The backend must strictly validate the token and map its `tid + oid` identity to the provider-neutral internal principal. Centre Success PostgreSQL remains authoritative for organisation membership, roles, capabilities, scopes, effective dates, and every business-authorisation decision. Do not use Entra groups, app roles, claims, or frontend state to grant Centre Success access. Never accept client-supplied principal, user, role, capability, organisation, centre, or ancestry data as identity or authority. The public health endpoint remains non-sensitive. Every Milestone 2B business endpoint is `auth: true` and independently enforces current PostgreSQL authority and resource scope.

## Confirmed technical baseline

- Frontend: Next.js, React, and TypeScript; responsive and mobile first.
- Frontend design language: the shared Bright Steps "Greenhouse" system, matching the Bright Steps Site Launch Planner. Tokens, primitives and conventions are recorded in `docs/DESIGN_SYSTEM.md`. Build screens from the shared primitives rather than styling pages independently, and do not introduce a UI framework for appearance alone.
- Backend: Encore.ts and TypeScript, initially a modular monolith.
- Persistence: PostgreSQL through Encore SQL database infrastructure; source-controlled migrations once implementation is approved.
- Platform: use Encore capabilities where appropriate for APIs, SQL, Object Storage, Pub/Sub, cron, secrets, authentication handlers, service calls, tracing, structured logging, metrics, generated API documentation, and the local developer dashboard.
- Local infrastructure: Encore CLI, with OrbStack as the Docker-compatible runtime where required.
- Cloud: Encore Cloud with GitHub-connected deployment.
- Supabase is not part of the baseline. Do not introduce Supabase Auth, RLS, Storage, Edge Functions, or another Supabase dependency without an approved, documented architecture decision showing a material need.

The MVP default is one cohesive Encore deployable business service with internal domain modules and one application database. Do not create a service or database per logical domain. Extract a boundary only when ownership, scaling, reliability, security, or deployment evidence justifies it.

Canonical foundation role names are **Educator**, **Assistant Director**, **Centre Director**, **Area Manager**, **Compliance Manager**, **Operations Leadership**, **Finance**, **Executive**, and **System Administrator**. Do not create `Operations` or `Super Admin` as separate roles. Operations Leadership is scoped business oversight. System Administrator is technical administration and receives no business-content access unless separately assigned a business capability and scope.

## Required invariants

1. **Backend authorisation is mandatory.** Every protected operation and object lookup must be authorised in Encore using both capability and resource scope. Frontend visibility is never an authorisation control.
2. **Tenant scope is explicit.** Organisation, state/region, centre, assigned-centre, Area Manager, Compliance Manager, Finance, Executive, and sensitive-wellbeing scopes must be represented and enforced.
3. **Deny by default.** Missing, stale, ambiguous, or conflicting access context is denied. Never accept organisation or centre scope merely because the client supplied it.
4. **Sensitive data is minimised.** Wellbeing, child-related evidence, staff records, credentials, and financial information receive purpose-specific access, retention, logging, and export controls.
5. **Official sources stay external and versioned.** Do not invent legislation, ACECQA requirements, financial rules, or Bright Steps policy. A control that claims an external basis must record its source, jurisdiction, effective dates, verification state, and reviewer.
6. **Internal indicators are labelled.** Centre Health and internal audit scores are management signals, not regulatory ratings, legal determinations, or clinical assessments. The reserved Centre Health concept stays locked until an approved versioned methodology, weights and thresholds exist; surfaces may present source-owned BSA internal review score, performance band and risk status, and must not relabel those as Centre Health.
7. **Human accountability remains.** AI may retrieve, summarise, draft, and suggest; it may not make final compliance, employment, wellbeing, financial, or regulatory decisions.
8. **Auditability is part of each write path.** Material state changes, permission changes, evidence access, exports, score versions, configuration changes, and AI-assisted actions must be attributable and reviewable.

## Architecture working method

- Read `README.md` and all directly relevant files in `docs/` before designing or implementing a domain.
- Treat `docs/PRODUCT_VISION.md`, `docs/PERMISSIONS.md`, `docs/SECURITY.md`, and `docs/DATABASE_SCHEMA.md` as cross-cutting constraints.
- Keep domain language consistent: **organisation**, **state/region**, **centre**, **user**, **assignment**, **finding**, **corrective action**, **evidence**, **QIP improvement**, **internal audit**, and **Centre Health**.
- Record unresolved business decisions as explicit open decisions; do not silently turn assumptions into requirements.
- When implementation is approved, deliver vertical slices with tests for happy path, denied cross-scope access, audit recording, and failure/retry behaviour.
- Preserve the implemented foundation and user changes unless a later approved milestone explicitly replaces them. The sample Hello World service was removed only after the replacement service, database, API, tests, frontend connection, and local traces were verified.

## Source and legal safety

ACECQA guidance and legislation can change and jurisdiction-specific provisions can differ. At implementation and before each regulatory content release:

- verify against the applicable authoritative source and jurisdiction;
- have an authorised Bright Steps compliance owner approve the interpretation;
- retain the source URL/document, publication or access date, effective dates, and supersession chain;
- prevent drafts from becoming active controls without approval; and
- show users the source and verification status rather than presenting generated guidance as law.

Architecture documents are product and engineering decisions, not legal, regulatory, financial, employment, or clinical advice.
