import { secret } from "encore.dev/config";
import {
  validateEntraTokenVerificationConfig,
  type ValidatedEntraTokenVerificationConfig,
} from "./entra-access-token-verifier";

const entraTenantId = secret("EntraTenantId");
const entraApiClientId = secret("EntraApiClientId");
const entraWebClientId = secret("EntraWebClientId");

/** Loads the single-tenant and two-app-registration trust configuration. */
export function loadRuntimeEntraVerificationConfig(): ValidatedEntraTokenVerificationConfig {
  return validateEntraTokenVerificationConfig({
    tenantId: entraTenantId(),
    apiClientId: entraApiClientId(),
    webClientId: entraWebClientId(),
  });
}

/** Loads the two identifiers shared with the server-side Graph client. */
export function loadRuntimeEntraConfidentialClientIdentifiers(): {
  tenantId: string;
  clientId: string;
} {
  return {
    tenantId: entraTenantId(),
    clientId: entraApiClientId(),
  };
}
