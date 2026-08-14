import { api, APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import type { CentreSuccessAuthData } from "../authentication/auth-handler";
import type {
  AssignOperationalTemplateRequest,
  AssignOperationalTemplateResponse,
  CreateOperationalTemplateRequest,
  ListOperationalTemplatesRequest,
  ListOperationalTemplatesResponse,
  OperationalTemplateAssignmentOptions,
  OperationalTemplateDraft,
  OperationalTemplateIdRequest,
  OperationalTemplatePreview,
  OperationalTemplateVersion,
  OperationalTemplateVersionRequest,
  OperationalTemplateWorkspace,
  PublishOperationalTemplateRequest,
  RetireOperationalTemplateRequest,
  RetireOperationalTemplateResponse,
  UpdateOperationalTemplateDraftRequest,
} from "./contracts";
import {
  assignOperationalTemplate,
  createOperationalTemplateDraft,
  getOperationalTemplateVersion,
  getOperationalTemplateWorkspace,
  listOperationalTemplateAssignmentOptions,
  listOperationalTemplates,
  previewOperationalTemplateDraft,
  publishOperationalTemplate,
  retireOperationalTemplate,
  updateOperationalTemplateDraft,
} from "./service";
import { OperationalTemplateError } from "./types";

export interface OperationalTemplateApiDependencies {
  getTrustedAuthData: () => CentreSuccessAuthData | null | undefined;
  createDraft: typeof createOperationalTemplateDraft;
  updateDraft: typeof updateOperationalTemplateDraft;
  publish: typeof publishOperationalTemplate;
  list: typeof listOperationalTemplates;
  getVersion: typeof getOperationalTemplateVersion;
  previewDraft: typeof previewOperationalTemplateDraft;
  assign: typeof assignOperationalTemplate;
  retire: typeof retireOperationalTemplate;
  getWorkspace: typeof getOperationalTemplateWorkspace;
  assignmentOptions: typeof listOperationalTemplateAssignmentOptions;
}

const runtimeDependencies: OperationalTemplateApiDependencies = {
  getTrustedAuthData: () => getAuthData() as CentreSuccessAuthData | null,
  createDraft: createOperationalTemplateDraft,
  updateDraft: updateOperationalTemplateDraft,
  publish: publishOperationalTemplate,
  list: listOperationalTemplates,
  getVersion: getOperationalTemplateVersion,
  previewDraft: previewOperationalTemplateDraft,
  assign: assignOperationalTemplate,
  retire: retireOperationalTemplate,
  getWorkspace: getOperationalTemplateWorkspace,
  assignmentOptions: listOperationalTemplateAssignmentOptions,
};

function requirePrincipalId(dependencies: OperationalTemplateApiDependencies): string {
  const authData = dependencies.getTrustedAuthData();
  if (!authData) throw APIError.unauthenticated("authentication required");
  return authData.userID;
}

function toApiError(error: unknown): never {
  if (error instanceof APIError) throw error;
  if (!(error instanceof OperationalTemplateError)) {
    throw APIError.unavailable("template library is temporarily unavailable");
  }
  switch (error.code) {
    case "invalid_input":
      throw APIError.invalidArgument(error.message);
    case "access_denied":
    case "not_found":
      throw APIError.permissionDenied("template is not available");
    case "version_conflict":
      throw APIError.aborted("template changed; reload and try again");
    case "invalid_state":
      throw APIError.failedPrecondition(error.message).withDetails({ reason: error.code });
    case "context_unavailable":
      throw APIError.unavailable("template library is temporarily unavailable");
  }
}

/** @internal Testable authenticated boundary. */
export async function createOperationalTemplateEndpoint(
  request: CreateOperationalTemplateRequest,
  dependencies: OperationalTemplateApiDependencies = runtimeDependencies,
): Promise<OperationalTemplateDraft> {
  try {
    return await dependencies.createDraft({
      principalId: requirePrincipalId(dependencies),
      request,
    });
  } catch (error) {
    return toApiError(error);
  }
}

/** @internal Testable authenticated boundary. */
export async function updateOperationalTemplateEndpoint(
  request: UpdateOperationalTemplateDraftRequest,
  dependencies: OperationalTemplateApiDependencies = runtimeDependencies,
): Promise<OperationalTemplateDraft> {
  try {
    return await dependencies.updateDraft({
      principalId: requirePrincipalId(dependencies),
      request,
    });
  } catch (error) {
    return toApiError(error);
  }
}

/** @internal Testable authenticated boundary. */
export async function publishOperationalTemplateEndpoint(
  request: PublishOperationalTemplateRequest,
  dependencies: OperationalTemplateApiDependencies = runtimeDependencies,
): Promise<OperationalTemplateVersion> {
  try {
    return await dependencies.publish({
      principalId: requirePrincipalId(dependencies),
      request,
    });
  } catch (error) {
    return toApiError(error);
  }
}

/** @internal Testable authenticated boundary. */
export async function listOperationalTemplatesEndpoint(
  request: ListOperationalTemplatesRequest,
  dependencies: OperationalTemplateApiDependencies = runtimeDependencies,
): Promise<ListOperationalTemplatesResponse> {
  try {
    return await dependencies.list({
      principalId: requirePrincipalId(dependencies),
      request,
    });
  } catch (error) {
    return toApiError(error);
  }
}

/** @internal Testable authenticated boundary. */
export async function getOperationalTemplateVersionEndpoint(
  request: OperationalTemplateVersionRequest,
  dependencies: OperationalTemplateApiDependencies = runtimeDependencies,
): Promise<OperationalTemplateVersion> {
  try {
    return await dependencies.getVersion({
      principalId: requirePrincipalId(dependencies),
      templateId: request.templateId,
      versionId: request.versionId,
    });
  } catch (error) {
    return toApiError(error);
  }
}

/** @internal Testable authenticated boundary. */
export async function previewOperationalTemplateEndpoint(
  request: OperationalTemplateIdRequest,
  dependencies: OperationalTemplateApiDependencies = runtimeDependencies,
): Promise<OperationalTemplatePreview> {
  try {
    const template = await dependencies.previewDraft({
      principalId: requirePrincipalId(dependencies),
      templateId: request.templateId,
    });
    return { device: "PHONE", source: "DRAFT", template };
  } catch (error) {
    return toApiError(error);
  }
}

/** @internal Testable authenticated boundary. */
export async function assignOperationalTemplateEndpoint(
  request: AssignOperationalTemplateRequest,
  dependencies: OperationalTemplateApiDependencies = runtimeDependencies,
): Promise<AssignOperationalTemplateResponse> {
  try {
    return await dependencies.assign({
      principalId: requirePrincipalId(dependencies),
      request,
    });
  } catch (error) {
    return toApiError(error);
  }
}

/** @internal Testable authenticated boundary. */
export async function retireOperationalTemplateEndpoint(
  request: RetireOperationalTemplateRequest,
  dependencies: OperationalTemplateApiDependencies = runtimeDependencies,
): Promise<RetireOperationalTemplateResponse> {
  try {
    return await dependencies.retire({
      principalId: requirePrincipalId(dependencies),
      request,
    });
  } catch (error) {
    return toApiError(error);
  }
}

/** @internal Testable authenticated boundary. */
export async function getOperationalTemplateWorkspaceEndpoint(
  request: OperationalTemplateIdRequest,
  dependencies: OperationalTemplateApiDependencies = runtimeDependencies,
): Promise<OperationalTemplateWorkspace> {
  try {
    return await dependencies.getWorkspace({
      principalId: requirePrincipalId(dependencies),
      templateId: request.templateId,
    });
  } catch (error) {
    return toApiError(error);
  }
}

/** @internal Testable authenticated boundary. */
export async function listOperationalTemplateAssignmentOptionsEndpoint(
  dependencies: OperationalTemplateApiDependencies = runtimeDependencies,
): Promise<OperationalTemplateAssignmentOptions> {
  try {
    return await dependencies.assignmentOptions({
      principalId: requirePrincipalId(dependencies),
    });
  } catch (error) {
    return toApiError(error);
  }
}

export const createOperationalTemplate = api(
  { expose: true, auth: true, method: "POST", path: "/standards/templates" },
  (request: CreateOperationalTemplateRequest): Promise<OperationalTemplateDraft> =>
    createOperationalTemplateEndpoint(request),
);

export const listOperationalTemplateLibrary = api(
  { expose: true, auth: true, method: "GET", path: "/standards/templates" },
  (request: ListOperationalTemplatesRequest): Promise<ListOperationalTemplatesResponse> =>
    listOperationalTemplatesEndpoint(request),
);

export const updateOperationalTemplateDraftRoute = api(
  { expose: true, auth: true, method: "PUT", path: "/standards/templates/:templateId/draft" },
  (request: UpdateOperationalTemplateDraftRequest): Promise<OperationalTemplateDraft> =>
    updateOperationalTemplateEndpoint(request),
);

export const previewOperationalTemplateDraftRoute = api(
  { expose: true, auth: true, method: "GET", path: "/standards/templates/:templateId/preview" },
  (request: OperationalTemplateIdRequest): Promise<OperationalTemplatePreview> =>
    previewOperationalTemplateEndpoint(request),
);

export const publishOperationalTemplateRoute = api(
  { expose: true, auth: true, method: "POST", path: "/standards/templates/:templateId/publish" },
  (request: PublishOperationalTemplateRequest): Promise<OperationalTemplateVersion> =>
    publishOperationalTemplateEndpoint(request),
);

export const retireOperationalTemplateRoute = api(
  { expose: true, auth: true, method: "POST", path: "/standards/templates/:templateId/retire" },
  (request: RetireOperationalTemplateRequest): Promise<RetireOperationalTemplateResponse> =>
    retireOperationalTemplateEndpoint(request),
);

export const getOperationalTemplateVersionRoute = api(
  {
    expose: true,
    auth: true,
    method: "GET",
    path: "/standards/templates/:templateId/versions/:versionId",
  },
  (request: OperationalTemplateVersionRequest): Promise<OperationalTemplateVersion> =>
    getOperationalTemplateVersionEndpoint(request),
);

export const assignOperationalTemplateRoute = api(
  {
    expose: true,
    auth: true,
    method: "POST",
    path: "/standards/templates/:templateId/assignments",
  },
  (request: AssignOperationalTemplateRequest): Promise<AssignOperationalTemplateResponse> =>
    assignOperationalTemplateEndpoint(request),
);

export const getOperationalTemplateWorkspaceRoute = api(
  { expose: true, auth: true, method: "GET", path: "/standards/templates/:templateId" },
  (request: OperationalTemplateIdRequest): Promise<OperationalTemplateWorkspace> =>
    getOperationalTemplateWorkspaceEndpoint(request),
);

/*
 * Deliberately not nested under `/standards/templates/...`. A literal segment
 * there would sit alongside `:templateId` and the routing would depend on
 * precedence rather than on the path being unambiguous.
 */
export const listOperationalTemplateAssignmentOptionsRoute = api(
  { expose: true, auth: true, method: "GET", path: "/standards/template-assignment-options" },
  (): Promise<OperationalTemplateAssignmentOptions> =>
    listOperationalTemplateAssignmentOptionsEndpoint(),
);
