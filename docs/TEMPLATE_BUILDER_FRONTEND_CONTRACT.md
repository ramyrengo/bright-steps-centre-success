# Area Manager Template & Form Builder — frontend contract request

**From:** Template & Form Builder UX lane, branch `feature/area-manager-form-builder-ux`
**To:** Template & Form Builder backend lane
**Status:** Request for review. No backend work is implied or authorised by this
document; it states what the built frontend needs in order to be wired. It
invents no endpoint and asserts no capability name — ADR-0020 reserves both for
review inside its boundary.

The frontend is built and tested against typed props. Wiring it is a prop
mapping once these shapes exist. The authoritative TypeScript is
`frontend/src/components/template-builder-contract.ts`; this document is the
reviewable summary of it.

Everything below is expressed in **presentation terms**. No database field is
assumed. Where a value is described as "presentation-ready", the backend formats
it, because the browser has no authoritative centre time zone, no authoritative
clock and no way to know how versions are numbered.

**Nothing in this slice currently calls the generated client.** No
template/builder operation exists in `client.generated.ts`, so the routes are
wired to a gateway whose default implementation refuses honestly
(`backendNotAvailableGateway`). That is deliberate: it keeps the surfaces
reviewable without a fabricated template, assignment or schedule existing
anywhere.

---

## A. Library

```ts
type TemplateLibrary =
  | { status: "ready";   templates: TemplateSummary[]; canCreate: boolean }
  | { status: "partial"; templates: TemplateSummary[]; canCreate: boolean; warning: string }
  | { status: "unsupported" }
```

The discriminator carries the unknown-is-never-zero rule, exactly as the Centre
Standards workspace does:

- **`ready` + `[]`** is the only combination that may render "No templates yet".
- **`partial`** never renders an all-clear, even with an empty array. `warning`
  is displayed verbatim, so please phrase it for a reader.
- **`unsupported`** has no `templates` field at all, so it cannot assert anything
  about a library the request never looked for. This is the principal with no
  authoring authority, including a System Administrator.

`canCreate` is the backend's decision. The frontend renders no create control
without it and never infers one from a role name.

```ts
interface TemplateSummary {
  templateId: string          // opaque; routed on, never displayed
  name: string
  purpose?: string
  lifecycle: "DRAFT" | "PUBLISHED" | "RETIRED"
  versionLabel: string        // presentation-ready, e.g. "Version 3"
  questionCount: number
  stateLabel: string          // presentation-ready, e.g. "Published 13 Aug 2026"
  assignmentDescription?: string   // published/retired only
  scheduleDescription?: string     // published/retired only
}
```

---

## B. Template workspace

```ts
interface TemplateWorkspace {
  templateId: string
  templateName: string
  version: TemplateVersion        // the draft if one exists, else the version in use
  history: VersionHistoryEntry[]  // newest first
}
```

`TemplateVersion` is **discriminated on `lifecycle`**, and this is the item that
matters most in the whole request:

```ts
type TemplateVersion = { versionId: string; versionLabel: string } & (
  | { lifecycle: "DRAFT";     draft: TemplateDraft; canEdit: boolean; canPublish: boolean
                              lastSavedLocalTime?: string }
  | { lifecycle: "PUBLISHED"; content: TemplateDraft; publishedLocalTime: string
                              publishedBy: string; assignment: AssignmentSummary
                              schedule: ScheduleSummary; canCreateDraft: boolean
                              canRetire: boolean }
  | { lifecycle: "RETIRED";   content: TemplateDraft; publishedLocalTime: string
                              publishedBy: string; retiredLocalTime: string
                              retiredBy: string; assignment: AssignmentSummary
                              schedule: ScheduleSummary; canCreateDraft: boolean }
)
```

What the union buys, stated as invariants the type enforces:

- **A published version cannot carry editing authority.** There is no `canEdit`
  and no `draft` on the published or retired branch, so no surface can render an
  edit control on an immutable version by accident. Immutability stops being
  something every screen has to remember.
- **A draft cannot carry an assignment, a schedule or a publication time.** It
  has not been published, so it has nowhere to put facts it does not have.
- **Retirement adds fields and rewrites none.** `publishedLocalTime` and
  `publishedBy` are still present and still the original values.

Please do **not** flatten this into one record with optional fields. The
frontend's immutability guarantee is the shape.

