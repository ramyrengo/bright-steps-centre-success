/**
 * The view models the Area Manager Template & Form Builder renders, and the
 * gateway interface its surfaces are written against.
 *
 * This file used to be a UX-lane placeholder describing a transport that did
 * not exist. The transport is real now: `template-builder-gateway.ts` adapts
 * these view models onto the generated Encore client, and the backend request
 * and response shapes are imported from that client rather than restated here.
 * What stays in this file is only what is genuinely presentational — the shapes
 * the surfaces render, the wording they render it in, and the helpers that turn
 * one into the other.
 *
 * Three rules from ADR-0020 are carried by the *types*, so the states that must
 * never occur are unrepresentable rather than merely untested:
 *
 * - A published version is immutable. `PublishedVersion` and `RetiredVersion`
 *   carry no editing authority, no draft payload and no lock token, so no
 *   surface can offer an edit control on one by accident.
 * - Choices belong only to choice questions. A text, number, time or yes/no
 *   question has nowhere to put a `choices` array.
 * - The portfolio is resolved from backend authority. `PORTFOLIO` assignment
 *   carries no centre list at all, so the browser cannot supply one and cannot
 *   be read as having supplied one.
 *
 * A fourth rule is now carried the same way: an editable draft always holds the
 * `lockVersion` the backend gave it, so every command that changes a draft has
 * the optimistic-concurrency token in hand and two Area Managers editing one
 * draft cannot silently overwrite each other.
 *
 * Absence is never zero, per the design system: a library that could not be
 * fully established says so and never renders an all-clear, and a fact the
 * backend does not serve is left absent rather than filled with a plausible
 * default.
 */

/* ------------------------------------------------------------------ *
 * Question content
 * ------------------------------------------------------------------ */

/**
 * The seven question types the builder can author.
 *
 * These are presentation discriminators chosen by this lane and are never
 * rendered: every surface reads its wording from `QUESTION_TYPE_LABEL`, so no
 * internal token reaches a reader. Each one maps onto exactly one backend
 * question type — see `template-builder-gateway.ts` — which is why the set is
 * this set: the builder must not offer an author a question the backend cannot
 * store.
 *
 * `YES_NO` is the one piece of sugar. It is stored as a two-option choice
 * question, which is what it has always been on screen; the mapping is
 * deterministic in both directions.
 *
 * `DATE` closed a real scope gap rather than a fixture one: the approved Form
 * Builder scope always listed a date question, but the schema only began
 * admitting `date` at migration 031, so until then the builder correctly
 * refused to offer it.
 */
export type QuestionType =
  | "YES_NO"
  | "SINGLE_SELECT"
  | "MULTI_SELECT"
  | "TEXT"
  | "NUMBER"
  | "TIME"
  | "DATE";

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  YES_NO: "Yes or no",
  SINGLE_SELECT: "Choose one",
  MULTI_SELECT: "Choose any that apply",
  TEXT: "Written answer",
  NUMBER: "Number",
  TIME: "Time of day",
  DATE: "Date",
};

/** A one-line description of what the person answering will see. */
export const QUESTION_TYPE_HINT: Record<QuestionType, string> = {
  YES_NO: "Two large buttons — Yes or No.",
  SINGLE_SELECT: "A list of options; exactly one can be chosen.",
  MULTI_SELECT: "A list of options; any number can be chosen.",
  TEXT: "A box to write in.",
  NUMBER: "A number entry.",
  TIME: "A time of day, such as 9:00am.",
  DATE: "A calendar date, such as 3 September 2026.",
};

/** One offered option on a choice question. */
export interface DraftChoice {
  /** Stable within the draft. Opaque to the reader and never displayed. */
  choiceId: string;
  label: string;
}

/**
 * What varies between question types.
 *
 * A discriminated union rather than one wide record with optional fields: it is
 * what makes "a time question with three choices" impossible to construct, so
 * neither the editor nor the preview has to defend against it.
 */
