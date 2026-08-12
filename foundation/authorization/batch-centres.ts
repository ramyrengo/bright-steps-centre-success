import type { AuthorisationQueryExecutor } from "./database";
import type { AuthorisationResource } from "./policy";
import { CentreResourceContextError } from "./hierarchy";

interface CentreResourceRow {
  id: string;
  name: string;
  timezone: string;
  direct_membership_count: number | string;
  organisational_unit_ids: unknown;
  has_cycle: boolean;
  has_inactive_unit: boolean;
}

export interface CentreAuthorisationFact {
  id: string;
  name: string;
  timezone: string;
  resource: Extract<AuthorisationResource, { kind: "centre" }>;
}

export type CentreAuthorisationIssueReason =
  | "hierarchy_ambiguous"
  | "hierarchy_cycle"
  | "hierarchy_inactive";

export interface InvalidCentreAuthorisationFact {
  id: string;
  name: string;
  reason: CentreAuthorisationIssueReason;
  organisationalUnitIds: string[];
}

export interface OrganisationCentreAuthorisationFacts {
  centres: CentreAuthorisationFact[];
  invalidCentres: InvalidCentreAuthorisationFact[];
}

function parseUuidArray(value: unknown): string[] {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new CentreResourceContextError("hierarchy_inactive");
  }
  return value;
}

/**
 * Resolves every active centre and its effective ancestry with one set-wise
 * database query. It preserves the same fail-closed hierarchy invariants as
 * the single-centre loader without introducing a query per centre.
 */
export async function loadOrganisationCentreAuthorisationFacts(
  executor: AuthorisationQueryExecutor,
  organisationId: string,
  at: Date,
): Promise<OrganisationCentreAuthorisationFacts> {
  const rows = await executor.queryAll<CentreResourceRow>`
    WITH RECURSIVE
    active_centres AS (
      SELECT centre.id, centre.name, centre.timezone
      FROM centres AS centre
      WHERE centre.organisation_id = ${organisationId}
        AND centre.status = 'active'
    ),
    direct_memberships AS (
      SELECT membership.centre_id, membership.organisational_unit_id
      FROM centre_organisational_unit_memberships AS membership
      JOIN active_centres AS centre ON centre.id = membership.centre_id
      WHERE membership.organisation_id = ${organisationId}
        AND membership.effective_from <= ${at}
        AND (membership.effective_to IS NULL OR membership.effective_to > ${at})
    ),
    ancestry AS (
      SELECT
        membership.centre_id,
        unit.id,
        unit.parent_id,
        unit.status,
        unit.effective_from,
        unit.effective_to,
        ARRAY[unit.id]::uuid[] AS path,
        FALSE AS cycle_detected
      FROM direct_memberships AS membership
      JOIN organisational_units AS unit
        ON unit.organisation_id = ${organisationId}
       AND unit.id = membership.organisational_unit_id

      UNION ALL

      SELECT
        child.centre_id,
        parent.id,
        parent.parent_id,
        parent.status,
        parent.effective_from,
        parent.effective_to,
        child.path || parent.id,
        parent.id = ANY(child.path) AS cycle_detected
      FROM ancestry AS child
      JOIN organisational_units AS parent
        ON parent.organisation_id = ${organisationId}
       AND parent.id = child.parent_id
      WHERE NOT child.cycle_detected
    )
    SELECT
      centre.id,
      centre.name,
      centre.timezone,
      count(DISTINCT direct.organisational_unit_id) AS direct_membership_count,
      COALESCE(
        jsonb_agg(DISTINCT ancestry.id::text ORDER BY ancestry.id::text)
          FILTER (WHERE ancestry.id IS NOT NULL),
        '[]'::jsonb
      ) AS organisational_unit_ids,
      COALESCE(bool_or(ancestry.cycle_detected), FALSE) AS has_cycle,
      COALESCE(bool_or(
        ancestry.status <> 'active'
        OR ancestry.effective_from > ${at}
        OR (ancestry.effective_to IS NOT NULL AND ancestry.effective_to <= ${at})
      ), FALSE) AS has_inactive_unit
    FROM active_centres AS centre
    LEFT JOIN direct_memberships AS direct ON direct.centre_id = centre.id
    LEFT JOIN ancestry ON ancestry.centre_id = centre.id
    GROUP BY centre.id, centre.name, centre.timezone
    ORDER BY centre.name, centre.id
  `;

  const centres: CentreAuthorisationFact[] = [];
  const invalidCentres: InvalidCentreAuthorisationFact[] = [];
  for (const row of rows) {
    const organisationalUnitIds = parseUuidArray(row.organisational_unit_ids);
    if (Number(row.direct_membership_count) > 1) {
      invalidCentres.push({ id: row.id, name: row.name, reason: "hierarchy_ambiguous", organisationalUnitIds });
      continue;
    }
    if (row.has_cycle) {
      invalidCentres.push({ id: row.id, name: row.name, reason: "hierarchy_cycle", organisationalUnitIds });
      continue;
    }
    if (row.has_inactive_unit) {
      invalidCentres.push({ id: row.id, name: row.name, reason: "hierarchy_inactive", organisationalUnitIds });
      continue;
    }
    centres.push({
      id: row.id,
      name: row.name,
      timezone: row.timezone,
      resource: {
        kind: "centre",
        organisationId,
        centreId: row.id,
        organisationalUnitIds,
      },
    });
  }
  return { centres, invalidCentres };
}