```ts
interface VersionHistoryEntry {
  versionId: string
  versionLabel: string
  lifecycle: "DRAFT" | "PUBLISHED" | "RETIRED"
  eventLabel: string    // presentation-ready, e.g. "Published 13 Aug 2026"
  eventBy: string
  current: boolean      // the version in operational use
}
```

History is append-only. A new draft adds a row; it never edits one.

---

## C. Draft content

```ts
interface TemplateDraft {
  name: string
  purpose?: string
  sections: DraftSection[]      // presentation order is array order
}

interface DraftSection {
  sectionId: string
  title: string
  questions: DraftQuestion[]    // presentation order is array order
}

type DraftQuestion = {
  questionId: string
  wording: string
  guidance?: string
  required: boolean
} & (
  | { type: "YES_NO" }
  | { type: "SINGLE_SELECT"; choices: { choiceId: string; label: string }[] }
  | { type: "MULTI_SELECT";  choices: { choiceId: string; label: string }[] }
  | { type: "TEXT";   multiline: boolean }
  | { type: "NUMBER"; unitLabel?: string }
  | { type: "DATE" }
)
```

Two requests on this shape:

1. **Ordering is the array, not an index field.** A separate `position` column is
   fine in storage; please do not surface one. Two sources of order drift, and
   the one that drifts is always the one an educator sees.
2. **Choices belong only to choice questions.** A date question with a `choices`
   array is not a state the builder can produce, and the union means the
   frontend never has to defend against it.

`type` values are presentation discriminators chosen by this lane. They are
never rendered — every surface reads its wording from a label map, and a test
asserts no uppercase token reaches the DOM. If the backend names them
differently, the adapter maps them and nothing else changes.

### On the six types

ADR-0020 authorises Yes/No, single select, multi-select, text, number and date.
That is what is built. The coordinator's work order named `short_text`,
`long_text` and `time` instead; those are reconciled rather than added:

- short and long text are one `TEXT` question with a `multiline` flag, so the
  authoring choice is a presentation one rather than a seventh type outside the
  ADR;
- there is **no** `time` question type, because ADR-0020 does not authorise one.
  Due-time configuration lives on the schedule, in `E`, which is where the ADR
  puts it.

---

## D. Assignment

```ts
type AssignmentSelection =
  | { scope: "PORTFOLIO" }
  | { scope: "CENTRES"; centreIds: string[] }
```

**The `PORTFOLIO` branch carries no centre list, deliberately.** ADR-0020
requires the portfolio to be resolved from current PostgreSQL authority and
scope rather than from a client-supplied list. Giving the browser nowhere to put
one is a stronger guarantee than a comment asking it not to, and the UI hides
the centre checklist entirely on that branch so there is no list to send.

The backend must still validate every centre affected by either branch.

ADR-0020 names three options: one centre, selected centres, or the portfolio.
The first two are the same control at different cardinalities, so the UI offers
a checklist (choose one, choose several) and a portfolio option. If the product
owner wants "exactly one centre" to be a distinct, separately authorised
operation rather than a cardinality, please say so — that is a backend
distinction the frontend would then reflect.

```ts
interface AssignmentOptions {
  centres: { centreId: string; centreName: string; timeZoneLabel: string }[]
  portfolioAvailable: boolean
  portfolioCentreCount?: number   // absent where the backend did not resolve it
  warning?: string                // present when the list is known to be incomplete
}
```

- `timeZoneLabel` is **presentation-ready** — "Brisbane time", not an IANA
  identifier. The browser has no authoritative centre time zone.
- `portfolioCentreCount` is **absent, not `0`**, where the portfolio was not
  resolved. The UI then says the size is worked out at publish time rather than
  printing a count that would claim an empty portfolio.

```ts
type AssignmentSummary =
  | { scope: "PORTFOLIO"; description: string; centreCount?: number }
  | { scope: "CENTRES";   description: string; centreNames: string[] }
```

---

## E. Scheduling

```ts
interface ScheduleSelection { recurrence: "DAILY"; dueTime: string }  // 24-hour "HH:MM"

interface ScheduleSummary {
  recurrence: "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "AD_HOC"
  dueLocalTime: string   // presentation-ready, e.g. "9:00am"
  timeZoneNote: string   // presentation-ready, e.g. "in each centre's own local time"
}
```

