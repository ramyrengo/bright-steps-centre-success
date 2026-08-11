import { api } from "encore.dev/api";
import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import { authoriseCentreFromDatabase } from "../authorization/database-authoriser";
import { centreSuccessDB } from "../db";
import {
  filterCentreResourcesByCapability,
  requireBusinessPrincipal,
  requireCentreCapability,
  requireOrganisationCapability,
  toQuarterlyReviewApiError,
} from "./authorization";
import type {
  AcknowledgeAuditRequest,
  AcknowledgeAuditResponse,
  ActionTransitionResponse,
  AuditIdRequest,
  AuditPreparationResponse,
  AuditStatusTransitionResponse,
  AuditTransitionRequest,
  CompleteEvidenceUploadRequest,
  CompleteEvidenceUploadResponse,
  ComplianceOversightResponse,
  CorrectiveActionDetail,
  CorrectiveActionIdRequest,
  GetEvidenceAccessRequest,
  GetEvidenceAccessResponse,
  FinaliseQuarterlyAuditResponse,
  ListAuditCentresResponse,
  ListCorrectiveActionsResponse,
  QuarterlyAuditView,
  RequestEvidenceUploadRequest,
  RequestEvidenceUploadResponse,
  ReturnCorrectiveActionRequest,
  SaveAuditResponseRequest,
  SaveAuditResponseResponse,
  StartCorrectiveActionRequest,
  StartQuarterlyAuditRequest,
  StartQuarterlyAuditResponse,
  SubmitCorrectiveActionRequest,
  VerifyCorrectiveActionRequest,
} from "./contracts";
import {
  completeEvidenceUpload as completeEvidenceUploadWorkflow,
  getEvidenceAccess as getEvidenceAccessWorkflow,
  requestEvidenceUpload as requestEvidenceUploadWorkflow,
} from "./evidence";
import {
  listAuditCentresForPrincipal,
  listCorrectiveActionsForPrincipal,
  loadActionCentre,
  loadAuditIdentity,
  loadCorrectiveActionDetail,
  loadEvidenceTarget,
  loadQuarterlyAuditView,
} from "./queries";
import {
  acknowledgeAudit as acknowledgeAuditWorkflow,
  finaliseQuarterlyAudit as finaliseQuarterlyAuditWorkflow,
  getAuditPreparation as getAuditPreparationWorkflow,
  loadComplianceOversight,
  markAuditReady as markAuditReadyWorkflow,
  returnCorrectiveAction as returnCorrectiveActionWorkflow,
  saveAuditResponse as saveAuditResponseWorkflow,
  startCorrectiveAction as startCorrectiveActionWorkflow,
  startQuarterlyAudit as startQuarterlyAuditWorkflow,
  submitCorrectiveAction as submitCorrectiveActionWorkflow,
  verifyAndCloseCorrectiveAction as verifyAndCloseCorrectiveActionWorkflow,
} from "./service";
import { QuarterlyReviewError, requireUuid } from "./types";

async function authorisedCentreIds(input: {
  principalId: string;
  organisationId: string;
  requiredCapability: typeof capability.quarterlyAuditConduct;
}): Promise<string[]> {
  const rows = await centreSuccessDB.queryAll<{ id: string }>`
    SELECT id FROM centres
    WHERE organisation_id = ${input.organisationId} AND status = 'active'
    ORDER BY id
  `;
  const decisions = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      decision: await authoriseCentreFromDatabase({
        principalId: input.principalId,
        activeOrganisationId: input.organisationId,
        centreId: row.id,
        capability: input.requiredCapability,
      }),
    })),
  );
  return decisions.filter(({ decision }) => decision.allowed).map(({ id }) => id);
}