export type QuestionShape =
  | { type: "YES_NO" }
  | { type: "SINGLE_SELECT"; choices: DraftChoice[] }
  | { type: "MULTI_SELECT"; choices: DraftChoice[] }
  | { type: "TEXT"; multiline: boolean }
  | { type: "NUMBER" }
  | { type: "TIME" }
  // The bounds are plain calendar dates, `YYYY-MM-DD`, with no time and no
  // timezone attached. A centre's timezone decides when a form opens and is
  // due; it has no bearing on which day an answer may name, so it is not
  // consulted here.
  | { type: "DATE"; earliest?: string; latest?: string };

export type ChoiceQuestionShape = Extract<
  QuestionShape,
  { type: "SINGLE_SELECT" | "MULTI_SELECT" }
>;

export function isChoiceQuestion(shape: QuestionShape): shape is ChoiceQuestionShape {
  return shape.type === "SINGLE_SELECT" || shape.type === "MULTI_SELECT";
}

export type DraftQuestion = QuestionShape & {
  /** Stable within the draft. Opaque to the reader and never displayed. */
  questionId: string;
  wording: string;
  /** Optional help shown under the question to the person answering. */
  guidance?: string;
  required: boolean;
};

export interface DraftSection {
  sectionId: string;
  title: string;
  /** Presentation order is the array order. There is no separate index field
   *  to drift out of step with it. */
  questions: DraftQuestion[];
}

/**
 * The editable body of a draft.
 *
 * The editor holds one of these in memory and saves it whole, which is why the
 * gateway needs a single save command rather than a per-question mutation for
 * every control on the screen.
 *
 * `purpose` is not optional. The backend requires a template to say what it is
 * for before it will store one at all, so offering the field as optional would
 * be offering a draft that cannot be saved.
 */
export interface TemplateDraft {
  name: string;
  /** What this template is for, in the Area Manager's own words. */
  purpose: string;
  sections: DraftSection[];
}

/* ------------------------------------------------------------------ *
 * Lifecycle and version history
 * ------------------------------------------------------------------ */

export type TemplateLifecycle = "DRAFT" | "PUBLISHED" | "RETIRED";

export const LIFECYCLE_LABEL: Record<TemplateLifecycle, string> = {
  DRAFT: "Draft",
  PUBLISHED: "Published",
  RETIRED: "Retired",
};

export function lifecycleTone(
  lifecycle: TemplateLifecycle,
): "neutral" | "positive" | "informational" {
  switch (lifecycle) {
    case "DRAFT":
      return "neutral";
    case "PUBLISHED":
      return "positive";
    case "RETIRED":
      return "informational";
  }
}

/**
 * A draft carries its editable body, the authority to change it, and the lock
 * token every command that changes it must send back.
 *
 * A draft is not a version and has no version identifier: it has never been
 * published, so there is nothing permanent to identify. Every backend command
 * that touches it is keyed on the template instead, which is what `templateId`
 * on the workspace is for.
 *
 * Authority comes from the backend and is never inferred from the lifecycle
 * state or from a role name.
 */
export interface DraftVersionState {
  lifecycle: "DRAFT";
  /** Presentation-ready, e.g. "Draft". */
  versionLabel: string;
  draft: TemplateDraft;
  /**
   * Optimistic concurrency. Sent back on save, publish and retire so a second
   * Area Manager's changes are refused rather than silently overwritten.
   * Required, so an editable draft without one cannot be constructed.
   */
  lockVersion: number;
  canEdit: boolean;
  canPublish: boolean;
  /** Presentation-ready, e.g. "Saved 2:14pm". Absent before the first save. */
  lastSavedLocalTime?: string;
}

/** Identity shared by every published or retired version. */
export interface VersionIdentity {
  /** Opaque route identifier. Passed back untouched, never displayed. */
  versionId: string;
  /** Presentation-ready, e.g. "Version 3", composed from the version number
   *  the backend assigned. */
  versionLabel: string;
}

/**
 * A published version is immutable, so it has no `draft`, no `canEdit` and no
 * lock token. Its content is a read-only rendering of what was published.
 *
 * `assignment`, `schedule` and `publishedBy` are optional because the backend
 * does not serve them for every version. Where a fact is not established the
 * surface says so rather than printing a plausible one — a schedule invented in
 * the browser would be telling an Area Manager when a centre is asked.
 */
