# ADR-0019: Finding source families

- **Status:** Proposed for independent review; Product Owner decisions incorporated. The source-family model described here is implemented alongside ADR-0018 and passed the same local implementation gate at integration commit `1bf06b7`; independent review and Product Owner acceptance of that implementation are outstanding.
- **Date:** 2026-08-13
- **Decision owner:** Product Owner

## Context

M2B findings are physically coupled to a quarterly audit run and response. Centre Standards 4A needs approved operational outcomes to create findings and, where configured, corrective actions without pretending that an operational response is an audit response. Making existing audit columns merely nullable would permit sourceless, mixed, half-audit and cross-tenant records and would weaken accepted M2B integrity.

Corrective actions already reference a finding and do not need a second source pointer. The safe extension is therefore a source-family invariant on findings, followed by explicit migration of consumers that currently assume every finding has an audit origin.

This ADR authorises architecture only. It performs no schema or consumer change.

## Decision

### Explicit source family

A finding has exactly one immutable source family equivalent to:

- `QUARTERLY_AUDIT`;
- `OPERATIONAL_CHECK`.

For `QUARTERLY_AUDIT`:

- `audit_run_id IS NOT NULL`;
- `audit_response_id IS NOT NULL`;
- `check_response_id IS NULL`.

For `OPERATIONAL_CHECK`:

- `audit_run_id IS NULL`;
- `audit_response_id IS NULL`;
- `check_response_id IS NOT NULL`.

A PostgreSQL grouped check constraint must enforce those complete alternatives. It must reject unknown families, sourceless findings, half-audit findings and mixed audit/check findings.

### Relational source integrity

Null checks are insufficient. The future migration must introduce the composite candidate keys and foreign keys needed to prove:

- source and finding belong to the same organisation;
- source and finding belong to the same centre;
- an audit response belongs to the finding's named audit run;
- the audit run belongs to the same organisation and centre;
- a check response belongs to an occurrence in the same organisation and centre;
- no source can be borrowed across tenants, centres, runs or occurrences.

For the audit family, the target relational invariant is equivalent to:

1. an audit run exposes a unique `(organisation_id, centre_id, audit_run_id)` key;
2. an audit response carries/backfills immutable organisation and centre ownership and exposes a unique `(organisation_id, centre_id, audit_run_id, audit_response_id)` key;
3. that response key has a composite foreign key to its run; and
4. the finding's `(organisation_id, centre_id, audit_run_id, audit_response_id)` has a composite foreign key to the response key.

For the operational family, the target invariant is equivalent to:

1. a check occurrence exposes a unique `(organisation_id, centre_id, occurrence_id)` key;
2. a check response carries the same ownership and occurrence identifier, with a composite foreign key to the occurrence;
3. a check response exposes a unique `(organisation_id, centre_id, check_response_id)` key; and
4. the finding's `(organisation_id, centre_id, check_response_id)` has a composite foreign key to that response key.

Equivalent designs are acceptable only if PostgreSQL proves the same relationships. Triggers or service validation alone are not a substitute for enforceable referential identity.

Source references use restrictive history semantics. A source response with a finding cannot be deleted to erase its origin. Corrections and withdrawals use the existing append-only state/event approach rather than source replacement.

### Backfill and uniqueness

All existing findings are backfilled to `QUARTERLY_AUDIT` while their audit source columns remain required. Ownership columns and composite candidate keys are backfilled and validated before audit-source nullability is relaxed. The grouped source constraint and foreign keys are validated before application consumers can create operational findings.

Source-specific partial uniqueness must guarantee:

- at most one finding for a quarterly audit response in its tenant/source context; and
- at most one finding for an operational check response in its tenant/source context.

Retry and finalisation logic must find/reconcile the existing source-family record rather than create a duplicate.

### Corrective actions stay structurally unchanged

`corrective_actions` continues to reference exactly one finding. It receives no audit/check discriminator or duplicate source columns. The finding is the authoritative origin boundary.

The corrective-action lifecycle, owner, due date, evidence, submission, verification, independence, withdrawal/reactivation and append-only event rules remain unchanged. Source-specific presentation is joined through the finding.

### Discriminated action origin contract

Every source-aware action API and product surface represents origin as a discriminated union rather than a common object padded with audit defaults.

- `QUARTERLY_AUDIT` is labelled **Quarterly review** and may present authorised detail such as “From the Q2 2026 quarterly review”. Its branch may contain audit-only properties such as `originatingAuditId`, `originatingAuditStatus` and `originatingAuditAcknowledged`.
- `OPERATIONAL_CHECK` is labelled **Centre Standard** and may present authorised detail such as “From the Centre Standards Pilot — Staging check on <date>”. Audit-only properties are absent from this branch; they are not emitted as meaningless `null` or `false` assertions.

The public contract does not expose internal source-family enum names to ordinary Educators. Source-specific identifiers remain opaque and are returned only where needed for authorised routing or detail. Request input cannot select or rewrite an origin.

The synthetic 4A origin retains its staging marker in the finding description, required-remediation text copied to the corrective action, and action-origin presentation. This makes a downstream action visibly synthetic without changing its accepted corrective-action lifecycle.

### Consumer migration map

The implementation must identify each audit assumption rather than applying a broad nullable-column patch. At minimum:

