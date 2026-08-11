import { APIError } from "encore.dev/api";
import { getAuthData } from "~encore/auth";
import { FOUNDATION_CAPABILITIES, type FoundationCapability } from "../authorization/capabilities";
import { authoriseCentreFromDatabase } from "../authorization/database-authoriser";
import { authorise } from "../authorization/policy";
import type { CentreSuccessAuthData } from "../authentication/auth-handler";
import {
  AuthenticatedPrincipalContextError,
  loadAuthenticatedPrincipalContext,
  type ProvisionedAuthenticatedPrincipalContext,
} from "../authentication/principal-context";
import { QuarterlyReviewError } from "./types";

export interface BusinessPrincipal {
  principalId: string;
  organisationId: string;
  context: ProvisionedAuthenticatedPrincipalContext;
}

export async function requireBusinessPrincipal(): Promise<BusinessPrincipal> {
  const authData = getAuthData() as CentreSuccessAuthData | null;
  if (!authData) throw APIError.unauthenticated("authentication required");

  try {
    const context = await loadAuthenticatedPrincipalContext(authData.userID);
    if (context.provisioningStatus !== "provisioned") {
      throw APIError.permissionDenied("Centre Success access is not available");
    }
    return {
      principalId: context.principal.id,
      organisationId: context.activeOrganisation.id,
      context,
    };
  } catch (error) {
    if (error instanceof APIError) throw error;
    if (error instanceof AuthenticatedPrincipalContextError) {
      throw APIError.permissionDenied("Centre Success access is not available");
    }
    throw APIError.unavailable("Centre Success context is temporarily unavailable");
  }
}

export async function requireCentreCapability(
  principal: BusinessPrincipal,
  centreId: string,
  capability: FoundationCapability,
): Promise<void> {
  const decision = await authoriseCentreFromDatabase({
    principalId: principal.principalId,
    activeOrganisationId: principal.organisationId,
    centreId,
    capability,
  });
  if (!decision.allowed) {
    throw new QuarterlyReviewError("access_denied", "resource is not available");
  }
}

export function requireOrganisationCapability(
  principal: BusinessPrincipal,
  capability: FoundationCapability,
): void {
  const decision = authorise({
    context: principal.context.authorisation,
    capability,
    resource: {
      kind: "organisation",
      organisationId: principal.organisationId,
    },
  });
  if (!decision.allowed) {
    throw new QuarterlyReviewError("access_denied", "resource is not available");
  }
}

export async function canRemediateCentre(
  principalId: string,
  organisationId: string,
  centreId: string,
  at: Date,
): Promise<boolean> {
  const decision = await authoriseCentreFromDatabase({
    principalId,
    activeOrganisationId: organisationId,
    centreId,
    capability: FOUNDATION_CAPABILITIES.correctiveActionRemediate,
    at,
  });
  return decision.allowed;
}

export async function filterCentreResourcesByCapability<T extends { centreId: string }>(
  principal: Pick<BusinessPrincipal, "principalId" | "organisationId">,
  resources: readonly T[],
  capability: FoundationCapability,
  at?: Date,
): Promise<T[]> {
  const decisionAt = at ?? new Date();
  const decisions = await Promise.all(
    resources.map(async (resource) => ({
      resource,
      decision: await authoriseCentreFromDatabase({
        principalId: principal.principalId,
        activeOrganisationId: principal.organisationId,
        centreId: resource.centreId,
        capability,
        at: decisionAt,
      }),
    })),
  );
  return decisions
    .filter(({ decision }) => decision.allowed)
    .map(({ resource }) => resource);
}

export function toQuarterlyReviewApiError(error: unknown): never {
  if (error instanceof APIError) throw error;
  if (!(error instanceof QuarterlyReviewError)) {
    throw APIError.unavailable("quarterly review is temporarily unavailable");
  }

  switch (error.code) {
    case "invalid_input":
      throw APIError.invalidArgument(error.message);
    case "access_denied":
    case "not_found":
      throw APIError.permissionDenied("resource is not available");
    case "version_conflict":
      throw APIError.aborted("record changed; reload and try again");
    case "incomplete_audit":
    case "owner_resolution_required":
    case "invalid_state":
      throw APIError.failedPrecondition(error.message).withDetails({ reason: error.code });
    case "evidence_unavailable":
      throw APIError.failedPrecondition("evidence is not available").withDetails({
        reason: "evidence_unavailable",
      });
  }
}