export interface PublishedVersionState {
  lifecycle: "PUBLISHED";
  content: TemplateDraft;
  /** Presentation-ready, e.g. "13 Aug 2026, 2:20pm". */
  publishedLocalTime: string;
  /** Present only where the backend named the person. */
  publishedBy?: string;
  assignment?: AssignmentSummary;
  schedule?: ScheduleSummary;
  /** Whether this principal may start a new draft from this version. */
  canCreateDraft: boolean;
  canRetire: boolean;
}

/** Retirement stops future use. It never erases or rewrites what was published. */
export interface RetiredVersionState {
  lifecycle: "RETIRED";
  content: TemplateDraft;
  publishedLocalTime: string;
  publishedBy?: string;
  retiredLocalTime?: string;
  retiredBy?: string;
  assignment?: AssignmentSummary;
  schedule?: ScheduleSummary;
  canCreateDraft: boolean;
}

export type TemplateVersion =
  | DraftVersionState
  | (VersionIdentity & (PublishedVersionState | RetiredVersionState));

/**
 * One row of version history.
 *
 * The open draft and a permanent version are different things, so they are
 * different members: only a published or retired row has a version identifier
 * to open, and only it can be the one in use. A draft row cannot be mistaken
 * for a version that a centre was ever asked.
 */
export type VersionHistoryEntry =
  | {
      state: "DRAFT";
      /** Presentation-ready, e.g. "Draft". */
      label: string;
      /** Presentation-ready. What happened and when, e.g. "Last changed 2:14pm". */
      eventLabel: string;
      /** Present only where the backend named the person. */
      eventBy?: string;
    }
  | {
      state: "PUBLISHED" | "RETIRED";
      versionId: string;
      versionLabel: string;
      /** Presentation-ready, e.g. "Published 13 Aug 2026". */
      eventLabel: string;
      eventBy?: string;
      /** True for the version currently in operational use. */
      current: boolean;
    };

/** Which version of a template a surface is showing. */
export type OpenVersion = { kind: "DRAFT" } | { kind: "VERSION"; versionId: string };

/* ------------------------------------------------------------------ *
 * Assignment
 * ------------------------------------------------------------------ */

/**
 * Where a published version runs.
 *
 * `PORTFOLIO` deliberately carries no centre list. ADR-0020 requires the
 * portfolio to be resolved from current backend authority and scope, not from a
 * client-supplied list, and giving the browser nowhere to put one is a stronger
 * guarantee than a comment asking it not to. The backend still validates every
 * centre affected by either branch.
 */
export type AssignmentSelection =
  | { scope: "PORTFOLIO" }
  | { scope: "CENTRES"; centreIds: string[] };

/** One centre the backend says this principal may assign to. */
export interface AssignableCentre {
  centreId: string;
  centreName: string;
  /** Presentation-ready time-zone wording, e.g. "Brisbane time". Present only
   *  where the backend supplied one; the browser has no authoritative centre
   *  time zone and must not derive one. */
  timeZoneLabel?: string;
}

/**
 * What the assignment picker may offer.
 *
 * `portfolioCentreCount` is present only where the backend resolved the whole
 * portfolio. Where any authorised centre could not be resolved it is absent, so
 * the picker says the size is not confirmed rather than printing a number that
 * is really a floor.
 */
export interface AssignmentOptions {
  centres: AssignableCentre[];
  portfolioAvailable: boolean;
  portfolioCentreCount?: number;
  /** Present when the list is known to be incomplete. Displayed verbatim. */
  warning?: string;
}

/** How an assignment reads once it is published and immutable. */
export type AssignmentSummary =
  | { scope: "PORTFOLIO"; description: string; centreCount?: number }
  | { scope: "CENTRES"; description: string; centreNames: string[] };

/* ------------------------------------------------------------------ *
 * Scheduling
 * ------------------------------------------------------------------ */

/**
 * The recurrences ADR-0020 authorises.
 *
 * The read side accepts all five so a published version always renders
 * correctly. The write side — `ScheduleSelection` below — is daily only, which
 * is not a UI simplification but the whole of what the backend will accept:
 * `validateDailySchedule` refuses anything else outright.
 */
export type Recurrence = "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "AD_HOC";

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  DAILY: "Every day",
  WEEKLY: "Every week",
  MONTHLY: "Every month",
  QUARTERLY: "Every quarter",
  AD_HOC: "When requested",
};

