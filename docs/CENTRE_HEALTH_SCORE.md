# Centre Health

## Purpose

Centre Health is an explainable, versioned operational indicator that helps leaders identify where a centre is thriving, where support is needed, and what action may improve the position. It combines positive and risk signals without replacing professional review.

It is **not**:

- an ACECQA or regulatory rating;
- a prediction that a centre is legally compliant;
- a staff performance or disciplinary score;
- a clinical or individual wellbeing assessment;
- a public ranking of centres; or
- a substitute for reading critical findings and underlying evidence.

## Design principles

1. Show urgent facts and critical exceptions before an aggregate number.
2. Pair every negative factor with a clear explanation, source, freshness, and appropriate next step.
3. Recognise sustained strengths, verified improvement, timely action, and quality practice.
4. Avoid false precision: display coverage and confidence and suppress a score when data is insufficient.
5. Preserve centre context and avoid simplistic league tables.
6. Version methodology and keep historical results reproducible.
7. Exclude identifiable wellbeing and other purpose-incompatible data.
8. Let authorised users annotate context without editing calculated history.

## Candidate dimensions

Final dimensions and weights require Bright Steps approval and baseline analysis.

| Dimension | Candidate signals | Exclusions/guardrails |
| --- | --- | --- |
| Compliance readiness | Overdue approved controls, evidence freshness/completeness, accepted findings, high-priority action age/recurrence | Does not declare legal compliance; critical facts remain visible separately |
| Internal assurance | Quarterly internal audit outcomes, coverage, critical items, verified follow-through, trend comparability | Internal method only; no NQS rating labels; spot checks not mixed without approved method |
| Quality improvement | QIP review freshness, progress on meaningful improvements, strengths, evidence-backed reflection | Do not reward quantity of QIP entries or premature closure |
| Daily leadership | Priority acknowledgement, blocker escalation, timely ownership, sustainable completion | No keystroke/activity surveillance; absence may reflect leave or system outage |
| People capability | Approved certification/expiry readiness and coaching commitments where shareable | No inferred competence, medical data, or private coaching notes |
| Budget accountability | Reconciled variance/warning acknowledgement and forecast quality | No unauthorised line detail; stale/unreconciled data lowers confidence rather than blame |
| Wellbeing climate | Only approved, threshold-safe aggregate trend if participants were told of this use | No individual responses/support requests; optional dimension may be excluded entirely from MVP |
| Positive quality | Recognitions, sustained strengths, verified action effectiveness | Recognition cannot cancel unrelated critical risk |

## Methodology

A methodology version specifies:

- dimensions, input definitions, source states, time windows, and exclusions;
- normalisation and weights;
- minimum coverage and freshness;
- hard gates/caps for approved critical conditions;
- missing-data behaviour;
- confidence calculation;
- band labels and thresholds;
- comparison rules; and
- approver, effective dates, validation evidence, and change notes.

A conceptual calculation is:

`weighted sum of eligible dimension results`, followed by approved critical gates/caps.

This is deliberately not a production formula. Exact weights, thresholds, and labels are open decisions. The architecture prevents a high average from hiding an urgent finding by always displaying the exception and allowing a versioned cap or no-score state.

## Snapshot output

Each published centre snapshot contains:

- as-of timestamp and centre-local business date;
- methodology version;
- overall score/band if eligible;
- confidence/coverage and stale or unavailable inputs;
- dimension results;
- top positive contributions;
- top attention contributions;
- critical exceptions independent of score;
- changed factors since the last comparable snapshot;
- links to authorised source records and next actions; and
- contextual annotation history.

Snapshots are append-only. A later data correction creates a labelled recalculation, not an invisible rewrite.

## Data quality and missing data

- An integration failure or missing input must not automatically become a negative centre judgement.
- Stale or incomplete data reduces coverage/confidence and is visible.
- Planned closures, centre transitions, leave, and newly onboarded centres require approved exclusion/context rules.
- Users can report incorrect source data; the owning workflow corrects it and the score refreshes with provenance.
- Comparable trend requires compatible methodology and source coverage.

## Positive recognition

Recognition can originate from an internal audit strength, QIP milestone, verified sustained improvement, coaching achievement shared by agreement, or authorised manual recognition. It records evidence, author, audience, expiry/review, and privacy. Recognition is displayed as substantive context, not as gamified points that pressure staff.

## Views by role

- **Centre Director:** own-centre snapshot, explanation, strengths, attention items, and actions.
- **Area Manager:** assigned-centre portfolio with prioritisation and context; no broad ranking export by default.
- **Compliance Manager:** authorised compliance/assurance dimensions and underlying exceptions.
- **Finance:** finance dimension and permitted context only.
- **Executive:** organisation/approved scope summaries and controlled drill-through.
- **Wellbeing specialist:** safe aggregate source view, not operational score detail unless separately authorised.

Role access to the score never grants access to a restricted underlying record. Restricted contributions use safe summaries or are omitted.

## Governance and fairness

- A cross-functional owner group approves methodology, not a single developer or AI model.
- Validate against historical data for centre size, jurisdiction, service context, missingness, and unintended incentives.
- Conduct privacy and employee-impact review before using people or wellbeing signals.
- Publish a plain-language data dictionary and change notice.
- Provide a correction/challenge route and record annotations.
- Review for gaming, disparate effects, and whether the score actually predicts support needs.
- Never use Centre Health as the sole basis for disciplinary, employment, regulatory, or funding decisions.

## Refresh architecture

Authoritative domain events can request recalculation through Encore Pub/Sub. Subscribers are idempotent and coalesce rapid changes. A scheduled reconciliation detects missed events. The calculation reads consistent authorised source snapshots and writes a new Centre Health snapshot only when inputs/methodology warrant it.

## MVP recommendation

Begin with an **explainable dashboard of dimensions and critical exceptions**, not an overall number. Introduce an overall score/band only after data quality, governance, fairness, and user testing meet agreed gates. Wellbeing should remain separate until an explicit privacy-approved aggregate use is accepted.

## Open decisions

- Whether MVP includes an overall score or dimensions only.
- Dimensions, weights, windows, gates, thresholds, and labels.
- Minimum coverage/confidence and new-centre treatment.
- Permitted people, coaching, wellbeing, and finance signals.
- Governance body, challenge process, and review cadence.
- Portfolio comparison/export policy.
