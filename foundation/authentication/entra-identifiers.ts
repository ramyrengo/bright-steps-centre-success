const ENTRA_GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO_GUID = "00000000-0000-0000-0000-000000000000";

/** Returns one canonical lowercase Entra GUID, or null for an unsafe value. */
export function canonicaliseEntraGuid(value: unknown): string | null {
  if (typeof value !== "string" || value !== value.trim() || !ENTRA_GUID.test(value)) {
    return null;
  }

  const canonical = value.toLowerCase();
  return canonical === ZERO_GUID ? null : canonical;
}

export function entraIssuer(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/v2.0`;
}

export function entraDiscoveryUrl(tenantId: string): string {
  return `${entraIssuer(tenantId)}/.well-known/openid-configuration`;
}

export function entraJwksUrl(tenantId: string): string {
  return `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`;
}
