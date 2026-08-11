import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { centreSuccessDB } from "../db";
import { CANONICAL_ROLE_BUNDLES } from "./roles";

interface StoredRoleCapabilityRow {
  role_key: string;
  version: number;
  name: string;
  capability_code: string;
}

function bundleRecord(rows: readonly StoredRoleCapabilityRow[]) {
  const stored = new Map<
    string,
    { name: string; version: number; capabilities: string[] }
  >();

  for (const row of rows) {
    const bundle = stored.get(row.role_key) ?? {
      name: row.name,
      version: row.version,
      capabilities: [],
    };
    bundle.capabilities.push(row.capability_code);
    stored.set(row.role_key, bundle);
  }

  return Object.fromEntries(
    [...stored.entries()].map(([key, bundle]) => [
      key,
      { ...bundle, capabilities: bundle.capabilities.sort() },
    ]),
  );
}

const expectedRoleBundles = Object.fromEntries(
  CANONICAL_ROLE_BUNDLES.map((bundle) => [
    bundle.key,
    {
      name: bundle.name,
      version: bundle.version,
      capabilities: [...bundle.capabilities].sort(),
    },
  ]),
);

describe("canonical foundation role templates", () => {
  test("database bundles exactly match the reviewed TypeScript model", async () => {
    const rows = await centreSuccessDB.queryAll<StoredRoleCapabilityRow>`
      SELECT
        template.role_key,
        template.version,
        template.name,
        role_capability.capability_code
      FROM canonical_role_templates AS template
      JOIN canonical_role_template_capabilities AS role_capability
        ON role_capability.role_key = template.role_key
       AND role_capability.role_version = template.version
      WHERE template.status = 'active'
      ORDER BY template.role_key, role_capability.capability_code
    `;

    expect(bundleRecord(rows)).toEqual(expectedRoleBundles);
  });

  test("a new organisation receives evolvable role definitions but no access grants", async () => {
    const organisationId = randomUUID();

    await centreSuccessDB.exec`
      INSERT INTO organisations (id, name, status, default_timezone)
      VALUES (
        ${organisationId},
        'Synthetic role-bootstrap organisation',
        'active',
        'Australia/Sydney'
      )
    `;

    const provisioned = await centreSuccessDB.queryAll<StoredRoleCapabilityRow>`
      SELECT
        role.role_key,
        role.version,
        role.name,
        role_capability.capability_code
      FROM role_definitions AS role
      JOIN role_capabilities AS role_capability
        ON role_capability.role_definition_id = role.id
      WHERE role.organisation_id = ${organisationId}
        AND role.status = 'active'
        AND role.source_template_key = role.role_key
        AND role.source_template_version = role.version
      ORDER BY role.role_key, role_capability.capability_code
    `;

    expect(bundleRecord(provisioned)).toEqual(expectedRoleBundles);

    const grants = await centreSuccessDB.queryRow<{
      memberships: number;
      assignments: number;
    }>`
      SELECT
        (
          SELECT count(*)::integer
          FROM organisation_memberships
          WHERE organisation_id = ${organisationId}
        ) AS memberships,
        (
          SELECT count(*)::integer
          FROM role_assignments
          WHERE organisation_id = ${organisationId}
        ) AS assignments
    `;

    expect(grants).toEqual({ memberships: 0, assignments: 0 });
  });
});
