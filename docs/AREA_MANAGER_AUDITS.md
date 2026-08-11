# Area Manager Audits

## Purpose and boundary

Area Manager audits provide consistent internal assurance, coaching context, and corrective-action follow-through across assigned centres. They are not inspections by a regulatory authority and their outcomes are not official NQS Quality Area or overall ratings.

Every screen, export, and API representation must label results **Bright Steps internal audit** and identify the template/methodology version.

## Audit types

### Quarterly audit

A planned, broad internal review at each centre using the approved quarterly template. The default cadence is a business requirement to confirm, not a statement of regulation.

### Spot check

A focused internal check using an approved subset or purpose-built template. It records its trigger and scope and is not automatically comparable with a quarterly audit.

### Follow-up verification

A narrow review of completed corrective actions or previously failed items. It determines internal effectiveness under approved policy but does not rewrite the original result.

## Template governance

Templates follow `draft -> review -> approved -> active -> superseded/retired` and contain:

- purpose, audit type, owner, jurisdiction/applicability, and effective dates;
- sections and ordered items;
- item wording, guidance, permitted outcomes, evidence expectations, and comment rules;
- source/control/NQS mappings with rationale;
- weight, critical flag, score treatment, and not-applicable rule;
- finding and draft-action mapping;
- moderation and finalisation requirements; and
- comparison mapping to earlier template versions.

An audit pins the template version at scheduling. Active audits do not silently change when a template is superseded. Completed audits remain reproducible.

## Scheduling and assignment

- The scheduler creates an audit window, centre, assigned Area Manager/auditor, due dates, and required moderator if applicable.
- The backend verifies the auditor’s assignment to the centre for the whole operation.
- Conflicts of interest and substitutions are recorded.
- Temporary coverage uses an effective-dated delegation.
- Rescheduling preserves original dates and reason.
- Missed or overdue audits surface to the appropriate manager; they are not auto-finalised.

## Preparation

The Centre Director receives a proportionate preparation list and can link existing authorised evidence. Area Managers can review:

- previous comparable audits;
- open findings/actions;
- relevant current controls and source versions;
- QIP improvements and documented strengths;
- recent evidence within classification scope; and
- earlier coaching commitments only where sharing is permitted.

The system should reduce duplicate evidence collection and show freshness. It must not encourage staging or altering records to create a false audit picture.

## Item outcomes

The exact labels require business approval. The architecture supports outcomes such as:

- `met`;
- `partially_met`;
- `not_met`;
- `not_applicable` with required rationale; and
- `not_assessed` with required reason.

Each response records observation, evidence, author, timestamps, and confidence/information gap where needed. A negative outcome requires factual notes. A critical item cannot be neutralised by optional positive items.

## Scoring model

Scoring is a versioned internal methodology. A candidate calculation is:

`weighted achieved points / weighted eligible points x 100`

The approved template defines outcome points, weights, eligibility, rounding, and section roll-up. The result also includes:

- critical-item flags and score caps/gates;
- count of not assessed and information gaps;
- coverage percentage;
- evidence-completeness indicator;
- methodology version; and
- provisional/final status.

No threshold may use ACECQA rating names. The UI shows factor-level explanations and never presents the number without critical exceptions and coverage.

## Automatic actions from failed items

When an approved item mapping is triggered:

1. Create or link a draft finding using a stable audit/item key.
2. Pre-fill factual source, centre, audit, item, outcome, and evidence links.
3. Propose severity only from approved explicit rules.
4. Create a draft corrective action with expected outcome and default timing where configured.
5. Require an authorised Area/Compliance Manager to confirm severity, owner, due date, and verification method.
6. Notify the Centre Director after confirmation, avoiding sensitive detail in the notification.

Retries must not duplicate findings or actions. The audit can be finalised only when required action mappings are resolved or explicitly waived by authorised policy.

## Finalisation, response, and amendment

- The engine validates required items, evidence/comments, not-applicable reasons, and mapped findings.
- The Area Manager submits for moderation if required.
- Finalisation freezes responses, scoring inputs, methodology, and evidence-link snapshot.
- The Centre Director acknowledges and may add a visible response or factual challenge.
- Corrections after finalisation use a controlled amendment/reopen workflow with reason, authority, before/after values, score impact, and notifications.
- Original versions remain available in the audit history.

## Quarterly comparison

A comparison is allowed only when the methodology declares items/sections comparable. It shows:

- prior and current score with methodology versions;
- item-level improved, sustained, declined, new, removed, or not comparable status;
- critical-item changes;
- open/closed/repeated findings;
- evidence and coverage differences;
- contextual annotations; and
- QIP/coaching links where permitted.

Template changes use explicit mapping and never fabricate a trend. Comparisons support learning and triage, not public league tables or automatic performance conclusions.

## Positive quality recognition

Auditors can record a strength with observed practice, evidence, related Quality Area/internal theme, and consented audience. Recognition may feed the QIP strengths record and Centre Health positive signals. It must not expose child or staff information, and it does not offset an unrelated critical finding.

## Access and confidentiality

- Centre Directors see their centre’s audits and responses.
- Area Managers see audits for assigned centres.
- Compliance Managers see authorised organisation/region scope.
- Executives normally receive summaries and can drill down only where classification and capability permit.
- Coaching-restricted and wellbeing data are not audit evidence by default.
- External reviewer access is audit-specific and time-bound.
- Evidence download/export requires its own capability and is audited.

## Operational metrics

- completion timeliness and coverage;
- findings by approved tier and recurrence;
- corrective-action acceptance, overdue, and verified-closure time;
- comparison eligibility and methodology mix;
- moderation changes;
- strengths/recognitions; and
- auditor consistency indicators used for calibration, not covert personnel scoring.

## Open decisions

- Quarterly and spot-check templates, outcomes, weights, thresholds, and critical gates.
- Which audit types require moderation and independent verification.
- Target cadence and rescheduling authority.
- Comparison policy across template releases.
- Centre Director challenge and dispute-resolution process.
- Whether limited offline capture is required and its device/security constraints.
