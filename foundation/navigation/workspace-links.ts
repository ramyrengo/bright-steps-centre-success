import { FOUNDATION_CAPABILITIES, type FoundationCapability } from "../authorization/capabilities";

/**
 * The one place that decides which Centre Success destinations a principal may
 * see. Daily Success and the navigation projection both call it, so the two
 * can never drift into offering different link sets for the same principal.
 *
 * A link is presentation only. Every destination reauthorises server-side, and
 * nothing here is derived from a role name.
 */

export interface WorkspaceLink {
  label: string;
  route: string;
}

/** The only two facts a link decision needs. */
export interface WorkspaceLinkAuthorisation {
  centreIdsByCapability: ReadonlyMap<FoundationCapability, ReadonlySet<string>>;
  organisationCapabilities: ReadonlySet<FoundationCapability>;
}

/** Centre-scoped capabilities a caller must evaluate before deriving links. */
export const WORKSPACE_LINK_CENTRE_CAPABILITIES = [
  FOUNDATION_CAPABILITIES.correctiveActionRead,
  FOUNDATION_CAPABILITIES.quarterlyAuditRead,
  FOUNDATION_CAPABILITIES.correctiveActionRemediate,
  FOUNDATION_CAPABILITIES.quarterlyAuditConduct,
  FOUNDATION_CAPABILITIES.budgetPositionRead,
] as const;

/** Organisation-scoped capabilities a caller must evaluate before deriving links. */
export const WORKSPACE_LINK_ORGANISATION_CAPABILITIES = [
  FOUNDATION_CAPABILITIES.complianceOversightRead,
  FOUNDATION_CAPABILITIES.invitationRead,
  FOUNDATION_CAPABILITIES.principalRead,
] as const;

function holdsAnyCentre(
  authorisation: WorkspaceLinkAuthorisation,
  capability: FoundationCapability,
): boolean {
  return (authorisation.centreIdsByCapability.get(capability)?.size ?? 0) > 0;
}

export function deriveWorkspaceLinks(
  authorisation: WorkspaceLinkAuthorisation,
): WorkspaceLink[] {
  const links: WorkspaceLink[] = [];
  if (
    holdsAnyCentre(authorisation, FOUNDATION_CAPABILITIES.correctiveActionRead) ||
    holdsAnyCentre(authorisation, FOUNDATION_CAPABILITIES.quarterlyAuditRead) ||
    authorisation.organisationCapabilities.has(FOUNDATION_CAPABILITIES.complianceOversightRead)
  ) {
    links.push({ label: "Quality & Performance", route: "/quality" });
  }
  if (holdsAnyCentre(authorisation, FOUNDATION_CAPABILITIES.correctiveActionRemediate)) {
    links.push({ label: "Centre actions", route: "/centre" });
  }
  if (holdsAnyCentre(authorisation, FOUNDATION_CAPABILITIES.quarterlyAuditConduct)) {
    links.push({ label: "Area Manager reviews", route: "/area-manager" });
  }
  // The capability that guards the budget read endpoints themselves, so the
  // link and the destination can never disagree about who may see budget
  // content. `budget.summary.read` is the older synthetic Finance marker and
  // deliberately confers nothing here. No canonical System Administrator bundle
  // holds `budget.position.read`, so technical administration produces no link.
  if (holdsAnyCentre(authorisation, FOUNDATION_CAPABILITIES.budgetPositionRead)) {
    links.push({ label: "Budgets", route: "/budgets" });
  }
  if (authorisation.organisationCapabilities.has(FOUNDATION_CAPABILITIES.complianceOversightRead)) {
    links.push({ label: "Compliance oversight", route: "/compliance" });
  }
  if (
    authorisation.organisationCapabilities.has(FOUNDATION_CAPABILITIES.invitationRead) &&
    authorisation.organisationCapabilities.has(FOUNDATION_CAPABILITIES.principalRead)
  ) {
    links.push({ label: "People & Access", route: "/admin/people" });
  }
  return links;
}
