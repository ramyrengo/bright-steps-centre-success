import { parseArgs } from "node:util";
import { appMeta } from "encore.dev";
import { loadRuntimeEntraVerificationConfig } from "../foundation/authentication/entra-configuration";
import {
  assertLocalDevelopmentEnvironment,
  linkLocalEntraIdentity,
} from "../foundation/authentication/local-identity-linker";

const { values } = parseArgs({
  allowPositionals: false,
  strict: true,
  options: {
    "tenant-id": { type: "string" },
    oid: { type: "string" },
    "principal-id": { type: "string" },
    "organisation-id": { type: "string" },
    "operator-principal-id": { type: "string" },
    reason: { type: "string" },
  },
});

const environment = appMeta().environment;
assertLocalDevelopmentEnvironment(environment);
const configuredTenantId = loadRuntimeEntraVerificationConfig().tenantId;

const result = await linkLocalEntraIdentity(
  {
    tenantId: values["tenant-id"] ?? "",
    oid: values.oid ?? "",
    principalId: values["principal-id"] ?? "",
    organisationId: values["organisation-id"] ?? "",
    operatorPrincipalId: values["operator-principal-id"] ?? "",
    reason: values.reason ?? "",
  },
  { configuredTenantId, environment },
);

console.info(
  result.outcome === "linked"
    ? `Local Microsoft Entra identity linked as mapping ${result.mappingId}.`
    : `Local Microsoft Entra identity was already linked as mapping ${result.mappingId}.`,
);
