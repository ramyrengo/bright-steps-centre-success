import type { EnvironmentMeta } from "encore.dev";
import type { Transaction } from "encore.dev/storage/sqldb";
import { recordAuditEventWithExecutor } from "../audit/events";
import { CANONICAL_ROLE_BUNDLES } from "../authorization/roles";
import { requireIanaTimezone } from "../daily-success/time";
import { centreSuccessDB } from "../db";
import { assertLocalDevelopmentEnvironment } from "../authentication/local-identity-linker";
import {
  evaluateReviewedEnvironmentGate,
  environmentRequiresConfirmation,
  REVIEWED_APPLY_ENVIRONMENT_NAMES,
  REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES,
} from "../operations/reviewed-environment-gate";
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
 *
 * It runs in local development, staging, and production. Which of those an
 * `--apply` is allowed to reach is decided by the shared reviewed environment
 * gate in `operations/reviewed-environment-gate.ts` — the same gate the ADR-0021
 * D5 first-administrator ceremony passes — plus the unchanged local assertion
 * below. See `assertEnvironmentGate`.
 */

const ADVISORY_LOCK_KEY_HIGH = 1112691796;
const ADVISORY_LOCK_KEY_LOW = 20260814;

/**
 * The closed set of environments this load may **apply** in: the two reviewed
 * deployed environments, plus local development.
 *
 * `local` appears here and NOT in the shared list because admitting local is a
 * decision about this tool alone. Unlike the first-administrator ceremony, this
 * is a supported local development tool today and stays one — but it earns local
 * by ALSO passing the untouched `assertLocalDevelopmentEnvironment` guard, so an
 * environment merely *named* `local` cannot claim it. Widening this list is a
 * source change under review, not an operator flag.
 */
export const ORGANISATION_LOAD_APPLY_ENVIRONMENT_NAMES = [
  "local",
  ...REVIEWED_APPLY_ENVIRONMENT_NAMES,
] as const;

export type OrganisationLoadFailureCode =
  | "environment_not_declared"
  | "environment_mismatch"
  | "environment_not_permitted"
  | "environment_type_not_permitted"
  | "production_confirmation_required"
  | "confirmation_not_applicable"
  | "local_environment_required"
  | "organisation_timezone_required"
  | "organisation_timezone_invalid"
  | "reference_data_conflict"
  | "organisation_already_populated"
  | "canonical_role_unavailable"
  | "structure_only_violated";

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

export interface OrganisationLoadEnvironmentReport {
  /** What the operator typed. It had to equal `name` to get this far. */
  declared: string;
  name: string;
  type: string;
  cloud: string;
  confirmationRequired: boolean;
}

export interface OrganisationLoadReport {
  mode: "dry_run" | "apply";
  environment: OrganisationLoadEnvironmentReport;
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
  /**
   * People & Access reachability for the loaded organisation, evaluated after
   * the deferred guard has been forced to run. It is asserted to be ZERO: this
   * tool loads structure and grants nobody anything, so the organisation it
   * leaves behind is one that still needs the D5 first-administrator ceremony.
   */
  reachableSystemAdministrators: number;
  committed: boolean;
}

