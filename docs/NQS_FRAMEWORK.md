# NQS Framework

## Purpose and safety boundary

Centre Success will support self-assessment, quality improvement, internal assurance, and traceability to the National Quality Framework (NQF). It is not an official assessment-and-rating system and must not present internal outcomes as ratings issued by ACECQA or a state or territory regulatory authority.

This architecture does not reproduce legislation as application rules. External content enters through a versioned source-governance process and requires an authorised Bright Steps compliance owner to verify applicability and interpretation.

## Current authoritative frame

As checked on **11 August 2026**, ACECQA describes seven National Quality Standard (NQS) Quality Areas:

1. Educational program and practice.
2. Children’s health and safety.
3. Physical environment.
4. Staffing arrangements.
5. Relationships with children.
6. Collaborative partnerships with families and communities.
7. Governance and leadership.

The current ACECQA material reflects NQF child-safety changes that commenced across 2025 and 2026. Exact provisions, commencement dates, jurisdictional application, and later amendments must be verified rather than inferred.

Primary reference entry points:

- [ACECQA — National Quality Standard](https://www.acecqa.gov.au/nqf/national-quality-standard)
- [ACECQA — Guide to the National Quality Framework, updated 2026](https://www.acecqa.gov.au/sites/default/files/2026-03/Guide-to-the-NQF-260326.pdf)
- [ACECQA — National Regulations and jurisdiction notes](https://www.acecqa.gov.au/nqf/national-law-regulations/national-regulations)
- [ACECQA — NQF child-safety changes](https://www.acecqa.gov.au/nqf-child-safety-changes-1-september-2025-and-1-january-2026)
- [ACECQA — Self-assessment and quality improvement planning](https://www.acecqa.gov.au/national-quality-framework/guide-nqf/section-3-national-quality-standard-and-assessment-and-rating/assessment-and-rating-process/2-self-assessment-and-quality-improvement-planning)
- [ACECQA — Assessment and rating process](https://www.acecqa.gov.au/assessment/assessment-and-rating-process)

Links are reference locations, not embedded legal advice. The compliance owner must confirm the authoritative instrument for each applicable jurisdiction, including NSW and WA differences noted by ACECQA.

## Framework model

The source library represents a hierarchy without hardcoding it into product logic:

`framework -> framework version -> quality area -> standard -> element -> concept/guidance reference`

Each node records:

- stable internal identifier and official label/code where present;
- verbatim source reference or licensed excerpt only where authorised;
- source document/URL, issuing authority, jurisdiction, publication and access dates;
- effective-from, effective-to, status, and superseding version;
- content hash and change note;
- verification state (`draft`, `under_review`, `approved`, `superseded`, `withdrawn`);
- reviewer and approval evidence; and
- mappings to internal controls, audit items, evidence guidance, strengths, and QIP improvements.

Official hierarchy nodes are separate from Bright Steps policy and practice guidance. A user can always tell whether a statement is an external source, an internal policy, a local centre practice, or AI-generated assistance.

## Jurisdiction and applicability

Applicability is evaluated from centre jurisdiction, service characteristics supplied by an approved source, effective date, and approved control rules. The model permits:

- national framework content;
- jurisdiction-specific source versions and variations;
- organisation-wide Bright Steps controls;
- state/region policy overlays; and
- centre-specific improvement priorities.

When applicability is unclear, the engine marks the item `review_required`; it does not guess. A future-dated change can be previewed before activation. Historical records retain their original source and control versions.

## Self-assessment

For each applicable framework node, a centre may record:

- current practice narrative;
- strengths and positive recognition;
- critical reflection and stakeholder participation;
- evidence links;
- confidence and last-reviewed date;
- improvement opportunities; and
- reviewer comments.

Self-assessment is qualitative and evidence-backed. It is not reduced to a single NQS score. Internal audit outcomes can inform reflection but do not overwrite it.

## Living Quality Improvement Plan

Centre Success supports the QIP as a dynamic working plan and can produce approved snapshots. The model provides:

- centre philosophy and version history;
- self-assessment context;
- strengths;
- improvement goal, desired outcome, priority, responsible owner, milestones, measures, due/review dates, progress, and evidence;
- links to Quality Areas, standards/elements, internal controls, audits, coaching, and recognition;
- collaboration notes from educators, children, families, and community where appropriate and safely recorded; and
- publication/snapshot history.

ACECQA states that QIPs support self-assessment and improvement and that specific National Regulations apply to their content, availability, preparation, and review. Centre Success will not encode a fixed interpretation until Bright Steps verifies the applicable current requirements and jurisdictional submission process.

## Internal mapping rules

- A control or audit item may map to multiple framework nodes and must state the mapping rationale.
- A mapping does not mean the internal control text is the official requirement.
- Internal audit results use internal outcome labels and scoring; they never output an official NQS rating.
- Source changes trigger impact review rather than automatic remapping.
- Removed or superseded nodes remain queryable for historical records.
- QIP improvements can exist without an NQS mapping where the centre identifies another legitimate improvement priority.

## Governance roles

- **Source registrar:** records the publication without interpretation.
- **Compliance author:** proposes applicability and control mappings.
- **Reviewer/approver:** verifies source, jurisdiction, wording, and effective date; should be independent of the author for material changes.
- **Publisher:** activates the approved version at the planned time.
- **Centre/quality contributor:** performs self-assessment and QIP work but cannot alter official source content.

## Change monitoring and release

1. Register a source and immutable copy or reference where permitted.
2. Compare it with the last approved source version.
3. Assess affected framework nodes, controls, audit templates, guidance, schedules, and AI knowledge.
4. Obtain legal or specialist review where required.
5. Test applicability and migration behaviour.
6. Approve with effective date and communication plan.
7. Activate, create impact-review tasks, and invalidate superseded AI index entries.
8. Retain the full decision and supersession trail.

## Open decisions before implementation

- Initial jurisdictions and service types in scope.
- Authoritative-source ownership and legal-review process.
- Licensed content that may be stored verbatim versus referenced.
- QIP export format and jurisdiction-specific submission/support needs.
- Bright Steps mapping methodology and approval authority.
- Frequency and method of source-change monitoring.
