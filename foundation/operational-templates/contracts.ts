export type OperationalQuestionType =
  | "short_text"
  | "long_text"
  | "single_choice"
  | "multiple_choice"
  | "numeric"
  | "time";

export type OperationalTemplateLifecycle = "DRAFT" | "PUBLISHED" | "RETIRED";

export type OperationalTemplateMetadata = Record<
  string,
  string | number | boolean | null
>;

export interface OperationalChoiceOption {
  value: string;
  label: string;
}

interface OperationalQuestionInputBase {
  id?: string;
  label: string;
  instructions?: string;
  order: number;
  required: boolean;
}

export type OperationalQuestionInput =
  | (OperationalQuestionInputBase & {
      type: "short_text" | "long_text";
      minLength?: number;
      maxLength?: number;
    })
  | (OperationalQuestionInputBase & {
      type: "single_choice";
      options: OperationalChoiceOption[];
    })
  | (OperationalQuestionInputBase & {
      type: "multiple_choice";
      options: OperationalChoiceOption[];
      minSelections?: number;
      maxSelections?: number;
    })
  | (OperationalQuestionInputBase & {
      type: "numeric";
      minimum?: number;
      maximum?: number;
    })
  | (OperationalQuestionInputBase & {
      type: "time";
      earliest?: string;
      latest?: string;
    });

export interface OperationalSectionInput {
  id?: string;
  title: string;
  instructions?: string;
  order: number;
  questions: OperationalQuestionInput[];
}

export interface OperationalTemplateContentInput {
  title: string;
  instructions: string;
  metadata?: OperationalTemplateMetadata;
  sections: OperationalSectionInput[];
}

export interface CreateOperationalTemplateRequest
  extends OperationalTemplateContentInput {}

export interface OperationalTemplateIdRequest {
  templateId: string;
}

export interface UpdateOperationalTemplateDraftRequest
  extends OperationalTemplateIdRequest,
    OperationalTemplateContentInput {
  lockVersion: number;
}

export interface PublishOperationalTemplateRequest
  extends OperationalTemplateIdRequest {
  lockVersion: number;
}

export interface RetireOperationalTemplateRequest
  extends OperationalTemplateIdRequest {
  lockVersion: number;
}

export interface RetireOperationalTemplateResponse {
  templateId: string;
  lifecycle: "RETIRED";
  lockVersion: number;
}

export interface ListOperationalTemplatesRequest {
  /** When absent, assignment context is filtered to the current authorised portfolio. */
  centreId?: string;
}

export interface OperationalTemplateVersionRequest
  extends OperationalTemplateIdRequest {
  versionId: string;
}

export interface OperationalTemplateQuestion {
  id: string;
  label: string;
  instructions?: string;
  order: number;
  required: boolean;
  type: OperationalQuestionType;
  options?: OperationalChoiceOption[];
  minLength?: number;
  maxLength?: number;
  minSelections?: number;
  maxSelections?: number;
  minimum?: number;
  maximum?: number;
  earliest?: string;
  latest?: string;
}

export interface OperationalTemplateSection {
  id: string;
  title: string;
  instructions?: string;
  order: number;
  questions: OperationalTemplateQuestion[];
}

export interface OperationalTemplateDraft {
  templateId: string;
  lifecycle: OperationalTemplateLifecycle;
  title: string;
  instructions: string;
  metadata: OperationalTemplateMetadata;
  authorId: string;
  lockVersion: number;
  updatedAt: string;
  sections: OperationalTemplateSection[];
}

export interface OperationalTemplateVersion {
  templateId: string;
  versionId: string;
  versionNumber: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  title: string;
  instructions: string;
  metadata: OperationalTemplateMetadata;
  sourceKind: "BSA_INTERNAL";
  authorId: string;
  publishedAt: string;
  sections: OperationalTemplateSection[];
}

export interface OperationalTemplatePreview {
  device: "PHONE";
  source: "DRAFT" | "PUBLISHED";
  template: OperationalTemplateDraft | OperationalTemplateVersion;
}

export interface OperationalTemplateSummary {
  templateId: string;
  title: string;
  lifecycle: OperationalTemplateLifecycle;
  authorId?: string;
  lockVersion: number;
  latestPublishedVersion?: {
    versionId: string;
    versionNumber: number;
    publishedAt: string;
    authorId: string;
  };
  assignedCentres: Array<{ centreId: string; centreName: string }>;
}

export interface ListOperationalTemplatesResponse {
  templates: OperationalTemplateSummary[];
  assignmentFilter: { kind: "PORTFOLIO" } | { kind: "CENTRE"; centreId: string };
}

export interface AssignOperationalTemplateRequest
  extends OperationalTemplateIdRequest {
  versionId: string;
  target:
    | { kind: "CENTRES"; centreIds: string[] }
    | { kind: "PORTFOLIO" };
  schedule: {
    frequency: "DAILY";
    opensLocalTime: string;
    dueLocalTime: string;
    effectiveFrom: string;
  };
}

/** One entry in a template's permanent version history. */
export interface OperationalTemplateVersionSummary {
  versionId: string;
  versionNumber: number;
  lifecycle: "PUBLISHED" | "RETIRED";
  publishedAt: string;
  authorId: string;
}

/**
 * Everything the builder needs to open one template. `draft` is absent rather
 * than null when no editable draft exists, so a published-only template cannot
 * be mistaken for one with an empty draft.
 */
export interface OperationalTemplateWorkspace {
  templateId: string;
  title: string;
  lifecycle: OperationalTemplateLifecycle;
  draft?: OperationalTemplateDraft;
  /** Newest first. Published and retired entries are permanent. */
  versions: OperationalTemplateVersionSummary[];
}

export interface AssignableCentre {
  centreId: string;
  centreName: string;
}

/**
 * The centres this principal may actually assign a template to. The browser is
 * never the authority on assignment scope. `incompleteNotice` is present only
 * when some authorised centre could not be resolved, so a short list is never
 * mistaken for a complete one.
 */
export interface OperationalTemplateAssignmentOptions {
  centres: AssignableCentre[];
  portfolioAvailable: boolean;
  portfolioCentreCount: number;
  incompleteNotice?: string;
}

export interface AssignOperationalTemplateResponse {
  assignmentId: string;
  templateId: string;
  versionId: string;
  targetKind: "CENTRES" | "PORTFOLIO";
  frequency: "DAILY";
  centreCount: number;
  deployments: Array<{
    centreId: string;
    deploymentId: string;
    scheduleRevisionId: string;
    centreTimezone: string;
  }>;
}
