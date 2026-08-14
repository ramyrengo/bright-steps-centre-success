# ADR-0018: Centre Standards — Milestone 4A operational loop

- **Status:** Proposed for independent review; Product Owner decisions incorporated. The implementation described here exists and passed its local implementation gate at integration commit `1bf06b7`; independent review and Product Owner acceptance of that implementation are outstanding, and no hosted CI, deployment or production readiness is claimed.
- **Date:** 2026-08-13
- **Decision owner:** Product Owner

## Context

Centre Standards is the approved product name for a small, repeatable operational-check loop. Milestone 4A must reuse the proven immutable M2B content model without turning an operational check into a quarterly audit, weakening M2B scoring/history, creating a second corrective-action truth, or inventing a real Bright Steps requirement.

The product name is **Centre Standards**. **Operational Assurance** is the internal architecture term for this source family and must not replace the product name in user-facing language.

The initial scale is 20 centres with one daily standard. A representative future load for architectural testing is 20 centres, four daily checks per centre, and approximately 12 responses per check. That volume does not justify a microservice, separate database, or table partitioning. Centre Standards remains a logical domain inside the existing Encore modular monolith and PostgreSQL database.

This ADR authorises architecture only. It creates no schema, migration, capability, role version, API, schedule, seed, deployment, or Production activation.

## Decision

### Scope

Milestone 4A is exactly one synthetic staging-only operational standard, **Centre Standards Pilot — Staging**, with one daily schedule. An authorised Educator can discover, read and complete the occurrence online and atomically. Approved outcome configuration can produce either:

1. a response with no finding and no action; or
2. a finding and corrective action created together from the pinned approved version content.

The single deployment and schedule are approved staging seed/governance content, not a runtime business deployment-management workflow.

The occurrence and responses are the operational source of truth. Findings and corrective actions remain source-owned downstream workflow records. Daily Success is a request-time projection only and copies none of those facts.

The following are excluded:

- real Bright Steps policy or regulatory content;
- a template authoring, approval, publishing, or deployment workflow;
- Tier-2 later promotion from finding to corrective action;
- cross-source recurrence insight;
- weekly, monthly, weekday-only, ad-hoc, or multiple-daily schedule types;
- photo or evidence attachments on operational responses;
- offline completion, localStorage, IndexedDB, browser business-data drafts, offline sync, or incremental server drafts;
- hours, business-day, end-of-day, or local-calendar due semantics;
- Quality/QIP mutation, coaching, wellbeing, budget, AI, notifications, or Production activation.

Existing corrective-action evidence and the existing elapsed `due_days` semantics remain unchanged.

### Product entry point and Educator contract

Centre Standards is not deep-link only. Its root product route is `/standards`, so later separately authorised 4B completion breadth, 4C insight and 4D authoring work can grow under one stable product URL without any of those later surfaces being authorised now.

For a principal holding centre-scoped `operational_check.complete`, the minimal `/standards` landing page lists only `OPEN` occurrences that the current PostgreSQL capability-plus-scope decision permits that principal to complete. It does not expose unrelated centre history for discovery. The completion capability supplies the minimum read necessary to discover, understand and perform an authorised open occurrence; Educators do not need the broader `operational_check.read` capability merely to find their assigned work.

`operational_check.read` remains the broader leadership capability for authorised check, status and history reading. The conceptual occurrence route is `/standards/checks/[occurrenceId]`, with authority and state—not role names—selecting the presentation:

- `OPEN` plus `operational_check.complete` offers the completion experience;
- `OPEN` plus `operational_check.read` without completion authority offers a read-only occurrence view; and
- `COMPLETED` plus either applicable authority offers the authorised read-only completion summary.

A principal with no authorised occurrence receives a clear unavailable/no-authorised-work state. Missing or unavailable authority must not be presented as “nothing due”. Every route and API reauthorises from current PostgreSQL capability and matching scope.

The Educator completion/read contract exposes only what is necessary to understand and perform the authorised check:

- product-safe Standard/check name;
- item/question wording and instructions/help text;
- permitted user-facing outcome labels;
- progress;
- occurrence opening and due time;
- completion state; and
- `completed_at` where appropriate.