/**
 * What the builder can produce.
 *
 * All four fields are required because the backend requires all four. It also
 * enforces that the check opens before it is due, and that the first day is a
 * real date — `scheduleProblems` states both while the Area Manager can still
 * fix them, and the backend re-decides both.
 */
export interface ScheduleSelection {
  recurrence: "DAILY";
  /** 24-hour `HH:MM`, applied in each assigned centre's own local time. */
  opensLocalTime: string;
  /** 24-hour `HH:MM`, applied in each assigned centre's own local time. */
  dueLocalTime: string;
  /** `YYYY-MM-DD`. The first day the check runs. */
  effectiveFrom: string;
}

/** How a schedule reads once it is published and immutable. */
export interface ScheduleSummary {
  recurrence: Recurrence;
  /** Presentation-ready, e.g. "9:00am". */
  dueLocalTime: string;
  /** Presentation-ready, e.g. "6:00am". Present where the backend has one. */
  opensLocalTime?: string;
  /** Presentation-ready wording for how the time is applied across centres. */
  timeZoneNote: string;
}

/* ------------------------------------------------------------------ *
 * Library
 * ------------------------------------------------------------------ */

export interface TemplateSummary {
  templateId: string;
  name: string;
  purpose?: string;
  lifecycle: TemplateLifecycle;
  versionLabel: string;
  /** Absent where the library listing does not carry a question count. A card
   *  omits the count rather than printing a zero it did not establish. */
  questionCount?: number;
  /** Presentation-ready one-liner, e.g. "Not published yet" or
   *  "Published 13 Aug 2026". */
  stateLabel: string;
  /** Present on a published or retired template only. */
  assignmentDescription?: string;
  scheduleDescription?: string;
}

/**
 * The library, discriminated the same way the Centre Standards workspace is.
 *
 * `unsupported` carries no template field at all, so it cannot assert anything
 * about a library the request never looked for — this is the principal with no
 * authoring authority, including a System Administrator. `partial` always
 * carries a warning and may never render an all-clear, because an incomplete
 * list is not evidence that nothing exists.
 */
export type TemplateLibrary =
  | { status: "ready"; templates: TemplateSummary[]; canCreate: boolean }
  | { status: "partial"; templates: TemplateSummary[]; canCreate: boolean; warning: string }
  | { status: "unsupported" };

/* ------------------------------------------------------------------ *
 * Template workspace
 * ------------------------------------------------------------------ */

export interface TemplateWorkspace {
  templateId: string;
  templateName: string;
  /** The version this route opens on: the open draft where one exists,
   *  otherwise the version currently in use. */
  version: TemplateVersion;
  /** The template's optimistic-concurrency token, for commands that act on the
   *  template rather than on the version being read. Absent where the backend
   *  gave none. */
  lockVersion?: number;
  /** Newest first. Published and retired entries are permanent. */
  history: VersionHistoryEntry[];
}

/* ------------------------------------------------------------------ *
 * Command results
 * ------------------------------------------------------------------ */

export interface SaveDraftResult {
  lastSavedLocalTime: string;
  /** The token the *next* command must send. Threading this back is what keeps
   *  a second save from being refused as stale immediately after the first. */
  lockVersion: number;
}

/**
 * The result of publishing.
 *
 * Publishing and assigning are two backend commands. `PUBLISHED` means both
 * succeeded; `PUBLISHED_NOT_ASSIGNED` means the version is live and permanent
 * but has nowhere to run yet. That distinction is the point: telling an Area
 * Manager the publish failed when the version went live would be wrong, and the
 * obvious recovery — press publish again — would then be refused.
 *
 * `ALREADY_PUBLISHED` is success-shaped for the same reason `ALREADY_COMPLETED`
 * is on the completion path: the most likely real failure is a request that
 * committed and whose response was lost. It is only produced where the gateway
 * actually established that a new version exists, never guessed at.
 *
 * `REFUSED` is a reader-safe refusal decided by the backend — insufficient
 * authority, a centre outside scope, an empty template, a draft someone else
 * has changed. It is a result rather than an exception so the wording reaching
 * the reader is the backend's, and a refusal is never presented as an outage.
 */
