import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { centreSuccessDB } from "../db";

async function insertOrganisation(name: string): Promise<string> {
  const id = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (${id}, ${name}, 'active', 'Australia/Sydney')
  `;

  return id;
}

async function insertPrincipal(name: string): Promise<string> {
  const id = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${id}, ${name}, 'active')
  `;

  return id;
}

async function insertMembership(
  organisationId: string,
  principalId: string,
): Promise<string> {
  const id = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO organisation_memberships (
      id,
      organisation_id,
      principal_id,
      status
    ) VALUES (${id}, ${organisationId}, ${principalId}, 'active')
  `;

  return id;
}

async function insertRoleDefinition(organisationId: string): Promise<string> {
  const id = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO role_definitions (
      id,
      organisation_id,
      role_key,
      name,
      status
    ) VALUES (
      ${id},
      ${organisationId},
      ${`synthetic_${id.replaceAll("-", "")}`},
      'Synthetic test role',
      'active'
    )
  `;

  return id;
}

describe("role-assignment attribution schema", () => {
  test("accepts an attributable grant from an active in-organisation principal", async () => {
    const organisationId = await insertOrganisation("Assignment organisation");
    const recipientId = await insertPrincipal("Synthetic recipient");
    const grantorId = await insertPrincipal("Synthetic grantor");
    const membershipId = await insertMembership(organisationId, recipientId);
    await insertMembership(organisationId, grantorId);
    const roleDefinitionId = await insertRoleDefinition(organisationId);
    const assignmentId = randomUUID();

    await expect(
      centreSuccessDB.exec`
        INSERT INTO role_assignments (
          id,
          organisation_id,
          organisation_membership_id,
          role_definition_id,
          status,
          granted_by_principal_id,
          grant_source_type,
          reason
        ) VALUES (
          ${assignmentId},
          ${organisationId},
          ${membershipId},
          ${roleDefinitionId},
          'active',
          ${grantorId},
          'principal',
          'Approved synthetic role assignment.'
        )
      `,
    ).resolves.toBeUndefined();
  });

  test("rejects missing attribution, blank reason, and a cross-organisation grantor", async () => {
    const organisationA = await insertOrganisation("Grant organisation A");
    const organisationB = await insertOrganisation("Grant organisation B");
    const recipientId = await insertPrincipal("Synthetic recipient B");
    const grantorId = await insertPrincipal("Synthetic external grantor");
    const membershipId = await insertMembership(organisationA, recipientId);
    await insertMembership(organisationB, grantorId);
    const roleDefinitionId = await insertRoleDefinition(organisationA);

    await expect(
      centreSuccessDB.exec`
        INSERT INTO role_assignments (
          id,
          organisation_id,
          organisation_membership_id,
          role_definition_id,
          status,
          grant_source_type,
          reason
        ) VALUES (
          ${randomUUID()},
          ${organisationA},
          ${membershipId},
          ${roleDefinitionId},
          'active',
          'principal',
          'Missing grantor must fail.'
        )
      `,
    ).rejects.toThrow();

    await expect(
      centreSuccessDB.exec`
        INSERT INTO role_assignments (
          id,
          organisation_id,
          organisation_membership_id,
          role_definition_id,
          status,
          granted_by_principal_id,
          grant_source_type,
          reason
        ) VALUES (
          ${randomUUID()},
          ${organisationA},
          ${membershipId},
          ${roleDefinitionId},
          'active',
          ${grantorId},
          'principal',
          ' '
        )
      `,
    ).rejects.toThrow();

    await expect(
      centreSuccessDB.exec`
        INSERT INTO role_assignments (
          id,
          organisation_id,
          organisation_membership_id,
          role_definition_id,
          status,
          granted_by_principal_id,
          grant_source_type,
          reason
        ) VALUES (
          ${randomUUID()},
          ${organisationA},
          ${membershipId},
          ${roleDefinitionId},
          'active',
          ${grantorId},
          'principal',
          'Cross-organisation grantor must fail.'
        )
      `,
    ).rejects.toThrow(
      "role-assignment grantor is not an active organisation member",
    );
  });
});
