import { randomUUID } from "node:crypto";
import type { Primitive, Transaction } from "encore.dev/storage/sqldb";
import { recordAuditEventWithExecutor } from "../audit/events";
import {
  loadOrganisationCentreAuthorisationFacts,
  type CentreAuthorisationFact,
} from "../authorization/batch-centres";
import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import { loadPrincipalAuthorisationContextFromSnapshot } from "../authorization/context-loader";
import type { AuthorisationQueryExecutor } from "../authorization/database";
import { authorise, type PrincipalAuthorisationContext } from "../authorization/policy";
import { centreSuccessDB } from "../db";
import { inSerializableTransaction } from "../transactions";
import type {
  AssignOperationalTemplateRequest,
  AssignOperationalTemplateResponse,
  CreateOperationalTemplateRequest,
  ListOperationalTemplatesRequest,
  ListOperationalTemplatesResponse,
  OperationalChoiceOption,
  OperationalQuestionInput,
  OperationalTemplateAssignmentOptions,
  OperationalTemplateDraft,
  OperationalTemplateLifecycle,
  OperationalTemplateMetadata,
  OperationalTemplateQuestion,
  OperationalTemplateSection,
  OperationalTemplateVersion,
  OperationalTemplateVersionSummary,
  OperationalTemplateWorkspace,
  PublishOperationalTemplateRequest,
  RetireOperationalTemplateRequest,
  RetireOperationalTemplateResponse,
  UpdateOperationalTemplateDraftRequest,
} from "./contracts";
import { OperationalTemplateError, requireOperationalTemplateUuid } from "./types";
import {
  validateDailySchedule,
  validateOperationalTemplateContent,
} from "./validation";

interface TemplateExecutor extends AuthorisationQueryExecutor {
  exec: (strings: TemplateStringsArray, ...values: Primitive[]) => Promise<void>;
}

interface TemplatePrincipal {
  principalId: string;
  organisationId: string;
  context: PrincipalAuthorisationContext;
  centres: CentreAuthorisationFact[];
  invalidCentres: Awaited<ReturnType<typeof loadOrganisationCentreAuthorisationFacts>>["invalidCentres"];
}

interface DraftRow {
  template_id: string;
  title: string;
  instructions: string;
  metadata: unknown;
  created_by_principal_id: string;
  updated_at: Date;
  lock_version: number;
  root_status: "active" | "inactive";
  published_count: number | string;
}

interface SectionRow {
  id: string;
  title: string;
  instructions: string | null;
  sort_order: number;
}

interface QuestionRow {
  id: string;
  section_id: string;
  label: string;
  instructions: string | null;
  sort_order: number;
  question_type: OperationalTemplateQuestion["type"];
  required: boolean;
  answer_configuration: unknown;
}

interface VersionRow {
  template_id: string;
  version_id: string;
  version_number: number;
  title: string;
  instructions: string;
  metadata: unknown;
  published_at: Date | null;
  published_by_principal_id: string | null;
  root_status: "active" | "inactive";
}

type TemplateCapability =
  | typeof capability.templateRead
  | typeof capability.templateCreate
  | typeof capability.templatePublish
  | typeof capability.templateAssign;

function asExecutor(transaction: Transaction): TemplateExecutor {
  return transaction as TemplateExecutor;
}

async function loadPrincipal(
  executor: TemplateExecutor,
  principalId: string,
  decisionAt: Date,
): Promise<TemplatePrincipal> {
  const organisations = await executor.queryAll<{ organisation_id: string }>`
    SELECT DISTINCT membership.organisation_id
    FROM organisation_memberships AS membership
    JOIN organisations AS organisation ON organisation.id = membership.organisation_id
    JOIN principals AS principal ON principal.id = membership.principal_id
    WHERE membership.principal_id = ${principalId}
      AND principal.status = 'active'
      AND organisation.status = 'active'
      AND membership.status = 'active'
      AND membership.effective_from <= ${decisionAt}
      AND (membership.effective_to IS NULL OR membership.effective_to > ${decisionAt})
    ORDER BY membership.organisation_id
  `;
  if (organisations.length !== 1) {
    throw new OperationalTemplateError("access_denied", "template library is not available");
  }
  const organisationId = organisations[0].organisation_id;
  const context = await loadPrincipalAuthorisationContextFromSnapshot(executor, {
    principalId,
    activeOrganisationId: organisationId,
    at: decisionAt,
  });
  const facts = await loadOrganisationCentreAuthorisationFacts(executor, organisationId, decisionAt);
  return {
    principalId,
    organisationId,
    context,
    centres: facts.centres,
    invalidCentres: facts.invalidCentres,
  };
}

function canUseCentre(
  principal: TemplatePrincipal,
  centre: CentreAuthorisationFact,
  requiredCapability: TemplateCapability,
  decisionAt: Date,
): boolean {
  return authorise({
    context: principal.context,
    capability: requiredCapability,
    resource: centre.resource,
    at: decisionAt,
  }).allowed;
}

function authorisedCentres(
  principal: TemplatePrincipal,
  requiredCapability: TemplateCapability,
  decisionAt: Date,
): CentreAuthorisationFact[] {
  return principal.centres.filter((centre) =>
    canUseCentre(principal, centre, requiredCapability, decisionAt));
}

function requireAnyCentreCapability(
  principal: TemplatePrincipal,
  requiredCapability: TemplateCapability,
  decisionAt: Date,
): CentreAuthorisationFact[] {
  const centres = authorisedCentres(principal, requiredCapability, decisionAt);
  if (centres.length === 0) {
    throw new OperationalTemplateError("access_denied", "template library is not available");
  }
  return centres;
}

function hasInvalidAuthorisedCentre(
  principal: TemplatePrincipal,
  requiredCapability: TemplateCapability,
  decisionAt: Date,
): boolean {
  return principal.invalidCentres.some((centre) => authorise({
    context: principal.context,
    capability: requiredCapability,
    resource: {
      kind: "centre",
      organisationId: principal.organisationId,
      centreId: centre.id,
      organisationalUnitIds: centre.organisationalUnitIds,
    },
    at: decisionAt,
  }).allowed);
}

function metadataObject(value: unknown): OperationalTemplateMetadata {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationalTemplateError("context_unavailable", "template metadata is unavailable");
  }
  return value as OperationalTemplateMetadata;
}

function answerConfiguration(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new OperationalTemplateError("context_unavailable", "question configuration is unavailable");
  }
  return value as Record<string, unknown>;
}