export type PublishResult =
  | {
      outcome: "PUBLISHED";
      versionId: string;
      versionLabel: string;
      publishedLocalTime: string;
      assignment: AssignmentSummary;
      schedule: ScheduleSummary;
    }
  | {
      outcome: "PUBLISHED_NOT_ASSIGNED";
      versionId: string;
      versionLabel: string;
      publishedLocalTime: string;
      /** The backend's own wording for why the assignment did not happen. */
      reason: string;
    }
  | {
      outcome: "ALREADY_PUBLISHED";
      versionId: string;
      versionLabel: string;
      publishedLocalTime: string;
      /**
       * Whether the version that is already live was published by the person
       * reading this. "You published this" and "someone else got there first"
       * lead to different next moves, so they are not told in one sentence.
       *
       * The backend attributes publication: a version summary's `authorId` is
       * the principal who published it, not whoever drafted it. Where the
       * current principal could not be established this is false, because an
       * ownership claim that was not established is not one worth making.
       */
      publishedByRequester: boolean;
    }
  | { outcome: "REFUSED"; reason: string };

/** Setting where and when an already-published version runs. */
export type AssignResult =
  | { outcome: "ASSIGNED"; assignment: AssignmentSummary; schedule: ScheduleSummary }
  | { outcome: "REFUSED"; reason: string };

export interface CreateDraftResult {
  templateId: string;
}

export type CreateTemplateResult =
  | { outcome: "CREATED"; templateId: string }
  | { outcome: "REFUSED"; reason: string };

export interface RetireResult {
  /** The token the next command on this template must send. */
  lockVersion: number;
}

/* ------------------------------------------------------------------ *
 * Gateway
 * ------------------------------------------------------------------ */

/**
 * Everything the builder experience needs, and nothing else.
 *
 * Every command is keyed on `templateId`, because every backend route is.
 * Every command that changes a draft carries `lockVersion`, because every
 * backend command that changes a draft requires one.
 *
 * Saving is one whole-draft command rather than a mutation per control. That is
 * not a guess about the backend any more: the update route replaces the whole
 * draft body in one transaction, so a granular API would be several round trips
 * onto the same write.
 */
export interface TemplateBuilderGateway {
  loadLibrary(): Promise<TemplateLibrary>;
  createTemplate(input: { name: string; purpose: string }): Promise<CreateTemplateResult>;
  loadTemplate(templateId: string): Promise<TemplateWorkspace>;
  loadVersion(input: { templateId: string; versionId: string }): Promise<TemplateWorkspace>;
  saveDraft(input: {
    templateId: string;
    lockVersion: number;
    draft: TemplateDraft;
  }): Promise<SaveDraftResult>;
  loadAssignmentOptions(): Promise<AssignmentOptions>;
  /**
   * Publishes the draft the backend currently holds, then assigns it. The
   * caller must have saved first: the backend publishes what is stored, not
   * what is on screen.
   */
  publishVersion(input: {
    templateId: string;
    lockVersion: number;
    assignment: AssignmentSelection;
    schedule: ScheduleSelection;
  }): Promise<PublishResult>;
  /** Retrying only the assignment, after a version published without one. */
  assignPublishedVersion(input: {
    templateId: string;
    versionId: string;
    assignment: AssignmentSelection;
    schedule: ScheduleSelection;
  }): Promise<AssignResult>;
  /** Starts a new editable draft from a published or retired version. The
   *  source version is never modified. */
  createDraftFrom(input: { templateId: string; versionId: string }): Promise<CreateDraftResult>;
  retireTemplate(input: { templateId: string; lockVersion: number }): Promise<RetireResult>;
}

/** Distinguishes a recoverable failure from a refusal. A refusal is a result. */
export class TemplateBuilderUnavailableError extends Error {
  constructor(message = "The template builder is temporarily unavailable") {
    super(message);
    this.name = "TemplateBuilderUnavailableError";
  }
}

/**
 * A gateway that refuses every operation.
 *
 * This is no longer the default transport — `createTemplateBuilderGateway` is —
 * but the pattern is kept for genuine unavailability: a surface handed this
 * refuses honestly rather than inventing a template, and every error path in
 * the builder is exercised against it.
 */