The read side accepts all five recurrences ADR-0020 authorises, so a published
version always renders correctly whatever it was published with. **The write
side is narrowed to daily for this cycle**, per the coordinator's work order.
Daily is a strict subset of the ADR, and the surface says which one it is using
rather than presenting a picker with one option in it. Widening it later is a
change to one union and one fieldset.

`dueTime` is sent as a wall-clock time-of-day. Applying it in each assigned
centre's own local time is the backend's job, as is every subsequent occurrence
and timeliness decision — the browser derives none of it. Please keep schedule
storage, deadline display and timeliness comparison at consistent **minute
precision**, as ADR-0018 already requires of the completion path.

---

## F. Commands

```ts
createTemplate(input: { name: string }): Promise<{ templateId: string; versionId: string }>
saveDraft(input: { versionId: string; draft: TemplateDraft }): Promise<{ lastSavedLocalTime: string }>
createDraftFrom(input: { versionId: string }): Promise<{ templateId: string; versionId: string }>
retireVersion(input: { versionId: string }): Promise<{ retiredLocalTime: string }>
publishVersion(input: {
  versionId: string
  assignment: AssignmentSelection
  schedule: ScheduleSelection
}): Promise<PublishResult>
```

`saveDraft` sends the whole draft rather than a mutation per control. A draft is
small, single-writer, and only meaningful as a whole; a granular API would have
been this lane guessing at a backend shape. **`saveDraft` must refuse on a
version that is not a draft**, regardless of what the client sends.

`createDraftFrom` copies. The source version must be left exactly as it was —
that is what keeps the lineage of occurrences and completions that used it
stable.

---

## G. Publish result — the item that matters most

```ts
type PublishResult =
  | { outcome: "PUBLISHED";         versionId: string; versionLabel: string
                                    publishedLocalTime: string
                                    assignment: AssignmentSummary; schedule: ScheduleSummary }
  | { outcome: "ALREADY_PUBLISHED"; versionId: string; versionLabel: string
                                    publishedLocalTime: string; publishedByRequester: boolean }
  | { outcome: "REFUSED";           reason: string }
```

**`ALREADY_PUBLISHED` must be a success-shaped result, not an error.** This is
the same reasoning as `ALREADY_COMPLETED` on the completion path, and it matters
more here: the most likely real-world failure is a publish that commits and
whose response is lost in transit, and the obvious recovery an Area Manager
reaches for is pressing publish again. Returning an error would tell them they
failed after the version went live, and invite a second publish.

- `publishedByRequester: true` → *"You published Version 2 at 2:20pm. It was not
  published twice."* Presented as success.
- `publishedByRequester: false` → *"Version 2 was already published at 2:20pm"*,
  plus an explicit statement that the settings on screen were **not** applied.

**`REFUSED` is a decision, not an outage.** Insufficient authority, a centre
outside scope, a template with nothing in it — these are results with
backend-supplied, reader-safe wording, displayed verbatim. The frontend composes
none of it and never presents a refusal as a failure of the system. A thrown
error is reserved for transport failure, where the copy says we could not
confirm and that retrying is safe.

---

## H. Authority

Every `can*` flag — `canCreate`, `canEdit`, `canPublish`, `canCreateDraft`,
`canRetire` — is decided by the backend from current capability and resource
scope. The frontend renders no control it has not been granted and infers
nothing from a role name, from the lifecycle state, or from the fact that a
version was returned at all.

`canEdit` and `canPublish` are separate because they are separate decisions: a
principal may be able to shape a draft without being able to put it into
centres.

---

## I. Preview is not an operation

ADR-0020: phone preview "does not itself publish a version, assign a centre,
create an occurrence, record a completion, or confer authority."

The preview route therefore calls **no** completion command and reaches no
occurrence. It reads the saved draft, walks it one question at a time with the
same 56px targets and the same written progress count as the real completion
screen, and ends on a screen that says nothing was recorded and no centre was
contacted.

The coordinator's work order asked for `ALREADY_COMPLETED` handling in the
preview. That is **not** built, and deliberately: `ALREADY_COMPLETED` is a live
operational state of a real occurrence, and rendering it for a check that does
not exist would show an Area Manager an outcome that never happened. The real
handling already exists and is tested on the shipped Centre Standards completion
surface (`centre-standards-check.tsx`), which is where a real occurrence is.

The preview needs nothing from the backend beyond `B`.