function configuredOptions(value: unknown): OperationalChoiceOption[] {
  if (!Array.isArray(value) || !value.every((option) =>
    option && typeof option === "object"
      && typeof (option as { value?: unknown }).value === "string"
      && typeof (option as { label?: unknown }).label === "string")) {
    throw new OperationalTemplateError("context_unavailable", "question options are unavailable");
  }
  return value as OperationalChoiceOption[];
}

function questionFromRow(row: QuestionRow): OperationalTemplateQuestion {
  const configuration = answerConfiguration(row.answer_configuration);
  const base = {
    id: row.id,
    label: row.label,
    ...(row.instructions ? { instructions: row.instructions } : {}),
    order: row.sort_order,
    required: row.required,
    type: row.question_type,
  };
  switch (row.question_type) {
    case "short_text":
    case "long_text":
      return {
        ...base,
        type: row.question_type,
        ...(typeof configuration.minLength === "number" ? { minLength: configuration.minLength } : {}),
        ...(typeof configuration.maxLength === "number" ? { maxLength: configuration.maxLength } : {}),
      };
    case "single_choice":
      return {
        ...base,
        type: row.question_type,
        options: configuredOptions(configuration.options),
      };
    case "multiple_choice":
      return {
        ...base,
        type: row.question_type,
        options: configuredOptions(configuration.options),
        ...(typeof configuration.minSelections === "number"
          ? { minSelections: configuration.minSelections }
          : {}),
        ...(typeof configuration.maxSelections === "number"
          ? { maxSelections: configuration.maxSelections }
          : {}),
      };
    case "numeric":
      return {
        ...base,
        type: row.question_type,
        ...(typeof configuration.minimum === "number" ? { minimum: configuration.minimum } : {}),
        ...(typeof configuration.maximum === "number" ? { maximum: configuration.maximum } : {}),
      };
    case "time":
    case "date":
      return {
        ...base,
        type: row.question_type,
        ...(typeof configuration.earliest === "string" ? { earliest: configuration.earliest } : {}),
        ...(typeof configuration.latest === "string" ? { latest: configuration.latest } : {}),
      };
  }
}

function questionAsInput(question: OperationalTemplateQuestion): OperationalQuestionInput {
  const base = {
    id: question.id,
    label: question.label,
    ...(question.instructions ? { instructions: question.instructions } : {}),
    order: question.order,
    required: question.required,
  };
  switch (question.type) {
    case "short_text":
    case "long_text":
      return {
        ...base,
        type: question.type,
        ...(question.minLength !== undefined ? { minLength: question.minLength } : {}),
        ...(question.maxLength !== undefined ? { maxLength: question.maxLength } : {}),
      };
    case "single_choice":
      return { ...base, type: question.type, options: question.options ?? [] };
    case "multiple_choice":
      return {
        ...base,
        type: question.type,
        options: question.options ?? [],
        ...(question.minSelections !== undefined ? { minSelections: question.minSelections } : {}),
        ...(question.maxSelections !== undefined ? { maxSelections: question.maxSelections } : {}),
      };
    case "numeric":
      return {
        ...base,
        type: question.type,
        ...(question.minimum !== undefined ? { minimum: question.minimum } : {}),
        ...(question.maximum !== undefined ? { maximum: question.maximum } : {}),
      };
    case "time":
    case "date":
      return {
        ...base,
        type: question.type,
        ...(question.earliest ? { earliest: question.earliest } : {}),
        ...(question.latest ? { latest: question.latest } : {}),
      };
  }
}

function configurationForQuestion(question: OperationalQuestionInput): Record<string, unknown> {
  switch (question.type) {
    case "short_text":
    case "long_text":
      return {
        ...(question.minLength !== undefined ? { minLength: question.minLength } : {}),
        ...(question.maxLength !== undefined ? { maxLength: question.maxLength } : {}),
      };
    case "single_choice":
      return { options: question.options };
    case "multiple_choice":
      return {
        options: question.options,
        ...(question.minSelections !== undefined ? { minSelections: question.minSelections } : {}),
        ...(question.maxSelections !== undefined ? { maxSelections: question.maxSelections } : {}),
      };
    case "numeric":
      return {
        ...(question.minimum !== undefined ? { minimum: question.minimum } : {}),
        ...(question.maximum !== undefined ? { maximum: question.maximum } : {}),
      };
    case "time":
    case "date":
      return {
        ...(question.earliest ? { earliest: question.earliest } : {}),
        ...(question.latest ? { latest: question.latest } : {}),
      };
  }
}

function stableKey(prefix: "section" | "question", id: string): string {
  return `${prefix}_${id.replaceAll("-", "")}`;
}

async function loadDraftContent(
  executor: TemplateExecutor,
  organisationId: string,
  templateId: string,
  lock = false,
): Promise<{ draft: DraftRow; sections: OperationalTemplateSection[] }> {
  const query = lock
    ? executor.queryRow<DraftRow>`
        SELECT draft.template_id, draft.title, draft.instructions, draft.metadata,
               draft.created_by_principal_id, draft.updated_at, draft.lock_version,
               template.status AS root_status,
               (SELECT count(*) FROM audit_template_versions AS version
                WHERE version.organisation_id = draft.organisation_id
                  AND version.audit_template_id = draft.template_id
                  AND version.status IN ('active', 'superseded')) AS published_count
        FROM operational_template_drafts AS draft
        JOIN audit_templates AS template
          ON template.organisation_id = draft.organisation_id
         AND template.id = draft.template_id
         AND template.template_subtype = 'OPERATIONAL_STANDARD'
        WHERE draft.organisation_id = ${organisationId}
          AND draft.template_id = ${templateId}
        FOR UPDATE OF draft, template
      `
    : executor.queryRow<DraftRow>`
        SELECT draft.template_id, draft.title, draft.instructions, draft.metadata,
               draft.created_by_principal_id, draft.updated_at, draft.lock_version,
               template.status AS root_status,
               (SELECT count(*) FROM audit_template_versions AS version
                WHERE version.organisation_id = draft.organisation_id
                  AND version.audit_template_id = draft.template_id
                  AND version.status IN ('active', 'superseded')) AS published_count
        FROM operational_template_drafts AS draft
        JOIN audit_templates AS template
          ON template.organisation_id = draft.organisation_id
         AND template.id = draft.template_id
         AND template.template_subtype = 'OPERATIONAL_STANDARD'
        WHERE draft.organisation_id = ${organisationId}
          AND draft.template_id = ${templateId}
      `;
  const draft = await query;
  if (!draft) throw new OperationalTemplateError("not_found", "template is not available");
  const sectionRows = await executor.queryAll<SectionRow>`
    SELECT id, title, instructions, sort_order
    FROM operational_template_draft_sections
    WHERE organisation_id = ${organisationId} AND template_id = ${templateId}
    ORDER BY sort_order, id
  `;
  const questionRows = await executor.queryAll<QuestionRow>`
    SELECT id, section_id, label, instructions, sort_order, question_type,
           required, answer_configuration
    FROM operational_template_draft_questions
    WHERE organisation_id = ${organisationId} AND template_id = ${templateId}
    ORDER BY section_id, sort_order, id
  `;
  const sections = sectionRows.map((section) => ({
    id: section.id,
    title: section.title,
    ...(section.instructions ? { instructions: section.instructions } : {}),
    order: section.sort_order,
    questions: questionRows
      .filter((question) => question.section_id === section.id)
      .map(questionFromRow),
  }));
  return { draft, sections };
}