export interface OrganisationLoadOptions {
  /**
   * The environment the operator believes they are pointed at, typed out in
   * full. It is matched against `appMeta().environment.name`; a mismatch refuses
   * before any database work, on dry runs as well as applies. There is
   * deliberately no default — including no default of `local`, because an
   * exemption for local is exactly the hole the gate exists to close.
   */
  declaredEnvironment: string;
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
  /** Required only when applying to production. Refused anywhere else. */
  confirmProduction?: boolean;
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

/**
 * The environment gate.
 *
 * This tool used to assert exact local development on `--apply` and refuse
 * everything else, which left no reviewed way to create the organisation in
 * staging or production — so the ADR-0021 D5 ceremony had nothing to target and
 * no real person could ever be admitted. The assertion is therefore widened, but
 * only by adopting the SAME gate that ceremony already passes rather than a new
 * one of this tool's own devising. It differs from the ceremony's in exactly one
 * respect, deliberately: `local` is in this tool's apply allow-list, because
 * unlike the ceremony this is a supported local development tool.
 *
 * Local is not admitted on the strength of its NAME. When the operator declares
 * `local`, the unchanged `assertLocalDevelopmentEnvironment` from
 * `local-identity-linker.ts` must also pass — exact local cloud, local name, and
 * development type. That guard is not modified, not copied, and not weakened
 * here; it is called. So a cloud environment that somebody names `local` gets a
 * refusal, and the local path behaves exactly as it did before.
 *
 * What this gate is NOT is the safety property. That is environment-independent
 * and enforced separately below: the load stands down entirely once the
 * organisation holds any membership, in every environment, dry run and apply
 * alike.
 */
function assertEnvironmentGate(
  options: OrganisationLoadOptions,
  apply: boolean,
): void {
  const refusal = evaluateReviewedEnvironmentGate(
    {
      declaredEnvironment: options.declaredEnvironment,
      apply,
      confirmProduction: options.confirmProduction,
    },
    options.environment,
    {
      applyEnvironmentNames: ORGANISATION_LOAD_APPLY_ENVIRONMENT_NAMES,
      confirmationEnvironmentNames: REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES,
      refusedTypeConsequence: "create the organisation for real",
      notPermittedNote:
        "widening that list is a source change under review, not an operator flag",
    },
  );

  if (refusal !== null) {
    throw new OrganisationLoadError(refusal.code, refusal.detail);
  }

  if (!apply || options.declaredEnvironment.trim() !== "local") {
    return;
  }

  try {
    assertLocalDevelopmentEnvironment(options.environment);
  } catch {
    throw new OrganisationLoadError(
      "local_environment_required",
      "an environment named local must also report the local cloud and the " +
        "development type; this one reports " +
        `cloud ${options.environment.cloud} and type ${options.environment.type}`,
    );
  }
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

/**
 * Re-checks, after this load's own writes, that the load granted nobody
 * anything. `assertOrganisationUnpopulated` proves the organisation was empty
 * when we started; this proves we left it that way, which is the claim the
 * operator report makes and the reason staff can only arrive through the
 * Milestone 2C invitation lifecycle.
 *
 * `reachable_system_administrator_count` is the People & Access reachability
 * definition from migration 017 and must be zero here. The organisation this
 * tool leaves behind is deliberately one that still needs the D5 ceremony.
 */
async function assertStructureOnly(
  transaction: Transaction,
): Promise<number> {
  const facts = await transaction.queryRow<{
    memberships: number;
    assignments: number;
    scopes: number;
    reachable: number;
  }>`
    SELECT
      (SELECT count(*)::integer FROM organisation_memberships
       WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}) AS memberships,
      (SELECT count(*)::integer FROM role_assignments
       WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}) AS assignments,
      (SELECT count(*)::integer FROM assignment_scopes
       WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}) AS scopes,
      reachable_system_administrator_count(${BRIGHT_STEPS_ORGANISATION_ID}) AS reachable
  `;

  if (facts === null) {
    throw new OrganisationLoadError(
      "structure_only_violated",
      "the structure-only verification query returned no row",
    );
  }

  if (
    facts.memberships > 0 ||
    facts.assignments > 0 ||
    facts.scopes > 0 ||
    facts.reachable > 0
  ) {
    throw new OrganisationLoadError(
      "structure_only_violated",
      `this load would leave ${facts.memberships} membership(s), ` +
        `${facts.assignments} assignment(s), ${facts.scopes} scope(s) and ` +
        `${facts.reachable} reachable System Administrator(s); it creates no ` +
        "principal, membership, or role assignment",
    );
  }

  return facts.reachable;
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
 *
 * The People & Access last-administrator guard from migrations 017 and 018 is
 * DEFERRABLE INITIALLY DEFERRED, and the ADR-0006 provisioning trigger inserts
 * `role_definitions` and `role_capabilities` rows that enqueue it — so it would
 * otherwise fire only at COMMIT and never in a transaction that ends in a
 * rollback. `SET CONSTRAINTS ALL IMMEDIATE` forces it before either outcome, so
 * a dry run exercises exactly what an apply does instead of skipping the one
 * check that only ever runs on the real thing.
 */
export async function loadBrightStepsOrganisationReference(
  options: OrganisationLoadOptions,
): Promise<OrganisationLoadReport> {
  const apply = options.apply === true;
  const now = options.now ?? (() => new Date());

  // First, and before centreSuccessDB.begin(): a refused environment must not be
  // able to open a transaction that could commit. A dry run writes nothing and is
  // permitted in any environment, but must still name the one it is pointed at.
  assertEnvironmentGate(options, apply);

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

    // Force the deferred last-administrator guard from migrations 017 and 018 to
    // run now, so that a dry run exercises it exactly as an apply would.
    await transaction.exec`SET CONSTRAINTS ALL IMMEDIATE`;

    const reachableSystemAdministrators = await assertStructureOnly(transaction);

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
      environment: {
        declared: options.declaredEnvironment.trim(),
        name: options.environment.name,
        type: options.environment.type,
        cloud: options.environment.cloud,
        confirmationRequired: environmentRequiresConfirmation(
          options.environment.name,
        ),
      },
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
      reachableSystemAdministrators,
      committed,
    };
  } catch (error) {
    if (!committed) {
      // The rollback must not be able to replace the error being handled. If
      // commit() itself threw, `committed` is still false and this runs against
      // a transaction that may already be unusable — so a throwing rollback
      // would surface a connection-level message in place of the refusal the
      // operator actually needs to read. The original error always wins.
      try {
        await transaction.rollback();
      } catch {
        // Deliberately swallowed. A rollback that fails here has nothing to
        // tell the operator that `error` does not already tell them better.
      }
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
  lines.push(`environment            ${report.environment.name} (type ${report.environment.type}, cloud ${report.environment.cloud})`);
  lines.push(`declared by operator   ${report.environment.declared}  (matched against appMeta)`);
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
  lines.push(
    `reachable System Administrators after this load: ${report.reachableSystemAdministrators}`,
  );
  lines.push("The organisation this leaves behind still needs the ADR-0021 D5");
  lines.push("first-administrator ceremony before any human can sign in.");

  return lines.join("\n");
}
