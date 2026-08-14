import type { EnvironmentMeta } from "encore.dev";
import type { Transaction } from "encore.dev/storage/sqldb";
import { recordAuditEventWithExecutor } from "../audit/events";
import { CANONICAL_ROLE_BUNDLES } from "../authorization/roles";
import { requireIanaTimezone } from "../daily-success/time";
import { centreSuccessDB } from "../db";
import { assertLocalDevelopmentEnvironment } from "../authentication/local-identity-linker";
import {
  BRIGHT_STEPS_DATASET_APPROVED_ON,
  BRIGHT_STEPS_DATASET_VERSION,
  BRIGHT_STEPS_NON_TRADING_CENTRES,
  BRIGHT_STEPS_ORGANISATION_ID,
  BRIGHT_STEPS_ORGANISATION_NAME,
  BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM,
  BRIGHT_STEPS_STATES,
  BRIGHT_STEPS_TRADING_CENTRES,
} from "./bright-steps-academy";

/**
 * Reviewed organisation reference load — ADR-0021 D2 / Stage 7.
 *
 * Loads the approved Bright Steps Academy organisation, its state units, its
 * twelve trading centres, and their effective-dated placements. It is
 * deliberately NOT an import, sync, or reconciliation job against an external
 * system of record: ADR-0010 defers that decision and forbids building one.
 * The foundation database remains the authority and the approved values are
 * committed, reviewable data.
 *
 * It creates no principal, no membership, and no role assignment. People are
 * provisioned only through the Milestone 2C invitation lifecycle.
 */

const ADVISORY_LOCK_KEY_HIGH = 1112691796;
const ADVISORY_LOCK_KEY_LOW = 20260814;

export type OrganisationLoadFailureCode =
  | "local_environment_required"
  | "organisation_timezone_required"
  | "organisation_timezone_invalid"
  | "reference_data_conflict"
  | "organisation_already_populated"
  | "canonical_role_unavailable";

export class OrganisationLoadError extends Error {
  readonly code: OrganisationLoadFailureCode;
  readonly detail: string;

  constructor(code: OrganisationLoadFailureCode, detail = "") {
    super(`organisation reference load rejected: ${code}${detail ? ` (${detail})` : ""}`);
    this.name = "OrganisationLoadError";
    this.code = code;
    this.detail = detail;
  }
}

export type PlannedAction = "create" | "unchanged" | "conflict";

export type PlannedResource =
  | "organisation"
  | "organisational_unit"
  | "centre"
  | "centre_placement";

export interface PlannedChange {
  resource: PlannedResource;
  id: string;
  label: string;
  action: PlannedAction;
  detail?: string;
}

export interface CanonicalRoleReport {
  /** Provisioned by the ADR-0006 trigger when the organisation row is created. */
  expected: readonly string[];
  present: readonly string[];
  missing: readonly string[];
}

export interface OrganisationLoadReport {
  mode: "dry_run" | "apply";
  organisationId: string;
  organisationName: string;
  organisationTimezone: string;
  datasetVersion: number;
  datasetApprovedOn: string;
  /** Approved seeding convention, not an opening or appointment date. */
  seedingEffectiveFrom: string;
  changes: readonly PlannedChange[];
  counts: Record<PlannedAction, number>;
  canonicalRoles: CanonicalRoleReport;
  excludedNonTradingCentres: readonly string[];
  committed: boolean;
}

export interface OrganisationLoadOptions {
  /**
   * `organisations.default_timezone` is NOT NULL and is read by Daily Success
   * and Centre Quality to derive the organisation's business date. The approved
   * dataset does not state it — the estate spans four offsets and no head-office
   * zone was supplied — so it is explicit operator input rather than an
   * engineering guess. There is deliberately no default.
   */
  organisationTimezone: string;
  environment: Pick<EnvironmentMeta, "cloud" | "name" | "type">;
  /** Dry run is the default. Nothing commits unless this is explicitly true. */
  apply?: boolean;
  now?: () => Date;
}

interface OrganisationRow {
  id: string;
  name: string;
  status: string;
  default_timezone: string;
}

interface UnitRow {
  id: string;
  code: string;
  name: string;
  kind: string;
  status: string;
  parent_id: string | null;
  effective_from: Date;
  effective_to: Date | null;
}

interface CentreRow {
  id: string;
  code: string;
  name: string;
  jurisdiction_code: string;
  timezone: string;
  status: string;
}

interface PlacementRow {
  id: string;
  centre_id: string;
  organisational_unit_id: string;
  effective_from: Date;
  effective_to: Date | null;
}