function lifecycle(draft: DraftRow): OperationalTemplateLifecycle {
  if (draft.root_status === "inactive") return "RETIRED";
  return Number(draft.published_count) > 0 ? "PUBLISHED" : "DRAFT";
}

function requireDraftOwner(draft: DraftRow, principalId: string): void {
  // TODO(coordinator): collaborative draft ownership is not decided in
  // ADR-0020. The initial deny-by-default rule keeps draft mutation,
  // preview, publication, and retirement with the attributable creator until
  // that policy is set.
  if (draft.created_by_principal_id !== principalId) {
    throw new OperationalTemplateError("access_denied", "template is not available");
  }
}

function draftResponse(input: {
  draft: DraftRow;
  sections: OperationalTemplateSection[];
}): OperationalTemplateDraft {
  return {
    templateId: input.draft.template_id,
    lifecycle: lifecycle(input.draft),
    title: input.draft.title,
    instructions: input.draft.instructions,
    metadata: metadataObject(input.draft.metadata),
    authorId: input.draft.created_by_principal_id,
    lockVersion: input.draft.lock_version,
    updatedAt: input.draft.updated_at.toISOString(),
    sections: input.sections,
  };
}

async function replaceDraftSections(
  executor: TemplateExecutor,
  input: {
    organisationId: string;
    templateId: string;
    sections: ReturnType<typeof validateOperationalTemplateContent>["sections"];
    existingSectionIds?: Set<string>;
    existingQuestionIds?: Set<string>;
  },
): Promise<void> {
  const sectionIds = new Set<string>();
  const questionIds = new Set<string>();
  const resolved = input.sections.map((section) => {
    if (section.id && input.existingSectionIds && !input.existingSectionIds.has(section.id)) {
      throw new OperationalTemplateError("invalid_input", "draft section is not available");
    }
    const sectionId = section.id ?? randomUUID();
    if (sectionIds.has(sectionId)) {
      throw new OperationalTemplateError("invalid_input", "draft section IDs must be unique");
    }
    sectionIds.add(sectionId);
    const questions = section.questions.map((question) => {
      if (question.id && input.existingQuestionIds && !input.existingQuestionIds.has(question.id)) {
        throw new OperationalTemplateError("invalid_input", "draft question is not available");
      }
      const questionId = question.id ?? randomUUID();
      if (questionIds.has(questionId)) {
        throw new OperationalTemplateError("invalid_input", "draft question IDs must be unique");
      }
      questionIds.add(questionId);
      return { question, questionId };
    });
    return { section, sectionId, questions };
  });
  await executor.exec`
    DELETE FROM operational_template_draft_sections
    WHERE organisation_id = ${input.organisationId} AND template_id = ${input.templateId}
  `;
  for (const { section, sectionId, questions } of resolved) {
    await executor.exec`
      INSERT INTO operational_template_draft_sections (
        id, organisation_id, template_id, stable_key, title, instructions, sort_order
      ) VALUES (
        ${sectionId}, ${input.organisationId}, ${input.templateId},
        ${stableKey("section", sectionId)}, ${section.title}, ${section.instructions ?? null},
        ${section.order}
      )
    `;
    for (const { question, questionId } of questions) {
      await executor.exec`
        INSERT INTO operational_template_draft_questions (
          id, organisation_id, template_id, section_id, lineage_key,
          label, instructions, sort_order, question_type, required,
          answer_configuration
        ) VALUES (
          ${questionId}, ${input.organisationId}, ${input.templateId}, ${sectionId},
          ${stableKey("question", questionId)}, ${question.label},
          ${question.instructions ?? null}, ${question.order}, ${question.type},
          ${question.required}, ${configurationForQuestion(question)}
        )
      `;
    }
  }
}

export async function createOperationalTemplateDraft(
  input: { principalId: string; request: CreateOperationalTemplateRequest },
  dependencies: { now: () => Date } = { now: () => new Date() },
): Promise<OperationalTemplateDraft> {
  const content = validateOperationalTemplateContent(input.request, { requireQuestions: false });
  const decisionAt = dependencies.now();
  return inSerializableTransaction(async (transaction) => {
    const executor = asExecutor(transaction);
    const principal = await loadPrincipal(executor, input.principalId, decisionAt);
    requireAnyCentreCapability(principal, capability.templateCreate, decisionAt);
    const templateId = randomUUID();
    await executor.exec`
      INSERT INTO audit_templates (
        id, organisation_id, template_key, title, audit_type,
        template_subtype, status, created_by_principal_id, created_at, updated_at
      ) VALUES (
        ${templateId}, ${principal.organisationId},
        ${`operational_template_${templateId.replaceAll("-", "")}`},
        ${content.title}, 'operational_standard', 'OPERATIONAL_STANDARD',
        'active', ${principal.principalId}, ${decisionAt}, ${decisionAt}
      )
    `;
    await executor.exec`
      INSERT INTO operational_template_drafts (
        organisation_id, template_id, title, instructions, metadata,
        created_by_principal_id, updated_by_principal_id, created_at, updated_at
      ) VALUES (
        ${principal.organisationId}, ${templateId}, ${content.title},
        ${content.instructions}, ${content.metadata ?? {}}, ${principal.principalId},
        ${principal.principalId}, ${decisionAt}, ${decisionAt}
      )
    `;
    await replaceDraftSections(executor, {
      organisationId: principal.organisationId,
      templateId,
      sections: content.sections,
    });
    await recordAuditEventWithExecutor(executor, {
      organisationId: principal.organisationId,
      actorPrincipalId: principal.principalId,
      action: "operational_template.draft_created",
      resourceType: "operational_template",
      resourceId: templateId,
      scopeType: "organisation",
      scopeId: principal.organisationId,
      context: {
        sectionCount: content.sections.length,
        questionCount: content.sections.reduce((count, section) => count + section.questions.length, 0),
      },
      occurredAt: decisionAt,
    });
    return draftResponse(await loadDraftContent(executor, principal.organisationId, templateId));
  });
}

