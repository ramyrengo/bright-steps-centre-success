# Bright Steps Centre Success

Bright Steps Centre Success is a proposed operational success system for Australian early childhood education and care centres. It is intended to bring daily leadership priorities, quality improvement, internal assurance, corrective action, coaching, wellbeing, budget accountability, and organisation-level visibility into one explainable and permission-safe experience.

## Current status

**Milestone 1, Milestone 2A — Authentication Gate, and Milestone 2B — Area Manager Audit to Corrective Action are accepted and complete. Milestone 2C — People & Access + User Invitations is authorised for implementation.**

Milestone 0 architecture, Milestone 1 foundation, Milestone 2A authentication, and Milestone 2B quarterly review are complete. The repository contains one Encore `foundation` service with the organisation/centre/principal/access/audit foundation, Microsoft Entra authentication, the synthetic quarterly-review vertical slice, a responsive Next.js application, generated client communication, database-backed authorisation tests, and automated quality checks. Milestone 2C adds invitation-based People & Access administration without changing the authentication or authorisation boundary.

Microsoft Entra ID in the single Bright Steps Australia tenant is the approved authentication provider. The Next.js SPA uses MSAL Authorization Code with PKCE to obtain an access token for the Centre Success API. Encore strictly validates that token and maps its `tid + oid` identity to the existing provider-neutral internal principal, after which Centre Success reloads current membership, assignment-bound capabilities, and scopes from PostgreSQL. Entra user assignment is set to **No**, but authentication still grants no Centre Success access: unmapped or uninvited identities remain `not_provisioned`. Entra is not the business-authorisation source, users are not auto-provisioned, and Microsoft Graph is not integrated. See [Foundation Decisions](docs/FOUNDATION_DECISIONS.md), [People & Access Architecture](docs/PEOPLE_AND_ACCESS.md), [ADR-0012](docs/adr/0012-microsoft-entra-id-single-tenant-authentication.md), [ADR-0013](docs/adr/0013-milestone-2b-quarterly-review-vertical-slice.md), [ADR-0014](docs/adr/0014-people-and-access-invitation-architecture.md), and [MVP Build Plan](docs/MVP_BUILD_PLAN.md).

## Confirmed architecture

- Responsive, mobile-first Next.js/React/TypeScript frontend.
- Encore.ts/TypeScript backend.
- Modular monolith for MVP: cohesive logical domain modules inside an initial Encore deployable boundary, split only when evidence supports it.
- PostgreSQL through Encore SQL database infrastructure, with source-controlled migrations after approval.
- Encore Object Storage, Pub/Sub, cron, secrets, auth handlers, service calls, tracing, logging, metrics, generated API documentation, and local dashboard where appropriate.
- Encore CLI locally; OrbStack provides the Docker-compatible runtime where local infrastructure needs it.
- Encore Cloud with GitHub-connected deployment.
- Explicit backend authorisation; no Supabase or reliance on frontend visibility as a security boundary.

## Documentation map

| Document | Decision area |
| --- | --- |
| [Foundation Decisions](docs/FOUNDATION_DECISIONS.md) | Accepted foundation constraints, role baseline, and authentication boundary |
| [Architecture Decision Records](docs/adr/README.md) | Material accepted foundation and authentication decisions |
| [Developer Setup](docs/DEVELOPER_SETUP.md) | Local prerequisites, Microsoft Entra configuration, startup, tests, database, and client generation |
| [Product Vision](docs/PRODUCT_VISION.md) | Outcomes, boundaries, principles, success measures |
| [Personas](docs/PERSONAS.md) | User needs, risks, and contexts |
| [User Roles](docs/USER_ROLES.md) | Operational responsibilities and separation of duties |
| [People & Access Architecture](docs/PEOPLE_AND_ACCESS.md) | Approved, implementation-gated invitation, access lifecycle, approval, and security design |
| [Workflows](docs/WORKFLOWS.md) | End-to-end journeys and lifecycle states |
| [NQS Framework](docs/NQS_FRAMEWORK.md) | NQF/NQS/QIP modelling and source governance |
| [Compliance Engine](docs/COMPLIANCE_ENGINE.md) | Configurable controls, tasks, evidence, and corrective actions |
| [Area Manager Audits](docs/AREA_MANAGER_AUDITS.md) | Quarterly audits, spot checks, scoring, comparisons |
| [Database Schema](docs/DATABASE_SCHEMA.md) | Conceptual domain model and data invariants |
| [Permissions](docs/PERMISSIONS.md) | Backend capability and scope enforcement |
| [Centre Health Score](docs/CENTRE_HEALTH_SCORE.md) | Explainable organisational health indicator |
| [Coaching Framework](docs/COACHING_FRAMEWORK.md) | Mentoring cycles, goals, and confidentiality |
| [Wellbeing Framework](docs/WELLBEING_FRAMEWORK.md) | Privacy-preserving wellbeing support and trends |
| [Budget Accountability](docs/BUDGET_ACCOUNTABILITY.md) | Approved/actual/forecast visibility and governance |
| [AI Architecture](docs/AI_ARCHITECTURE.md) | Permission-aware assistant and knowledge controls |
| [Integrations](docs/INTEGRATIONS.md) | System boundaries, adapters, sync, and provenance |
| [Security](docs/SECURITY.md) | Threat model, privacy, security controls, operations |
| [MVP Build Plan](docs/MVP_BUILD_PLAN.md) | Sequencing, gates, tests, and deferred scope |

## Product-wide rules

- The system assists accountable people; it does not replace professional, regulatory, financial, employment, or clinical judgement.
- ACECQA and jurisdictional material is referenced through a versioned, reviewed source registry. Requirements are never invented or silently generated.
- Internal audit and Centre Health results are not official NQS ratings.
- Each protected read and write is authorised in the backend against an organisation and resource scope.
- Sensitive wellbeing, child-related evidence, staff, and finance data is collected minimally and purpose-bound.
- Material actions and AI assistance are attributable through durable audit records.

## Architecture reference date

The product architecture was cross-reviewed on **11 August 2026**. External regulatory, privacy, and platform references must be revalidated before implementation and before activation of any regulated control content.
