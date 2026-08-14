import { appMeta, type EnvironmentMeta } from "encore.dev";

import { recordAuditEventWithExecutor } from "../audit/events";
import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import { authorise } from "../authorization/policy";
import { inSerializableTransaction } from "../transactions";
import { loadPrincipalOrganisation } from "./service";
import { assertSyntheticStandardsEnvironment } from "./synthetic-environment";
import {
  seedSyntheticStandardsPilot,
  SYNTHETIC_STANDARDS_PILOT_IDS,
} from "./synthetic-pilot";
import { CentreStandardsError, requireStandardsUuid } from "./types";

/**
 * The operator trigger for the synthetic Centre Standards pilot.
 *
 * The pilot content itself has existed since Milestone 4A and is deliberately
 * restricted to local development and the exact `staging` environment. What was
 * missing was any way to run it: `seedSyntheticStandardsPilot` had no caller
 * outside the test suite, so a deployed staging environment could hold every
 * Centre Standards table and still show an empty screen forever, because
 * occurrences are generated from a deployment and no deployment could be made.
 *
 * A script would not close that gap. `encore exec` runs against the local
 * application, and reaching a deployed environment with it is still an open
 * question. An authenticated endpoint is the one shape that works where the
 * content is actually needed.
 *
 * Three gates, in the order that gives the clearest failure:
 *
 * 1. **Environment**, first and before any database work, so an attempt in the
 *    wrong place is refused on the spot rather than after a transaction has
 *    been opened. The seed re-checks this itself; that duplication is
 *    deliberate, because the seed is also reachable from tests.
 * 2. **Capability** — `system.configure` at organisation scope. Seeding is
 *    technical administration of an environment, not authorship of operational
 *    content, so it belongs to the same authority that configures the system
 *    and deliberately not to `template.create`.
 * 3. **Everything the seed already enforces** — an active organisation and
 *    centre, a valid effective date, and an advisory lock so two concurrent
 *    calls cannot interleave.
 *
 * Safe to call twice, but not by overwriting. Every insert carries
 * `ON CONFLICT DO NOTHING` against fixed identifiers, so re-seeding an
 * untouched pilot returns the same one rather than building a second beside it.
 * If the existing pilot no longer matches its approved definition — retitled, no
 * longer synthetic, or its deployment deactivated — the seed refuses instead of
 * quietly restoring it. That is the safer failure: a deactivated pilot was
 * deactivated by someone, and silently reactivating it would undo a decision
 * this operation cannot see the reason for.
 */

export interface SeedSyntheticStandardsPilotInput {
  principalId: string;
  centreId: string;
  /** `YYYY-MM-DD`. Defaults to the current UTC date. */
  effectiveFrom?: string;
  /** Deploy the pilot active so occurrences generate. Defaults to true. */
  activate?: boolean;
  /** Test seams; production callers pass neither. */
  environment?: Pick<EnvironmentMeta, "cloud" | "name" | "type">;
  now?: () => Date;
}

export interface SeedSyntheticStandardsPilotResult {
  templateId: string;
  versionId: string;
  deploymentId: string;
  scheduleRevisionId: string;
  questionCount: number;
  effectiveFrom: string;
  activated: boolean;
}

function utcDate(at: Date): string {
  return at.toISOString().slice(0, 10);
}

export async function seedSyntheticStandardsPilotForPrincipal(
  input: SeedSyntheticStandardsPilotInput,
): Promise<SeedSyntheticStandardsPilotResult> {
  const environment = input.environment ?? appMeta().environment;
  // Refused before anything is read or written. A wrong-environment attempt
  // should never reach the database at all.
  assertSyntheticStandardsEnvironment(environment);

  requireStandardsUuid(input.principalId, "principal ID");
  requireStandardsUuid(input.centreId, "centre ID");

  const decisionAt = (input.now ?? (() => new Date()))();
  const effectiveFrom = input.effectiveFrom ?? utcDate(decisionAt);
  const activate = input.activate ?? true;

  // Authorisation resolves in its own transaction and closes before the seed
  // opens its own; the seed takes an advisory lock rather than relying on this
  // one staying open.
  const organisationId = await inSerializableTransaction(async (transaction) => {
    const principal = await loadPrincipalOrganisation(
      transaction,
      input.principalId,
      decisionAt,
    );
    const decision = authorise({
      context: principal.context,
      capability: capability.systemConfigure,
      resource: { kind: "organisation", organisationId: principal.organisationId },
      at: decisionAt,
    });
    if (!decision.allowed) {
      throw new CentreStandardsError("access_denied", "check is not available");
    }
    return principal.organisationId;
  });

  const ids = await seedSyntheticStandardsPilot({
    environment,
    organisationId,
    centreId: input.centreId,
    effectiveFrom,
    activate,
    actorPrincipalId: input.principalId,
  });

  // Seeding a deployment into an environment is a material act even when the
  // content is synthetic, so it is recorded against the deployment it created.
  await inSerializableTransaction(async (transaction) => {
    await recordAuditEventWithExecutor(transaction, {
      organisationId,
      actorPrincipalId: input.principalId,
      action: "operational_standard_deployment.seeded",
      resourceType: "operational_standard_deployment",
      resourceId: ids.deploymentId,
      scopeType: "centre",
      scopeId: input.centreId,
      context: {
        source: "synthetic_standards_pilot",
        environment: environment.name,
        effectiveFrom,
        activated: activate,
      },
      occurredAt: decisionAt,
    });
  });

  return {
    templateId: ids.templateId,
    versionId: ids.versionId,
    deploymentId: ids.deploymentId,
    scheduleRevisionId: ids.scheduleRevisionId,
    questionCount: SYNTHETIC_STANDARDS_PILOT_IDS.questionIds.length,
    effectiveFrom,
    activated: activate,
  };
}