export async function updateOperationalTemplateDraft(
  input: { principalId: string; request: UpdateOperationalTemplateDraftRequest },
  dependencies: { now: () => Date } = { now: () => new Date() },
): Promise<OperationalTemplateDraft> {
  const templateId = requireOperationalTemplateUuid(input.request.templateId, "template ID");
  const content = validateOperationalTemplateContent(input.request, { requireQuestions: false });
  if (!Number.isSafeInteger(input.request.lockVersion) || input.request.lockVersion < 1) {
    throw new OperationalTemplateError("invalid_input", "lockVersion is invalid");
  }
  const decisionAt = dependencies.now();
  return inSerializableTransaction(async (transaction) => {
    const executor = asExecutor(transaction);
    const principal = await loadPrincipal(executor, input.principalId, decisionAt);
    requireAnyCentreCapability(principal, capability.templateCreate, decisionAt);
    const current = await loadDraftContent(executor, principal.organisationId, templateId, true);
    requireDraftOwner(current.draft, principal.principalId);
    if (current.draft.root_status !== "active") {
      throw new OperationalTemplateError("invalid_state", "retired templates cannot be edited");
    }
    if (current.draft.lock_version !== input.request.lockVersion) {
      throw new OperationalTemplateError("version_conflict", "template changed; reload and try again");
    }
    const existingSectionIds = new Set(current.sections.map((section) => section.id));
    const existingQuestionIds = new Set(
      current.sections.flatMap((section) => section.questions.map((question) => question.id)),
    );
    await replaceDraftSections(executor, {
      organisationId: principal.organisationId,
      templateId,
      sections: content.sections,
      existingSectionIds,
      existingQuestionIds,
    });
    await executor.exec`
      UPDATE operational_template_drafts
      SET title = ${content.title}, instructions = ${content.instructions},
          metadata = ${content.metadata ?? {}}, updated_by_principal_id = ${principal.principalId},
          updated_at = ${decisionAt}, lock_version = lock_version + 1
      WHERE organisation_id = ${principal.organisationId} AND template_id = ${templateId}
    `;
    await executor.exec`
      UPDATE audit_templates
      SET title = ${content.title}, updated_at = ${decisionAt}, lock_version = lock_version + 1
      WHERE organisation_id = ${principal.organisationId} AND id = ${templateId}
    `;
    await recordAuditEventWithExecutor(executor, {
      organisationId: principal.organisationId,
      actorPrincipalId: principal.principalId,
      action: "operational_template.draft_updated",
      resourceType: "operational_template",
      resourceId: templateId,
      scopeType: "organisation",
      scopeId: principal.organisationId,
      context: {
        fromLockVersion: input.request.lockVersion,
        sectionCount: content.sections.length,
        questionCount: content.sections.reduce((count, section) => count + section.questions.length, 0),
      },
      occurredAt: decisionAt,
    });
    return draftResponse(await loadDraftContent(executor, principal.organisationId, templateId));
  });
}

async function loadVersion(
  executor: TemplateExecutor,
  organisationId: string,
  templateId: string,
  versionId: string,
): Promise<OperationalTemplateVersion> {
  const version = await executor.queryRow<VersionRow>`
    SELECT version.audit_template_id AS template_id, version.id AS version_id,
           version.version AS version_number, version.title, version.instructions,
           version.metadata, version.published_at, version.published_by_principal_id,
           template.status AS root_status
    FROM audit_template_versions AS version
    JOIN audit_templates AS template
      ON template.organisation_id = version.organisation_id
     AND template.id = version.audit_template_id
     AND template.template_subtype = 'OPERATIONAL_STANDARD'
    WHERE version.organisation_id = ${organisationId}
      AND version.audit_template_id = ${templateId}
      AND version.id = ${versionId}
      AND version.template_subtype = 'OPERATIONAL_STANDARD'
      AND version.source_classification = 'BSA_INTERNAL'
      AND version.status IN ('active', 'superseded')
  `;
  if (!version || !version.published_at || !version.published_by_principal_id) {
    throw new OperationalTemplateError("not_found", "template version is not available");
  }
  const sectionRows = await executor.queryAll<SectionRow>`
    SELECT id, title, instructions, sort_order
    FROM audit_template_sections
    WHERE organisation_id = ${organisationId} AND template_version_id = ${versionId}
    ORDER BY sort_order, id
  `;
  const itemRows = await executor.queryAll<QuestionRow>`
    SELECT id, section_id, wording AS label, instructions, sort_order,
           question_type, (applicability = 'required') AS required,
           answer_configuration
    FROM audit_template_items
    WHERE organisation_id = ${organisationId} AND template_version_id = ${versionId}
    ORDER BY section_id, sort_order, id
  `;
  return {
    templateId: version.template_id,
    versionId: version.version_id,
    versionNumber: version.version_number,
    lifecycle: version.root_status === "inactive" ? "RETIRED" : "PUBLISHED",
    title: version.title,
    instructions: version.instructions,
    metadata: metadataObject(version.metadata),
    sourceKind: "BSA_INTERNAL",
    authorId: version.published_by_principal_id,
    publishedAt: version.published_at.toISOString(),
    sections: sectionRows.map((section) => ({
      id: section.id,
      title: section.title,
      ...(section.instructions ? { instructions: section.instructions } : {}),
      order: section.sort_order,
      questions: itemRows
        .filter((question) => question.section_id === section.id)
        .map(questionFromRow),
    })),
  };
}

