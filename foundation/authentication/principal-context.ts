import { loadPrincipalAuthorisationContextFromSnapshot } from "../authorization/context-loader";
import { withAuthorisationSnapshot } from "../authorization/database";
import type { PrincipalAuthorisationContext } from "../authorization/policy";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type AuthenticatedPrincipalContextFailureCode =
  | "principal_unavailable"
  | "active_organisation_ambiguous";

export class AuthenticatedPrincipalContextError extends Error {
  readonly code: AuthenticatedPrincipalContextFailureCode;

  constructor(code: AuthenticatedPrincipalContextFailureCode) {
    super(`authenticated principal context rejected: ${code}`);
    this.name = "AuthenticatedPrincipalContextError";
    this.code = code;
  }
}

interface PrincipalRow {
  id: string;
  display_name: string;
  status: "active" | "inactive";
}

interface ActiveOrganisationRow {
  id: string;
  name: string;
}

export interface ProvisionedAuthenticatedPrincipalContext {
  provisioningStatus: "provisioned";
  principal: {
    id: string;
    displayName: string;
  };
  activeOrganisation: {
    id: string;
    name: string;
  };
  authorisation: PrincipalAuthorisationContext;
}

export interface UnprovisionedAuthenticatedPrincipalContext {
  provisioningStatus: "not_provisioned";
}

export type AuthenticatedPrincipalContext =
  | ProvisionedAuthenticatedPrincipalContext
  | UnprovisionedAuthenticatedPrincipalContext;

/**
 * Resolves the gate's active tenant server-side. Until a reviewed tenant
 * selector exists, zero memberships yields an identity-only not-provisioned
 * state and more than one active organisation fails closed.
 */
export async function loadAuthenticatedPrincipalContext(
  principalId: string,
  at?: Date,
  now: () => Date = () => new Date(),
): Promise<AuthenticatedPrincipalContext> {
  if (!CANONICAL_UUID.test(principalId)) {
    throw new AuthenticatedPrincipalContextError("principal_unavailable");
  }

  return withAuthorisationSnapshot(async (executor) => {
    const decisionAt = at ?? now();
    const principal = await executor.queryRow<PrincipalRow>`
      SELECT id, display_name, status
      FROM principals
      WHERE id = ${principalId}
    `;

    if (principal === null || principal.status !== "active") {
      throw new AuthenticatedPrincipalContextError("principal_unavailable");
    }

    const organisations = await executor.queryAll<ActiveOrganisationRow>`
      SELECT DISTINCT organisation.id, organisation.name
      FROM organisation_memberships AS membership
      JOIN organisations AS organisation
        ON organisation.id = membership.organisation_id
      WHERE membership.principal_id = ${principal.id}
        AND membership.status = 'active'
        AND membership.effective_from <= ${decisionAt}
        AND (membership.effective_to IS NULL OR membership.effective_to > ${decisionAt})
        AND organisation.status = 'active'
      ORDER BY organisation.id
    `;

    if (organisations.length === 0) {
      return { provisioningStatus: "not_provisioned" };
    }

    if (organisations.length !== 1) {
      throw new AuthenticatedPrincipalContextError("active_organisation_ambiguous");
    }

    const activeOrganisation = organisations[0];
    const authorisation: PrincipalAuthorisationContext =
      await loadPrincipalAuthorisationContextFromSnapshot(executor, {
        principalId: principal.id,
        activeOrganisationId: activeOrganisation.id,
        at: decisionAt,
      });

    return {
      provisioningStatus: "provisioned",
      principal: {
        id: principal.id,
        displayName: principal.display_name,
      },
      activeOrganisation,
      authorisation,
    };
  });
}
