# Bright Steps Centre Success — repository instructions

## Current delivery gate

This repository is in **Milestone 0: architecture**. Do not begin Milestone 1 or alter the Encore starter until the product owner explicitly approves implementation.

Until that approval, do not scaffold Next.js, add packages, create migrations or tables, implement APIs or authentication, create UI, configure integrations, add secrets, or provision infrastructure. Architecture work is limited to `README.md`, `AGENTS.md`, and `docs/*.md`.

## Confirmed technical baseline

- Frontend: Next.js, React, and TypeScript; responsive and mobile first.
- Backend: Encore.ts and TypeScript, initially a modular monolith.
- Persistence: PostgreSQL through Encore SQL database infrastructure; source-controlled migrations once implementation is approved.
- Platform: use Encore capabilities where appropriate for APIs, SQL, Object Storage, Pub/Sub, cron, secrets, authentication handlers, service calls, tracing, structured logging, metrics, generated API documentation, and the local developer dashboard.
- Local infrastructure: Encore CLI, with OrbStack as the Docker-compatible runtime where required.
- Cloud: Encore Cloud with GitHub-connected deployment.
- Supabase is not part of the baseline. Do not introduce Supabase Auth, RLS, Storage, Edge Functions, or another Supabase dependency without an approved, documented architecture decision showing a material need.

The MVP default is one cohesive Encore deployable business service with internal domain modules and one application database. Do not create a service or database per logical domain. Extract a boundary only when ownership, scaling, reliability, security, or deployment evidence justifies it.

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
- Preserve the existing starter and user changes unless a later approved milestone explicitly replaces them.

## Source and legal safety

ACECQA guidance and legislation can change and jurisdiction-specific provisions can differ. At implementation and before each regulatory content release:

- verify against the applicable authoritative source and jurisdiction;
- have an authorised Bright Steps compliance owner approve the interpretation;
- retain the source URL/document, publication or access date, effective dates, and supersession chain;
- prevent drafts from becoming active controls without approval; and
- show users the source and verification status rather than presenting generated guidance as law.

Architecture documents are product and engineering decisions, not legal, regulatory, financial, employment, or clinical advice.
