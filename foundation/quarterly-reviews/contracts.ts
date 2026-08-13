import type {
  AuditOutcome,
  AuditRiskStatus,
  AuditStatus,
  CorrectiveActionStatus,
  FindingStatus,
  FindingSeverity,
} from "./types";

export interface AuditCentreSummary {
  id: string;
  name: string;
  previousAuditDate?: string;
  previousScore?: number;
  openCorrectiveActions: number;
}

export interface ListAuditCentresResponse {
  centres: AuditCentreSummary[];
}

export interface AuditPreparationResponse {
  centre: { id: string; name: string };
  activeTemplate: { id: string; title: string; version: number; synthetic: boolean };
  previousAudit?: { id: string; finalisedAt: string; score?: number };
  openCorrectiveActions: number;
}

export interface AuditOwnerCandidate {
  principalId: string;
  displayName: string;
}

export interface AuditItemView {
  id: string;
  lineageKey: string;
  wording: string;
  instructions?: string;
  weight: number;
  scored: boolean;
  critical: boolean;
  evidenceRequirement: "none" | "optional" | "required";
  allowedOutcomes: AuditOutcome[];
  response?: {
    id: string;
    outcome: AuditOutcome;
    comment?: string;
    locationContext?: string;
    selectedOwnerPrincipalId?: string;
    lockVersion: number;
  };
  finding?: {
    id: string;
    severity: FindingSeverity;
    status: FindingStatus;
    repeatCount: number;
    actionId?: string;
  };
}

export interface AuditSectionView {
  id: string;
  title: string;
  instructions?: string;
  items: AuditItemView[];
  score?: number;
}

export interface QuarterlyAuditView {
  id: string;
  centre: { id: string; name: string };
  template: {
    id: string;
    title: string;
    version: number;
    synthetic: boolean;
    sourceClassification: string;
  };
  status: AuditStatus;
  reviewPeriodStart: string;
  lockVersion: number;
  progress: { answered: number; total: number };
  score?: number;
  coveragePercent?: number;
  riskStatus?: AuditRiskStatus;
  performanceBand?: { code: string; label: string };
  previousComparison?: {
    auditId: string;
    score?: number;
    difference?: number;
  };
  ownerCandidates: AuditOwnerCandidate[];
  sections: AuditSectionView[];
  positivePractices: Array<{ id: string; description: string }>;
  acknowledged: boolean;
}

export interface StartQuarterlyAuditRequest {
  centreId: string;
}

export interface StartQuarterlyAuditResponse {
  auditId: string;
  status: AuditStatus;
  created: boolean;
}

export interface AuditIdRequest {
  auditId: string;
}

export interface AuditTransitionRequest extends AuditIdRequest {
  lockVersion: number;
}

export interface AuditStatusTransitionResponse {
  status: AuditStatus;
  lockVersion: number;
}

export interface FinaliseQuarterlyAuditResponse {
  auditId: string;
  status: "FINALISED";
  score: number | null;
  riskStatus: AuditRiskStatus;
}

export interface SaveAuditResponseRequest {
  auditId: string;
  itemId: string;
  outcome: AuditOutcome;
  comment?: string;
  locationContext?: string;
  selectedOwnerPrincipalId?: string;
  responseLockVersion?: number;
  responseCorrectionReason?: string;
}

export interface SaveAuditResponseResponse {
  responseId: string;
  lockVersion: number;
  auditStatus: AuditStatus;
  immediateFindingCreated: boolean;
  immediateActionCreated: boolean;
  ownerResolutionRequired: boolean;
}

export interface CorrectiveActionSummary {
  id: string;
  centreId: string;
  centreName: string;
  title: string;
  severity: FindingSeverity;
  dueAt: string;
  status: CorrectiveActionStatus;
  ownerPrincipalId?: string;
  verificationRequired: boolean;
  submittedAt?: string;
}

export interface CorrectiveActionDetail extends CorrectiveActionSummary {
  finding: {
    id: string;
    description: string;
    itemLineageKey: string;
    repeatCount: number;
    origin:
      | {
          source: "QUARTERLY_AUDIT";
          label: "Quarterly review";
          quarterLabel: string;
          auditId: string;
          auditStatus: AuditStatus;
          acknowledged: boolean;
        }
      | {
          source: "OPERATIONAL_CHECK";
          label: "Centre Standard";
          occurrenceId: string;
          standardName: string;
          businessDate: string;
          synthetic: boolean;
        };
  };
  requiredRemediation: string;
  evidenceRequirement: "none" | "optional" | "required";
  lockVersion: number;
  evidence: Array<{
    id: string;
    filename: string;
    mediaType: string;
    byteSize?: number;
    scanStatus: "not_scanned" | "clean" | "rejected";
    availabilityStatus: string;
  }>;
  history: Array<{
    eventType: string;
    fromStatus?: string;
    toStatus: string;
    reason?: string;
    occurredAt: string;
  }>;
}

export interface ListCorrectiveActionsResponse {
  actions: CorrectiveActionSummary[];
}

export interface CorrectiveActionIdRequest {
  actionId: string;
}

export interface StartCorrectiveActionRequest extends CorrectiveActionIdRequest {
  lockVersion: number;
}

export interface SubmitCorrectiveActionRequest extends CorrectiveActionIdRequest {
  lockVersion: number;
  remediationNote: string;
}

export interface ReturnCorrectiveActionRequest extends CorrectiveActionIdRequest {
  lockVersion: number;
  reason: string;
  disposition?: "MORE_INFORMATION_REQUIRED" | "REJECTED";
}

export interface VerifyCorrectiveActionRequest extends CorrectiveActionIdRequest {
  lockVersion: number;
  verificationNote?: string;
}

export interface ActionTransitionResponse {
  actionId: string;
  status: CorrectiveActionStatus;
  lockVersion: number;
}

export interface AcknowledgeAuditRequest extends AuditIdRequest {
  comment?: string;
}

export interface AcknowledgeAuditResponse {
  acknowledgementId: string;
  acknowledgedAt: string;
}

export interface RequestEvidenceUploadRequest {
  targetType: "AUDIT_RESPONSE" | "CORRECTIVE_ACTION";
  targetId: string;
  filename: string;
  mediaType: "image/jpeg" | "image/png" | "application/pdf";
}

export interface RequestEvidenceUploadResponse {
  evidenceId: string;
  uploadUrl: string;
  expiresInSeconds: number;
}

export interface CompleteEvidenceUploadRequest {
  evidenceId: string;
}

export interface CompleteEvidenceUploadResponse {
  evidenceId: string;
  scanStatus: "not_scanned" | "clean" | "rejected";
  availabilityStatus: string;
  warning?: string;
}

export interface GetEvidenceAccessRequest {
  evidenceId: string;
}

export interface GetEvidenceAccessResponse {
  downloadUrl: string;
  expiresInSeconds: number;
  scanStatus: "not_scanned" | "clean";
  warning?: string;
}

export interface ComplianceOversightResponse {
  counts: {
    completed: number;
    inProgress: number;
    outstanding: number;
    centresBelowInternalThreshold: number;
    criticalFindings: number;
    highFindings: number;
    openCorrectiveActions: number;
    overdueCorrectiveActions: number;
    awaitingVerification: number;
  };
  centres: Array<{
    centreId: string;
    centreName: string;
    latestAuditId?: string;
    latestScore?: number;
    riskStatus?: AuditRiskStatus;
    openActions: number;
    overdueActions: number;
  }>;
}