export const backendNotAvailableGateway: TemplateBuilderGateway = {
  loadLibrary: () => Promise.reject(new TemplateBuilderUnavailableError()),
  createTemplate: () => Promise.reject(new TemplateBuilderUnavailableError()),
  loadTemplate: () => Promise.reject(new TemplateBuilderUnavailableError()),
  loadVersion: () => Promise.reject(new TemplateBuilderUnavailableError()),
  saveDraft: () => Promise.reject(new TemplateBuilderUnavailableError()),
  loadAssignmentOptions: () => Promise.reject(new TemplateBuilderUnavailableError()),
  publishVersion: () => Promise.reject(new TemplateBuilderUnavailableError()),
  assignPublishedVersion: () => Promise.reject(new TemplateBuilderUnavailableError()),
  createDraftFrom: () => Promise.reject(new TemplateBuilderUnavailableError()),
  retireTemplate: () => Promise.reject(new TemplateBuilderUnavailableError()),
};

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

export const TEMPLATE_ROOT = "/standards/templates";

/**
 * What the publish step opens on, and what the preview shows a draft.
 *
 * One pair of constants rather than one per surface: the preview's whole claim
 * is that it shows what the person answering will see, and a preview showing a
 * different default time from the one publish opens on would quietly make that
 * claim false.
 */
export const DEFAULT_OPENS_TIME = "06:00";
export const DEFAULT_DUE_TIME = "09:00";

export function templateRoute(templateId: string): string {
  return `${TEMPLATE_ROOT}/${templateId}`;
}

export function templatePreviewRoute(templateId: string): string {
  return `${TEMPLATE_ROOT}/${templateId}/preview`;
}

/** The body a surface may render, whatever lifecycle the version is in. */
export function versionContent(version: TemplateVersion): TemplateDraft {
  return version.lifecycle === "DRAFT" ? version.draft : version.content;
}

/**
 * Editing authority.
 *
 * A published or retired version has no `canEdit` to consult, which is the
 * point: immutability is carried by the shape rather than by every caller
 * remembering to check the lifecycle first.
 */
export function canEditVersion(version: TemplateVersion): boolean {
  return version.lifecycle === "DRAFT" && version.canEdit;
}

export function countQuestions(draft: TemplateDraft): number {
  return draft.sections.reduce((total, section) => total + section.questions.length, 0);
}