It does not expose configured severity, corrective-action `due_days` or due date, required-remediation configuration, independent-verification configuration, finding or corrective-action internals, template/version/database identifiers beyond opaque routing identifiers, or internal source-family enum names. Outcome effects remain server-side. The occurrence deadline is user-facing—such as “Due by 9:00am”—but downstream action configuration and deadlines are not.

Educator-facing completion language is deliberately minimal:

- no downstream action: “Thanks — your check is complete.”;
- governed downstream action: “Thanks — your check is complete. One issue has been raised for follow-up.”; and
- requester retry after successful completion: “Already submitted — you completed this check at <time>.”

Ordinary Educators are never shown the terms finding, corrective action, governed action, `RECORDED`, severity, `due_days`, verification, or internal identifiers. The product must not claim a Director was notified because notifications are outside 4A.

### Reuse of the immutable template engine

Reuse the stable template, immutable version, ordered section/item, item-lineage, and outcome-configuration concepts. Audit scoring, performance bands, audit runs, audit acknowledgements, positive-practice records, and audit evidence remain quarterly-audit concepts.

PostgreSQL must enforce an immutable subtype with values equivalent to:

- `QUARTERLY_REVIEW`; and
- `OPERATIONAL_STANDARD`.

The subtype must be present at both the stable-template and immutable-version boundaries. The version subtype must be bound to its parent through a composite foreign key or an equally strong relational constraint; copying a type value without that relationship is insufficient.

The future migration must enforce all of these invariants:

- a `QUARTERLY_REVIEW` version requires a scoring policy;
- an `OPERATIONAL_STANDARD` version has no scoring policy in 4A;
- an audit run can reference only a `QUARTERLY_REVIEW` version;
- an operational occurrence can reference only an `OPERATIONAL_STANDARD` version;
- released template/version subtype cannot be changed;
- direct SQL cannot attach the wrong subtype to either source family.

A defensible relational shape is a unique version key containing `version_id` and `template_subtype`, with `audit_runs` and operational occurrences carrying a checked constant subtype and using composite foreign keys to that key. The exact physical column names may vary, but service convention alone is not acceptable.

Known M2B consumers that currently rely on quarterly-only template/run semantics and must retain or receive an explicit kind boundary are:

- `getAuditPreparation` and `startQuarterlyAudit`, whose existing template-type predicates must remain;
- `loadResponseConfiguration`, `saveAuditResponse`, `ensureFindingAndAction` and immediate/correction reconciliation;
- `loadFinalisationRows`, `ensureAuditReady`, `markAuditReady` and `finaliseQuarterlyAudit`;
- `acknowledgeAudit` and the audit-only positive-practice/evidence paths;
- `loadComplianceOversight`, including audit counts, latest-audit score/band and outstanding-quarter projections;
- `loadAuditIdentity`, `listAuditCentresForPrincipal`, `loadScoringInputs` and `loadQuarterlyAuditView`;
- previous-quarter comparison and current quarterly recurrence subqueries;
- `daily-success/quarterly-review-source.ts`; and
- development/staging content setup that currently creates only quarterly templates and runs.

Generic action/finding consumers are governed separately by ADR-0019. Service predicates supplement these PostgreSQL constraints; they never replace them.

### Operational concepts

The 4A persistence design contains:

- **standard deployment:** organisation, centre, pinned operational standard/version, effective window, status and audit attribution;
- **schedule revision:** immutable daily wall-clock schedule and effective local-date window for one deployment;
- **check occurrence:** one centre-local business-date instance with pinned deployment, schedule revision, operational version, timezone, opening/due instants and completion facts;
- **check response:** one item outcome within an occurrence, with constrained comment/reason, responder and response time;
- **optional occurrence events:** append-only operational facts such as due-window passage; projections must not depend on the event being emitted.

Schedule changes create a new revision. They never rewrite an existing occurrence. Each occurrence pins the content version and schedule revision that produced it.

At minimum, an occurrence snapshots immutable organisation, centre, deployment, schedule revision, operational template version, centre-local business date, centre IANA timezone, `opens_at` and `due_at`; it records completion principal and `completed_at` when completed and carries optimistic-concurrency state for mutation safety.

PostgreSQL must enforce one occurrence per organisation, deployment and centre-local business date. Tenant and centre ownership must be proven through composite keys. Each response must belong to the same organisation, centre and occurrence, and its item must belong to the occurrence's pinned operational version. Completion freezes the response set; correction requires a separately authorised future workflow.

