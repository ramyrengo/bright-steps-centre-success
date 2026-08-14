"use client";

/**
 * The Template & Form Builder's transport: an adapter from the builder's view
 * models onto the generated Encore client.
 *
 * Nothing here invents an endpoint or a field. Where the backend does not serve
 * a fact the adapter leaves it absent and the surface says so — that is the
 * unknown-is-never-zero rule applied to a transport rather than to a card.
 *
 * Three things this file exists to get right, because getting them wrong is
 * silent rather than loud:
 *
 * 1. `lockVersion` is threaded, never defaulted. Every command that changes a
 *    draft sends the token the backend last gave, and every command that
 *    changes a draft hands the next one back. Dropping it would let two Area
 *    Managers editing one draft overwrite each other with no error anywhere.
 * 2. Every route is keyed on `templateId`. The provisional gateway keyed four
 *    commands on a version identifier that no backend route accepts.
 * 3. Publishing is two commands — publish, then assign. They are sequenced, and
 *    a version that published but could not be assigned is reported as exactly
 *    that, because telling an Area Manager the publish failed after the version
 *    went live is worse than telling them nothing.
 */

import { useMemo } from "react";

import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import CentreSuccessClient, { ErrCode, isAPIError } from "../lib/client.generated";
import type { operational_templates as backend } from "../lib/client.generated";
import {
  TemplateBuilderUnavailableError,
  dateLabel,
  dueTimeLabel,
  timestampLabel,
  type AssignResult,
  type AssignmentOptions,
  type AssignmentSelection,
  type AssignmentSummary,
  type CreateDraftResult,
  type CreateTemplateResult,
  type DraftQuestion,
  type PublishResult,
  type RetireResult,
  type SaveDraftResult,
  type ScheduleSelection,
  type ScheduleSummary,
  type TemplateBuilderGateway,
  type TemplateDraft,
  type TemplateLibrary,
  type TemplateSummary,
  type TemplateVersion,
  type TemplateWorkspace,
  type VersionHistoryEntry,
} from "./template-builder-contract";

/**
 * The authenticated client this adapter speaks to.
 *
 * Taken from the generated class rather than restated, so a regenerated client
 * with a changed signature fails the typecheck here instead of at runtime.
 */
export type CentreSuccessApiClient = InstanceType<typeof CentreSuccessClient>;

const TIME_ZONE_NOTE = "in each centre's own local time";

/* ------------------------------------------------------------------ *
 * Refusal versus outage
 * ------------------------------------------------------------------ */

/**
 * A decision the backend made, in the backend's own words.
 *
 * It is an error rather than a result only where the calling surface already
 * has one error path — saving a draft, starting a draft from a version. The
 * paths where the difference changes what a reader is told, publishing above
 * all, return a discriminated result instead.
 */
export class TemplateBuilderRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TemplateBuilderRefusedError";
  }
}

/**
 * Error codes that mean "the backend decided", as distinct from "the backend
 * could not answer".
 *
 * The difference is the whole reason a refusal is not shown as an outage: an
 * Area Manager told a centre is outside their scope can act on that, and an
 * Area Manager told the service is down cannot.
 */
const REFUSAL_CODES: ReadonlySet<string> = new Set([
  ErrCode.InvalidArgument,
  ErrCode.FailedPrecondition,
  ErrCode.Aborted,
  ErrCode.PermissionDenied,
  ErrCode.NotFound,
  ErrCode.AlreadyExists,
  ErrCode.OutOfRange,
]);

/** The backend's own wording where this was a decision, otherwise `undefined`. */
export function refusalReason(error: unknown): string | undefined {
  if (!isAPIError(error)) return undefined;
  if (!REFUSAL_CODES.has(error.code)) return undefined;
  return error.message.trim() || "This wasn't allowed.";
}

function isCode(error: unknown, code: ErrCode): boolean {
  return isAPIError(error) && error.code === code;
}