| Consumer | Required treatment |
| --- | --- |
| `loadResponseConfiguration` and `ensureFindingAndAction` in `quarterly-reviews/service.ts` | Require `QUARTERLY_AUDIT`; preserve one finding per audit response and existing correction/reactivation behaviour. |
| `loadFinalisationRows`, `ensureAuditReady` and `finaliseQuarterlyAudit` | Require a quarterly template/run and ignore operational sources while preserving scoring, critical override and section results. |
| Compliance oversight audit-run and critical-finding metrics | Keep audit metrics explicitly quarterly; include operational findings/actions only in a separately defined authorised metric, not silently. |
| `loadActionForUpdate` | Load action/finding independently of audit response; obtain accepted persisted action controls and a discriminated source projection without requiring an audit join. |
| `loadCorrectiveActionDetail` | Return the discriminated origin union above; audit-only properties including `originatingAuditId`, `originatingAuditStatus` and `originatingAuditAcknowledged` are absent from the operational branch. |
| `loadAuditIdentity`, audit-centre listing, scoring input, quarterly view and previous/comparison queries in `quarterly-reviews/queries.ts` | Require quarterly template/run subtype. |
| Existing quarterly recurrence query in `quarterly-reviews/queries.ts` | Filter to `QUARTERLY_AUDIT` and retain only the accepted quarterly methodology/lineage semantics. |
| `daily-success/corrective-action-source.ts` | Make finding/source joins source-aware; retain one action card from the corrective-action source and never duplicate an operational action in the occurrence source. |
| `daily-success/quarterly-review-source.ts` | Continue to read only quarterly runs. |
| Centre Quality generic action/finding projections | When separately implemented, accept source-aware generic actions without treating operational findings as audits; quarterly-only uncovered-finding or scoring projections must explicitly filter `source_family = 'QUARTERLY_AUDIT'` rather than relying on an audit `INNER JOIN` to discard operational rows incidentally. No current main-branch Quality consumer is changed by this ADR. |
| Centre Director corrective-action UI and contracts | Present the discriminated origin safely and preserve existing remediation/evidence behaviour; never require an audit link for an operational action. |
| Audit evidence, audit acknowledgement and positive-practice consumers | Remain audit-only; operational response photos/evidence are out of scope. |
| Compliance/action counts, searches and exports | State whether the measure is audit-only, operational-only or both; filter before counting/returning and preserve current authorization. |
| Development/staging synthetic seed | Assign explicit template/source family and never use matching lineage text to claim cross-source recurrence. |

Every source-aware action detail is discriminated. Consumers must not fabricate an audit identifier, status or acknowledgement for operational actions or expose raw polymorphic columns as an unvalidated public contract.

### Recurrence boundary

Existing `item_lineage_key` establishes lineage only within the accepted quarterly-audit methodology/version semantics. It is not proof that an item in an operational template represents the same requirement.

M2B quarterly recurrence remains unchanged in meaning and must explicitly select `QUARTERLY_AUDIT` findings. Centre Standards 4A provides no cross-source recurrence, count, badge, trend or comparison.

Future Milestone 4C recurrence requires a separately authorised, explicit governed mapping between template/item identities. Coincidentally equal lineage keys, wording, titles, outcomes or model similarity are insufficient. ADR-0019 does not introduce `governed_requirements` or pre-authorise that mapping.

No 4A product surface may state or imply that an operational issue is “the same requirement” as a quarterly-audit issue. The future governed identity/mapping is reserved architecturally for 4C only.

### Authorization and disclosure

Changing the source shape grants no access. Existing capability-plus-same-assignment-scope authorization remains mandatory for findings, actions, detail, counts, searches, evidence and exports. Collection queries filter inaccessible records rather than disclosing their existence. Action mutation resolves the source and current centre server-side and authorizes within the owning transaction.

### M2B acceptance preservation

Implementation cannot be accepted until the existing M2B matrix remains unchanged for:

- quarterly creation;
- response;
- finding;
- action;
- critical override;
- immediate action;
- correction;
- finalisation;
- scoring;
- section results;
- remediation;
- evidence;
- submission;
- independent verification;
- acknowledgement;
- positive practice;
- quarterly recurrence;
- quarter comparison; and
- Compliance oversight.

Database-backed negative tests must also prove that a finding cannot be sourceless, mixed, half-audit, cross-tenant, cross-centre, linked to an audit response from another run, or linked to a check response from another occurrence/centre.

## Consequences

- Findings become the stable source-family boundary while corrective actions retain one physical origin link.
- M2B history and uniqueness are preserved rather than weakened by nullable audit columns.
- Consumers must deliberately describe their source coverage.
- Operational findings can participate in existing remediation without misrepresenting their origin.
- Cross-source recurrence remains unavailable until governed identity mapping is separately approved.

## Deferred and locked

Tier-2 promotion from a finding to a later corrective action is not part of 4A. Cross-source recurrence and governed mappings are locked to Milestone 4C. Generic polymorphic sources, Quality/QIP mutation, evidence attachments on operational responses, and additional source families require separate architecture and Product Owner approval. Any future response-attachment gate must separately decide malware/scanning controls, child-sensitive image classification, purpose-specific access, and retention/deletion; existing corrective-action evidence is unchanged.

## Implementation gate

ADR-0018 and ADR-0019 must pass independent review together. No migration or consumer change may begin until the Product Owner explicitly authorises implementation. The future migration must be forward-only, clean-database tested, representative-data upgrade tested, and sequenced so no deployed code can create or read a partially enforced source family.
