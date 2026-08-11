# User Roles

## Role model

A role is a bundle of potential capabilities, not global access. Effective access is the intersection of:

1. authenticated identity;
2. active organisation membership;
3. active role assignment;
4. resource scope (organisation, state/region, centre, assigned centres, record participation, or explicit grant);
5. data classification and purpose restrictions;
6. current time and delegation conditions; and
7. any separation-of-duties rule.

One person may hold multiple roles. The backend evaluates each request against current assignments and resource attributes. It never trusts role or centre identifiers supplied by the frontend as proof of access.

Capabilities from multiple valid assignments combine, but each capability remains bound to the scope and conditions of the assignment that granted it. A centre-scoped role cannot lend its scope to an organisation-scoped capability from another role, or vice versa.

## Canonical foundation roles

| Role | Normal scope | Core responsibilities | Important exclusions |
| --- | --- | --- | --- |
| Educator | Assigned centre | View the assigned centre and perform separately assigned contributions when future modules exist | No unrelated centres, organisation-wide administration, or automatic access to all centre records |
| Assistant Director | Assigned centre | Support centre leadership within explicitly granted centre capabilities | Not automatically equivalent to Centre Director for current or future capabilities |
| Centre Director | One or explicitly assigned centres | Daily success, centre tasks, evidence, actions, QIP, audit response, allowed budget commentary | Cannot approve own high-risk closure where independent verification is required; no other-centre access |
| Area Manager | Effective-dated assigned centres | Quarterly audits, spot checks, coaching, escalation, recognition, portfolio triage | No unassigned centres; cannot alter source controls; sensitive wellbeing excluded by default |
| Compliance Manager | Explicitly assigned organisation | Organisation-wide Quality & Compliance governance, risk oversight, corrective-action verification, and source review | No finance, individual wellbeing, or system administration by default; cannot rewrite completed audit history |
| Operations Leadership | Explicit organisation, state/region, centre group, or centres | Business oversight of organisation structure, centres, basic operational profiles, and relevant in-scope user/role and Area Manager assignments | No implicit organisation-wide, technical-admin, finance, compliance-closure, finalised-audit, wellbeing, secret, or infrastructure access |
| Finance | Explicit organisation/region/centre subsets and line-item policy | Financial governance and enough organisation/centre metadata to interpret permitted financial records | No compliance authority, coaching, wellbeing, system administration, or unrelated business content merely through Finance |
| Executive | Explicitly assigned organisation strategic scope | Aggregated operational visibility, material risk, budget, trends, recognition | Read-oriented by default; no unrestricted mutation, system administration, or individual wellbeing responses |
| System Administrator | Assigned technical administration scope | Identity mapping, internal-principal and assignment administration, application configuration, support, and system operational health | No automatic business-content, finance, coaching, wellbeing, child-related, audit, finding, or corrective-action access; no silent impersonation |

These are the only fixed roles approved for Milestone 1 synthetic authorisation tests. Role definitions and their capability bundles are data-driven; application policy must not branch throughout the codebase on role names. `Operations` and `Super Admin` are not roles: the canonical terms are **Operations Leadership** and **System Administrator**.

### Deferred role patterns

Acting Centre Director access is represented as a time-bounded delegation of approved Centre Director capabilities unless a later decision justifies another fixed role. Quality/Pedagogy Lead, Wellbeing Administrator, and Internal/External Reviewer remain documented future domain roles and are not instantiated in Milestone 1. Narrow contributor access is a record-scoped capability/assignment and does not require a global `Contributor` role.

## Capability families

The approved Milestone 1 capability keys are:

- `organisation.read`;
- `centre.read`, `centre.manage`;
- `principal.read`, `principal.manage`, `identity.mapping.manage`;
- `assignment.read`, `assignment.manage`;
- `system.configure`, `system.health.read`; and
- `budget.summary.read` only as a synthetic Finance authorisation marker; Milestone 1 contains no budget record, API, or workflow.

Future domain modules may draw from these architectural capability families after their own approval:

- `organisation.manage`
- `daily.read`, `daily.update`
- `control.read`, `control.draft`, `control.approve`, `control.activate`
- `task.read`, `task.assign`, `task.complete`, `task.verify`
- `evidence.read`, `evidence.upload`, `evidence.link`, `evidence.export`, `evidence.restrict`
- `finding.read`, `finding.create`, `finding.triage`, `finding.close`
- `action.read`, `action.manage`, `action.verify`
- `audit.read`, `audit.schedule`, `audit.perform`, `audit.moderate`, `audit.finalise`, `audit.reopen`
- `qip.read`, `qip.contribute`, `qip.approve`, `qip.publish`
- `coaching.read`, `coaching.manage`, `coaching.restrict`
- `wellbeing.aggregate.read`, `wellbeing.campaign.manage`, `wellbeing.support_request.read`
- `budget.summary.read`, `budget.detail.read`, `budget.import`, `budget.configure`, `budget.comment`
- `health.read`, `health.configure`, `health.publish`
- `notification.manage`
- `ai.use`, `ai.admin`, `ai.audit`
- `report.export`, `audit_log.read`, `access_review.perform`

Except for the small Milestone 1 set above, these are architectural names for review, not implemented constants.

## Assignment types

- **Organisation membership:** establishes the tenant; it does not by itself grant content access.
- **Regional assignment:** applies to centres currently in a governed state/region hierarchy.
- **Centre assignment:** direct access to one or more centres.
- **Record assignment:** narrow access to a task, action, audit, QIP item, coaching cycle, or support request.
- **Delegation:** approved transfer of specified capabilities and scopes for a fixed period.
- **Break-glass grant:** exceptional, time-limited access requiring reason, alerting, and retrospective review; design approval is still pending.

Hierarchy changes must be effective-dated so historical records retain the scope that applied at the time.

## Separation of duties

- A user should not approve their own role or privileged assignment.
- The author of an externally based control should not be its sole approver.
- A person who submits evidence may be prevented from independently verifying it for high-risk controls.
- A Centre Director may respond to an audit but cannot silently modify a finalised audit result.
- A high-risk corrective action requires an authorised verifier distinct from the completer where policy specifies.
- Finance import and reconciliation/approval should be separable.
- Centre Health methodology changes require governance approval and do not recalculate history silently.
- System administrators cannot use technical privilege as routine business access.

## Lifecycle

1. Identity is linked to a person after an approved source or invitation process.
2. Membership, role, scope, effective dates, and grantor are recorded.
3. The assignee acknowledges role-specific responsibilities where required.
4. Access changes take effect promptly and invalidate cached decisions.
5. Delegations expire automatically.
6. Transfers update future access without rewriting historical attribution.
7. Deactivation blocks new sessions and retains required historical records.
8. Periodic access reviews require managers and data owners to recertify privileged, finance, executive, export, wellbeing, and break-glass access.

## Open decisions

- Identity provider, authentication assurance, and joiner/mover/leaver source.
- Exact organisation and region hierarchy.
- Future module capability bundles, industrial responsibilities, delegations, and approval authorities beyond the approved foundation baseline.
- Approval thresholds and independent-verifier rules.
- External reviewer and regulator access, if any.
- Break-glass design and support impersonation policy.
- Which budget line items Centre Directors and executives may view.
- Wellbeing support-request operating model and authorised recipients.