/** Formats a 24-hour `HH:MM` the way a person says it. */
export function dueTimeLabel(dueTime: string): string {
  const match = /^(\d{2}):(\d{2})$/.exec(dueTime);
  if (!match) return dueTime;
  const hours = Number(match[1]);
  const minutes = match[2];
  const suffix = hours < 12 ? "am" : "pm";
  const display = hours % 12 === 0 ? 12 : hours % 12;
  return `${display}:${minutes}${suffix}`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;

/**
 * A backend timestamp as a reader sees it, in the reader's own local time.
 *
 * Hand-composed from the local calendar fields rather than left to a locale
 * formatter: the same string has to be readable in a test, in a screenshot and
 * on a phone, and a formatter that quietly inserts a narrow no-break space or
 * reorders the parts by host locale makes that untrue.
 *
 * Returns `undefined` for anything unparseable, so a bad timestamp is an absent
 * fact rather than the words "Invalid Date" on an audit surface.
 */
export function timestampLabel(iso: string): string | undefined {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  const minutes = `${at.getMinutes()}`.padStart(2, "0");
  const time = dueTimeLabel(`${`${at.getHours()}`.padStart(2, "0")}:${minutes}`);
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}, ${time}`;
}

/** The date part only, e.g. "13 Aug 2026". */
export function dateLabel(iso: string): string | undefined {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return undefined;
  return `${at.getDate()} ${MONTHS[at.getMonth()]} ${at.getFullYear()}`;
}

/**
 * A plain calendar date — `YYYY-MM-DD` — as a reader sees it, e.g. "3 Sep 2026".
 *
 * Deliberately not `dateLabel`. That one parses an instant and then reads the
 * host's local calendar off it, which is right for a backend timestamp and
 * wrong here: a date question's bounds carry no time and no zone, so passing
 * one through `Date` would let a reader west of UTC see the day before the one
 * the Area Manager chose. The parts are read straight out of the string
 * instead, so the day shown is the day stored, everywhere.
 *
 * Returns `undefined` for anything that is not a real calendar date, so a
 * malformed bound is an absent fact rather than "Invalid Date" on screen.
 */
export function calendarDateLabel(value: string): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  if (!match) return undefined;
  const [, year, month, day] = match;
  const monthIndex = Number(month) - 1;
  const name = MONTHS[monthIndex];
  if (!name) return undefined;
  const dayNumber = Number(day);
  // The month's own length, so 31 Sep and 30 Feb are refused rather than shown.
  const daysInMonth = new Date(Date.UTC(Number(year), monthIndex + 1, 0)).getUTCDate();
  if (dayNumber < 1 || dayNumber > daysInMonth) return undefined;
  return `${dayNumber} ${name} ${Number(year)}`;
}

/** Today in the reader's own local calendar, as `YYYY-MM-DD`. */
export function localToday(now: Date = new Date()): string {
  const month = `${now.getMonth() + 1}`.padStart(2, "0");
  const day = `${now.getDate()}`.padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Why a draft cannot be published yet, in the order a reader would fix them.
 *
 * The backend re-decides all of this and its refusal is authoritative. This
 * exists so an Area Manager is told what is missing while they can still fix
 * it, rather than after a round trip that refuses.
 */
export function draftReadinessProblems(draft: TemplateDraft): string[] {
  const problems: string[] = [];
  if (!draft.name.trim()) problems.push("Give the template a name.");
  if (!draft.purpose.trim()) problems.push("Say what this template is for.");
  if (draft.sections.length === 0) problems.push("Add at least one section.");

  if (draft.sections.some((section) => !section.title.trim())) {
    problems.push("Give every section a name.");
  }

  if (countQuestions(draft) === 0) problems.push("Add at least one question.");

  const blank = draft.sections
    .flatMap((section) => section.questions)
    .filter((question) => !question.wording.trim()).length;
  if (blank > 0) {
    problems.push(
      blank === 1
        ? "One question has no wording yet."
        : `${blank} questions have no wording yet.`,
    );
  }

  const shortChoices = draft.sections
    .flatMap((section) => section.questions)
    .filter(
      (question) =>
        isChoiceQuestion(question) &&
        question.choices.filter((choice) => choice.label.trim()).length < 2,
    ).length;
  if (shortChoices > 0) {
    problems.push(
      shortChoices === 1
        ? "One choice question needs at least two options."
        : `${shortChoices} choice questions need at least two options.`,
    );
  }

  return problems;
}

/**
 * Why a schedule cannot be published yet.
 *
 * The same two rules the backend enforces, stated before the round trip rather
 * than after it. Both are real operational facts, not formatting: a check that
 * is due before it opens can never be completed on time.
 */
export function scheduleProblems(schedule: ScheduleSelection): string[] {
  const problems: string[] = [];
  const time = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
  if (!time.test(schedule.opensLocalTime) || !time.test(schedule.dueLocalTime)) {
    problems.push("Choose a time the check opens and a time it is due.");
  } else if (schedule.opensLocalTime >= schedule.dueLocalTime) {
    problems.push("The time it is due has to be after the time it opens.");
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(schedule.effectiveFrom)) {
    problems.push("Choose the first day it runs.");
  } else if (Number.isNaN(new Date(`${schedule.effectiveFrom}T00:00:00.000Z`).getTime())) {
    problems.push("Choose the first day it runs.");
  }
  return problems;
}

/** Describes a selection before it is published, for the confirmation copy. */
export function describeAssignment(
  selection: AssignmentSelection,
  options: AssignmentOptions,
): string {
  if (selection.scope === "PORTFOLIO") {
    return options.portfolioCentreCount === undefined
      ? "Every centre in your portfolio, resolved when you publish"
      : `Every centre in your portfolio — ${options.portfolioCentreCount} centre${
          options.portfolioCentreCount === 1 ? "" : "s"
        } right now`;
  }
  const names = selection.centreIds
    .map((id) => options.centres.find((centre) => centre.centreId === id)?.centreName)
    .filter((name): name is string => Boolean(name));
  if (names.length === 0) return "No centre chosen yet";
  if (names.length === 1) return names[0]!;
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}