function sameInstant(value: Date, expected: Date): boolean {
  return value.getTime() === expected.getTime();
}

function differences(
  comparisons: readonly (readonly [string, unknown, unknown])[],
): string[] {
  return comparisons
    .filter(([, actual, expected]) => actual !== expected)
    .map(([field, actual, expected]) => `${field}: found ${JSON.stringify(actual)}, approved ${JSON.stringify(expected)}`);
}

async function ensureOrganisation(
  transaction: Transaction,
  organisationTimezone: string,
  changes: PlannedChange[],
): Promise<void> {
  const rows = await transaction.queryAll<OrganisationRow>`
    SELECT id, name, status, default_timezone
    FROM organisations
    WHERE id = ${BRIGHT_STEPS_ORGANISATION_ID}
       OR name = ${BRIGHT_STEPS_ORGANISATION_NAME}
    ORDER BY id
    FOR UPDATE
  `;

  if (rows.length > 1) {
    changes.push({
      resource: "organisation",
      id: BRIGHT_STEPS_ORGANISATION_ID,
      label: BRIGHT_STEPS_ORGANISATION_NAME,
      action: "conflict",
      detail: `${rows.length} rows already match the approved id or name`,
    });
    return;
  }

  const existing = rows[0];
  if (existing !== undefined) {
    const mismatches = differences([
      ["id", existing.id, BRIGHT_STEPS_ORGANISATION_ID],
      ["name", existing.name, BRIGHT_STEPS_ORGANISATION_NAME],
      ["status", existing.status, "active"],
      ["default_timezone", existing.default_timezone, organisationTimezone],
    ]);
    changes.push({
      resource: "organisation",
      id: BRIGHT_STEPS_ORGANISATION_ID,
      label: BRIGHT_STEPS_ORGANISATION_NAME,
      action: mismatches.length === 0 ? "unchanged" : "conflict",
      ...(mismatches.length === 0 ? {} : { detail: mismatches.join("; ") }),
    });
    return;
  }

  // The ADR-0006 trigger provisions the nine canonical role definitions here.
  await transaction.exec`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (
      ${BRIGHT_STEPS_ORGANISATION_ID},
      ${BRIGHT_STEPS_ORGANISATION_NAME},
      'active',
      ${organisationTimezone}
    )
  `;
  changes.push({
    resource: "organisation",
    id: BRIGHT_STEPS_ORGANISATION_ID,
    label: BRIGHT_STEPS_ORGANISATION_NAME,
    action: "create",
  });
}

async function ensureStates(
  transaction: Transaction,
  changes: PlannedChange[],
): Promise<void> {
  for (const state of BRIGHT_STEPS_STATES) {
    const rows = await transaction.queryAll<UnitRow>`
      SELECT id, code, name, kind, status, parent_id, effective_from, effective_to
      FROM organisational_units
      WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
        AND (id = ${state.id} OR code = ${state.code})
      ORDER BY id
      FOR UPDATE
    `;

    if (rows.length > 1) {
      changes.push({
        resource: "organisational_unit",
        id: state.id,
        label: state.code,
        action: "conflict",
        detail: `${rows.length} rows already match the approved id or code`,
      });
      continue;
    }

    const existing = rows[0];
    if (existing !== undefined) {
      const mismatches = differences([
        ["id", existing.id, state.id],
        ["code", existing.code, state.code],
        ["name", existing.name, state.name],
        ["kind", existing.kind, state.kind],
        ["status", existing.status, "active"],
        ["parent_id", existing.parent_id, null],
      ]);
      if (!sameInstant(existing.effective_from, BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM)) {
        mismatches.push(
          `effective_from: found ${existing.effective_from.toISOString()}, approved ${BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM.toISOString()}`,
        );
      }
      if (existing.effective_to !== null) {
        mismatches.push("effective_to: found a closed window, approved an open one");
      }
      changes.push({
        resource: "organisational_unit",
        id: state.id,
        label: state.code,
        action: mismatches.length === 0 ? "unchanged" : "conflict",
        ...(mismatches.length === 0 ? {} : { detail: mismatches.join("; ") }),
      });
      continue;
    }

    await transaction.exec`
      INSERT INTO organisational_units (
        id, organisation_id, parent_id, kind, code, name, status, effective_from
      ) VALUES (
        ${state.id}, ${BRIGHT_STEPS_ORGANISATION_ID}, NULL, ${state.kind},
        ${state.code}, ${state.name}, 'active', ${BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM}
      )
    `;
    changes.push({
      resource: "organisational_unit",
      id: state.id,
      label: state.code,
      action: "create",
    });
  }
}