export async function publishOperationalTemplate(
  input: { principalId: string; request: PublishOperationalTemplateRequest },
  dependencies: { now: () => Date } = { now: () => new Date() },
): Promise<OperationalTemplateVersion> {
  const templateId = requireOperationalTemplateUuid(input.request.templateId, "template ID");
  if (!Number.isSafeInteger(input.request.lockVersion) || input.request.lockVersion < 1) {
    throw new OperationalTemplateError("invalid_input", "lockVersion is invalid");
  }
  const decisionAt = dependencies.now();
  return inSerializableTransaction(async (transaction) => {
    const executor = asExecutor(transaction);
    const principal = await loadPrincipal(executor, input.principalId, decisionAt);
    requireAnyCentreCapability(principal, capability.templatePublish, decisionAt);
    const current = await loadDraftContent(executor, principal.organisationId, templateId, true);
    requireDraftOwner(current.draft, principal.principalId);
    if (current.draft.root_status !== "active") {
      throw new OperationalTemplateError("invalid_state", "retired templates cannot be published");
    }
    if (current.draft.lock_version !== input.request.lockVersion) {
      throw new OperationalTemplateError("version_conflict", "template changed; reload and try again");
    }
    const content = validateOperationalTemplateContent({
      title: current.draft.title,
      instructions: current.draft.instructions,
      metadata: metadataObject(current.draft.metadata),
      sections: current.sections.map((section) => ({
        id: section.id,
        title: section.title,
        ...(section.instructions ? { instructions: section.instructions } : {}),
        order: section.order,
        questions: section.questions.map(questionAsInput),
      })),
    }, { requireQuestions: true });
    const next = await executor.queryRow<{ version_number: number }>`
      SELECT COALESCE(max(version), 0)::integer + 1 AS version_number
      FROM audit_template_versions
      WHERE organisation_id = ${principal.organisationId}
        AND audit_template_id = ${templateId}
    `;
    if (!next) throw new OperationalTemplateError("context_unavailable", "version lineage is unavailable");
    const versionId = randomUUID();
    await executor.exec`
      UPDATE audit_template_versions
      SET status = 'superseded'
      WHERE organisation_id = ${principal.organisationId}
        AND audit_template_id = ${templateId}
        AND template_subtype = 'OPERATIONAL_STANDARD'
        AND status = 'active'
    `;
    await executor.exec`
      INSERT INTO audit_template_versions (
        id, organisation_id, audit_template_id, scoring_policy_id,
        template_subtype, version, title, instructions, status,
        effective_from, source_classification, synthetic, published_at,
        published_by_principal_id, metadata
      ) VALUES (
        ${versionId}, ${principal.organisationId}, ${templateId}, NULL,
        'OPERATIONAL_STANDARD', ${next.version_number}, ${content.title},
        ${content.instructions}, 'draft', ${decisionAt}, 'BSA_INTERNAL', FALSE,
        ${decisionAt}, ${principal.principalId}, ${content.metadata ?? {}}
      )
    `;
    for (const section of content.sections) {
      const draftSectionId = section.id ?? randomUUID();
      const sectionId = randomUUID();
      await executor.exec`
        INSERT INTO audit_template_sections (
          id, organisation_id, template_version_id, stable_key,
          title, instructions, sort_order
        ) VALUES (
          ${sectionId}, ${principal.organisationId}, ${versionId},
          ${stableKey("section", draftSectionId)}, ${section.title},
          ${section.instructions ?? null}, ${section.order}
        )
      `;
      for (const question of section.questions) {
        const draftQuestionId = question.id ?? randomUUID();
        const questionId = randomUUID();
        await executor.exec`
          INSERT INTO audit_template_items (
            id, organisation_id, template_version_id, section_id, lineage_key,
            wording, instructions, sort_order, scoring_weight, scored, critical,
            evidence_requirement, applicability, source_classification,
            source_reference, question_type, answer_configuration
          ) VALUES (
            ${questionId}, ${principal.organisationId}, ${versionId}, ${sectionId},
            ${stableKey("question", draftQuestionId)}, ${question.label},
            ${question.instructions ?? null}, ${question.order}, 0, FALSE, FALSE,
            'none', ${question.required ? "required" : "optional"}, 'BSA_INTERNAL',
            NULL, ${question.type}, ${configurationForQuestion(question)}
          )
        `;
      }
    }
    await executor.exec`
      UPDATE audit_template_versions
      SET status = 'active'
      WHERE organisation_id = ${principal.organisationId} AND id = ${versionId}
    `;
    await executor.exec`
      UPDATE operational_template_drafts
      SET updated_by_principal_id = ${principal.principalId}, updated_at = ${decisionAt},
          lock_version = lock_version + 1
      WHERE organisation_id = ${principal.organisationId} AND template_id = ${templateId}
    `;
    await recordAuditEventWithExecutor(executor, {
      organisationId: principal.organisationId,
      actorPrincipalId: principal.principalId,
      action: "operational_template.published",
      resourceType: "operational_template_version",
      resourceId: versionId,
      scopeType: "organisation",
      scopeId: principal.organisationId,
      context: {
        templateId,
        versionNumber: next.version_number,
        sectionCount: content.sections.length,
        questionCount: content.sections.reduce((count, section) => count + section.questions.length, 0),
      },
      occurredAt: decisionAt,
    });
    return loadVersion(executor, principal.organisationId, templateId, versionId);
  });
}