export const listAssignedAuditCentres = api(
  { expose: true, auth: true, method: "GET", path: "/quarterly-reviews/centres" },
  async (): Promise<ListAuditCentresResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      const centreIds = await authorisedCentreIds({
        principalId: principal.principalId,
        organisationId: principal.organisationId,
        requiredCapability: capability.quarterlyAuditConduct,
      });
      return {
        centres: await listAuditCentresForPrincipal({
          organisationId: principal.organisationId,
          centreIds,
        }),
      };
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const getAuditPreparation = api(
  { expose: true, auth: true, method: "GET", path: "/quarterly-reviews/centres/:centreId/preparation" },
  async ({ centreId }: { centreId: string }): Promise<AuditPreparationResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      centreId = requireUuid(centreId, "centre ID");
      await requireCentreCapability(principal, centreId, capability.quarterlyAuditConduct);
      return getAuditPreparationWorkflow({ organisationId: principal.organisationId, centreId });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const startQuarterlyAudit = api(
  { expose: true, auth: true, method: "POST", path: "/quarterly-reviews/audits" },
  async (request: StartQuarterlyAuditRequest): Promise<StartQuarterlyAuditResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      const centreId = requireUuid(request.centreId, "centre ID");
      await requireCentreCapability(principal, centreId, capability.quarterlyAuditConduct);
      return startQuarterlyAuditWorkflow({
        organisationId: principal.organisationId,
        centreId,
        actorPrincipalId: principal.principalId,
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

async function requireAuditCapability(
  principal: Awaited<ReturnType<typeof requireBusinessPrincipal>>,
  auditId: string,
  requiredCapability: Parameters<typeof requireCentreCapability>[2],
) {
  const identity = await loadAuditIdentity(principal.organisationId, requireUuid(auditId, "audit ID"));
  await requireCentreCapability(principal, identity.centre_id, requiredCapability);
  return identity;
}

export const getQuarterlyAudit = api(
  { expose: true, auth: true, method: "GET", path: "/quarterly-reviews/audits/:auditId" },
  async ({ auditId }: AuditIdRequest): Promise<QuarterlyAuditView> => {
    try {
      const principal = await requireBusinessPrincipal();
      await requireAuditCapability(principal, auditId, capability.quarterlyAuditRead);
      return loadQuarterlyAuditView({
        organisationId: principal.organisationId,
        principalId: principal.principalId,
        auditId,
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const saveQuarterlyAuditResponse = api(
  { expose: true, auth: true, method: "PUT", path: "/quarterly-reviews/audits/:auditId/responses/:itemId" },
  async (request: SaveAuditResponseRequest): Promise<SaveAuditResponseResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      await requireAuditCapability(principal, request.auditId, capability.quarterlyAuditConduct);
      return saveAuditResponseWorkflow({
        organisationId: principal.organisationId,
        actorPrincipalId: principal.principalId,
        request: {
          ...request,
          auditId: requireUuid(request.auditId, "audit ID"),
          itemId: requireUuid(request.itemId, "audit item ID"),
        },
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const markQuarterlyAuditReady = api(
  { expose: true, auth: true, method: "POST", path: "/quarterly-reviews/audits/:auditId/ready" },
  async (request: AuditTransitionRequest): Promise<AuditStatusTransitionResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      await requireAuditCapability(principal, request.auditId, capability.quarterlyAuditConduct);
      return markAuditReadyWorkflow({
        organisationId: principal.organisationId,
        auditId: request.auditId,
        actorPrincipalId: principal.principalId,
        expectedLockVersion: request.lockVersion,
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const finaliseQuarterlyAudit = api(
  { expose: true, auth: true, method: "POST", path: "/quarterly-reviews/audits/:auditId/finalise" },
  async (request: AuditTransitionRequest): Promise<FinaliseQuarterlyAuditResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      await requireAuditCapability(principal, request.auditId, capability.quarterlyAuditFinalise);
      return finaliseQuarterlyAuditWorkflow({
        organisationId: principal.organisationId,
        auditId: request.auditId,
        actorPrincipalId: principal.principalId,
        expectedLockVersion: request.lockVersion,
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const acknowledgeQuarterlyAudit = api(
  { expose: true, auth: true, method: "POST", path: "/quarterly-reviews/audits/:auditId/acknowledge" },
  async (request: AcknowledgeAuditRequest): Promise<AcknowledgeAuditResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      const identity = await requireAuditCapability(
        principal,
        request.auditId,
        capability.quarterlyAuditAcknowledge,
      );
      return acknowledgeAuditWorkflow({
        organisationId: principal.organisationId,
        centreId: identity.centre_id,
        auditId: request.auditId,
        actorPrincipalId: principal.principalId,
        ...(request.comment ? { comment: request.comment } : {}),
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const listMyCorrectiveActions = api(
  { expose: true, auth: true, method: "GET", path: "/corrective-actions/mine" },
  async (): Promise<ListCorrectiveActionsResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      const candidates = await listCorrectiveActionsForPrincipal({
        organisationId: principal.organisationId,
        principalId: principal.principalId,
      });
      return {
        actions: await filterCentreResourcesByCapability(
          principal,
          candidates,
          capability.correctiveActionRemediate,
        ),
      };
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

async function requireActionCapability(
  principal: Awaited<ReturnType<typeof requireBusinessPrincipal>>,
  actionId: string,
  requiredCapability: Parameters<typeof requireCentreCapability>[2],
) {
  actionId = requireUuid(actionId, "corrective action ID");
  const action = await loadActionCentre(principal.organisationId, actionId);
  await requireCentreCapability(principal, action.centreId, requiredCapability);
  return action;
}

export const getCorrectiveAction = api(
  { expose: true, auth: true, method: "GET", path: "/corrective-actions/:actionId" },
  async ({ actionId }: CorrectiveActionIdRequest): Promise<CorrectiveActionDetail> => {
    try {
      const principal = await requireBusinessPrincipal();
      await requireActionCapability(principal, actionId, capability.correctiveActionRead);
      return loadCorrectiveActionDetail(principal.organisationId, actionId, principal.principalId);
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const startCorrectiveAction = api(
  { expose: true, auth: true, method: "POST", path: "/corrective-actions/:actionId/start" },
  async (request: StartCorrectiveActionRequest): Promise<ActionTransitionResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      await requireActionCapability(principal, request.actionId, capability.correctiveActionRemediate);
      return startCorrectiveActionWorkflow({
        organisationId: principal.organisationId, actionId: request.actionId,
        actorPrincipalId: principal.principalId, expectedLockVersion: request.lockVersion,
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const submitCorrectiveActionEvidence = api(
  { expose: true, auth: true, method: "POST", path: "/corrective-actions/:actionId/submit" },
  async (request: SubmitCorrectiveActionRequest): Promise<ActionTransitionResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      await requireActionCapability(principal, request.actionId, capability.correctiveActionRemediate);
      return submitCorrectiveActionWorkflow({
        organisationId: principal.organisationId, actionId: request.actionId,
        actorPrincipalId: principal.principalId, expectedLockVersion: request.lockVersion,
        remediationNote: request.remediationNote,
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const listCorrectiveActionVerificationQueue = api(
  { expose: true, auth: true, method: "GET", path: "/corrective-actions/verification-queue" },
  async (): Promise<ListCorrectiveActionsResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      const candidates = await listCorrectiveActionsForPrincipal({
        organisationId: principal.organisationId,
        verificationOnly: true,
      });
      return {
        actions: await filterCentreResourcesByCapability(
          principal,
          candidates,
          capability.correctiveActionVerify,
        ),
      };
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const verifyAndCloseCorrectiveAction = api(
  { expose: true, auth: true, method: "POST", path: "/corrective-actions/:actionId/verify" },
  async (request: VerifyCorrectiveActionRequest): Promise<ActionTransitionResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      await requireActionCapability(principal, request.actionId, capability.correctiveActionVerify);
      return verifyAndCloseCorrectiveActionWorkflow({
        organisationId: principal.organisationId, actionId: request.actionId,
        actorPrincipalId: principal.principalId, expectedLockVersion: request.lockVersion,
        ...(request.verificationNote ? { verificationNote: request.verificationNote } : {}),
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const returnCorrectiveAction = api(
  { expose: true, auth: true, method: "POST", path: "/corrective-actions/:actionId/return" },
  async (request: ReturnCorrectiveActionRequest): Promise<ActionTransitionResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      await requireActionCapability(principal, request.actionId, capability.correctiveActionVerify);
      return returnCorrectiveActionWorkflow({
        organisationId: principal.organisationId, actionId: request.actionId,
        actorPrincipalId: principal.principalId, expectedLockVersion: request.lockVersion,
        reason: request.reason,
        disposition: request.disposition ?? "MORE_INFORMATION_REQUIRED",
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

async function requireEvidenceTargetCapability(
  principal: Awaited<ReturnType<typeof requireBusinessPrincipal>>,
  targetType: "AUDIT_RESPONSE" | "CORRECTIVE_ACTION",
  targetId: string,
  mode: "upload" | "read",
): Promise<string> {
  if (targetType === "CORRECTIVE_ACTION") {
    const action = await requireActionCapability(
      principal,
      targetId,
      mode === "upload" ? capability.evidenceUpload : capability.evidenceRead,
    );
    if (mode === "upload" && action.ownerPrincipalId !== principal.principalId) {
      throw new QuarterlyReviewError("access_denied", "evidence target is not available");
    }
    return action.centreId;
  }
  const response = await centreSuccessDB.queryRow<{ centre_id: string; auditor_principal_id: string }>`
    SELECT run.centre_id, run.auditor_principal_id
    FROM audit_responses AS response
    JOIN audit_runs AS run
      ON run.organisation_id = response.organisation_id AND run.id = response.audit_run_id
    WHERE response.organisation_id = ${principal.organisationId} AND response.id = ${targetId}
  `;
  if (!response) throw new QuarterlyReviewError("not_found", "evidence target is not available");
  await requireCentreCapability(
    principal,
    response.centre_id,
    mode === "upload" ? capability.quarterlyAuditConduct : capability.evidenceRead,
  );
  if (mode === "upload" && response.auditor_principal_id !== principal.principalId) {
    throw new QuarterlyReviewError("access_denied", "evidence target is not available");
  }
  return response.centre_id;
}

export const requestEvidenceUpload = api(
  { expose: true, auth: true, method: "POST", path: "/evidence/uploads" },
  async (request: RequestEvidenceUploadRequest): Promise<RequestEvidenceUploadResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      const targetId = requireUuid(request.targetId, "evidence target ID");
      const centreId = await requireEvidenceTargetCapability(
        principal, request.targetType, targetId, "upload",
      );
      return requestEvidenceUploadWorkflow({
        organisationId: principal.organisationId, centreId,
        actorPrincipalId: principal.principalId, request: { ...request, targetId },
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const completeEvidenceUpload = api(
  { expose: true, auth: true, method: "POST", path: "/evidence/:evidenceId/complete" },
  async ({ evidenceId }: CompleteEvidenceUploadRequest): Promise<CompleteEvidenceUploadResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      evidenceId = requireUuid(evidenceId, "evidence ID");
      const target = await loadEvidenceTarget(principal.organisationId, evidenceId);
      await requireEvidenceTargetCapability(principal, target.targetType, target.targetId, "upload");
      return completeEvidenceUploadWorkflow({
        organisationId: principal.organisationId, centreId: target.centreId,
        evidenceId, actorPrincipalId: principal.principalId,
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const getEvidenceAccess = api(
  { expose: true, auth: true, method: "GET", path: "/evidence/:evidenceId/access" },
  async ({ evidenceId }: GetEvidenceAccessRequest): Promise<GetEvidenceAccessResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      evidenceId = requireUuid(evidenceId, "evidence ID");
      const target = await loadEvidenceTarget(principal.organisationId, evidenceId);
      await requireEvidenceTargetCapability(principal, target.targetType, target.targetId, "read");
      return getEvidenceAccessWorkflow({
        organisationId: principal.organisationId, centreId: target.centreId,
        evidenceId, actorPrincipalId: principal.principalId,
      });
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);

export const getComplianceOversight = api(
  { expose: true, auth: true, method: "GET", path: "/compliance/quarterly-reviews" },
  async (): Promise<ComplianceOversightResponse> => {
    try {
      const principal = await requireBusinessPrincipal();
      requireOrganisationCapability(principal, capability.complianceOversightRead);
      return loadComplianceOversight(principal.organisationId);
    } catch (error) {
      return toQuarterlyReviewApiError(error);
    }
  },
);