async function ensureCentres(
  transaction: Transaction,
  changes: PlannedChange[],
): Promise<void> {
  for (const centre of BRIGHT_STEPS_TRADING_CENTRES) {
    const rows = await transaction.queryAll<CentreRow>`
      SELECT id, code, name, jurisdiction_code, timezone, status
      FROM centres
      WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
        AND (id = ${centre.id} OR code = ${centre.code})
      ORDER BY id
      FOR UPDATE
    `;

    if (rows.length > 1) {
      changes.push({
        resource: "centre",
        id: centre.id,
        label: `${centre.code} — ${centre.name}`,
        action: "conflict",
        detail: `${rows.length} rows already match the approved id or code`,
      });
      continue;
    }

    const existing = rows[0];
    if (existing !== undefined) {
      const mismatches = differences([
        ["id", existing.id, centre.id],
        ["code", existing.code, centre.code],
        ["name", existing.name, centre.name],
        ["jurisdiction_code", existing.jurisdiction_code, centre.stateCode],
        ["timezone", existing.timezone, centre.timezone],
        ["status", existing.status, "active"],
      ]);
      changes.push({
        resource: "centre",
        id: centre.id,
        label: `${centre.code} — ${centre.name}`,
        action: mismatches.length === 0 ? "unchanged" : "conflict",
        ...(mismatches.length === 0 ? {} : { detail: mismatches.join("; ") }),
      });
      continue;
    }

    await transaction.exec`
      INSERT INTO centres (
        id, organisation_id, code, name, jurisdiction_code, timezone, status
      ) VALUES (
        ${centre.id}, ${BRIGHT_STEPS_ORGANISATION_ID}, ${centre.code}, ${centre.name},
        ${centre.stateCode}, ${centre.timezone}, 'active'
      )
    `;
    changes.push({
      resource: "centre",
      id: centre.id,
      label: `${centre.code} — ${centre.name}`,
      action: "create",
    });
  }
}

async function ensurePlacements(
  transaction: Transaction,
  changes: PlannedChange[],
): Promise<void> {
  const unitByState = new Map(BRIGHT_STEPS_STATES.map((state) => [state.code, state.id]));

  for (const centre of BRIGHT_STEPS_TRADING_CENTRES) {
    const unitId = unitByState.get(centre.stateCode);
    if (unitId === undefined) {
      throw new OrganisationLoadError(
        "reference_data_conflict",
        `centre ${centre.code} names state ${centre.stateCode}, which the approved dataset does not define`,
      );
    }

    const label = `${centre.code} → ${centre.stateCode}`;
    // A centre may only have one currently effective placement — ADR-0004
    // treats simultaneous placements as conflicting resource context and denies
    // access — so any existing placement for this centre is the natural key.
    const rows = await transaction.queryAll<PlacementRow>`
      SELECT id, centre_id, organisational_unit_id, effective_from, effective_to
      FROM centre_organisational_unit_memberships
      WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
        AND (id = ${centre.placementId} OR centre_id = ${centre.id})
      ORDER BY id
      FOR UPDATE
    `;

    if (rows.length > 1) {
      changes.push({
        resource: "centre_placement",
        id: centre.placementId,
        label,
        action: "conflict",
        detail: `${rows.length} placements already exist for this centre`,
      });
      continue;
    }

    const existing = rows[0];
    if (existing !== undefined) {
      const mismatches = differences([
        ["id", existing.id, centre.placementId],
        ["centre_id", existing.centre_id, centre.id],
        ["organisational_unit_id", existing.organisational_unit_id, unitId],
      ]);
      if (!sameInstant(existing.effective_from, BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM)) {
        mismatches.push(
          `effective_from: found ${existing.effective_from.toISOString()}, approved ${BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM.toISOString()}`,
        );
      }
      if (existing.effective_to !== null) {
        mismatches.push("effective_to: found a closed window, approved an open one");
      }
      changes.push({
        resource: "centre_placement",
        id: centre.placementId,
        label,
        action: mismatches.length === 0 ? "unchanged" : "conflict",
        ...(mismatches.length === 0 ? {} : { detail: mismatches.join("; ") }),
      });
      continue;
    }

    await transaction.exec`
      INSERT INTO centre_organisational_unit_memberships (
        id, organisation_id, centre_id, organisational_unit_id, effective_from
      ) VALUES (
        ${centre.placementId}, ${BRIGHT_STEPS_ORGANISATION_ID}, ${centre.id},
        ${unitId}, ${BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM}
      )
    `;
    changes.push({
      resource: "centre_placement",
      id: centre.placementId,
      label,
      action: "create",
    });
  }
}

