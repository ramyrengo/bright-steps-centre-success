export const FOUNDATION_CAPABILITIES = {
  organisationRead: "organisation.read",
  centreRead: "centre.read",
  centreManage: "centre.manage",
  principalRead: "principal.read",
  principalManage: "principal.manage",
  identityMappingManage: "identity.mapping.manage",
  assignmentRead: "assignment.read",
  assignmentManage: "assignment.manage",
  systemConfigure: "system.configure",
  systemHealthRead: "system.health.read",
  budgetSummaryRead: "budget.summary.read",
  quarterlyAuditRead: "quarterly_audit.read",
  quarterlyAuditConduct: "quarterly_audit.conduct",
  quarterlyAuditFinalise: "quarterly_audit.finalise",
  quarterlyAuditAcknowledge: "quarterly_audit.acknowledge",
  findingRead: "finding.read",
  correctiveActionRead: "corrective_action.read",
  correctiveActionRemediate: "corrective_action.remediate",
  correctiveActionVerify: "corrective_action.verify",
  evidenceRead: "evidence.read",
  evidenceUpload: "evidence.upload",
  complianceOversightRead: "compliance.oversight.read",
  operationalCheckRead: "operational_check.read",
  operationalCheckComplete: "operational_check.complete",
  invitationRead: "invitation.read",
  invitationManage: "invitation.manage",
  accessHistoryRead: "access_history.read",
  privilegedAccessApprove: "privileged_access.approve",
  accessChangeRequest: "access.change.request",
} as const;

export type FoundationCapability =
  (typeof FOUNDATION_CAPABILITIES)[keyof typeof FOUNDATION_CAPABILITIES];

const foundationCapabilityCodes = new Set<string>(
  Object.values(FOUNDATION_CAPABILITIES),
);

export function isFoundationCapability(
  value: string,
): value is FoundationCapability {
  return foundationCapabilityCodes.has(value);
}