### Lifecycle and timeliness

The occurrence lifecycle is only:

- `OPEN`;
- `COMPLETED`.

There is no exclusive `MISSED` status. Timeliness is derived from pinned facts using one trusted request time:

- `OPEN` and `due_at <= now` means overdue;
- `COMPLETED` and `completed_at <= due_at` means completed on time;
- `COMPLETED` and `completed_at > due_at` means completed late.

Completion exactly at `due_at` is on time. An optional append-only due-window event may support notifications or operations later, but a missing event cannot change the projection.

Approved user-facing language is:

- `OPEN` before due: “Due by 9:00am”;
- `OPEN` after `due_at`: “Overdue”;
- completed on time: “Completed 7:42am”; and
- completed late: “Completed late · 9:18am”.

“Missed” is not the primary user-facing state because an overdue occurrence remains completable. Leadership views do not attribute an overdue occurrence to a particular Educator. Completion is not rendered as a performance percentage. Schedule storage, deadline display and timeliness interpretation use consistent **minute precision** in 4A so the visible deadline cannot contradict the derived state.

### Centre-local schedule and DST

`centres.timezone` is the authoritative IANA timezone. A daily schedule stores a local wall-clock opening/due time; the occurrence stores the centre-local business date, timezone snapshot, and resolved UTC instants. The generator advances local calendar dates, never fixed 24-hour UTC intervals.

For 4A, a schedule is not activatable when an applicable local opening or due time is nonexistent or ambiguous under the centre timezone. Resolution must use a strict conversion that rejects DST gaps and folds rather than silently choosing an offset. The one synthetic schedule must therefore use wall times that are unambiguous for its effective dates. Generation repeats the strict check and fails visibly if trusted timezone data no longer resolves uniquely.

Generation is idempotent under the occurrence uniqueness key. A bounded catch-up scans missing eligible local business dates so a scheduler outage does not silently erase overdue work. Acceptance must cover Sydney DST start/end, Brisbane non-DST behaviour, duplicate scheduler execution, and catch-up.

### Online atomic completion and Educator authorization

Only these new business capabilities are authorised:

- `operational_check.read`;
- `operational_check.complete`.

An approved implementation may add a new version of the canonical Educator role bundle containing centre-scoped `operational_check.complete`. It must not mutate an existing role version. No author, approve, publish, or deploy capability is introduced. System Administrator receives neither capability by technical-admin status.

Completion is one online, atomic, `SERIALIZABLE` command. The backend must:

1. obtain the internal principal from verified Encore AuthData and resolve the active organisation server-side;
2. resolve and lock the occurrence using its trusted organisation and record identifier;
3. capture one decision time;
4. load current principal, membership, assignment-bound capabilities, assignment scopes and centre hierarchy within the transaction;
5. require one effective assignment to supply `operational_check.complete` and matching centre scope;
6. revalidate the centre, deployment, version subtype and schedule occurrence; if it is already `COMPLETED`, return the typed non-mutating result below rather than processing the submitted answers;
7. validate exact item coverage and outcome configuration against the pinned version;
8. insert the response set, create any configured finding/action, mark completion, increment optimistic concurrency state and append minimised audit events atomically; and
9. reject stale, transferred, expired, deactivated, fabricated or cross-centre requests without partial writes.

The client cannot supply identity, organisation, centre, authority, ancestry, role, capability, due time, template subtype or outcome effects. No response is persisted until the full completion succeeds.

An authorised completion request that reaches an already completed occurrence returns a typed, non-mutating result equivalent to:

- `ALREADY_COMPLETED`;
- `completed_at`; and
- `completed_by_requester: true | false`.

It creates no second response set, finding or corrective action. When the requester completed it, the UI presents the result as successful/completed—“Already submitted — you completed this check at 7:42am.” When another authorised principal completed it, the UI says “This check has already been completed” and shows the authorised read-only summary. Neither case claims that the retried submitted answers were accepted. This is the narrow response-loss contract for 4A, not a general idempotency-key subsystem.

Unfinished answers remain ephemeral React state. After a recoverable API or network failure, the completion view keeps the entered answers mounted, re-enables an appropriate retry, disables or otherwise prevents duplicate submit while a request is in flight, and does not imply success. It warns before navigation would discard unsaved answers, and a completed occurrence reopens read-only. It must not persist business content to localStorage, IndexedDB, an offline cache, or an incremental server draft.

