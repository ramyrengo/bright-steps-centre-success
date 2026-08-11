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

## Organisational roles

| Role | Normal scope | Core responsibilities | Important exclusions |
| --- | --- | --- | --- |
| Centre Director | One or explicitly assigned centres | Daily success, centre tasks, evidence, actions, QIP, audit response, allowed budget commentary | Cannot approve own high-risk closure where independent verification is required; no other-centre access |
| Acting Centre Director | Centre plus start/end time | Temporarily performs approved Centre Director work | Access expires automatically; no retrospective access outside delegation window unless explicitly granted |
| Area Manager | Assigned centres, optionally a defined region | Quarterly audits, spot checks, coaching, escalation, recognition, portfolio triage | No unassigned centres; cannot alter source controls; sensitive wellbeing excluded by default |
| Compliance Manager | Organisation, jurisdictions, or designated regions | Control and audit governance, risk oversight, corrective-action verification, source review | No finance or individual wellbeing access by default; cannot rewrite completed audit history |
| Quality/Pedagogy Lead | Assigned organisation/region/centres | Self-assessment, QIP, quality evidence, strengths, coaching contribution | No compliance-control activation or financial access unless separately granted |
| Finance User | Organisation/region/centre subsets and line-item policy | Import validation, budget configuration, forecasts, warnings, reconciliation | No compliance evidence or wellbeing access merely through finance role |
| Executive | Organisation or designated business unit | Aggregated operational visibility, material risk, budget, trends, recognition | Drill-through remains classification-controlled; individual wellbeing responses excluded |
| Educator/Contributor | Assigned records at a centre | Complete assigned action, submit evidence, contribute reflection | Cannot browse all centre records or approve own submission unless policy allows |
| Wellbeing Administrator | Defined campaign/aggregate scope | Configure approved campaign, see safe aggregates, manage support pathways | Raw individual responses excluded unless a separate explicit support-request permission applies |
| System Administrator | Technical tenant configuration | Identity linking, assignment administration, configuration support | No automatic content read access; no silent impersonation |
| Internal/External Reviewer | Named audit/review and centres | Perform a time-bounded assurance activity | Access ends with engagement; exports and evidence access are constrained |

Bright Steps must confirm final role names, industrial responsibilities, delegations, and approval authorities before implementation.

## Capability families

- `organisation.manage`
- `identity.read`, `identity.assign`, `identity.deactivate`
- `centre.read`, `centre.manage`
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

These are architectural names for review, not implemented constants.

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
- Approval thresholds and independent-verifier rules.
- External reviewer and regulator access, if any.
- Break-glass design and support impersonation policy.
- Which budget line items Centre Directors and executives may view.
- Wellbeing support-request operating model and authorised recipients.
