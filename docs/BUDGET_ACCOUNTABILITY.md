# Budget Accountability

## Purpose and boundary

Budget Accountability gives Centre Directors and authorised leaders timely, understandable visibility of financial position and an accountable response workflow. It does not replace Bright Steps’ general ledger, procurement, payroll, accounts-payable, budgeting, or financial-approval systems.

No Bright Steps finance system, chart of accounts, reporting calendar, thresholds, approval authority, or integration mechanism is assumed in this architecture.

## Outcomes

- Centre Directors understand approved budget, actuals, available balance, commitments where available, forecast, and material variance for permitted categories.
- Finance can trust source provenance, reconciliation, mappings, and freshness.
- Warnings are explainable and lead to an owner, commentary, forecast, or support request.
- Area Managers and executives see only their approved centre/category scope.
- Centre Success never creates a shadow ledger or silently changes source financial data.

## Financial concepts

Definitions must be supplied by Finance and versioned. The model distinguishes:

- **Approved budget:** an immutable approved source snapshot for a financial period/version.
- **Actual:** posted expenditure/revenue supplied by the system of record as of a stated cutoff.
- **Committed:** approved but not yet posted value only if the source can provide a reliable definition.
- **Remaining:** approved budget less included actual/commitment categories under the declared method.
- **Forecast:** expected period outcome with method, assumptions, author, and version.
- **Variance:** amount and percentage relative to the chosen approved/forecast baseline.
- **Warning:** a versioned rule result requiring awareness or response; not necessarily a policy breach.

Each value carries currency, period, source batch, cutoff/freshness, mapping version, and reconciliation state.

## System-of-record relationship

The nominated finance platform remains authoritative for transactions, approvals, vendors, accounts, and official reporting. Centre Success stores immutable imported snapshots/lines or approved aggregates needed for the product purpose, plus local forecasts, warnings, and commentary.

Corrections follow one of two governed paths:

1. correct in the source and import a new batch; or
2. record a clearly labelled Centre Success adjustment/annotation under Finance authority without rewriting original imported data.

## Ingestion and reconciliation

1. Receive a signed/authorised API response, governed file, or manual Finance import.
2. Validate connection, organisation, centre codes, period, currency, categories, schema/version, totals, duplicates, and cutoff.
3. Map external identifiers through an approved, versioned mapping.
4. Quarantine unknown centres/categories and malformed or conflicting rows.
5. Reconcile counts/totals against source control values.
6. Require Finance review where policy specifies.
7. Publish the batch atomically to permitted views and retain prior versions.
8. Record source, actor/service identity, time, hash/reference, and result.

Partial or stale imports are visibly marked and must not create misleading warnings. Retries are idempotent by source batch/event key.

## Centre Director experience

For a permitted centre and period, show:

- approved budget and source/version;
- actual and cutoff date;
- committed value only when trusted and defined;
- available/remaining under the displayed formula;
- current forecast and assumptions;
- amount and percentage variance;
- trend versus earlier periods where accounting definitions are comparable;
- warnings, owner, required response, and due date;
- allowed line-group drill-down; and
- data freshness/reconciliation caveats.

The view uses plain language and accessible visuals. It avoids red/green-only meaning and does not show restricted payroll, personal remuneration, bank, tax, or vendor details unless specifically authorised.

## Forecasting

MVP forecasting should be transparent and simple:

- user-entered forecast with reason/assumptions; and/or
- deterministic run-rate or Finance-approved formula with visible inputs.

Store each forecast as a version. Never present a model output as guaranteed. AI may explain or draft assumptions but cannot approve a forecast or spending decision. Advanced predictive models require sufficient history, validation, bias/error monitoring, and a later architecture decision.

## Warning framework

A rule version defines metric, scope/category, period window, threshold, direction, minimum data freshness, severity label, recipients, acknowledgement, and effective dates. Candidate categories—not approved thresholds—include:

- actual or forecast overspend;
- unusually rapid consumption for period elapsed;
- missing/stale actuals or unreconciled batch;
- significant forecast change;
- persistent variance; and
- missing owner/commentary after a warning.

Warnings progress `new -> acknowledged -> response_in_progress -> resolved/closed`, with `suppressed` or `not_applicable` requiring approved reason and expiry. Resolution does not change the underlying finance values.

## Accountability and approvals

- Centre Directors can comment, forecast, acknowledge, and own permitted responses for their centres.
- Area Managers see/manage warnings only for assigned centres and approved categories.
- Finance configures definitions/rules, validates imports, and controls restricted detail.
- Executives see approved organisation/portfolio summaries and controlled drill-through.
- System Administrators manage technical connections but cannot read financial content by default.

Financial delegations and spending approval remain in the authoritative finance/procurement process unless a later approved decision brings them into scope.

## Centre Health relationship

Centre Health may use only an approved finance dimension such as reconciled warning status, forecast freshness, and acknowledged accountability—not restricted transaction detail. Missing or failed finance data reduces confidence; it does not automatically penalise a centre. The finance contribution is visible to users authorised for that context and cannot mask critical non-financial issues.

## Security and privacy

- Separate summary, detail, import, configuration, forecast, and export capabilities.
- Restrict centre/category scope in every backend query.
- Protect import endpoints, files, webhooks, and mappings against tampering/replay.
- Store integration credentials in Encore secrets when approved, never in source or tables.
- Audit imports, mapping changes, rule changes, forecasts, adjustments, warnings, exports, and privileged reads.
- Minimise finance detail in logs, traces, notifications, AI prompts, and analytics.
- Use short-lived controlled exports with manifests and expiry.

## Open decisions before implementation

- Finance system(s) of record and integration method.
- Financial calendar, currency, chart/category mapping, and source identifiers.
- Definitions of actual, commitment, remaining, forecast, and variance.
- Centre Director, Area Manager, Executive, and Finance visibility by category.
- Warning rules, thresholds, severities, response/approval authorities.
- Refresh frequency, cutoff and reconciliation controls.
- Retention, export, and audit requirements.
- Whether any budget capability belongs in the first MVP release.