### Outcome effects and action boundary

The existing outcome-configuration shape may power operational items for `creates_finding`, `creates_corrective_action`, severity, `due_days`, independent verification and remediation wording. Audit score effects and performance bands do not apply. Operational `due_days` remains elapsed 24-hour units from the configured action-creation fact; it is not a business-day or local-calendar SLA.

Operational content in 4A permits only `creates_finding = false / creates_corrective_action = false` (**RECORDED**) or `creates_finding = true / creates_corrective_action = true` (**GOVERNED ACTION**). A governed action also pins approved severity, `due_days`, remediation and required independent verification. Operational finding-only configuration is rejected as a 4A content-governance rule, without weakening M2B's accepted finding-only configuration semantics. There is no later promotion command or UI. `corrective_actions` remains structurally unchanged and continues to reference one finding; source-aware loading is governed by ADR-0019.

### Synthetic staging content and propagation

Every relevant surface must make the pilot's synthetic nature unmistakable. The Standard name is **Centre Standards Pilot — Staging**; assessed questions use unmistakably synthetic/test wording rather than plausible Bright Steps policy such as “Is the outdoor gate secure?”; and the completion view carries a persistent adjacent synthetic notice.

If the synthetic governed-action outcome creates downstream records, both the finding description and copied required remediation carry a synthetic staging marker. The approved remediation concept is:

> SYNTHETIC STAGING TEST — no real Bright Steps operational remediation is required. Complete this action only to test the Centre Success workflow.

Authorised action-origin presentation identifies the staging pilot source. The environment-safe seed refuses Production activation. Engineering must not invent a real BSA operational or regulatory requirement merely to make the pilot look realistic.

### Evidence boundary

Operational template content in 4A must require no check-response attachment or photo. The existing corrective-action evidence lifecycle remains unchanged. Any future response-evidence milestone must separately approve malware/scanning controls, child-sensitive image classification, purpose-specific access, and retention/deletion; 4A does not pre-design or implement them.

### Daily Success integration and query budget

Daily Success gains one set-wise operational-occurrence adapter for currently authorised centres and already-supported Daily Success perspectives only. It projects **only `OPEN` occurrences**, using `whyShown: CHECK_DUE_TODAY` or `whyShown: CHECK_OVERDUE`. Once an occurrence is `COMPLETED`, it is no longer active Daily Success work. If completion created a corrective action, that obligation appears only through the existing corrective-action source; the completed occurrence and its action are never simultaneous accountability cards.

CTA selection is capability-derived. `operational_check.complete` may offer the completion experience; `operational_check.read` without completion authority links to read-only occurrence detail. A Centre Director must not receive a CTA that predictably lands on an authorization denial, and every destination still reauthorises on the backend. For a Centre Director reader, ordinary occurrence responsibility is `YOUR_CENTRE_NEEDS_TO_ACT`, not `YOU_NEED_TO_ACT`, unless the principal independently holds responsibility and authority that make the latter true.

Milestone 4A does not add an Educator Daily Success perspective. Educators reach the check through the Centre Standards completion experience. Any future Educator home or Daily Success perspective requires a separate Product Owner decision.

The accepted normal relevant-perspective operation baseline is expected to move from approximately 14 to 17 database operations:

- source savepoint;
- one set-wise operational-occurrence query;
- source savepoint release.

This is a design budget, not permission to hide additional queries. Acceptance must measure representative one-centre, multi-centre and 20-centre portfolios and prove the operation count remains independent of centre count. Source failure remains isolated and honestly reported under ADR-0015.

### Mobile completion contract

The 4A completion experience uses the existing Centre Success/Greenhouse design system and must be comfortable at 375px with no horizontal page overflow. Primary answer controls have at least a 56px target; every other actionable target has at least a 44px target. Completion uses minimal, focused navigation chrome, clear question progress, visible keyboard focus, words as well as colour, reduced-motion support, and a real completion screen rather than toast-only confirmation. Implementation may add a shared `AnswerControl`-style primitive; it must not solve the interaction with private one-off styling.

### Quality compatibility boundary

