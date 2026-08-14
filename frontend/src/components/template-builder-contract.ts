/**
 * The minimum frontend-facing interface the Area Manager Template & Form
 * Builder needs.
 *
 * This file is a UX-lane placeholder, not a backend contract. It follows the
 * convention `centre-standards-contract.ts` established: describe the smallest
 * shape the experience requires, in presentation terms, so the surfaces can be
 * built and tested before the backend lane exists — and so wiring later is a
 * prop mapping rather than a redesign. No endpoint is invented here; nothing in
 * this file calls the generated client, and the default gateway refuses
 * honestly rather than fabricating a template.
 *
 * Three rules from ADR-0020 are carried by the *types*, so the states that must
 * never occur are unrepresentable rather than merely untested:
 *
 * - A published version is immutable. `PublishedVersion` and `RetiredVersion`
 *   carry no editing authority and no draft payload, so no surface can offer an
 *   edit control on one by accident.
 * - Choices belong only to choice questions. A text, number, date or yes/no
 *   question has nowhere to put a `choices` array.
 * - The portfolio is resolved from backend authority. `PORTFOLIO` assignment
 *   carries no centre list at all, so the browser cannot supply one and cannot
 *   be read as having supplied one.
 *
 * Absence is never zero, per the design system: a library that could not be
 * fully established says so and never renders an all-clear.
 */

/* ------------------------------------------------------------------ *
 * Question content
 * ------------------------------------------------------------------ */

/**
 * The six question types ADR-0020 authorises for the initial slice.
 *
 * These are presentation discriminators chosen by this lane. They are never
 * rendered: every surface reads its wording from `QUESTION_TYPE_LABEL`, so no
 * internal token reaches a reader. If the backend names them differently, the
 * adapter maps them and nothing else changes.
 */
export type QuestionType =
  | "YES_NO"
  | "SINGLE_SELECT"
  | "MULTI_SELECT"
  | "TEXT"
  | "NUMBER"
  | "DATE";

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  YES_NO: "Yes or no",
  SINGLE_SELECT: "Choose one",
  MULTI_SELECT: "Choose any that apply",
  TEXT: "Written answer",
  NUMBER: "Number",
  DATE: "Date",
};

