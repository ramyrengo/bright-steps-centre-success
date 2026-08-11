import {
  withAuthorisationSnapshot,
  type AuthorisationQueryExecutor,
} from "./database";
import type { AuthorisationResource } from "./policy";

const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type CentreResourceFailureCode =
  | "invalid_identifier"
  | "centre_missing"
  | "centre_inactive"
  | "hierarchy_ambiguous"
  | "hierarchy_inactive"
  | "hierarchy_cycle";

export class CentreResourceContextError extends Error {
  readonly code: CentreResourceFailureCode;

  constructor(code: CentreResourceFailureCode) {
    super(`centre resource context rejected: ${code}`);
    this.name = "CentreResourceContextError";
    this.code = code;
  }
}

export interface LoadCentreAuthorisationResourceInput {
  organisationId: string;
  centreId: string;
  at?: Date;
}

interface CentreRow {
  id: string;
  organisation_id: string;
  status: "active" | "inactive";
}

interface DirectMembershipRow {
  organisational_unit_id: string;
}

interface AncestryRow {
  id: string;
  status: "active" | "inactive";
  effective_from: Date;
  effective_to: Date | null;
  cycle_detected: boolean;
}

function requireCanonicalUuid(value: string): void {
  if (!CANONICAL_UUID.test(value)) {
    throw new CentreResourceContextError("invalid_identifier");
  }
}

function isEffectiveUnit(row: AncestryRow, at: Date): boolean {
  return (
    row.status === "active" &&
    row.effective_from.getTime() <= at.getTime() &&
    (row.effective_to === null || row.effective_to.getTime() > at.getTime())
  );
}

/**
 * Resolves a centre and every current organisational-unit ancestor in one
 * canonical PostgreSQL traversal. Callers never supply or flatten unit IDs.
 */
export async function loadCentreAuthorisationResource(
  input: LoadCentreAuthorisationResourceInput,
): Promise<Extract<AuthorisationResource, { kind: "centre" }>> {
  return withAuthorisationSnapshot((executor) =>
    loadCentreAuthorisationResourceFromSnapshot(executor, input),
  );
}

/** @internal Shared with the composed database authorizer for one read snapshot. */
export async function loadCentreAuthorisationResourceFromSnapshot(
  executor: AuthorisationQueryExecutor,
  input: LoadCentreAuthorisationResourceInput,
): Promise<Extract<AuthorisationResource, { kind: "centre" }>> {
  requireCanonicalUuid(input.organisationId);
  requireCanonicalUuid(input.centreId);
  const at = input.at ?? new Date();

  const centre = await executor.queryRow<CentreRow>`
    SELECT id, organisation_id, status
    FROM centres
    WHERE organisation_id = ${input.organisationId}
      AND id = ${input.centreId}
  `;

  if (centre === null) {
    throw new CentreResourceContextError("centre_missing");
  }

  if (centre.status !== "active") {
    throw new CentreResourceContextError("centre_inactive");
  }

  const directMemberships = await executor.queryAll<DirectMembershipRow>`
    SELECT organisational_unit_id
    FROM centre_organisational_unit_memberships
    WHERE organisation_id = ${centre.organisation_id}
      AND centre_id = ${centre.id}
      AND effective_from <= ${at}
      AND (effective_to IS NULL OR effective_to > ${at})
    ORDER BY organisational_unit_id
  `;

  if (directMemberships.length > 1) {
    throw new CentreResourceContextError("hierarchy_ambiguous");
  }

  if (directMemberships.length === 0) {
    return {
      kind: "centre",
      organisationId: centre.organisation_id,
      centreId: centre.id,
      organisationalUnitIds: [],
    };
  }

  const directUnitId = directMemberships[0].organisational_unit_id;
  const ancestry = await executor.queryAll<AncestryRow>`
    WITH RECURSIVE ancestry AS (
      SELECT
        unit.id,
        unit.parent_id,
        unit.status,
        unit.effective_from,
        unit.effective_to,
        ARRAY[unit.id]::uuid[] AS path,
        FALSE AS cycle_detected
      FROM organisational_units AS unit
      WHERE unit.organisation_id = ${centre.organisation_id}
        AND unit.id = ${directUnitId}

      UNION ALL

      SELECT
        parent.id,
        parent.parent_id,
        parent.status,
        parent.effective_from,
        parent.effective_to,
        child.path || parent.id,
        parent.id = ANY(child.path) AS cycle_detected
      FROM ancestry AS child
      JOIN organisational_units AS parent
        ON parent.organisation_id = ${centre.organisation_id}
       AND parent.id = child.parent_id
      WHERE NOT child.cycle_detected
    )
    SELECT
      id,
      status,
      effective_from,
      effective_to,
      cycle_detected
    FROM ancestry
  `;

  if (ancestry.some((unit) => unit.cycle_detected)) {
    throw new CentreResourceContextError("hierarchy_cycle");
  }

  if (ancestry.some((unit) => !isEffectiveUnit(unit, at))) {
    throw new CentreResourceContextError("hierarchy_inactive");
  }

  return {
    kind: "centre",
    organisationId: centre.organisation_id,
    centreId: centre.id,
    organisationalUnitIds: ancestry.map((unit) => unit.id),
  };
}