async function inspectCanonicalRoles(
  transaction: Transaction,
): Promise<CanonicalRoleReport> {
  const expected = CANONICAL_ROLE_BUNDLES.map((bundle) => bundle.key).slice().sort();
  const rows = await transaction.queryAll<{ role_key: string }>`
    SELECT role_key
    FROM role_definitions
    WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
      AND status = 'active'
      AND source_template_key IS NOT NULL
    ORDER BY role_key
  `;
  const present = rows.map((row) => row.role_key);
  const found = new Set(present);
  return {
    expected,
    present,
    missing: expected.filter((key) => !found.has(key)),
  };
}

async function assertOrganisationUnpopulated(
  transaction: Transaction,
): Promise<void> {
  // Structural writes bypass the normal authoriser because no principal exists
  // to authorise them — the organisation is being created. That is only
  // defensible while the organisation has nobody in it. Once a membership
  // exists, hierarchy changes must go through the authorised People & Access
  // and centre-management paths like any other write, so this tool stands down.
  const populated = await transaction.queryRow<{ memberships: number }>`
    SELECT count(*)::integer AS memberships
    FROM organisation_memberships
    WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
  `;
  if (populated !== null && populated.memberships > 0) {
    throw new OrganisationLoadError(
      "organisation_already_populated",
      `${populated.memberships} organisation membership(s) already exist; use the authorised People & Access and centre-management paths`,
    );
  }
}

async function recordLoadAudit(
  transaction: Transaction,
  changes: readonly PlannedChange[],
  occurredAt: Date,
): Promise<void> {
  const created = changes.filter((change) => change.action === "create");
  for (const change of created) {
    // Attribution lives in the append-only audit record: organisations,
    // units, centres, and placements carry no attribution column, and there is
    // no principal in this organisation yet to name as the actor.
    await recordAuditEventWithExecutor(transaction, {
      organisationId: BRIGHT_STEPS_ORGANISATION_ID,
      action: "organisation_reference.loaded",
      resourceType:
        change.resource === "centre_placement"
          ? "centre_organisational_unit_membership"
          : change.resource,
      resourceId: change.id,
      scopeType: "organisation",
      scopeId: BRIGHT_STEPS_ORGANISATION_ID,
      context: {
        source: "reviewed_organisation_reference_load",
        datasetVersion: BRIGHT_STEPS_DATASET_VERSION,
        datasetApprovedOn: BRIGHT_STEPS_DATASET_APPROVED_ON,
        resource: change.resource,
        label: change.label,
        seedingEffectiveFrom: BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM.toISOString(),
      },
      occurredAt,
    });
  }
}

function countActions(changes: readonly PlannedChange[]): Record<PlannedAction, number> {
  return {
    create: changes.filter((change) => change.action === "create").length,
    unchanged: changes.filter((change) => change.action === "unchanged").length,
    conflict: changes.filter((change) => change.action === "conflict").length,
  };
}

/**
 * Plans and — only when `apply` is true — commits the approved reference load.
 *
 * A dry run performs the identical work inside the same transaction and then
 * rolls it back, so it is a rehearsal rather than a guess: every constraint,
 * trigger, and canonical-role provisioning step is genuinely exercised and
 * nothing is persisted.
 */
