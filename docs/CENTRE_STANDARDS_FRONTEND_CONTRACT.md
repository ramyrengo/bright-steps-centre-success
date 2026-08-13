# Centre Standards 4A — frontend contract request

**From:** Centre Standards UX lane, branch `feature/centre-standards-4a-ux`
**To:** Centre Standards backend lane
**Status:** Request for review. No backend work is implied or authorised by this
document; it states what the built frontend needs in order to be wired.

The frontend is complete and tested against typed props. Wiring it is a prop
mapping once these shapes exist. The authoritative TypeScript is
`frontend/src/components/centre-standards-contract.ts` on the UX branch — this
document is the reviewable summary of it.

Everything below is expressed in **presentation terms**. No database field is
assumed. Where a value is described as "presentation-ready", the backend formats
it, because the browser has no authoritative centre timezone and must not
recompute one.

---

## Changes since the previous request

Three fields are **no longer needed**. Please do not expose them:

| Field | Why it went |
| --- | --- |
| `centreId` | Never rendered. Routing uses `occurrenceId` only. |
| `asOf` | Never rendered on these surfaces. |
| `authority.canRead` | Always true where the object exists — an occurrence the viewer may not read should not be returned at all. |

Two shape changes, both to make invalid states unrepresentable rather than to
add data:

1. The occurrence response is **discriminated on `state`**, with `canComplete`
   only on `OPEN` and `responses` only on `COMPLETED`.
2. `partial` always carries a `warning`; `unsupported` carries **no** open-work
   field at all.

---

## A. Landing — open checks

`GET /standards` (name at your discretion)

```ts
type StandardsWorkspace =
  | { status: "ready";       openChecks: OpenCheckSummary[] }
  | { status: "partial";     openChecks: OpenCheckSummary[]; warning: string }
  | { status: "unsupported" }
```

The discriminator carries the whole unknown-is-not-zero rule:

- **`ready` + `[]`** is the only combination that may render an all-clear
  ("Nothing due right now"). It means the source was queried and is genuinely
  empty.
- **`partial`** never renders an all-clear, even with an empty array. Its
  `openChecks` are the checks that *were* confirmed, never evidence that no
  others exist. `warning` is displayed verbatim, so please phrase it for a
  reader.
- **`unsupported`** has no `openChecks` field, so it cannot assert anything
  about work the request never looked for. This is the System Administrator and
  no-authorised-centre case.

Only `OPEN` occurrences appear here. Completed history is deliberately out of
4A: an Educator's task list should shrink as they work.

---

## B. Occurrence detail

`GET /standards/checks/:occurrenceId`

```ts
interface CheckIdentity {
  occurrenceId: string      // opaque; passed back untouched, never displayed
  standardName: string      // safe display name
  centreName: string
  businessDate: string      // centre-local `YYYY-MM-DD`
  questionCount: number
}

type CheckOrigin =
  | { synthetic: true; syntheticNotice: string }
  | { synthetic: false }

interface OpenCheckState {
  state: "OPEN"
  timeliness: "DUE" | "OVERDUE"
  dueLocalTime: string      // presentation-ready, e.g. "9:00am"
  canComplete: boolean
}

interface CompletedCheckState {
  state: "COMPLETED"
  timeliness: "COMPLETED_ON_TIME" | "COMPLETED_LATE"
  dueLocalTime: string
  completedLocalTime: string
}

type OpenCheckSummary = CheckIdentity & CheckOrigin & OpenCheckState

type StandardsCheckDetail =
  | (CheckIdentity & CheckOrigin & OpenCheckState      & { questions: CheckQuestion[] })
  | (CheckIdentity & CheckOrigin & CompletedCheckState & { questions: CheckQuestion[]
                                                           responses?: CheckRecordedResponse[] })

interface CheckQuestion {
  questionId: string
  wording: string
  instructions?: string
  options: { value: string; label: string; description?: string }[]
}

interface CheckRecordedResponse {
  questionId: string
  wording: string
  answerLabel: string
}
```

What the union buys, stated as invariants the type enforces:

- A completed occurrence **cannot** carry completion authority.
- An open occurrence **cannot** carry recorded responses.
- Synthetic content **cannot** omit its notice — `syntheticNotice` is required
  whenever `synthetic` is true, so the disclaimer cannot drift from the approved
  wording. Please supply the approved string; the browser never composes it.
- `responses` is absent (not empty) where the viewer may not read answers. The
  UI says "not available to you" rather than showing an empty record.

`timeliness` is derived server-side from pinned facts and one trusted request
time, per ADR-0018. The frontend renders it and derives nothing:

| Value | Rendered |
| --- | --- |
| `DUE` | "Due by 9:00am" |
| `OVERDUE` | "Overdue" |
| `COMPLETED_ON_TIME` | "Completed 7:42am" |
| `COMPLETED_LATE` | "Completed late · 9:18am" |

Please keep schedule storage, deadline display and timeliness comparison at
consistent **minute precision**, as ADR-0018 requires — otherwise a check
completed in the same minute as its deadline can display as late.

---

## C. Completion command

```ts
completeCheck(input: {
  occurrenceId: string
  answers: { questionId: string; value: string }[]
}): Promise<CompleteCheckResult>
```

`value` is the opaque option value returned in `B`, passed back untouched. The
client supplies nothing else — no identity, centre, authority, timing or outcome
effect.

---

## D. Already-completed result — the item that matters most