/** Re-raises a transport failure as the builder's own unavailability error. */
function asFailure(error: unknown): never {
  const reason = refusalReason(error);
  if (reason) throw new TemplateBuilderRefusedError(reason);
  throw new TemplateBuilderUnavailableError();
}

/* ------------------------------------------------------------------ *
 * Question content, both directions
 * ------------------------------------------------------------------ */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE_OPTION_VALUE = /^[a-z0-9][a-z0-9_.-]{0,99}$/;

/** The backend accepts an identifier only where it minted one. */
function backendId(id: string): string | undefined {
  return UUID.test(id) ? id.toLowerCase() : undefined;
}

/**
 * A choice identifier the backend will accept as an option value.
 *
 * Values must be unique within a question and match a narrow safe-identifier
 * pattern. A value the backend already stored is kept exactly as it is, so
 * reading a published version and saving it again does not silently renumber
 * every option; anything else is normalised, and a collision falls back to a
 * positional value rather than being sent as a duplicate the backend rejects.
 */
function optionValue(choiceId: string, used: Set<string>, index: number): string {
  const normalised = choiceId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, 100);
  if (normalised && SAFE_OPTION_VALUE.test(normalised) && !used.has(normalised)) {
    used.add(normalised);
    return normalised;
  }
  let fallback = `option-${index + 1}`;
  let attempt = index + 1;
  while (used.has(fallback)) {
    attempt += 1;
    fallback = `option-${attempt}`;
  }
  used.add(fallback);
  return fallback;
}

const YES_NO_OPTIONS: backend.OperationalChoiceOption[] = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/**
 * A yes/no question is a two-option choice question and always has been.
 *
 * The backend authorises six question types and a dedicated yes/no is not one
 * of them, so the builder stores it as the thing it renders: exactly two
 * options, valued `yes` and `no`. The test is deliberately narrow — an author's
 * own two-option question carries generated option values, never these two — so
 * the mapping is reversible and a real choice question is never flattened into
 * a pair of buttons.
 */
function isYesNo(question: backend.OperationalTemplateQuestion): boolean {
  if (question.type !== "single_choice") return false;
  const options = question.options ?? [];
  return (
    options.length === 2 && options[0]?.value === "yes" && options[1]?.value === "no"
  );
}

function choicesFrom(
  options: readonly backend.OperationalChoiceOption[] | undefined,
): { choiceId: string; label: string }[] {
  return (options ?? []).map((option) => ({
    choiceId: option.value,
    label: option.label,
  }));
}

function questionFromBackend(
  question: backend.OperationalTemplateQuestion,
): DraftQuestion {
  const base = {
    questionId: question.id,
    wording: question.label,
    required: question.required,
    ...(question.instructions ? { guidance: question.instructions } : {}),
  };
  switch (question.type) {
    case "short_text":
      return { ...base, type: "TEXT", multiline: false };
    case "long_text":
      return { ...base, type: "TEXT", multiline: true };
    case "single_choice":
      return isYesNo(question)
        ? { ...base, type: "YES_NO" }
        : { ...base, type: "SINGLE_SELECT", choices: choicesFrom(question.options) };
    case "multiple_choice":
      return { ...base, type: "MULTI_SELECT", choices: choicesFrom(question.options) };
    case "numeric":
      return { ...base, type: "NUMBER" };
    case "time":
      return { ...base, type: "TIME" };
    case "date":
      return {
        ...base,
        type: "DATE",
        ...(question.earliest ? { earliest: question.earliest } : {}),
        ...(question.latest ? { latest: question.latest } : {}),
      };
  }
}

