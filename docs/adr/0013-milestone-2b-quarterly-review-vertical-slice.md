# ADR-0013: Milestone 2B quarterly review vertical slice

- Architecture decision status: Accepted
- Milestone delivery status: **ACCEPTED / COMPLETE** (Product Owner acceptance recorded 11 August 2026)
- Date: 2026-08-11
- Decision owner: Product Owner

## Context

This ADR approves the Milestone 2B design; it does not record Product Owner acceptance of the delivered milestone. Completion remains gated on acceptance remediation, full regression and hosted CI, independent re-review, and explicit Product Owner acceptance.

Milestone 2B is the first business vertical slice after the accepted foundation and Microsoft Entra authentication gate. It must prove an assigned Area Manager can conduct a synthetic internal quarterly centre review that produces reproducible scoring, accountable findings and corrective actions, Centre Director remediation, independent verification, acknowledgement, positive-practice capture, and minimal organisation oversight. It must not be represented as an ACECQA or regulatory assessment.

## Decision

Keep one Encore modular monolith and the existing PostgreSQL capability-plus-assignment-plus-scope authorisation boundary. Add versioned quarterly-review templates, scoring policies and bands; immutable template-version/item lineage; pinned audit runs and response history; findings, actions and transition events; acknowledgements; positive observations; and private evidence metadata/object links.

Draft response rows remain resumable, while each create/update is recorded as a minimised audit event without copying comments or evidence. Finalisation freezes the response rows and calculated result; any future amendment must append controlled history instead of rewriting the final audit.

The synthetic development outcome factors are `COMPLIANT = 1.0`, `POSITIVE_PRACTICE = 1.0`, `PARTIALLY_COMPLIANT = 0.5`, `NON_COMPLIANT = 0`, and `IMMEDIATE_ACTION_REQUIRED = 0`. They are versioned configuration, not permanent policy. `NOT_APPLICABLE` and configured non-scored items are excluded. `NOT_OBSERVED` is non-scored, requires a reason, never means compliant, and cannot hide an unresolved critical requirement. Percentage score and risk status remain separate; a critical finding overrides comfort from a high average.

Ordinary findings/actions are reconciled idempotently at finalisation. A configured `IMMEDIATE_ACTION_REQUIRED` response creates or escalates its finding/action immediately during an in-progress audit, and finalisation reuses it. Exactly one eligible remediation owner may be selected automatically. Zero or multiple candidates require an Area Manager choice from server-validated candidates before finalisation; no arbitrary selection is allowed. Owner choice is audited.

Changing a draft response so that an already-created immediate or critical finding is no longer required needs an explicit correction reason. The finding and its corrective action move to `WITHDRAWN`; they remain as historical records with append-only state events but are excluded from active risk, action and oversight counts. A later qualifying response reactivates the same lineage instead of creating a duplicate, and finalisation reconciles the current active state idempotently.

Scores are rounded to two decimal places before presentation and band selection. Bands use contiguous half-open ranges, except that the highest range includes `100`; a policy cannot become active with a gap, overlap, invalid range or duplicate priority. Oversight reads the stored audit band against the audit's pinned scoring-policy version and its explicit internal-threshold classification rather than applying an application-code percentage constant.

Critical and immediate actions require independent verification at both the application and database boundaries. The remediation submitter cannot verify and close their own critical action, even when holding another role. Corrective-action events describe only persisted status changes; evidence submission is a distinct domain event rather than a fictional intermediate status. Significant transitions are append-only and attributable.

Evidence storage is private. Local synthetic uploads may remain explicitly `not_scanned` and the interface must disclose that status. In non-local environments an unscanned new object is unavailable until an approved scanning control exists. Compliance Managers may access audit/finding/action/remediation evidence only within their authorised organisation compliance scope; this grants nothing in wellbeing, Finance, coaching, HR, or another sensitive domain.

## Consequences

- Canonical Area Manager, Centre Director and Compliance Manager bundles receive reviewed domain capabilities through a new version; System Administrator and Executive receive no implied business mutation rights.
- Every business API is `auth: true` and re-evaluates current PostgreSQL authority and record scope.
- Finalised audit inputs and score snapshots are immutable; a later amendment workflow must append history instead of rewriting it.
- Comparable-quarter and repeat-finding calculations use stable item lineage and compatible methodology versions, not wording comparison.
- The pilot template and all local people/centres are synthetic development data with no official regulatory assertion.

## Deferred

Official regulatory content, QIP, notifications/PubSub, Daily Success, coaching, wellbeing, budget, AI, Graph/SharePoint/HR/CRM integration, executive dashboards, production evidence scanning, and final production retention/legal-hold operations remain outside Milestone 2B.
