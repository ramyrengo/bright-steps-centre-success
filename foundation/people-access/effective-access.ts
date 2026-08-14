import {
  loadOrganisationCentreAuthorisationFacts,
  type CentreAuthorisationIssueReason,
} from "../authorization/batch-centres";
import { FOUNDATION_CAPABILITIES } from "../authorization/capabilities";
import type { FoundationCapability } from "../authorization/capabilities";
import {
  AuthorisationContextError,
  loadPrincipalAuthorisationContextFromSnapshot,
} from "../authorization/context-loader";
import type { AuthorisationContextFailureCode } from "../authorization/context-loader";
import { withAuthorisationSnapshot } from "../authorization/database";
import { authorise } from "../authorization/policy";
import type {
  DenyReason,
  PrincipalAuthorisationContext,
} from "../authorization/policy";

/**
 * Why no capability could be evaluated at all. Each value is a state the
 * authorisation context loader refuses to build a context for, which is also
 * the answer to the support question that prompted the lookup — "cannot sign
 * in" is usually `principal_inactive` or `membership_missing`.
 */
export type EffectiveAccessBlocker = AuthorisationContextFailureCode;

/** One authorisation decision, reported exactly as the policy returned it. */
export type EffectiveAccessDecision =
  | { allowed: true; assignmentId: string; roleKey: string }
  | { allowed: false; reason: DenyReason };

export interface EffectiveCentreAccess {
  centreId: string;
  centreName: string;
  decision: EffectiveAccessDecision;
}

export interface EffectiveCapabilityAccess {
  capability: FoundationCapability;
  organisation: EffectiveAccessDecision;
  centres: EffectiveCentreAccess[];
}

/**
 * A centre deliberately left out of the matrix because its hierarchy could not
 * be resolved. It is reported rather than dropped: an administrator reading
 * "allowed at no centre" must be able to tell a real denial from a centre this
 * report never managed to ask about.
 */
export interface UnevaluatedCentre {
  centreId: string;
  centreName: string;
  reason: CentreAuthorisationIssueReason;
}

/**
 * The report is a union rather than one shape with optional fields so that a
 * blocked lookup cannot be read as "this person has no access anywhere". An
 * empty capability list is a conclusion; a blocker is the absence of one.
 */
export type EffectiveAccessReport =
  | {
      evaluated: false;
      principalId: string;
      evaluatedAt: string;
      blockedBy: EffectiveAccessBlocker;
    }
  | {
      evaluated: true;
      principalId: string;
      evaluatedAt: string;
      capabilities: EffectiveCapabilityAccess[];
      unevaluatedCentres: UnevaluatedCentre[];
    };

const EVALUATED_CAPABILITIES: readonly FoundationCapability[] = Object.values(
  FOUNDATION_CAPABILITIES,
)
  .slice()
  .sort();

/**
 * Reports what a principal can currently do, by asking the same policy the
 * enforcement path asks.
 *
 * The report calls `authorise` rather than re-deriving access from assignments
 * and role bundles. A second implementation would answer confidently and, the
 * first time the two drifted, answer wrongly — and an access diagnostic is
 * consulted precisely when someone already doubts what the system is doing.
 *
 * Every capability and every centre is evaluated from one repeatable-read
 * snapshot, so the matrix cannot contain two mutually inconsistent rows, and
 * centre ancestry is resolved set-wise rather than one query per centre.
 *
 * This reports on access only. It reads no business content and grants the
 * caller nothing, which is what keeps it inside ADR-0009: an administrator
 * administers access, they do not read what the person can see.
 */
export async function getEffectiveAccess(input: {
  organisationId: string;
  principalId: string;
  at?: Date;
}): Promise<EffectiveAccessReport> {
  const at = input.at ?? new Date();
  const evaluatedAt = at.toISOString();

  return withAuthorisationSnapshot(async (executor) => {
    let context: PrincipalAuthorisationContext;
    try {
      context = await loadPrincipalAuthorisationContextFromSnapshot(executor, {
        principalId: input.principalId,
        activeOrganisationId: input.organisationId,
        at,
      });
    } catch (error) {
      if (error instanceof AuthorisationContextError) {
        return {
          evaluated: false as const,
          principalId: input.principalId,
          evaluatedAt,
          blockedBy: error.code,
        };
      }
      throw error;
    }

    const facts = await loadOrganisationCentreAuthorisationFacts(
      executor,
      input.organisationId,
      at,
    );

    const capabilities = EVALUATED_CAPABILITIES.map((capability) => ({
      capability,
      organisation: authorise({
        context,
        capability,
        resource: { kind: "organisation", organisationId: input.organisationId },
        at,
      }),
      centres: facts.centres.map((centre) => ({
        centreId: centre.id,
        centreName: centre.name,
        decision: authorise({ context, capability, resource: centre.resource, at }),
      })),
    }));

    return {
      evaluated: true as const,
      principalId: input.principalId,
      evaluatedAt,
      capabilities,
      unevaluatedCentres: facts.invalidCentres.map((centre) => ({
        centreId: centre.id,
        centreName: centre.name,
        reason: centre.reason,
      })),
    };
  });
}