function questionToBackend(
  question: DraftQuestion,
  index: number,
): backend.OperationalQuestionInput {
  const id = backendId(question.questionId);
  const base = {
    ...(id ? { id } : {}),
    label: question.wording,
    ...(question.guidance ? { instructions: question.guidance } : {}),
    // Presentation order is the array order on this side; the backend wants an
    // explicit, unique, one-based position, so it is derived here rather than
    // stored as a second fact that can drift out of step with the array.
    order: index + 1,
    required: question.required,
  };
  switch (question.type) {
    case "YES_NO":
      return { ...base, type: "single_choice", options: YES_NO_OPTIONS };
    case "SINGLE_SELECT":
    case "MULTI_SELECT": {
      const used = new Set<string>();
      const options = question.choices.map((choice, position) => ({
        value: optionValue(choice.choiceId, used, position),
        label: choice.label,
      }));
      return question.type === "SINGLE_SELECT"
        ? { ...base, type: "single_choice", options }
        : { ...base, type: "multiple_choice", options };
    }
    case "TEXT":
      return { ...base, type: question.multiline ? "long_text" : "short_text" };
    case "NUMBER":
      return { ...base, type: "numeric" };
    case "TIME":
      return { ...base, type: "time" };
    case "DATE":
      // Bounds are carried in both directions rather than dropped on read, so
      // reopening a draft and saving it cannot quietly erase a bound the author
      // set. An empty field is absent, not an empty string: the backend refuses
      // "" as a malformed date, and it means "no bound" here anyway.
      return {
        ...base,
        type: "date",
        ...(question.earliest ? { earliest: question.earliest } : {}),
        ...(question.latest ? { latest: question.latest } : {}),
      };
  }
}

function sectionsFromBackend(
  sections: readonly backend.OperationalTemplateSection[],
): TemplateDraft["sections"] {
  return [...sections]
    .sort((left, right) => left.order - right.order)
    .map((section) => ({
      sectionId: section.id,
      title: section.title,
      questions: [...section.questions]
        .sort((left, right) => left.order - right.order)
        .map(questionFromBackend),
    }));
}

function contentToBackend(draft: TemplateDraft): {
  title: string;
  instructions: string;
  sections: backend.OperationalSectionInput[];
} {
  return {
    title: draft.name.trim(),
    instructions: draft.purpose.trim(),
    sections: draft.sections.map((section, index) => {
      const id = backendId(section.sectionId);
      return {
        ...(id ? { id } : {}),
        title: section.title,
        order: index + 1,
        questions: section.questions.map(questionToBackend),
      };
    }),
  };
}

function draftBody(draft: backend.OperationalTemplateDraft): TemplateDraft {
  return {
    name: draft.title,
    purpose: draft.instructions,
    sections: sectionsFromBackend(draft.sections),
  };
}

function versionBody(version: backend.OperationalTemplateVersion): TemplateDraft {
  return {
    name: version.title,
    purpose: version.instructions,
    sections: sectionsFromBackend(version.sections),
  };
}

/* ------------------------------------------------------------------ *
 * Workspace projection
 * ------------------------------------------------------------------ */

function versionLabel(versionNumber: number): string {
  return `Version ${versionNumber}`;
}

function historyFrom(
  workspace: backend.OperationalTemplateWorkspace,
): VersionHistoryEntry[] {
  const entries: VersionHistoryEntry[] = [];
  if (workspace.draft) {
    const changed = timestampLabel(workspace.draft.updatedAt);
    entries.push({
      state: "DRAFT",
      label: "Draft",
      eventLabel: changed ? `Last changed ${changed}` : "Not published yet",
    });
  }
  // The backend returns versions newest first and every one of them is
  // permanent. Only the newest can be the one in use, and a retired template
  // has none in use at all.
  workspace.versions.forEach((version, index) => {
    const published = dateLabel(version.publishedAt);
    entries.push({
      state: version.lifecycle,
      versionId: version.versionId,
      versionLabel: versionLabel(version.versionNumber),
      eventLabel:
        version.lifecycle === "RETIRED"
          ? published
            ? `Published ${published}, since retired`
            : "Published, since retired"
          : published
            ? `Published ${published}`
            : "Published",
      current: index === 0 && version.lifecycle === "PUBLISHED",
    });
  });
  return entries;
}

/** Authority the backend will actually honour, never inferred from a role. */
interface Authority {
  /** The backend keeps draft mutation, preview, publication and retirement
   *  with the draft's creator. Matching that rule here means the builder does
   *  not offer a control the backend is going to refuse. */
  owns: (authorId: string | undefined) => boolean;
}

