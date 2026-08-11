import { randomUUID } from "node:crypto";
import type { EnvironmentMeta } from "encore.dev";
import { recordAuditEventWithExecutor } from "../audit/events";
import { FOUNDATION_CAPABILITIES } from "../authorization/capabilities";
import {
  AuthorisationContextError,
  loadPrincipalAuthorisationContextFromSnapshot,
} from "../authorization/context-loader";
import { authorise } from "../authorization/policy";
import { centreSuccessDB } from "../db";
import { canonicaliseEntraGuid } from "./entra-identifiers";
import { microsoftEntraProviderKey } from "./external-identity";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type LocalIdentityLinkFailureCode =
  | "local_environment_required"
  | "invalid_input"
  | "operator_not_authorised"
  | "target_principal_unavailable"
  | "mapping_conflict";

export class LocalIdentityLinkError extends Error {
  readonly code: LocalIdentityLinkFailureCode;

  constructor(code: LocalIdentityLinkFailureCode) {
    super(`local identity link rejected: ${code}`);
    this.name = "LocalIdentityLinkError";
    this.code = code;
  }
}

export interface LinkLocalEntraIdentityInput {
  tenantId: string;
  oid: string;
  principalId: string;
  organisationId: string;
  operatorPrincipalId: string;
  reason: string;
  /** Trusted test/script clock. Never sourced from a public request. */
  at?: Date;
}

export interface LinkLocalEntraIdentityResult {
  mappingId: string;
  outcome: "linked" | "already_linked";
}

export interface LinkLocalEntraIdentityDependencies {
  configuredTenantId: string;
  environment: Pick<EnvironmentMeta, "cloud" | "name" | "type">;
}

interface PrincipalRow {
  id: string;
}

interface MappingRow {
  id: string;
  principal_id: string;
  status: "active" | "inactive";
}

export function assertLocalDevelopmentEnvironment(
  environment: Pick<EnvironmentMeta, "cloud" | "name" | "type">,
): void {
  if (
    environment.cloud !== "local" ||
    environment.name !== "local" ||
    environment.type !== "development"
  ) {
    throw new LocalIdentityLinkError("local_environment_required");
  }
}

interface ValidatedLocalEntraIdentityInput {
  providerKey: string;
  providerSubject: string;
  reason: string;
}

function validateInput(
  input: LinkLocalEntraIdentityInput,
  configuredTenantId: string,
): ValidatedLocalEntraIdentityInput {
  const tenantId = canonicaliseEntraGuid(input.tenantId);
  const expectedTenantId = canonicaliseEntraGuid(configuredTenantId);
  const providerSubject = canonicaliseEntraGuid(input.oid);
  const providerKey = microsoftEntraProviderKey(tenantId);
  if (
    tenantId === null ||
    expectedTenantId === null ||
    tenantId !== expectedTenantId ||
    providerKey === null ||
    providerSubject === null ||
    !CANONICAL_UUID.test(input.principalId) ||
    !CANONICAL_UUID.test(input.organisationId) ||
    !CANONICAL_UUID.test(input.operatorPrincipalId)
  ) {
    throw new LocalIdentityLinkError("invalid_input");
  }

  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > 500) {
    throw new LocalIdentityLinkError("invalid_input");
  }

  return { providerKey, providerSubject, reason };
}

/**
 * Links one development Entra tid+oid to an existing synthetic principal. The
 * operator must already hold identity.mapping.manage in the selected
 * organisation; this function creates no principal, membership, role, scope,
 * or assignment.
 */
export async function linkLocalEntraIdentity(
  input: LinkLocalEntraIdentityInput,
  dependencies: LinkLocalEntraIdentityDependencies,
): Promise<LinkLocalEntraIdentityResult> {
  assertLocalDevelopmentEnvironment(dependencies.environment);
  const { providerKey, providerSubject, reason } = validateInput(
    input,
    dependencies.configuredTenantId,
  );
  const decisionAt = input.at ?? new Date();
  const transaction = await centreSuccessDB.begin();

  try {
    await transaction.exec`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;

    let operatorContext;
    try {
      operatorContext = await loadPrincipalAuthorisationContextFromSnapshot(
        transaction,
        {
          principalId: input.operatorPrincipalId,
          activeOrganisationId: input.organisationId,
          at: decisionAt,
        },
      );
    } catch (error) {
      if (error instanceof AuthorisationContextError) {
        throw new LocalIdentityLinkError("operator_not_authorised");
      }
      throw error;
    }

    const operatorDecision = authorise({
      context: operatorContext,
      capability: FOUNDATION_CAPABILITIES.identityMappingManage,
      resource: {
        kind: "organisation",
        organisationId: input.organisationId,
      },
      at: decisionAt,
    });

    if (!operatorDecision.allowed) {
      throw new LocalIdentityLinkError("operator_not_authorised");
    }

    const targetPrincipal = await transaction.queryRow<PrincipalRow>`
      SELECT principal.id
      FROM principals AS principal
      WHERE principal.id = ${input.principalId}
        AND principal.status = 'active'
        AND EXISTS (
          SELECT 1
          FROM organisation_memberships AS membership
          WHERE membership.principal_id = principal.id
            AND membership.organisation_id = ${input.organisationId}
            AND membership.status = 'active'
            AND membership.effective_from <= ${decisionAt}
            AND (membership.effective_to IS NULL OR membership.effective_to > ${decisionAt})
        )
      FOR UPDATE
    `;

    if (targetPrincipal === null) {
      throw new LocalIdentityLinkError("target_principal_unavailable");
    }

    const existingSubjectMapping = await transaction.queryRow<MappingRow>`
      SELECT id, principal_id, status
      FROM external_identity_mappings
      WHERE provider_key = ${providerKey}
        AND provider_subject = ${providerSubject}
      FOR UPDATE
    `;

    if (existingSubjectMapping !== null) {
      if (
        existingSubjectMapping.principal_id === input.principalId &&
        existingSubjectMapping.status === "active"
      ) {
        await transaction.commit();
        return {
          mappingId: existingSubjectMapping.id,
          outcome: "already_linked",
        };
      }

      throw new LocalIdentityLinkError("mapping_conflict");
    }

    const existingPrincipalMapping = await transaction.queryRow<{ id: string }>`
      SELECT id
      FROM external_identity_mappings
      WHERE provider_key = ${providerKey}
        AND principal_id = ${input.principalId}
        AND status = 'active'
      ORDER BY id
      LIMIT 1
      FOR UPDATE
    `;

    if (existingPrincipalMapping !== null) {
      throw new LocalIdentityLinkError("mapping_conflict");
    }

    const mappingId = randomUUID();
    await transaction.exec`
      INSERT INTO external_identity_mappings (
        id,
        principal_id,
        provider_key,
        provider_subject,
        status,
        last_verified_at
      ) VALUES (
        ${mappingId},
        ${targetPrincipal.id},
        ${providerKey},
        ${providerSubject},
        'active',
        ${decisionAt}
      )
    `;

    await recordAuditEventWithExecutor(transaction, {
      organisationId: input.organisationId,
      actorPrincipalId: input.operatorPrincipalId,
      action: "identity.mapping.linked",
      resourceType: "external_identity_mapping",
      resourceId: mappingId,
      scopeType: "principal",
      scopeId: targetPrincipal.id,
      context: {
        provider: "microsoft_entra",
        source: "local_operator_script",
        reason,
      },
      occurredAt: decisionAt,
    });

    await transaction.commit();
    return { mappingId, outcome: "linked" };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