export async function getOperationalTemplateVersion(input: {
  principalId: string;
  templateId: string;
  versionId: string;
}): Promise<OperationalTemplateVersion> {
  const templateId = requireOperationalTemplateUuid(input.templateId, "template ID");
  const versionId = requireOperationalTemplateUuid(input.versionId, "version ID");
  const transaction = await centreSuccessDB.begin();
  const executor = asExecutor(transaction);
  const decisionAt = new Date();
  try {
    await executor.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const principal = await loadPrincipal(executor, input.principalId, decisionAt);
    requireAnyCentreCapability(principal, capability.templateRead, decisionAt);
    const version = await loadVersion(executor, principal.organisationId, templateId, versionId);
    await transaction.commit();
    return version;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function previewOperationalTemplateDraft(input: {
  principalId: string;
  templateId: string;
}): Promise<OperationalTemplateDraft> {
  const templateId = requireOperationalTemplateUuid(input.templateId, "template ID");
  const transaction = await centreSuccessDB.begin();
  const executor = asExecutor(transaction);
  const decisionAt = new Date();
  try {
    await executor.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const principal = await loadPrincipal(executor, input.principalId, decisionAt);
    requireAnyCentreCapability(principal, capability.templateCreate, decisionAt);
    const draft = await loadDraftContent(executor, principal.organisationId, templateId);
    requireDraftOwner(draft.draft, principal.principalId);
    await transaction.commit();
    return draftResponse(draft);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function listOperationalTemplates(input: {
  principalId: string;
  request: ListOperationalTemplatesRequest;
}): Promise<ListOperationalTemplatesResponse> {
  const requestedCentreId = input.request.centreId
    ? requireOperationalTemplateUuid(input.request.centreId, "centre ID")
    : undefined;
  const transaction = await centreSuccessDB.begin();
  const executor = asExecutor(transaction);
  const decisionAt = new Date();
  try {
    await executor.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const principal = await loadPrincipal(executor, input.principalId, decisionAt);
    const portfolio = requireAnyCentreCapability(principal, capability.templateRead, decisionAt);
    if (!requestedCentreId
        && hasInvalidAuthorisedCentre(principal, capability.templateRead, decisionAt)) {
      throw new OperationalTemplateError(
        "context_unavailable",
        "authorised portfolio could not be resolved safely",
      );
    }
    const filteredCentres = requestedCentreId
      ? portfolio.filter((centre) => centre.id === requestedCentreId)
      : portfolio;
    if (requestedCentreId && filteredCentres.length !== 1) {
      throw new OperationalTemplateError("access_denied", "template library is not available");
    }
    const centreIds = filteredCentres.map((centre) => centre.id);
    const templates = await executor.queryAll<{
      template_id: string;
      root_title: string;
      root_status: "active" | "inactive";
      lock_version: number;
      draft_title: string | null;
      draft_author_id: string | null;
      version_id: string | null;
      version_number: number | null;
      version_title: string | null;
      published_at: Date | null;
      published_by_principal_id: string | null;
    }>`
      SELECT template.id AS template_id, template.title AS root_title,
             template.status AS root_status,
             COALESCE(draft.lock_version, template.lock_version) AS lock_version,
             draft.title AS draft_title,
             draft.created_by_principal_id AS draft_author_id,
             latest.id AS version_id, latest.version AS version_number,
             latest.title AS version_title, latest.published_at,
             latest.published_by_principal_id
      FROM audit_templates AS template
      LEFT JOIN operational_template_drafts AS draft
        ON draft.organisation_id = template.organisation_id
       AND draft.template_id = template.id
      LEFT JOIN LATERAL (
        SELECT version.id, version.version, version.title, version.published_at,
               version.published_by_principal_id
        FROM audit_template_versions AS version
        WHERE version.organisation_id = template.organisation_id
          AND version.audit_template_id = template.id
          AND version.template_subtype = 'OPERATIONAL_STANDARD'
          AND version.source_classification = 'BSA_INTERNAL'
          AND version.status IN ('active', 'superseded')
        ORDER BY version.version DESC, version.id
        LIMIT 1
      ) AS latest ON TRUE
      WHERE template.organisation_id = ${principal.organisationId}
        AND template.template_subtype = 'OPERATIONAL_STANDARD'
        AND (latest.id IS NOT NULL OR draft.created_by_principal_id = ${principal.principalId})
      ORDER BY COALESCE(draft.title, latest.title, template.title), template.id
    `;
    const assignments = await executor.queryAll<{
      template_id: string;
      centre_id: string;
      centre_name: string;
    }>`
      SELECT DISTINCT assignment.template_id, centre.id AS centre_id, centre.name AS centre_name
      FROM operational_template_assignments AS assignment
      JOIN operational_template_assignment_centres AS assigned
        ON assigned.organisation_id = assignment.organisation_id
       AND assigned.assignment_id = assignment.id
      JOIN operational_standard_deployments AS deployment
        ON deployment.organisation_id = assigned.organisation_id
       AND deployment.centre_id = assigned.centre_id
       AND deployment.id = assigned.deployment_id
      JOIN centres AS centre
        ON centre.organisation_id = assigned.organisation_id
       AND centre.id = assigned.centre_id
      WHERE assignment.organisation_id = ${principal.organisationId}
        AND assigned.centre_id = ANY(${centreIds}::uuid[])
        AND deployment.status = 'ACTIVE'
      ORDER BY assignment.template_id, centre.name, centre.id
    `;
    await transaction.commit();
    return {
      assignmentFilter: requestedCentreId
        ? { kind: "CENTRE", centreId: requestedCentreId }
        : { kind: "PORTFOLIO" },
      templates: templates.map((template) => ({
        templateId: template.template_id,
        title: template.draft_title ?? template.version_title ?? template.root_title,
        lifecycle: template.root_status === "inactive"
          ? "RETIRED"
          : template.version_id ? "PUBLISHED" : "DRAFT",
        ...(template.draft_author_id ? { authorId: template.draft_author_id } : {}),
        lockVersion: template.lock_version,
        ...(template.version_id && template.version_number && template.published_at && template.published_by_principal_id
          ? {
              latestPublishedVersion: {
                versionId: template.version_id,
                versionNumber: template.version_number,
                publishedAt: template.published_at.toISOString(),
                authorId: template.published_by_principal_id,
              },
            }
          : {}),
        assignedCentres: assignments
          .filter((assignment) => assignment.template_id === template.template_id)
          .map((assignment) => ({
            centreId: assignment.centre_id,
            centreName: assignment.centre_name,
          })),
      })),
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function assignOperationalTemplate(
  input: { principalId: string; request: AssignOperationalTemplateRequest },
  dependencies: { now: () => Date } = { now: () => new Date() },
): Promise<AssignOperationalTemplateResponse> {
  const templateId = requireOperationalTemplateUuid(input.request.templateId, "template ID");
  const versionId = requireOperationalTemplateUuid(input.request.versionId, "version ID");
  validateDailySchedule(input.request.schedule);
  const decisionAt = dependencies.now();
  return inSerializableTransaction(async (transaction) => {
    const executor = asExecutor(transaction);
    const principal = await loadPrincipal(executor, input.principalId, decisionAt);
    const portfolio = requireAnyCentreCapability(principal, capability.templateAssign, decisionAt);
    const version = await executor.queryRow<{ id: string }>`
      SELECT version.id
      FROM audit_template_versions AS version
      JOIN audit_templates AS template
        ON template.organisation_id = version.organisation_id
       AND template.id = version.audit_template_id
       AND template.status = 'active'
      WHERE version.organisation_id = ${principal.organisationId}
        AND version.audit_template_id = ${templateId}
        AND version.id = ${versionId}
        AND version.template_subtype = 'OPERATIONAL_STANDARD'
        AND version.source_classification = 'BSA_INTERNAL'
        AND version.status = 'active'
      FOR UPDATE OF template
    `;
    if (!version) throw new OperationalTemplateError("not_found", "published template is not available");
    // TODO(coordinator): the accepted 4A completion API carries outcome-token
    // strings only. Do not invent a typed text/number/multi-select completion
    // payload in this builder lane; integration must extend that existing
    // occurrence/response route once its public contract is reviewed.
    let targetCentres: CentreAuthorisationFact[];
    if (input.request.target.kind === "PORTFOLIO") {
      if (hasInvalidAuthorisedCentre(principal, capability.templateAssign, decisionAt)) {
        throw new OperationalTemplateError(
          "context_unavailable",
          "authorised portfolio could not be resolved safely",
        );
      }
      targetCentres = portfolio;
    } else {
      if (!Array.isArray(input.request.target.centreIds)
          || input.request.target.centreIds.length < 1
          || input.request.target.centreIds.length > 100) {
        throw new OperationalTemplateError("invalid_input", "select between 1 and 100 centres");
      }
      const requested = [...new Set(input.request.target.centreIds.map((id) =>
        requireOperationalTemplateUuid(id, "centre ID")))];
      if (requested.length !== input.request.target.centreIds.length) {
        throw new OperationalTemplateError("invalid_input", "centre IDs must be unique");
      }
      targetCentres = requested.map((centreId) => {
        const centre = portfolio.find((candidate) => candidate.id === centreId);
        if (!centre) throw new OperationalTemplateError("access_denied", "centre is not available");
        return centre;
      });
    }
    if (targetCentres.length === 0) {
      throw new OperationalTemplateError("access_denied", "no authorised centres are available");
    }
    const assignmentId = randomUUID();
    await executor.exec`
      INSERT INTO operational_template_assignments (
        id, organisation_id, template_id, template_version_id, target_kind,
        frequency, opens_local_time, due_local_time, effective_from,
        assigned_by_principal_id, assigned_at
      ) VALUES (
        ${assignmentId}, ${principal.organisationId}, ${templateId}, ${versionId},
        ${input.request.target.kind}, 'DAILY', ${input.request.schedule.opensLocalTime}::text::time,
        ${input.request.schedule.dueLocalTime}::text::time, ${input.request.schedule.effectiveFrom}::date,
        ${principal.principalId}, ${decisionAt}
      )
    `;
    const deployments: AssignOperationalTemplateResponse["deployments"] = [];
    for (const centre of targetCentres) {
      const existing = await executor.queryRow<{ id: string }>`
        SELECT deployment.id
        FROM operational_standard_deployments AS deployment
        JOIN audit_template_versions AS deployed_version
          ON deployed_version.organisation_id = deployment.organisation_id
         AND deployed_version.id = deployment.template_version_id
        WHERE deployment.organisation_id = ${principal.organisationId}
          AND deployment.centre_id = ${centre.id}
          AND deployed_version.audit_template_id = ${templateId}
          AND deployment.status = 'ACTIVE'
        LIMIT 1
        FOR UPDATE OF deployment
      `;
      if (existing) {
        throw new OperationalTemplateError(
          "invalid_state",
          "template already has an active deployment for a selected centre",
        );
      }
      const deploymentId = randomUUID();
      const scheduleRevisionId = randomUUID();
      await executor.exec`
        INSERT INTO operational_standard_deployments (
          id, organisation_id, centre_id, template_version_id, status,
          effective_from, synthetic_notice, created_by_principal_id,
          created_at, updated_at
        ) VALUES (
          ${deploymentId}, ${principal.organisationId}, ${centre.id}, ${versionId},
          'ACTIVE', ${input.request.schedule.effectiveFrom}::date, NULL,
          ${principal.principalId}, ${decisionAt}, ${decisionAt}
        )
      `;
      await executor.exec`
        INSERT INTO operational_standard_schedule_revisions (
          id, organisation_id, centre_id, deployment_id, revision, frequency,
          opens_local_time, due_local_time, effective_from, centre_timezone,
          created_by_principal_id, created_at
        ) VALUES (
          ${scheduleRevisionId}, ${principal.organisationId}, ${centre.id},
          ${deploymentId}, 1, 'DAILY', ${input.request.schedule.opensLocalTime}::text::time,
          ${input.request.schedule.dueLocalTime}::text::time,
          ${input.request.schedule.effectiveFrom}::date, ${centre.timezone},
          ${principal.principalId}, ${decisionAt}
        )
      `;
      await executor.exec`
        INSERT INTO operational_template_assignment_centres (
          organisation_id, assignment_id, centre_id, deployment_id, centre_timezone
        ) VALUES (
          ${principal.organisationId}, ${assignmentId}, ${centre.id},
          ${deploymentId}, ${centre.timezone}
        )
      `;
      await recordAuditEventWithExecutor(executor, {
        organisationId: principal.organisationId,
        actorPrincipalId: principal.principalId,
        action: "operational_template.centre_assigned",
        resourceType: "operational_standard_deployment",
        resourceId: deploymentId,
        scopeType: "centre",
        scopeId: centre.id,
        context: { assignmentId, templateId, versionId, frequency: "DAILY" },
        occurredAt: decisionAt,
      });
      deployments.push({
        centreId: centre.id,
        deploymentId,
        scheduleRevisionId,
        centreTimezone: centre.timezone,
      });
    }
    await recordAuditEventWithExecutor(executor, {
      organisationId: principal.organisationId,
      actorPrincipalId: principal.principalId,
      action: "operational_template.assigned",
      resourceType: "operational_template_assignment",
      resourceId: assignmentId,
      scopeType: "organisation",
      scopeId: principal.organisationId,
      context: {
        templateId,
        versionId,
        targetKind: input.request.target.kind,
        centreCount: deployments.length,
        frequency: "DAILY",
        opensLocalTime: input.request.schedule.opensLocalTime,
        dueLocalTime: input.request.schedule.dueLocalTime,
        effectiveFrom: input.request.schedule.effectiveFrom,
      },
      occurredAt: decisionAt,
    });
    return {
      assignmentId,
      templateId,
      versionId,
      targetKind: input.request.target.kind,
      frequency: "DAILY",
      centreCount: deployments.length,
      deployments,
    };
  });
}

/**
 * Everything the builder needs to open one template: its open draft where one
 * exists, and its permanent version history.
 *
 * The draft is omitted rather than nulled when none exists, so a
 * published-only template cannot read as one with an empty draft.
 */
export async function getOperationalTemplateWorkspace(input: {
  principalId: string;
  templateId: string;
}): Promise<OperationalTemplateWorkspace> {
  const templateId = requireOperationalTemplateUuid(input.templateId, "template ID");
  const transaction = await centreSuccessDB.begin();
  const executor = asExecutor(transaction);
  const decisionAt = new Date();
  try {
    await executor.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const principal = await loadPrincipal(executor, input.principalId, decisionAt);
    requireAnyCentreCapability(principal, capability.templateRead, decisionAt);
    const template = await executor.queryRow<{
      title: string;
      status: "active" | "inactive";
    }>`
      SELECT template.title, template.status
      FROM audit_templates AS template
      WHERE template.organisation_id = ${principal.organisationId}
        AND template.id = ${templateId}
        AND template.template_subtype = 'OPERATIONAL_STANDARD'
    `;
    if (!template) {
      throw new OperationalTemplateError("not_found", "template is not available");
    }
    const versionRows = await executor.queryAll<{
      version_id: string;
      version_number: number;
      status: string;
      published_at: Date;
      published_by_principal_id: string;
    }>`
      SELECT version.id AS version_id, version.version AS version_number,
             version.status, version.published_at, version.published_by_principal_id
      FROM audit_template_versions AS version
      WHERE version.organisation_id = ${principal.organisationId}
        AND version.audit_template_id = ${templateId}
        AND version.template_subtype = 'OPERATIONAL_STANDARD'
        AND version.source_classification = 'BSA_INTERNAL'
        AND version.status IN ('active', 'superseded', 'retired')
      ORDER BY version.version DESC, version.id
    `;
    const draftExists = await executor.queryRow<{ template_id: string }>`
      SELECT draft.template_id
      FROM operational_template_drafts AS draft
      WHERE draft.organisation_id = ${principal.organisationId}
        AND draft.template_id = ${templateId}
    `;
    const draft = draftExists
      ? draftResponse(await loadDraftContent(executor, principal.organisationId, templateId))
      : undefined;
    await transaction.commit();
    const versions: OperationalTemplateVersionSummary[] = versionRows.map((version) => ({
      versionId: version.version_id,
      versionNumber: version.version_number,
      lifecycle: version.status === "retired" ? "RETIRED" : "PUBLISHED",
      publishedAt: version.published_at.toISOString(),
      authorId: version.published_by_principal_id,
    }));
    return {
      templateId,
      title: draft?.title ?? template.title,
      lifecycle: template.status === "inactive"
        ? "RETIRED"
        : versions.length > 0 ? "PUBLISHED" : "DRAFT",
      ...(draft ? { draft } : {}),
      versions,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/**
 * The centres this principal may actually assign a template to.
 *
 * The browser is never the authority here; it renders what this returns. When
 * an authorised centre cannot be resolved the notice is set, so a short list is
 * never presented as a complete one.
 */
export async function listOperationalTemplateAssignmentOptions(input: {
  principalId: string;
}): Promise<OperationalTemplateAssignmentOptions> {
  const transaction = await centreSuccessDB.begin();
  const executor = asExecutor(transaction);
  const decisionAt = new Date();
  try {
    await executor.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const principal = await loadPrincipal(executor, input.principalId, decisionAt);
    const assignable = requireAnyCentreCapability(
      principal,
      capability.templateAssign,
      decisionAt,
    );
    const incomplete = hasInvalidAuthorisedCentre(
      principal,
      capability.templateAssign,
      decisionAt,
    );
    const centreIds = assignable.map((centre) => centre.id);
    const named = await executor.queryAll<{ centre_id: string; centre_name: string }>`
      SELECT centre.id AS centre_id, centre.name AS centre_name
      FROM centres AS centre
      WHERE centre.organisation_id = ${principal.organisationId}
        AND centre.id = ANY(${centreIds}::uuid[])
      ORDER BY centre.name, centre.id
    `;
    await transaction.commit();
    return {
      centres: named.map((centre) => ({
        centreId: centre.centre_id,
        centreName: centre.centre_name,
      })),
      portfolioAvailable: named.length > 0,
      portfolioCentreCount: named.length,
      ...(incomplete
        ? {
            incompleteNotice:
              "Some centres you work in could not be confirmed, so this list may be incomplete.",
          }
        : {}),
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function retireOperationalTemplate(
  input: { principalId: string; request: RetireOperationalTemplateRequest },
  dependencies: { now: () => Date } = { now: () => new Date() },
): Promise<RetireOperationalTemplateResponse> {
  const templateId = requireOperationalTemplateUuid(input.request.templateId, "template ID");
  if (!Number.isSafeInteger(input.request.lockVersion) || input.request.lockVersion < 1) {
    throw new OperationalTemplateError("invalid_input", "lockVersion is invalid");
  }
  const decisionAt = dependencies.now();
  return inSerializableTransaction(async (transaction) => {
    const executor = asExecutor(transaction);
    const principal = await loadPrincipal(executor, input.principalId, decisionAt);
    requireAnyCentreCapability(principal, capability.templatePublish, decisionAt);
    const current = await loadDraftContent(executor, principal.organisationId, templateId, true);
    requireDraftOwner(current.draft, principal.principalId);
    if (current.draft.root_status !== "active" || Number(current.draft.published_count) === 0) {
      throw new OperationalTemplateError("invalid_state", "only a published template can be retired");
    }
    if (current.draft.lock_version !== input.request.lockVersion) {
      throw new OperationalTemplateError("version_conflict", "template changed; reload and try again");
    }
    const activeDeployments = await executor.queryAll<{ id: string; centre_id: string }>`
      SELECT deployment.id, deployment.centre_id
      FROM operational_standard_deployments AS deployment
      JOIN audit_template_versions AS version
        ON version.organisation_id = deployment.organisation_id
       AND version.id = deployment.template_version_id
      WHERE deployment.organisation_id = ${principal.organisationId}
        AND version.audit_template_id = ${templateId}
        AND deployment.status = 'ACTIVE'
      ORDER BY deployment.id
      FOR UPDATE OF deployment
    `;
    for (const deployment of activeDeployments) {
      await executor.exec`
        UPDATE operational_standard_deployments
        SET status = 'INACTIVE', updated_at = ${decisionAt}, lock_version = lock_version + 1
        WHERE organisation_id = ${principal.organisationId} AND id = ${deployment.id}
      `;
      await recordAuditEventWithExecutor(executor, {
        organisationId: principal.organisationId,
        actorPrincipalId: principal.principalId,
        action: "operational_template.deployment_retired",
        resourceType: "operational_standard_deployment",
        resourceId: deployment.id,
        scopeType: "centre",
        scopeId: deployment.centre_id,
        context: { templateId },
        occurredAt: decisionAt,
      });
    }
    await executor.exec`
      UPDATE audit_templates
      SET status = 'inactive', retired_at = ${decisionAt},
          retired_by_principal_id = ${principal.principalId},
          updated_at = ${decisionAt}, lock_version = lock_version + 1
      WHERE organisation_id = ${principal.organisationId} AND id = ${templateId}
    `;
    await executor.exec`
      UPDATE operational_template_drafts
      SET updated_by_principal_id = ${principal.principalId}, updated_at = ${decisionAt},
          lock_version = lock_version + 1
      WHERE organisation_id = ${principal.organisationId} AND template_id = ${templateId}
    `;
    await recordAuditEventWithExecutor(executor, {
      organisationId: principal.organisationId,
      actorPrincipalId: principal.principalId,
      action: "operational_template.retired",
      resourceType: "operational_template",
      resourceId: templateId,
      scopeType: "organisation",
      scopeId: principal.organisationId,
      context: { deactivatedDeploymentCount: activeDeployments.length },
      occurredAt: decisionAt,
    });
    return {
      templateId,
      lifecycle: "RETIRED",
      lockVersion: current.draft.lock_version + 1,
    };
  });
}
