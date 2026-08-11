import type { FoundationCapability } from "./capabilities";
import {
  AuthorisationContextError,
  loadPrincipalAuthorisationContextFromSnapshot,
} from "./context-loader";
import { withAuthorisationSnapshot } from "./database";
import {
  CentreResourceContextError,
  loadCentreAuthorisationResourceFromSnapshot,
} from "./hierarchy";
import {
  authorise,
  type AuthorisationDecision,
  type DenyReason,
} from "./policy";

export interface AuthoriseCentreFromDatabaseInput {
  principalId: string;
  activeOrganisationId: string;
  centreId: string;
  capability: FoundationCapability;
  /** Trusted server/test clock; never take this value from a public request. */
  at?: Date;
}

function contextFailureReason(error: AuthorisationContextError): DenyReason {
  switch (error.code) {
    case "principal_inactive":
      return "principal_inactive";
    case "membership_missing":
      return "membership_missing";
    case "membership_ambiguous":
      return "membership_ambiguous";
    default:
      return "invalid_context";
  }
}

/**
 * Proves the internal database-to-policy authorization seam. It is not an API
 * and must only receive a principal established by a future trusted server
 * authentication context or by synthetic tests. The optional clock is a test
 * seam; production callers omit it and cannot source decision time from a
 * public request.
 */
export async function authoriseCentreFromDatabase(
  input: AuthoriseCentreFromDatabaseInput,
  now: () => Date = () => new Date(),
): Promise<AuthorisationDecision> {
  return withAuthorisationSnapshot(async (executor) => {
    const decisionAt = input.at ?? now();

    try {
      const context = await loadPrincipalAuthorisationContextFromSnapshot(
        executor,
        {
          principalId: input.principalId,
          activeOrganisationId: input.activeOrganisationId,
          at: decisionAt,
        },
      );
      const resource = await loadCentreAuthorisationResourceFromSnapshot(
        executor,
        {
          organisationId: input.activeOrganisationId,
          centreId: input.centreId,
          at: decisionAt,
        },
      );

      return authorise({
        context,
        capability: input.capability,
        resource,
        at: decisionAt,
      });
    } catch (error) {
      if (error instanceof AuthorisationContextError) {
        return { allowed: false, reason: contextFailureReason(error) };
      }

      if (error instanceof CentreResourceContextError) {
        return { allowed: false, reason: "invalid_resource" };
      }

      throw error;
    }
  });
}