---

## J. Navigation — the one blocker we cannot resolve

`deriveWorkspaceLinks` in `foundation/navigation/workspace-links.ts` must return
a template-library destination for a principal holding whatever the authoring
capability turns out to be called.

We could not add this. ADR-0020 states that "exact new capability names are not
invented by this governance decision and require review within this boundary",
so this lane will not invent one.

Until it exists, `/standards/templates` is reachable only by deep link. The
surfaces mark themselves active at that route and are otherwise unaffected;
frontend visibility is presentation only and every destination reauthorises
server-side regardless.

This is the same shape of blocker as `H` in the Centre Standards frontend
contract, and has the same resolution: a capability name decided in the backend
lane, then one line of navigation.

---

## K. Audit

ADR-0020 requires an attributable audit trail for material template, version,
lifecycle, assignment, schedule, due-configuration and answer/remediation-rule
changes. The frontend requests nothing for this and surfaces nothing beyond the
`publishedBy` / `retiredBy` / `eventBy` attribution already in `B`. Recording is
entirely a backend concern; this note exists so it is not assumed to have been
covered by the shapes above.

---

## L. Not built in this cycle, and why

- **Answer and remediation rules.** ADR-0020 permits a published version to
  carry configurable answer/remediation rules that feed the *existing*
  finding/corrective-action architecture. No authoring UI for them is built.
  Designing one before the backend has named how a configured outcome reaches
  the existing architecture would mean inventing that boundary from the browser,
  which is exactly what the ADR forbids. `DraftQuestion` has room for it.
- **Retire.** `canRetire` and `retireVersion` are in the contract and the
  retired lifecycle renders correctly, but no retire control is wired to a
  confirmation flow yet. Retiring a live template is a consequential action and
  is better designed alongside the backend's answer on what happens to open
  occurrences at the moment of retirement.
- **Weekly, monthly, quarterly and ad-hoc schedules.** Authorised by ADR-0020,
  narrowed to daily by this cycle's work order. See `E`.

---

## What is already proven on the frontend

The suite covers: an unsupported library asserting nothing; a partial library
never rendering an all-clear; a template created once under two clicks in one
batch; sections and questions added, reordered by button with the move
announced, and removed; every one of the six question types rendering its own
control in the preview; a choice question never reduced below two options; a
required question holding the preview flow while an optional one does not; a
draft refusing to publish until it is publishable and saying what is missing; a
published version offering no edit control anywhere; a new draft leaving the
published version and the history untouched; publish sending exactly one command
under two clicks in one batch; `ALREADY_PUBLISHED` presented as success;
`REFUSED` shown in the backend's own words with retry still available; an
ambiguous publish failure never claiming nothing was published; an unresolved
portfolio size never rendered as zero; and no internal token or storage
vocabulary reaching the DOM on any surface.

The layout contract is asserted against the stylesheet: single-column
zero-minimum grids, 56px primary and typed answer targets, 44px everywhere else,
a fixed action bar reserving the space it covers, wide layouts added rather than
assumed, and forced-colors keeping every boundary visible.

---

## Frontend-only assumptions

These are decisions this lane made about its own surfaces. None of them asks
anything of the backend, and none of them should be read as a contract term.

- **Two screen elements may carry the same words, and the tests say which one
  they mean.** On a published version, "This version cannot be changed" appears
  both in the page summary and on the questions themselves; in the library,
  "Published" is both a filter and a state badge. Both repetitions are
  deliberate — the reader meets the fact where they need it — so the assertions
  are scoped to a named region or a card rather than the copy being thinned out
  to make a query unambiguous.
- **A version label is not unique text on the page.** A history row shows
  "Version 1" and its own Open button is named "Open Version 1", so history is
  asserted as ordered rows, newest first, rather than as loose text.
- **The stylesheet contract reads selector lists, not literal text.** A rule
  written `.builder-section-list, .builder-question-list { … }` serves both
  selectors; the layout test resolves either name to that rule, so how the
  stylesheet is punctuated cannot make a rule look missing.
- **No test depends on a clock.** Every time and date reaching a surface is
  presentation-ready text supplied by the gateway (`lastSavedLocalTime`,
  `publishedLocalTime`, `eventLabel`), and the fixtures supply fixed strings. The
  browser derives no timestamp and no time zone, so there is nothing here that
  can drift between runs or between machines.
