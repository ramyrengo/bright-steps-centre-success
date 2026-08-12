import { centreSuccessDB } from "../db";
import {
  canonicaliseEntraGuid,
} from "./entra-identifiers";

export const MICROSOFT_ENTRA_PROVIDER_PREFIX = "microsoft_entra:";

export type ActivePrincipalResolution =
  | { status: "active"; principalId: string }
  | { status: "not_provisioned" };

interface ExternalIdentityRow {
  principal_id: string;
  mapping_status: "active" | "inactive";
  principal_status: "pending" | "active" | "suspended" | "revoked";
}

/**
 * The tenant is part of the provider key and oid remains the raw provider
 * subject. Neither value is exposed through Encore AuthData.
 */
export function microsoftEntraProviderKey(tenantId: unknown): string | null {
  const canonicalTenantId = canonicaliseEntraGuid(tenantId);
  return canonicalTenantId === null
    ? null
    : `${MICROSOFT_ENTRA_PROVIDER_PREFIX}${canonicalTenantId}`;
}

/**
 * Resolves a verified Entra tid+oid through the existing provider-neutral
 * mapping. Authentication never creates a principal, membership, or grant.
 */
export async function resolveActivePrincipalForEntraIdentity(
  identity: { tenantId: string; objectId: string },
): Promise<ActivePrincipalResolution> {
  const providerKey = microsoftEntraProviderKey(identity.tenantId);
  const providerSubject = canonicaliseEntraGuid(identity.objectId);
  if (providerKey === null || providerSubject === null) {
    return { status: "not_provisioned" };
  }

  const row = await centreSuccessDB.queryRow<ExternalIdentityRow>`
    SELECT
      mapping.principal_id,
      mapping.status AS mapping_status,
      principal.status AS principal_status
    FROM external_identity_mappings AS mapping
    JOIN principals AS principal
      ON principal.id = mapping.principal_id
    WHERE mapping.provider_key = ${providerKey}
      AND mapping.provider_subject = ${providerSubject}
  `;

  if (
    row === null ||
    row.mapping_status !== "active" ||
    row.principal_status !== "active"
  ) {
    return { status: "not_provisioned" };
  }

  return { status: "active", principalId: row.principal_id };
}
