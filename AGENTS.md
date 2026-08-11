# Bright Steps Centre Success — repository instructions

## Current delivery gate

**Milestone 1: Centre Success foundation is implemented and awaiting product-owner acceptance.** Preserve the Encore application and Cloud connection. Do not begin Milestone 2 or any later business module without explicit approval.

Milestone 1 may add one Encore business service/database, the minimum organisation/centre/principal/access/audit schema, data-driven authorisation policy and synthetic tests, a public health endpoint, a responsive Next.js shell, a generated Encore client, and local developer documentation. Do not implement compliance workflows, audits, QIP, coaching, wellbeing, budget functionality, notifications, AI, or other later business modules.

The external identity provider remains unapproved. Do not add runtime authentication, credentials, client-supplied identity headers, or an insecure temporary login. Until an approved provider establishes trusted identity, expose no protected business API; the only public Milestone 1 API is a minimal non-sensitive health endpoint.

## Confirmed technical baseline

- Frontend: Next.js, React, and TypeScript; responsive and mobile first.
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
6. **Internal indicators are labelled.** Centre Health and internal audit scores are management signals, not regulatory ratings, legal determinations, or clinical assessments.
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
