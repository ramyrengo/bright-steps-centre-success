import { appMeta } from "encore.dev";
import { bootstrapLocalFirstAdministrator } from "../foundation/authentication/local-first-administrator-bootstrap";

const result = await bootstrapLocalFirstAdministrator({
  environment: appMeta().environment,
});

console.info(`organisation-id:
${result.organisationId}

principal-id:
${result.targetPrincipalId}

operator-principal-id:
${result.operatorPrincipalId}`);