function draftVersion(
  draft: backend.OperationalTemplateDraft,
  authority: Authority,
  retired: boolean,
): TemplateVersion {
  const owner = authority.owns(draft.authorId);
  const saved = timestampLabel(draft.updatedAt);
  return {
    lifecycle: "DRAFT",
    versionLabel: "Draft",
    draft: draftBody(draft),
    lockVersion: draft.lockVersion,
    canEdit: owner && !retired,
    canPublish: owner && !retired,
    ...(saved ? { lastSavedLocalTime: saved } : {}),
  };
}

function publishedVersion(
  version: backend.OperationalTemplateVersion,
  options: { canCreateDraft: boolean; canRetire: boolean },
): TemplateVersion {
  const published = timestampLabel(version.publishedAt) ?? "";
  // Assignment and schedule are deliberately absent. No read route on this
  // backend reports where or when a given published version runs, and a
  // schedule composed in the browser would be telling an Area Manager when a
  // centre is asked. The record states that it is not confirmed instead.
  if (version.lifecycle === "RETIRED") {
    return {
      versionId: version.versionId,
      versionLabel: versionLabel(version.versionNumber),
      lifecycle: "RETIRED",
      content: versionBody(version),
      publishedLocalTime: published,
      canCreateDraft: options.canCreateDraft,
    };
  }
  return {
    versionId: version.versionId,
    versionLabel: versionLabel(version.versionNumber),
    lifecycle: "PUBLISHED",
    content: versionBody(version),
    publishedLocalTime: published,
    canCreateDraft: options.canCreateDraft,
    canRetire: options.canRetire,
  };
}

/* ------------------------------------------------------------------ *
 * Assignment and schedule
 * ------------------------------------------------------------------ */

function assignmentTarget(
  selection: AssignmentSelection,
): backend.AssignOperationalTemplateRequest["target"] {
  return selection.scope === "PORTFOLIO"
    ? { kind: "PORTFOLIO" }
    : { kind: "CENTRES", centreIds: selection.centreIds };
}

function scheduleRequest(
  schedule: ScheduleSelection,
): backend.AssignOperationalTemplateRequest["schedule"] {
  return {
    frequency: "DAILY",
    opensLocalTime: schedule.opensLocalTime,
    dueLocalTime: schedule.dueLocalTime,
    effectiveFrom: schedule.effectiveFrom,
  };
}

/**
 * How an assignment reads once the backend has made it.
 *
 * The centres named are the ones the backend says it deployed to, not the ones
 * the browser asked for, and the portfolio branch takes its size from the
 * backend's own count rather than from any list the client holds.
 */
function assignmentSummary(
  response: backend.AssignOperationalTemplateResponse,
  centreNames: ReadonlyMap<string, string>,
): AssignmentSummary {
  if (response.targetKind === "PORTFOLIO") {
    return {
      scope: "PORTFOLIO",
      description: "Every centre in your portfolio",
      centreCount: response.centreCount,
    };
  }
  const names = response.deployments
    .map((deployment) => centreNames.get(deployment.centreId))
    .filter((name): name is string => Boolean(name));
  return {
    scope: "CENTRES",
    description:
      names.length > 0
        ? names.join(", ")
        : `${response.centreCount} centre${response.centreCount === 1 ? "" : "s"}`,
    centreNames: names,
  };
}

function scheduleSummary(schedule: ScheduleSelection): ScheduleSummary {
  return {
    recurrence: "DAILY",
    dueLocalTime: dueTimeLabel(schedule.dueLocalTime),
    opensLocalTime: dueTimeLabel(schedule.opensLocalTime),
    timeZoneNote: TIME_ZONE_NOTE,
  };
}

/* ------------------------------------------------------------------ *
 * Library projection
 * ------------------------------------------------------------------ */