/** A one-line description of what the person answering will see. */
export const QUESTION_TYPE_HINT: Record<QuestionType, string> = {
  YES_NO: "Two large buttons — Yes or No.",
  SINGLE_SELECT: "A list of options; exactly one can be chosen.",
  MULTI_SELECT: "A list of options; any number can be chosen.",
  TEXT: "A box to write in.",
  NUMBER: "A number entry, with an optional unit.",
  DATE: "A date picker.",
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
 * what makes "a date question with three choices" impossible to construct, so
 * neither the editor nor the preview has to defend against it.
 */
export type QuestionShape =
  | { type: "YES_NO" }
  | { type: "SINGLE_SELECT"; choices: DraftChoice[] }
  | { type: "MULTI_SELECT"; choices: DraftChoice[] }
  | { type: "TEXT"; multiline: boolean }
  | { type: "NUMBER"; unitLabel?: string }
  | { type: "DATE" };

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
 * The editable body of a draft version.
 *
 * The editor holds one of these in memory and saves it whole, which is why the
 * gateway needs a single save command rather than a per-question mutation for
 * every control on the screen.
 */
export interface TemplateDraft {
  name: string;
  /** What this template is for, in the Area Manager's own words. */
  purpose?: string;
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

/** Identity shared by every version shape. */
export interface VersionIdentity {
  /** Opaque route identifier. Passed back untouched, never displayed. */
  versionId: string;
  /** Presentation-ready, e.g. "Version 3". Composed by the backend so the
   *  browser never has to guess how versions are numbered. */
  versionLabel: string;
}

/**
 * A draft carries its editable body and the authority to change it. Authority
 * comes from the backend and is never inferred from the lifecycle state or from
 * a role name.
 */
export interface DraftVersionState {
  lifecycle: "DRAFT";
  draft: TemplateDraft;
  canEdit: boolean;
  canPublish: boolean;
  /** Presentation-ready, e.g. "Saved 2:14pm". Absent before the first save. */
  lastSavedLocalTime?: string;
}

/**
 * A published version is immutable, so it has no `draft` and no `canEdit`.
 * Its content is a read-only rendering of what was published.
 */
export interface PublishedVersionState {
  lifecycle: "PUBLISHED";
  content: TemplateDraft;
  /** Presentation-ready, e.g. "13 Aug 2026, 2:20pm". */
  publishedLocalTime: string;
  publishedBy: string;
  assignment: AssignmentSummary;
  schedule: ScheduleSummary;
  /** Whether this principal may start a new draft from this version. */
  canCreateDraft: boolean;
  canRetire: boolean;
}

/** Retirement stops future use. It never erases or rewrites what was published. */
export interface RetiredVersionState {
  lifecycle: "RETIRED";
  content: TemplateDraft;
  publishedLocalTime: string;
  publishedBy: string;
  retiredLocalTime: string;
  retiredBy: string;
  assignment: AssignmentSummary;
  schedule: ScheduleSummary;
  canCreateDraft: boolean;
}

export type TemplateVersion = VersionIdentity &
  (DraftVersionState | PublishedVersionState | RetiredVersionState);

/** One row of version history. Published and retired rows are permanent. */
export interface VersionHistoryEntry {
  versionId: string;
  versionLabel: string;
  lifecycle: TemplateLifecycle;
  /** Presentation-ready. What happened and when, e.g. "Published 13 Aug 2026". */
  eventLabel: string;
  eventBy: string;
  /** True for the version currently in operational use. */
  current: boolean;
}

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
  /** Presentation-ready time-zone wording, e.g. "Brisbane time". The browser
   *  has no authoritative centre time zone and must not derive one. */
  timeZoneLabel: string;
}

/**
 * What the assignment picker may offer.
 *
 * `portfolioCentreCount` is present only where the backend actually resolved
 * the portfolio. Where it is absent the picker says the size is not confirmed
 * rather than printing a `0` that would claim an empty portfolio.
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
 * correctly. The write side — `ScheduleSelection` below — is narrowed to daily
 * for this cycle, which is the coordinator's instruction and a strict subset of
 * the ADR. Widening it later is a change to one union, not to the surfaces.
 */
export type Recurrence = "DAILY" | "WEEKLY" | "MONTHLY" | "QUARTERLY" | "AD_HOC";

export const RECURRENCE_LABEL: Record<Recurrence, string> = {
  DAILY: "Every day",
  WEEKLY: "Every week",
  MONTHLY: "Every month",
  QUARTERLY: "Every quarter",
  AD_HOC: "When requested",
};

/** What this cycle's builder can produce. */
export interface ScheduleSelection {
  recurrence: "DAILY";
  /** 24-hour `HH:MM`, applied in each assigned centre's own local time. */
  dueTime: string;
}

/** How a schedule reads once it is published and immutable. */
export interface ScheduleSummary {
  recurrence: Recurrence;
  /** Presentation-ready, e.g. "9:00am". */
  dueLocalTime: string;
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
  questionCount: number;
  /** Presentation-ready one-liner, e.g. "Draft started 2:14pm" or
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
  /** Newest first. Published and retired entries are permanent. */
  history: VersionHistoryEntry[];
}

/* ------------------------------------------------------------------ *
 * Command results
 * ------------------------------------------------------------------ */

export interface SaveDraftResult {
  lastSavedLocalTime: string;
}

/**
 * The result of publishing.
 *
 * `ALREADY_PUBLISHED` is success-shaped for the same reason
 * `ALREADY_COMPLETED` is on the completion path: the most likely real failure
 * is a request that committed and whose response was lost, and telling an Area
 * Manager they failed after the version went live would be wrong — worse here,
 * because the obvious recovery is to press publish again.
 *
 * `REFUSED` is a reader-safe refusal decided by the backend — insufficient
 * authority, a centre outside scope, an empty template. It is a result rather
 * than an exception so the wording reaching the reader is the backend's, and a
 * refusal is never presented as an outage.
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
      outcome: "ALREADY_PUBLISHED";
      versionId: string;
      versionLabel: string;
      publishedLocalTime: string;
      publishedByRequester: boolean;
    }
  | { outcome: "REFUSED"; reason: string };

export interface CreateDraftResult {
  templateId: string;
  versionId: string;
}

export interface RetireResult {
  retiredLocalTime: string;
}

/* ------------------------------------------------------------------ *
 * Gateway
 * ------------------------------------------------------------------ */

/**
 * Everything the builder experience needs, and nothing else.
 *
 * Saving is one whole-draft command rather than a mutation per control. That is
 * deliberate: a granular API would be this lane guessing at a backend shape, and
 * a draft is small, single-writer and only meaningful as a whole.
 */
export interface TemplateBuilderGateway {
  loadLibrary(): Promise<TemplateLibrary>;
  createTemplate(input: { name: string }): Promise<CreateDraftResult>;
  loadTemplate(templateId: string): Promise<TemplateWorkspace>;
  loadVersion(versionId: string): Promise<TemplateWorkspace>;
  saveDraft(input: { versionId: string; draft: TemplateDraft }): Promise<SaveDraftResult>;
  loadAssignmentOptions(): Promise<AssignmentOptions>;
  publishVersion(input: {
    versionId: string;
    assignment: AssignmentSelection;
    schedule: ScheduleSelection;
  }): Promise<PublishResult>;
  /** Starts a new editable draft from a published or retired version. The
   *  source version is never modified. */
  createDraftFrom(input: { versionId: string }): Promise<CreateDraftResult>;
  retireVersion(input: { versionId: string }): Promise<RetireResult>;
}

/** Distinguishes a recoverable failure from a refusal. A refusal is a result. */
export class TemplateBuilderUnavailableError extends Error {
  constructor(message = "The template builder is temporarily unavailable") {
    super(message);
    this.name = "TemplateBuilderUnavailableError";
  }
}

/**
 * The default gateway until the backend lane lands.
 *
 * It refuses honestly rather than inventing data, so the routes are wired and
 * reviewable without a fabricated template, assignment or schedule existing
 * anywhere. No generated-client method is called, because none exists for this
 * slice yet and this lane does not invent endpoints.
 */
export const backendNotAvailableGateway: TemplateBuilderGateway = {
  loadLibrary: () => Promise.reject(new TemplateBuilderUnavailableError()),
  createTemplate: () => Promise.reject(new TemplateBuilderUnavailableError()),
  loadTemplate: () => Promise.reject(new TemplateBuilderUnavailableError()),
  loadVersion: () => Promise.reject(new TemplateBuilderUnavailableError()),
  saveDraft: () => Promise.reject(new TemplateBuilderUnavailableError()),
  loadAssignmentOptions: () => Promise.reject(new TemplateBuilderUnavailableError()),
  publishVersion: () => Promise.reject(new TemplateBuilderUnavailableError()),
  createDraftFrom: () => Promise.reject(new TemplateBuilderUnavailableError()),
  retireVersion: () => Promise.reject(new TemplateBuilderUnavailableError()),
};

/* ------------------------------------------------------------------ *
 * Presentation helpers
 * ------------------------------------------------------------------ */

export const TEMPLATE_ROOT = "/standards/templates";

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
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names[0]}, ${names[1]} and ${names.length - 2} more`;
}
