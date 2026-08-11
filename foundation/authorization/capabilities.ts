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