function librarySummary(template: backend.OperationalTemplateSummary): TemplateSummary {
  const latest = template.latestPublishedVersion;
  const published = latest ? dateLabel(latest.publishedAt) : undefined;
  const centres = template.assignedCentres.map((centre) => centre.centreName);
  return {
    templateId: template.templateId,
    name: template.title,
    lifecycle: template.lifecycle,
    versionLabel: latest ? versionLabel(latest.versionNumber) : "Draft",
    // The listing carries no question count and no purpose. Both are omitted
    // rather than filled with a zero or a blank line the reader would read as
    // a fact about the template.
    stateLabel:
      template.lifecycle === "RETIRED"
        ? "Retired — it no longer runs"
        : latest
          ? published
            ? `Published ${published}`
            : "Published"
          : "Not published yet",
    ...(centres.length > 0 ? { assignmentDescription: centres.join(", ") } : {}),
  };
}

/* ------------------------------------------------------------------ *
 * The gateway
 * ------------------------------------------------------------------ */

/**
 * Binds the builder's operations to one authenticated client.
 *
 * The principal is read once and remembered for the life of the gateway. It is
 * used for exactly one thing: matching the backend's own rule that a draft
 * belongs to the person who started it, so the builder does not offer an edit
 * control that the backend is going to refuse. Where the principal cannot be
 * established the builder offers nothing, because authority that could not be
 * established is not authority.
 */
