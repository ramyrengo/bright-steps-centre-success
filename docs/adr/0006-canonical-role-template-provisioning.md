# ADR-0006: Canonical role templates provisioned per organisation

## Status

Accepted for Milestone 1.

## Context

`docs/FOUNDATION_DECISIONS.md` fixes nine canonical roles as an approved
baseline that may only change by documented decision. Roles are data-driven
bundles, so the baseline must exist as reviewed data rather than as a constant
duplicated in application or test code. Each organisation must also be able to
evolve its own role definitions later without silently rewriting the approved
baseline or diverging from it unnoticed.

## Decision

Store the approved baseline once in `canonical_role_templates` and
`canonical_role_template_capabilities`, seeded by migration and versioned per
role key with a single active version. Provision organisation-scoped
`role_definitions` and `role_capabilities` from those templates through a
database trigger when an organisation is created, recording
`source_template_key` and `source_template_version` on each provisioned row.
Mirror the same bundles in `foundation/authorization/roles.ts` and assert
equality between the TypeScript model and the seeded tables in
`roles.test.ts`.

Provisioning creates role definitions only. It creates no membership and no
role assignment, so a new organisation starts with no access granted.

## Consequences

The approved baseline is verifiable against data, and drift between code and
database fails a test rather than surviving to runtime. Organisations can later
diverge deliberately while `source_template_key` still records the template
lineage. A future baseline change is a new template version plus an explicit
migration decision, not an edit to an existing active version.

Because provisioning is a trigger, creating an organisation has a side effect
beyond the row inserted. That is intentional — it prevents an organisation from
existing in a state where no canonical role is available — but any future
organisation-creation path must expect it.
