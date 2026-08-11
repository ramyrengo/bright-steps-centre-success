# Milestone 2B Engineering Follow-ups

**Status: tracked before broad multi-centre rollout.** These items are deliberately outside the acceptance-remediation implementation. They may not weaken current scope filtering or authorisation correctness.

## Batched collection authorisation

The current Area Manager and Centre Director multi-record list boundaries load candidate rows, then make one database-backed authorisation decision per distinct resource. Static inspection measures this as one list query plus `N` authorisation snapshots for `N` candidate centre records; each snapshot currently performs four principal/context queries and three centre/hierarchy queries (seven SQL reads, plus transaction control). Owner resolution uses one candidate query and three centre/hierarchy reads, then four context reads per candidate and one locking query per allowed candidate during a mutation. This is correct and fail-closed, but grows linearly with centres/candidates.

Before broad multi-centre rollout, measure this with representative portfolio sizes and add a batch authoriser that resolves one principal's effective tenant context, hierarchy facts, and requested centre IDs in one repeatable-read snapshot. It must return only explicit allow decisions, retain active-tenant/effective-date semantics, and preserve the collection rule that inaccessible rows are omitted without disclosing their existence. Do not replace this with frontend filtering or a broad organisation-level allow.

## Organisational-unit Compliance oversight

Milestone 2B oversight is an organisation-scoped Compliance Manager view. An organisational-unit-only Compliance assignment is not treated as organisation-wide authority and therefore cannot use this endpoint. Region/state-filtered oversight needs a separately approved resource contract and tenant-constrained query; it must not be inferred by returning the organisation aggregate.

## Future one-to-many finding resolution

Milestone 2B intentionally enforces one corrective action per finding. If a later approved workflow permits one finding to have multiple actions, finding resolution must require every non-withdrawn required action to reach an accepted terminal state. The future schema/service change needs explicit aggregation, concurrency, reopen, audit-history, and migration rules before removing the current uniqueness guard.
