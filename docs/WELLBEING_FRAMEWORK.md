# Wellbeing Framework

## Purpose and boundary

Centre Success may support leadership and staff wellbeing through voluntary check-ins, approved resources, safe aggregate trends, and explicit requests for support. The feature must increase access to support without becoming a surveillance, clinical, diagnostic, or automatic employment-decision system.

The system is not an emergency service. It does not diagnose distress, infer mental health status, or promise confidentiality beyond the operating model Bright Steps has approved and clearly communicated.

## Non-negotiable principles

1. State purpose, audience, data use, retention, visibility, and limits before collection.
2. Collect the minimum information needed.
3. Prefer anonymous or privacy-preserving aggregates for climate insight.
4. Separate survey responses, identified support requests, coaching, HR, audit, and performance records.
5. No individual response feeds Centre Health, internal audits, performance, compliance, or AI retrieval.
6. Participation, non-participation, and response content do not affect a person’s score or employment outcome.
7. Small cohorts and filter combinations are suppressed to prevent reidentification.
8. Provide approved human support pathways and clear emergency information.

## Capability layers

### Resource hub

Approved, current internal and external wellbeing resources with owner, review date, audience, jurisdiction/location where relevant, and emergency disclaimer. Viewing a general resource should not create a sensitive profile.

### Personal check-in

A private reflection experience can be offered without storing content. If saved reflections are proposed later, they require a separate privacy design and must not become visible to managers or administrators.

### Organisational pulse

An approved campaign collects a minimal set of responses under a declared anonymity/confidentiality model. It produces only threshold-safe aggregates for defined cohorts and questions.

### Explicit support request

A user deliberately identifies themselves, selects a support pathway or authorised recipient, understands what will be shared, and can track acknowledgement. This is separate from anonymous pulse data.

## Campaign design

Before activation, the campaign owner records:

- approved purpose and prohibited uses;
- questions and version;
- eligible audience and sampling period;
- anonymous, pseudonymous, or confidential model;
- whether identity is ever collected and why;
- minimum reporting threshold and complementary suppression rules;
- approved viewers and aggregate dimensions;
- collection notice/consent or other validated basis;
- retention/deletion and withdrawal/correction handling;
- resource/support/escalation pathways; and
- privacy, people, security, and where appropriate legal review.

Questions avoid unnecessary health details, free text, child/family details, and leading or coercive language.

## Anonymity and confidentiality architecture

The UI must never call a campaign anonymous if the data model, logs, unique links, timestamps, or administrators can reasonably connect responses to a person.

Where one-response enforcement is required, eligibility/participation tokens should be separated from response content as far as practicable. Operational telemetry must not re-create the link. Campaign administrators see completion counts only at an approved aggregation level.

If a confidential identified model is used, named access and use restrictions are explicit. A System Admin role alone never grants response access.

## Aggregate protection

- Publish only cohorts meeting an approved minimum threshold; exact threshold requires privacy review.
- Apply complementary suppression so totals cannot reveal a hidden small cell.
- Restrict repeated slicing, differencing, export, and combination with staffing data.
- Consider response diversity and dominance, not count alone, before publication.
- Do not publish free-text responses in small cohorts; thematic analysis requires a separately approved method.
- Carry campaign version, cohort definition, count band, suppression state, and freshness with every aggregate.
- Prevent AI from querying around suppression via repeated prompts.

## Support and urgent situations

An explicit support request states expected response time and recipients. Notifications contain minimal sensitive content. Access and status changes are audited. A user can always see the current recipient set where policy permits.

Campaigns and resources show approved internal contacts and Australian emergency/crisis pathways appropriate at the time of release. These details must be owned and reviewed by Bright Steps; the architecture does not hardcode them.

Automated text analysis must not determine suicide/self-harm risk, diagnose, or trigger undisclosed employment action. Any future safety triage requires specialist, legal, clinical, privacy, and human-factors review before an architecture decision.

## Use in Centre Health and executive views

The safest MVP position is to keep wellbeing outside the Centre Health score. If Bright Steps later approves an aggregate wellbeing dimension:

- participants must be told before collection;
- only published threshold-safe aggregates may be used;
- missing/suppressed data is neutral, not negative;
- no drill-through to individuals exists;
- the score explanation states the use and coverage; and
- fairness and unintended-incentive review is mandatory.

Executives and Area Managers see only approved aggregates, never individual answers or support requests through their ordinary role.

## Data lifecycle

- Keep campaign configuration, responses, aggregates, and support requests in distinct access domains.
- Retain raw responses only as long as approved and necessary; delete or irreversibly de-identify under policy.
- Propagate deletion/supersession to derived indexes and AI systems.
- Audit campaign configuration, privileged access, exports, suppression changes, and support-request access.
- Backups, logs, analytics, and test data follow the same privacy model.

## Success and harm measures

Useful measures include safe participation rates, aggregate availability, resource usefulness, support acknowledgement against communicated time, and trust/safety feedback. Monitor reidentification risk, inappropriate access attempts, coercion reports, unexpected low participation, notification misrouting, and misuse in employment decisions.

## Open decisions before implementation

- Whether wellbeing is in MVP at all.
- Legal/privacy/people operating model and collection basis.
- Campaign identity model and approved question set.
- Aggregation threshold, suppression, and export policy.
- Support recipients, response times, out-of-hours and urgent pathway.
- Retention, deletion, access/correction, and complaints process.
- Whether any aggregate may contribute to Centre Health.