Centre Standards owns operational deployments, schedule revisions, occurrences and responses. The findings/action domain owns downstream risk and remediation. Daily Success may project authorised operational facts. A future Centre Quality experience may read those source-owned facts through an approved source interface, but 4A adds no Quality aggregate, operational score, completion score, compliance score, blended score, Centre Health score, materialised roll-up, QIP mutation, trend claim, cross-source recurrence, or Quality-specific table/API.

Operationally sourced corrective actions must not break generic authorised action projections. Audit score, audit section and quarter-comparison projections remain quarterly-only. Any uncovered-finding projection that is defined as quarterly must explicitly select quarterly findings. Action detail may accurately identify an operational origin without converting it into an audit origin.

The separately authorised narrow Centre Quality & Performance read projection reserved by ADR-0017 is not changed, deleted or superseded by 4A. Future Quality use beyond that boundary must preserve 4A source ownership and obtain separate Product Owner authorisation.

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

Quarterly creation, scoring, comparison and recurrence must remain explicitly limited to quarterly-audit source semantics wherever a newly shared table could otherwise broaden them.

### Conceptual forward-migration sequence

If implementation is later authorised, the reviewable sequence is:

1. add and backfill template/version subtype; make scoring conditional; add composite subtype keys; constrain existing audit runs to quarterly versions; preserve released-version immutability;
2. add operational deployments, immutable daily schedule revisions, occurrences, responses and optional events with tenant/centre/version integrity;
3. add and backfill the finding source family and ownership columns, validate composite source foreign keys and partial uniqueness, relax audit-source nullability only after validation, and migrate source-assuming consumers before operational findings become creatable;
4. add only the two 4A capabilities and a new canonical Educator role-bundle version without mutating an existing version; and
5. add the separately approved synthetic staging content/deployment only after structure, authorization and M2B regression gates pass.

Structural migration, capability/role evolution and synthetic staging content should remain separately reviewable. No migration is authorised by this sequence.

### First-pilot usability acceptance

Implementation acceptance for the first synthetic staging pilot must prove all of the following:

1. An authorised Educator can discover and complete the synthetic check at 375px without a deep-link-only workaround.
2. The three-question normal path can be completed one-handed in under 60 seconds.
3. Educators never see severity, `due_days`, verification, finding/action terminology, internal source enums or regulatory claims.
4. Synthetic marking appears on the Standard and every generated downstream action.
5. A recoverable network failure before successful commit keeps entered answers in ephemeral page state and supports retry.
6. Response loss after a successful commit produces the completed/already-submitted presentation on retry, not a generic error.
7. Leaving with unsaved answers warns.
8. A completed occurrence reopens read-only.
9. Centre Director views use accurate due, overdue, on-time and late language.
10. A capability-derived CTA never deliberately routes an authorised reader to a completion denial.
11. System Administrator receives no Centre Standards navigation or content from technical-admin status.
12. A principal with no authorised centre/check sees an unavailable/no-authorised-work state, not “nothing due”.
13. Daily Success never duplicates a completed operational issue as both an occurrence obligation and a corrective-action obligation.
14. Target size, focus, semantic-state, non-colour and reduced-motion requirements pass.

## Consequences

- Reuse is limited to immutable content/versioning and approved outcome effects; operational work is not an audit run.
- Operational history remains reproducible from pinned content, schedule, timezone and time facts.
- Lateness remains correct even if a scheduler or optional event writer is unavailable.
- Atomic online completion avoids partial check truth; the typed already-completed result closes response-loss UX without a general idempotency subsystem.
- The one new Daily Success source preserves set-wise authorization and bounded query cost.
- Low initial volume accepts one modular-monolith/database design without premature service extraction or partitioning.

## Deferred and locked

Milestone 4B, 4C and 4D are locked. Cross-source recurrence and its governed mapping require Milestone 4C. A standards builder and author/approve/publish/deploy workflows require later explicit authorisation. Milestone 3B, Milestones 5 and 6, Composite Centre Health, Production activation and every excluded feature above remain locked.

## Implementation gate

This ADR must pass independent architecture review and receive explicit Product Owner implementation approval before code or migrations begin. No architecture or product-contract question remains intentionally unresolved. A future implementation proposal must still provide the exact three synthetic assessed questions, permitted outcome configuration, `due_days` rule, staging centre/deployment, effective dates and DST-safe daily wall times for review under that implementation gate; none may claim a real Bright Steps or regulatory requirement.
