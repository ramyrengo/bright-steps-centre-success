import type { Header } from "encore.dev/api";
import type { Primitive, Transaction } from "encore.dev/storage/sqldb";
import { loadOrganisationCentreAuthorisationFacts } from "../authorization/batch-centres";
import type { FoundationCapability } from "../authorization/capabilities";
import { loadPrincipalAuthorisationContextFromSnapshot } from "../authorization/context-loader";
import { authorise } from "../authorization/policy";
import type { AuthorisationQueryExecutor } from "../authorization/database";
import { centreSuccessDB } from "../db";
import {
  deriveWorkspaceLinks,
  WORKSPACE_LINK_CENTRE_CAPABILITIES,
  WORKSPACE_LINK_ORGANISATION_CAPABILITIES,
  type WorkspaceLink,
} from "./workspace-links";

/**
 * A minimal authenticated read-only navigation projection.
 *
 * Navigation used to be cached in the browser by Daily Success and read back
 * by every other page. That made client storage the effective authority for
 * which destinations appeared, because any syntactically valid path written
 * into storage would render. This endpoint replaces that: every page asks the
 * backend, and the backend evaluates current PostgreSQL capability and scope.
 *
 * It owns no state, adds no capability, and returns nothing but labels and
 * routes. Every destination still reauthorises independently.
 */

export interface NavigationResponse {
  cacheControl: Header<"Cache-Control">;
  links: WorkspaceLink[];
}

export class NavigationError extends Error {
  constructor(
    readonly code: "access_denied" | "context_unavailable",
    options?: ErrorOptions,
  ) {
    super(`Navigation unavailable: ${code}`, options);
    this.name = "NavigationError";
  }
}

interface PrincipalRow {
  id: string;
  status: "pending" | "active" | "suspended" | "revoked";
}

interface OrganisationRow {
  id: string;
}

export interface NavigationDependencies {
  now: () => Date;
}

const runtimeDependencies: NavigationDependencies = { now: () => new Date() };

interface NavigationQueryExecutor extends AuthorisationQueryExecutor {
  exec: (strings: TemplateStringsArray, ...values: Primitive[]) => Promise<unknown>;
}

function countedExecutor(
  transaction: Transaction,
  onQuery: () => void,
): NavigationQueryExecutor {
  return {
    queryAll: ((strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      return transaction.queryAll(strings, ...values);
    }) as NavigationQueryExecutor["queryAll"],
    queryRow: ((strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      return transaction.queryRow(strings, ...values);
    }) as NavigationQueryExecutor["queryRow"],
    exec: async (strings: TemplateStringsArray, ...values: Primitive[]) => {
      onQuery();
      await transaction.exec(strings, ...values);
    },
  };
}

export interface BuildNavigationResult {
  response: NavigationResponse;
  diagnostics: { queryCount: number };
}

export async function buildAuthorisedNavigation(
  input: { principalId: string },
  dependencies: NavigationDependencies = runtimeDependencies,
): Promise<BuildNavigationResult> {
  const transaction = await centreSuccessDB.begin();
  let queryCount = 0;
  const executor = countedExecutor(transaction, () => { queryCount += 1; });
  const decisionAt = dependencies.now();
  try {
    await executor.exec`SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY`;
    const principal = await executor.queryRow<PrincipalRow>`
      SELECT id, status FROM principals WHERE id = ${input.principalId}
    `;
    if (!principal || principal.status !== "active") throw new NavigationError("access_denied");
    const organisations = await executor.queryAll<OrganisationRow>`
      SELECT DISTINCT organisation.id
      FROM organisation_memberships AS membership
      JOIN organisations AS organisation ON organisation.id = membership.organisation_id
      WHERE membership.principal_id = ${principal.id}
        AND membership.status = 'active'
        AND membership.effective_from <= ${decisionAt}
        AND (membership.effective_to IS NULL OR membership.effective_to > ${decisionAt})
        AND organisation.status = 'active'
      ORDER BY organisation.id
    `;
    if (organisations.length !== 1) throw new NavigationError("access_denied");
    const organisationId = organisations[0].id;

    const context = await loadPrincipalAuthorisationContextFromSnapshot(executor, {
      principalId: principal.id,
      activeOrganisationId: organisationId,
      at: decisionAt,
    });
    const centreFacts = await loadOrganisationCentreAuthorisationFacts(
      executor,
      organisationId,
      decisionAt,
    );

    // Set-wise: centre facts and the principal context are loaded once, then
    // capability evaluation is pure and in memory. No per-centre authorizer.
    const centreIdsByCapability = new Map<FoundationCapability, ReadonlySet<string>>();
    for (const capability of WORKSPACE_LINK_CENTRE_CAPABILITIES) {
      centreIdsByCapability.set(
        capability,
        new Set(
          centreFacts.centres
            .filter(
              (centre) =>
                authorise({ context, capability, resource: centre.resource, at: decisionAt })
                  .allowed,
            )
            .map((centre) => centre.id),
        ),
      );
    }
    const organisationCapabilities = new Set<FoundationCapability>(
      WORKSPACE_LINK_ORGANISATION_CAPABILITIES.filter(
        (capability) =>
          authorise({
            context,
            capability,
            resource: { kind: "organisation", organisationId },
            at: decisionAt,
          }).allowed,
      ),
    );

    const links = deriveWorkspaceLinks({ centreIdsByCapability, organisationCapabilities });
    await transaction.commit();
    return {
      response: { cacheControl: "private, no-store", links },
      diagnostics: { queryCount },
    };
  } catch (error) {
    await transaction.rollback();
    if (error instanceof NavigationError) throw error;
    console.error("Navigation request failed safely", {
      errorType: error instanceof Error ? error.name : "unknown",
    });
    throw new NavigationError("context_unavailable", { cause: error });
  }
}