```ts
type CompleteCheckResult =
  | { outcome: "COMPLETED";         completedLocalTime: string; issueRaised: boolean }
  | { outcome: "ALREADY_COMPLETED"; completedLocalTime: string; completedByRequester: boolean }
```

**`ALREADY_COMPLETED` must be a success-shaped result, not an error.**

The most likely real-world failure is a submission that commits and whose
response is lost on the way back. The Educator retries, and if that returns an
error they are told they failed after doing everything right. The frontend
already handles both branches:

- `completedByRequester: true` → *"Already submitted — you completed this check
  at 7:42am."* Presented as success.
- `completedByRequester: false` → *"This check has already been completed"*,
  plus an explicit statement that the retried answers were **not** submitted.

`issueRaised` drives one sentence and nothing more: *"One issue has been raised
for follow-up."* The Educator is never shown the words finding, corrective
action, severity, due days, remediation or verification.

Per ADR-0018 this is the narrow response-loss contract, not a general
idempotency-key subsystem.

---

## E. Authority

`canComplete` on the open state, decided by the backend from current capability
and scope. There is no `canRead`.

The frontend never infers authority from a role name and renders no control it
has not been granted. A reader sees the read-only occurrence view; a completer
sees the completion flow.

---

## F. Educator-facing safety

The completion contract may carry only: standard name, question wording,
instructions, permitted outcome **labels**, progress, occurrence due time,
completion state and completion time.

It must not carry severity, corrective-action due date or `due_days`,
remediation configuration, verification configuration, finding or
corrective-action internals, template/version identifiers, or internal
source-family enum names.

One request on content: please ensure approved outcome **labels** do not echo an
internal token. We changed our fixtures from "Recorded outcome" to *"No issue to
report"* / *"Report an issue"* for exactly this reason — the label is what an
educator reads, and it should describe the world, not the enum.

---

## G. Action origin — discriminated

For the shared corrective-action surfaces:

```ts
type ActionOrigin =
  | { source: "QUARTERLY_AUDIT";   quarterLabel: string; route?: string; acknowledged?: boolean }
  | { source: "OPERATIONAL_CHECK"; standardName: string; businessDate: string
                                   synthetic: boolean;   route?: string }
```

Rendered as **"Quarterly review"** and **"Centre Standard"** — the enum names
never reach a reader.

Audit-only properties (`originatingAuditId`, `originatingAuditStatus`,
`originatingAuditAcknowledged`) must be **absent from the operational branch**,
not emitted as `null` or `false`. An acknowledgement flag on an operational
action asserts something meaningless.

`route` is present only where the reader is authorised to open that source, so
the origin line links or stays plain text accordingly.

`synthetic: true` renders the staging marker on the action itself — which is
what carries the pilot's synthetic nature into the Director's real
corrective-action list, per ADR-0018's propagation requirement.

---

## H. Navigation — the one blocker we cannot resolve

`deriveWorkspaceLinks` in `foundation/navigation/workspace-links.ts` must return
a Centre Standards destination for a principal holding `operational_check.read`
or `operational_check.complete`.

We could not add this: `operational_check.*` does not exist in
`FOUNDATION_CAPABILITIES` yet, and we will not invent a capability.

It matters because 4A excludes an Educator Daily Success perspective, so without
a navigation entry an Educator's only route in is a deep link. ADR-0018 §Product
entry point establishes `/standards` as the root product route and notes that
the completion capability supplies the minimum read needed to discover one's own
work — this is the shell half of that.

---

## Daily Success presentation (no backend change requested here)

The occurrence card and its CTA are built and tested. For when that integration
is authorised:

- `whyShown` of `CHECK_DUE_TODAY` or `CHECK_OVERDUE`.
- Centre Director responsibility is normally `YOUR_CENTRE_NEEDS_TO_ACT`.
- **The CTA route is the same for both authorities** — `/standards/checks/:id`,
  which resolves the surface server-side. Only the label differs ("Start check"
  / "View check"). This is deliberate: routing a reader to a completion-only
  destination would land them on a denial, which ADR-0018 forbids.
- Only `OPEN` occurrences are projected. A completed check is no longer active
  work, and any issue it raised travels through the existing corrective-action
  source — so one underlying problem is never two cards.
- **`synthetic` must travel with the occurrence onto the card.** This is the
  same propagation requirement `G` already states for the action origin: a
  staging occurrence sitting in a Centre Director's real Daily Success list has
  to say so where it is read, not only on the screen where it was created. The
  card renders "Staging test content" from that flag alone — it does not need
  `syntheticNotice`, because the full wording belongs on the check itself.

The projection is a pure function on the frontend
(`projectDailyOccurrences` in `centre-standards-integration.tsx`), so the
completed-occurrence rule is enforced by the discriminated summary rather than
by a filter Codex has to remember: a `COMPLETED` summary carries no
`canComplete`, so it has nothing to build a call to action from and cannot
reach a card by accident. Passing `StandardsCheckSummary[]` straight in is
therefore safe.

`responsibility` and whether to name the centre are supplied by the
perspective, not by the check — they are facts about the view.

---

## What is already proven on the frontend

The frontend suite covers: single submission under three same-batch native
clicks; partial-empty never rendering an all-clear; ambiguous failure keeping
answers and retrying into `ALREADY_COMPLETED`; in-app leave protection on the
brand link and sign out; focus moving to the completion heading; a completed
occurrence never reaching a Daily Success card; and no workflow vocabulary,
option value or identifier reaching the DOM.

Measured at 375px and 1024px: no horizontal overflow, 60px answer targets.