export function createTemplateBuilderGateway(
  client: CentreSuccessApiClient,
): TemplateBuilderGateway {
  let principal: Promise<string | undefined> | undefined;

  function principalId(): Promise<string | undefined> {
    principal ??= client.foundation
      .me()
      .then((me) => me.principal?.id)
      .catch(() => undefined);
    return principal;
  }

  async function authority(): Promise<Authority> {
    const id = await principalId();
    return { owns: (authorId) => Boolean(id && authorId && authorId === id) };
  }

  async function loadWorkspace(
    templateId: string,
  ): Promise<backend.OperationalTemplateWorkspace> {
    try {
      return await client.foundation.getOperationalTemplateWorkspaceRoute(templateId);
    } catch (error) {
      return asFailure(error);
    }
  }

  function projectWorkspace(
    workspace: backend.OperationalTemplateWorkspace,
    version: TemplateVersion,
  ): TemplateWorkspace {
    return {
      templateId: workspace.templateId,
      templateName: workspace.title,
      version,
      ...(workspace.draft ? { lockVersion: workspace.draft.lockVersion } : {}),
      history: historyFrom(workspace),
    };
  }

  async function centreNames(): Promise<ReadonlyMap<string, string>> {
    try {
      const options = await client.foundation.listOperationalTemplateAssignmentOptionsRoute();
      return new Map(options.centres.map((centre) => [centre.centreId, centre.centreName]));
    } catch {
      // A name we could not look up is a name we do not print. The assignment
      // still happened; only the wording is thinner.
      return new Map();
    }
  }

  async function assign(input: {
    templateId: string;
    versionId: string;
    assignment: AssignmentSelection;
    schedule: ScheduleSelection;
  }): Promise<AssignResult> {
    try {
      const response = await client.foundation.assignOperationalTemplateRoute(
        input.templateId,
        {
          versionId: input.versionId,
          target: assignmentTarget(input.assignment),
          schedule: scheduleRequest(input.schedule),
        },
      );
      return {
        outcome: "ASSIGNED",
        assignment: assignmentSummary(response, await centreNames()),
        schedule: scheduleSummary(input.schedule),
      };
    } catch (error) {
      return {
        outcome: "REFUSED",
        reason:
          refusalReason(error) ??
          "We couldn't reach the service to set where and when this runs.",
      };
    }
  }

  return {
    async loadLibrary(): Promise<TemplateLibrary> {
      try {
        // No centre filter: the backend then answers for the whole authorised
        // portfolio, which is the only scope this surface has any business
        // asking about. It refuses outright rather than returning a short list
        // when it cannot resolve that portfolio safely.
        const response = await client.foundation.listOperationalTemplateLibrary({});
        return {
          status: "ready",
          templates: response.templates.map(librarySummary),
          // The listing carries no authoring-authority flag, so the control is
          // offered and the backend decides. Creating refuses in the reader's
          // own words where it is not allowed; it never silently succeeds.
          canCreate: true,
        };
      } catch (error) {
        // No authority to read the library at all. This is the principal who
        // is connected but not set up to author, and it asserts nothing about
        // a library the request never looked at.
        if (isCode(error, ErrCode.PermissionDenied)) return { status: "unsupported" };
        return asFailure(error);
      }
    },

    async createTemplate(input): Promise<CreateTemplateResult> {
      try {
        // Empty sections are permitted on create — the backend only requires
        // questions when publishing — but a title and a purpose are not
        // optional, which is why the dialog asks for both rather than sending
        // a placeholder the author never wrote.
        const draft = await client.foundation.createOperationalTemplate({
          title: input.name.trim(),
          instructions: input.purpose.trim(),
          sections: [],
        });
        return { outcome: "CREATED", templateId: draft.templateId };
      } catch (error) {
        const reason = refusalReason(error);
        if (reason) return { outcome: "REFUSED", reason };
        throw new TemplateBuilderUnavailableError();
      }
    },

    async loadTemplate(templateId): Promise<TemplateWorkspace> {
      const workspace = await loadWorkspace(templateId);
      const scope = await authority();
      if (workspace.draft) {
        return projectWorkspace(
          workspace,
          draftVersion(workspace.draft, scope, workspace.lifecycle === "RETIRED"),
        );
      }
      const newest = workspace.versions[0];
      if (!newest) throw new TemplateBuilderUnavailableError();
      try {
        const version = await client.foundation.getOperationalTemplateVersionRoute(
          templateId,
          newest.versionId,
        );
        return projectWorkspace(
          workspace,
          publishedVersion(version, {
            // Starting a new draft is only offered where the backend would
            // accept one: it refuses outright while a draft is already open.
            canCreateDraft: workspace.lifecycle !== "RETIRED",
            canRetire: false,
          }),
        );
      } catch (error) {
        return asFailure(error);
      }
    },

    async loadVersion({ templateId, versionId }): Promise<TemplateWorkspace> {
      const [workspace, version] = await Promise.all([
        loadWorkspace(templateId),
        client.foundation
          .getOperationalTemplateVersionRoute(templateId, versionId)
          .catch(asFailure),
      ]);
      const scope = await authority();
      return projectWorkspace(
        workspace,
        publishedVersion(version, {
          canCreateDraft: !workspace.draft && workspace.lifecycle !== "RETIRED",
          canRetire:
            workspace.lifecycle === "PUBLISHED" &&
            scope.owns(workspace.draft?.authorId) &&
            workspace.versions[0]?.versionId === versionId,
        }),
      );
    },

    async saveDraft({ templateId, lockVersion, draft }): Promise<SaveDraftResult> {
      try {
        const saved = await client.foundation.updateOperationalTemplateDraftRoute(
          templateId,
          { lockVersion, ...contentToBackend(draft) },
        );
        return {
          lastSavedLocalTime: timestampLabel(saved.updatedAt) ?? "just now",
          // The token the next save and the publish must carry. Returning the
          // backend's new one is what keeps a second save from being refused
          // as stale the moment the first succeeds.
          lockVersion: saved.lockVersion,
        };
      } catch (error) {
        return asFailure(error);
      }
    },

    async loadAssignmentOptions(): Promise<AssignmentOptions> {
      try {
        const options =
          await client.foundation.listOperationalTemplateAssignmentOptionsRoute();
        const incomplete = Boolean(options.incompleteNotice);
        return {
          centres: options.centres.map((centre) => ({
            centreId: centre.centreId,
            centreName: centre.centreName,
          })),
          portfolioAvailable: options.portfolioAvailable,
          // A count taken from a list that is known to be short is a floor, not
          // a size. Where the backend says the list is incomplete the count is
          // withheld, and the picker says the size is not confirmed instead of
          // printing a number the reader would take as the whole portfolio.
          ...(incomplete ? {} : { portfolioCentreCount: options.portfolioCentreCount }),
          ...(options.incompleteNotice ? { warning: options.incompleteNotice } : {}),
        };
      } catch (error) {
        return asFailure(error);
      }
    },

    async publishVersion({
      templateId,
      lockVersion,
      assignment,
      schedule,
    }): Promise<PublishResult> {
      let version: backend.OperationalTemplateVersion;
      try {
        version = await client.foundation.publishOperationalTemplateRoute(templateId, {
          lockVersion,
        });
      } catch (error) {
        const reason = refusalReason(error);
        if (!reason) {
          // The request may have committed and lost its response. Rejecting
          // lets the dialog say it could not confirm the publish rather than
          // claiming nothing happened.
          throw new TemplateBuilderUnavailableError();
        }
        if (isCode(error, ErrCode.Aborted)) {
          // The lock moved under us. Either someone else changed the draft, or
          // our own publish committed and we never saw the answer. Those read
          // very differently to an Area Manager, so the difference is
          // established from the version list rather than guessed at.
          const after = await loadWorkspace(templateId).catch(() => undefined);
          const newest = after?.versions[0];
          if (newest) {
            return {
              outcome: "ALREADY_PUBLISHED",
              versionId: newest.versionId,
              versionLabel: versionLabel(newest.versionNumber),
              publishedLocalTime: timestampLabel(newest.publishedAt) ?? "",
            };
          }
        }
        return { outcome: "REFUSED", reason };
      }

      const published = timestampLabel(version.publishedAt) ?? "";
      const assigned = await assign({
        templateId,
        versionId: version.versionId,
        assignment,
        schedule,
      });
      if (assigned.outcome === "REFUSED") {
        // The version is live and permanent. Reporting a total failure here
        // would send an Area Manager back to press publish again, which the
        // backend would then refuse.
        return {
          outcome: "PUBLISHED_NOT_ASSIGNED",
          versionId: version.versionId,
          versionLabel: versionLabel(version.versionNumber),
          publishedLocalTime: published,
          reason: assigned.reason,
        };
      }
      return {
        outcome: "PUBLISHED",
        versionId: version.versionId,
        versionLabel: versionLabel(version.versionNumber),
        publishedLocalTime: published,
        assignment: assigned.assignment,
        schedule: assigned.schedule,
      };
    },

    assignPublishedVersion: assign,

    async createDraftFrom({ templateId }): Promise<CreateDraftResult> {
      try {
        // Nothing is created here, despite the name. Every template keeps one
        // persistent draft as its editable working copy: publishing snapshots
        // that draft into an immutable version rather than consuming it, and
        // the database refuses to delete one. So "edit this published version"
        // opens the draft that already exists, and publishing it again
        // produces the next version.
        //
        // The version the reader clicked is deliberately not copied over the
        // draft. A draft that has moved on from the published version is a
        // real state, and overwriting it here would silently discard work
        // someone had in progress.
        const workspace =
          await client.foundation.getOperationalTemplateWorkspaceRoute(templateId);
        if (!workspace.draft) throw new TemplateBuilderUnavailableError();
        return { templateId: workspace.draft.templateId };
      } catch (error) {
        return asFailure(error);
      }
    },

    async retireTemplate({ templateId, lockVersion }): Promise<RetireResult> {
      try {
        const retired = await client.foundation.retireOperationalTemplateRoute(templateId, {
          lockVersion,
        });
        return { lockVersion: retired.lockVersion };
      } catch (error) {
        return asFailure(error);
      }
    },
  };
}

/**
 * The builder's transport for a signed-in reader.
 *
 * One gateway per client instance, so the principal lookup behind ownership is
 * made once per session rather than once per screen.
 */
export function useTemplateBuilderGateway(): TemplateBuilderGateway {
  const client = useAuthenticatedCentreSuccessClient();
  return useMemo(() => createTemplateBuilderGateway(client), [client]);
}