export async function loadBrightStepsOrganisationReference(
  options: OrganisationLoadOptions,
): Promise<OrganisationLoadReport> {
  const apply = options.apply === true;
  const now = options.now ?? (() => new Date());

  if (options.organisationTimezone.trim().length === 0) {
    throw new OrganisationLoadError(
      "organisation_timezone_required",
      "the organisation default timezone is explicit operator input and has no default",
    );
  }
  try {
    requireIanaTimezone(options.organisationTimezone);
  } catch {
    throw new OrganisationLoadError(
      "organisation_timezone_invalid",
      `${options.organisationTimezone} is not a resolvable IANA timezone`,
    );
  }

  // This must remain before centreSuccessDB.begin(): a non-local environment
  // cannot open a transaction that could commit. A dry run writes nothing and
  // is permitted anywhere so a reviewer can see the plan for the environment
  // they are about to load.
  if (apply) {
    assertLocalDevelopmentEnvironment(options.environment);
  }

  const changes: PlannedChange[] = [];
  const transaction = await centreSuccessDB.begin();
  let committed = false;

  try {
    await transaction.exec`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
    await transaction.exec`
      SELECT pg_advisory_xact_lock(${ADVISORY_LOCK_KEY_HIGH}, ${ADVISORY_LOCK_KEY_LOW})
    `;

    await assertOrganisationUnpopulated(transaction);
    await ensureOrganisation(transaction, options.organisationTimezone, changes);

    const organisationConflict = changes.some((change) => change.action === "conflict");
    if (organisationConflict) {
      throw new OrganisationLoadError(
        "reference_data_conflict",
        changes.find((change) => change.action === "conflict")?.detail ?? "organisation",
      );
    }

    await ensureStates(transaction, changes);
    await ensureCentres(transaction, changes);
    await ensurePlacements(transaction, changes);

    const canonicalRoles = await inspectCanonicalRoles(transaction);
    if (canonicalRoles.missing.length > 0) {
      throw new OrganisationLoadError(
        "canonical_role_unavailable",
        `missing canonical role definitions: ${canonicalRoles.missing.join(", ")}`,
      );
    }

    const counts = countActions(changes);
    if (counts.conflict > 0) {
      const detail = changes
        .filter((change) => change.action === "conflict")
        .map((change) => `${change.resource} ${change.label}: ${change.detail ?? "conflict"}`)
        .join(" | ");
      throw new OrganisationLoadError("reference_data_conflict", detail);
    }

    await recordLoadAudit(transaction, changes, now());

    if (apply) {
      await transaction.commit();
      committed = true;
    } else {
      // The dry run's whole contract: everything above was executed against the
      // real schema and none of it survives.
      await transaction.rollback();
    }

    return {
      mode: apply ? "apply" : "dry_run",
      organisationId: BRIGHT_STEPS_ORGANISATION_ID,
      organisationName: BRIGHT_STEPS_ORGANISATION_NAME,
      organisationTimezone: options.organisationTimezone,
      datasetVersion: BRIGHT_STEPS_DATASET_VERSION,
      datasetApprovedOn: BRIGHT_STEPS_DATASET_APPROVED_ON,
      seedingEffectiveFrom: BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM.toISOString(),
      changes,
      counts,
      canonicalRoles,
      excludedNonTradingCentres: BRIGHT_STEPS_NON_TRADING_CENTRES,
      committed,
    };
  } catch (error) {
    if (!committed) {
      await transaction.rollback();
    }
    throw error;
  }
}

/** Renders a report for an operator to read before approving the real load. */
export function formatOrganisationLoadReport(report: OrganisationLoadReport): string {
  const lines: string[] = [];
  const heading = report.mode === "dry_run"
    ? "DRY RUN — nothing was written"
    : "APPLIED — changes committed";
  lines.push(`Bright Steps Academy organisation reference load — ${heading}`);
  lines.push("");
  lines.push(`organisation-id        ${report.organisationId}`);
  lines.push(`organisation-name      ${report.organisationName}`);
  lines.push(`organisation-timezone  ${report.organisationTimezone}  (operator input, not approved dataset)`);
  lines.push(`dataset-version        ${report.datasetVersion} (approved ${report.datasetApprovedOn})`);
  lines.push(`seeding-effective-from ${report.seedingEffectiveFrom}  (SEEDING CONVENTION, not an opening or appointment date)`);
  lines.push("");
  lines.push(`plan: ${report.counts.create} create, ${report.counts.unchanged} unchanged, ${report.counts.conflict} conflict`);
  lines.push("");

  const groups: readonly PlannedResource[] = [
    "organisation",
    "organisational_unit",
    "centre",
    "centre_placement",
  ];
  for (const group of groups) {
    const rows = report.changes.filter((change) => change.resource === group);
    if (rows.length === 0) continue;
    lines.push(`${group} (${rows.length})`);
    for (const row of rows) {
      lines.push(`  ${row.action.padEnd(9)} ${row.label}${row.detail ? `  -- ${row.detail}` : ""}`);
    }
    lines.push("");
  }

  lines.push(`canonical role definitions present: ${report.canonicalRoles.present.length}/${report.canonicalRoles.expected.length}`);
  lines.push(`  ${report.canonicalRoles.present.join(", ")}`);
  if (report.canonicalRoles.missing.length > 0) {
    lines.push(`  MISSING: ${report.canonicalRoles.missing.join(", ")}`);
  }
  lines.push("");
  lines.push(`non-trading sites deliberately NOT loaded (${report.excludedNonTradingCentres.length})`);
  lines.push(`  ${report.excludedNonTradingCentres.join(", ")}`);
  lines.push("");
  lines.push("people: none. This tool creates no principal, membership, or role");
  lines.push("assignment. Staff are provisioned only through the Milestone 2C");
  lines.push("invitation lifecycle, which requires a verified Entra identity.");

  return lines.join("\n");
}
