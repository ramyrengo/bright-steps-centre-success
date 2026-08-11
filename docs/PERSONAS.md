# Personas

Personas describe user context and design pressure; they do not grant permissions. Access comes from the role, assignment, capability, and resource-scope model in [User Roles](USER_ROLES.md) and [Permissions](PERMISSIONS.md).

## Primary personas

### Centre Director — daily accountable leader

**Context:** Runs one centre, often from a phone and amid interruptions. Responsible for immediate operations, staff leadership, quality improvement, evidence, follow-through, and explaining centre context upward.

**Needs:**

- a short prioritised daily view with due dates, risk, and rationale;
- fast capture of updates and evidence without losing context;
- clear distinction between required action, recommendation, recognition, and information;
- help preparing for audits and keeping the QIP alive;
- budget information stated in operational language;
- a safe way to ask for coaching or support.

**Pain risks:** Alert overload, duplicate entry, opaque scores, tasks with no owner, compliance language without source, and wellbeing features that feel like performance monitoring.

**Success moment:** Can explain the centre’s priorities, strengths, risks, actions, QIP progress, and budget position from one trustworthy view.

### Area Manager — portfolio coach and assurance owner

**Context:** Supports a defined set of centres, balances assurance with coaching, conducts quarterly audits and spot checks, and needs comparable information without losing local context.

**Needs:**

- assignment-scoped portfolio triage;
- versioned internal audit templates and offline-tolerant/mobile capture in future UX design;
- evidence-linked findings and draft corrective actions;
- quarter-on-quarter comparison using comparable template versions;
- coaching plans, follow-ups, and positive recognition;
- temporary delegation that is explicit and time-bound.

**Pain risks:** Misleading rankings, data outside assigned centres, audit scoring that masks critical failures, and coaching notes becoming broadly visible.

**Success moment:** Identifies what requires assurance, what needs coaching, and what deserves recognition before risk becomes crisis.

### Compliance Manager — command-centre specialist

**Context:** Maintains organisational controls and templates, monitors cross-centre risk, supports interpretation, and governs evidence and corrective-action quality.

**Needs:**

- organisation-wide exception and recurrence views within approved scope;
- source provenance, effective dates, jurisdiction applicability, and review workflow;
- high-risk escalation and overdue-action tracking;
- the ability to draft and approve controls without silently rewriting history;
- access auditing and export controls.

**Pain risks:** Generated requirements presented as law, unversioned control changes, weak jurisdiction handling, and Centre Health used as a substitute for expert review.

**Success moment:** Can demonstrate which control version applied, why, to whom, with what evidence and response.

### Finance Partner or Finance Manager — financial governance specialist

**Context:** Owns or validates financial data and policy, while Centre Directors own operational responses to the budget information they are allowed to see.

**Needs:**

- source-of-record reconciliation status;
- approved, actual, committed where available, and forecast values with clear periods and currency;
- configurable warning thresholds and commentary workflow;
- controlled access by organisation, centre, account grouping, and sensitivity;
- immutable import and adjustment provenance.

**Pain risks:** Centre Success becoming an unofficial ledger, stale actuals presented as current, or executives and directors seeing restricted line items.

**Success moment:** Variances are visible, explained, owned, and reconciled without duplicating the finance system.

## Secondary personas

### Executive leader — organisational decision-maker

Needs a concise portfolio view of material risk, quality, action progress, budget, and positive recognition. Requires trends and drill-through only where executive scope permits. Must see freshness, confidence, and definitions—not just a league table.

### Educator or delegated contributor — evidence and action contributor

May be assigned a narrow task, evidence request, reflection, or QIP contribution at one centre. Needs a simple, safe workflow and must not inherit the Centre Director’s broad visibility.

### Quality or pedagogical leader — quality improvement specialist

Contributes to self-assessment, strengths, critical reflection, QIP improvements, and evidence. Needs collaboration and history without permission to approve regulatory controls unless separately assigned.

### People and culture or wellbeing specialist — restricted support role

May administer wellbeing campaigns, view safe aggregates, and respond to explicit support requests. Must not receive individual responses merely because they have an organisational role. Employment and wellbeing access remain separate.

### System administrator — technical access administrator

Configures identity links, assignments, and operational settings. Does not automatically gain business-data read access. Break-glass access, if approved later, must be time-bound, justified, alerted, and audited.

### Auditor or authorised reviewer — constrained assurance role

Can perform a defined audit or review against assigned centres and template versions. Access expires with the engagement and does not imply ongoing portfolio access.

## Shared accessibility and environment needs

- Responsive operation across phone, tablet, and desktop.
- Clear plain-language summaries with traceable technical or source detail on demand.
- Keyboard and assistive-technology support; colour is never the sole signal.
- Save-and-resume for interrupted work.
- Australian time-zone aware dates, centre-local due times, and explicit timestamps.
- Low cognitive load, careful notification volume, and respectful language.
- No dark patterns that pressure wellbeing disclosure, premature attestation, or unsupported closure.

## Anti-personas and prohibited uses

The system is not designed for anonymous broad organisational browsing, covert employee surveillance, automatic disciplinary profiling, child profiling, automated regulatory conclusions, or public centre ranking. These uses must be prevented by product policy and backend controls, not merely discouraged in UI copy.
