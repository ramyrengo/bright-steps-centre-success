import {
  FOUNDATION_CAPABILITIES as capability,
  type FoundationCapability,
} from "./capabilities";

export interface CanonicalRoleBundle {
  key: string;
  name: string;
  version: number;
  capabilities: readonly FoundationCapability[];
}

export const CANONICAL_ROLE_BUNDLES = [
  {
    key: "educator",
    name: "Educator",
    version: 1,
    capabilities: [capability.centreRead],
  },
  {
    key: "assistant_director",
    name: "Assistant Director",
    version: 1,
    capabilities: [capability.centreRead],
  },
  {
    key: "centre_director",
    name: "Centre Director",
    version: 2,
    capabilities: [
      capability.centreRead,
      capability.centreManage,
      capability.quarterlyAuditRead,
      capability.quarterlyAuditAcknowledge,
      capability.findingRead,
      capability.correctiveActionRead,
      capability.correctiveActionRemediate,
      capability.evidenceRead,
      capability.evidenceUpload,
    ],
  },
  {
    key: "area_manager",
    name: "Area Manager",
    version: 2,
    capabilities: [
      capability.centreRead,
      capability.quarterlyAuditRead,
      capability.quarterlyAuditConduct,
      capability.quarterlyAuditFinalise,
      capability.findingRead,
      capability.correctiveActionRead,
      capability.correctiveActionVerify,
      capability.evidenceRead,
    ],
  },
  {
    key: "compliance_manager",
    name: "Compliance Manager",
    version: 2,
    capabilities: [
      capability.organisationRead,
      capability.centreRead,
      capability.quarterlyAuditRead,
      capability.findingRead,
      capability.correctiveActionRead,
      capability.correctiveActionVerify,
      capability.evidenceRead,
      capability.complianceOversightRead,
    ],
  },
  {
    key: "operations_leadership",
    name: "Operations Leadership",
    version: 1,
    capabilities: [
      capability.organisationRead,
      capability.centreRead,
      capability.assignmentRead,
    ],
  },
  {
    key: "finance",
    name: "Finance",
    version: 1,
    capabilities: [
      capability.organisationRead,
      capability.centreRead,
      capability.budgetSummaryRead,
    ],
  },
  {
    key: "executive",
    name: "Executive",
    version: 1,
    capabilities: [capability.organisationRead, capability.centreRead],
  },
  {
    key: "system_administrator",
    name: "System Administrator",
    version: 2,
    capabilities: [
      capability.principalRead,
      capability.principalManage,
      capability.identityMappingManage,
      capability.assignmentRead,
      capability.assignmentManage,
      capability.systemConfigure,
      capability.systemHealthRead,
      capability.invitationRead,
      capability.invitationManage,
      capability.accessHistoryRead,
      capability.privilegedAccessApprove,
    ],
  },
] as const satisfies readonly CanonicalRoleBundle[];

export type CanonicalRoleKey = (typeof CANONICAL_ROLE_BUNDLES)[number]["key"];

export function canonicalRoleBundle(
  key: CanonicalRoleKey,
): (typeof CANONICAL_ROLE_BUNDLES)[number] {
  const bundle = CANONICAL_ROLE_BUNDLES.find((candidate) => candidate.key === key);

  if (bundle === undefined) {
    throw new Error(`unknown canonical role: ${key}`);
  }

  return bundle;
}
