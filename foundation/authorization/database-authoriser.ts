import { loadOrganisationCentreAuthorisationFacts } from "./batch-centres";
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

export interface AuthoriseCentresFromDatabaseInput {
  principalId: string;
  activeOrganisationId: string;
  /** The centres actually being considered. Order and duplicates are irrelevant. */
  centreIds: readonly string[];
  capability: FoundationCapability;
  /** Trusted server/test clock; never take this value from a public request. */
  at?: Date;
}

/**
 * The set-wise counterpart to `authoriseCentreFromDatabase`.
 *
 * A multi-record list boundary that calls the single-centre authoriser once per
 * candidate opens one repeatable-read snapshot per candidate, and re-reads the
 * same principal context and the same hierarchy inside every one of them. The
 * cost grows linearly with the portfolio while the answer is derived from facts
 * that do not change between candidates.
 *
 * This resolves the principal's effective context and every centre's ancestry
 * once, in a single snapshot, and then evaluates the pure policy per centre. It
 * is the same seam the read-side projections already use.
 *
 * It fails closed exactly as the single-centre path does, and by the same
 * reasoning:
 *
 * - a context failure denies every centre rather than some of them, because a
 *   principal whose context cannot be established has no authority anywhere;
 * - a centre that is inactive, ambiguously placed, cyclic, or under an inactive
 *   unit never appears in the resolved facts, so it is never allowed — matching
 *   the single-centre `invalid_resource` denial;
 * - only an explicit `allowed` decision puts a centre in the returned set.
 *
 * Callers receive allowed identifiers only. Nothing distinguishes "denied" from
 * "does not exist", which is what keeps a collection from disclosing rows the
 * reader may not see.
 */
export async function authoriseCentresFromDatabase(
  input: AuthoriseCentresFromDatabaseInput,
  now: () => Date = () => new Date(),
): Promise<ReadonlySet<string>> {
  const requested = new Set(input.centreIds);
  if (requested.size === 0) return new Set();

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
      const facts = await loadOrganisationCentreAuthorisationFacts(
        executor,
        input.activeOrganisationId,
        decisionAt,
      );

      const allowed = new Set<string>();
      for (const centre of facts.centres) {
        if (!requested.has(centre.id)) continue;
        const decision = authorise({
          context,
          capability: input.capability,
          resource: centre.resource,
          at: decisionAt,
        });
        if (decision.allowed) allowed.add(centre.id);
      }
      return allowed;
    } catch (error) {
      // Deny everything rather than partially: a context or hierarchy failure
      // says the decision could not be made, not that it came back negative.
      if (
        error instanceof AuthorisationContextError ||
        error instanceof CentreResourceContextError
      ) {
        return new Set<string>();
      }

      throw error;
    }
  });
}
