import { APIError } from "encore.dev/api";
import type { FoundationCapability } from "../authorization/capabilities";
import {
  requireBusinessPrincipal,
  requireOrganisationCapability,
  type BusinessPrincipal,
} from "../quarterly-reviews/authorization";
import { PeopleAccessError } from "./types";

export async function requirePeopleAdministrator(
  capability: FoundationCapability,
): Promise<BusinessPrincipal> {
  const principal = await requireBusinessPrincipal();
  try {
    requireOrganisationCapability(principal, capability);
  } catch {
    throw new PeopleAccessError("access_denied", "resource is not available");
  }
  return principal;
}

export function toPeopleAccessApiError(error: unknown): never {
  if (error instanceof APIError) throw error;
  if (!(error instanceof PeopleAccessError)) {
    throw APIError.unavailable("People & Access is temporarily unavailable");
  }

  switch (error.code) {
    case "invalid_input":
      throw APIError.invalidArgument(error.message);
    case "access_denied":
    case "not_found":
      throw APIError.permissionDenied("resource is not available");
    case "version_conflict":
      throw APIError.aborted("record changed; reload and try again")
        .withDetails({ reason: error.code });
    case "temporarily_unavailable":
      throw APIError.unavailable("People & Access is temporarily unavailable");
    default:
      throw APIError.failedPrecondition(error.message).withDetails({ reason: error.code });
  }
}
