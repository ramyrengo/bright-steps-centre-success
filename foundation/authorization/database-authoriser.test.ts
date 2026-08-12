import { randomUUID } from "node:crypto";
import { describe, expect, test, vi } from "vitest";
import { centreSuccessDB } from "../db";
import { FOUNDATION_CAPABILITIES as capability } from "./capabilities";
import { loadPrincipalAuthorisationContext } from "./context-loader";
import { authoriseCentreFromDatabase } from "./database-authoriser";
import {
  loadCentreAuthorisationResource,
} from "./hierarchy";
import { authorise, type AssignmentScope } from "./policy";
import type { CanonicalRoleKey } from "./roles";

const JANUARY = new Date("2026-01-01T00:00:00.000Z");
const JUNE = new Date("2026-06-01T00:00:00.000Z");
const JULY = new Date("2026-07-01T00:00:00.000Z");
const AUGUST = new Date("2026-08-11T00:00:00.000Z");
const OCTOBER = new Date("2026-10-01T00:00:00.000Z");

interface TestScopeWindow {
  scope: AssignmentScope;
  effectiveFrom?: Date;
  effectiveTo?: Date;
}

interface AddAssignmentInput {
  organisationId: string;
  membershipId: string;
  roleKey: CanonicalRoleKey;
  scopes: readonly TestScopeWindow[];
  status?: "active" | "inactive";
  effectiveFrom?: Date;
  effectiveTo?: Date;
}

async function addOrganisation(label: string): Promise<string> {
  const id = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (${id}, ${label}, 'active', 'Australia/Sydney')
  `;

  return id;
}

async function addUnit(
  organisationId: string,
  kind: "state" | "region" | "centre_group",
  label: string,
  parentId: string | null = null,
): Promise<string> {
  const id = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO organisational_units (
      id,
      organisation_id,
      parent_id,
      kind,
      code,
      name,
      status,
      effective_from
    ) VALUES (
      ${id},
      ${organisationId},
      ${parentId},
      ${kind},
      ${id.slice(0, 12)},
      ${label},
      'active',
      ${JANUARY}
    )
  `;

  return id;
}

async function addCentre(
  organisationId: string,
  label: string,
): Promise<string> {
  const id = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO centres (
      id,
      organisation_id,
      code,
      name,
      jurisdiction_code,
      timezone,
      status
    ) VALUES (
      ${id},
      ${organisationId},
      ${id.slice(0, 12)},
      ${label},
      'NSW',
      'Australia/Sydney',
      'active'
    )
  `;

  return id;
}

async function placeCentre(
  organisationId: string,
  centreId: string,
  organisationalUnitId: string,
  effectiveFrom = JANUARY,
  effectiveTo?: Date,
): Promise<void> {
  await centreSuccessDB.exec`
    INSERT INTO centre_organisational_unit_memberships (
      id,
      organisation_id,
      centre_id,
      organisational_unit_id,
      effective_from,
      effective_to
    ) VALUES (
      ${randomUUID()},
      ${organisationId},
      ${centreId},
      ${organisationalUnitId},
      ${effectiveFrom},
      ${effectiveTo ?? null}
    )
  `;
}

async function addPrincipal(
  label: string,
  status: "pending" | "active" | "suspended" | "revoked" = "active",
): Promise<string> {
  const id = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${id}, ${label}, ${status})
  `;

  return id;
}

async function addMembership(
  organisationId: string,
  principalId: string,
  options: {
    status?: "active" | "inactive";
    effectiveFrom?: Date;
    effectiveTo?: Date;
  } = {},
): Promise<string> {
  const id = randomUUID();

  await centreSuccessDB.exec`
    INSERT INTO organisation_memberships (
      id,
      organisation_id,
      principal_id,
      status,
      effective_from,
      effective_to
    ) VALUES (
      ${id},
      ${organisationId},
      ${principalId},
      ${options.status ?? "active"},
      ${options.effectiveFrom ?? JANUARY},
      ${options.effectiveTo ?? null}
    )
  `;

  return id;
}

async function canonicalRoleDefinitionId(
  organisationId: string,
  roleKey: CanonicalRoleKey,
): Promise<string> {
  const role = await centreSuccessDB.queryRow<{ id: string }>`
    SELECT id
    FROM role_definitions
    WHERE organisation_id = ${organisationId}
      AND role_key = ${roleKey}
      AND status = 'active'
    ORDER BY version DESC
    LIMIT 1
  `;

  if (role === null) {
    throw new Error(`canonical role was not provisioned: ${roleKey}`);
  }

  return role.id;
}

async function addAssignment(input: AddAssignmentInput): Promise<string> {
  const id = randomUUID();
  const effectiveFrom = input.effectiveFrom ?? JANUARY;
  const roleDefinitionId = await canonicalRoleDefinitionId(
    input.organisationId,
    input.roleKey,
  );

  await centreSuccessDB.exec`
    INSERT INTO role_assignments (
      id,
      organisation_id,
      organisation_membership_id,
      role_definition_id,
      status,
      effective_from,
      effective_to,
      grant_source_type,
      reason
    ) VALUES (
      ${id},
      ${input.organisationId},
      ${input.membershipId},
      ${roleDefinitionId},
      ${input.status ?? "active"},
      ${effectiveFrom},
      ${input.effectiveTo ?? null},
      'bootstrap',
      'Synthetic authorization integration fixture.'
    )
  `;

  for (const window of input.scopes) {
    const organisationalUnitId =
      window.scope.type === "organisational_unit"
        ? window.scope.organisationalUnitId
        : null;
    const centreId =
      window.scope.type === "centre" ? window.scope.centreId : null;

    await centreSuccessDB.exec`
      INSERT INTO assignment_scopes (
        id,
        organisation_id,
        role_assignment_id,
        scope_type,
        organisational_unit_id,
        centre_id,
        effective_from,
        effective_to
      ) VALUES (
        ${randomUUID()},
        ${input.organisationId},
        ${id},
        ${window.scope.type},
        ${organisationalUnitId},
        ${centreId},
        ${window.effectiveFrom ?? effectiveFrom},
        ${window.effectiveTo ?? input.effectiveTo ?? null}
      )
    `;
  }

  return id;
}

async function addSimpleCentreTree(organisationId: string, label: string) {
  const state = await addUnit(organisationId, "state", `${label} state`);
  const region = await addUnit(
    organisationId,
    "region",
    `${label} region`,
    state,
  );
  const group = await addUnit(
    organisationId,
    "centre_group",
    `${label} group`,
    region,
  );
  const centre = await addCentre(organisationId, `${label} centre`);
  await placeCentre(organisationId, centre, group);
  return { state, region, group, centre };
}

describe("database-backed foundation authorization", () => {
  test("loads canonical context and keeps Assistant Director below Centre Director", async () => {
    const organisationId = await addOrganisation("Context loader organisation");
    const tree = await addSimpleCentreTree(organisationId, "Context loader");
    const principalId = await addPrincipal("Synthetic Assistant Director");
    const membershipId = await addMembership(organisationId, principalId);
    const assignmentId = await addAssignment({
      organisationId,
      membershipId,
      roleKey: "assistant_director",
      scopes: [{ scope: { type: "centre", centreId: tree.centre } }],
    });

    const context = await loadPrincipalAuthorisationContext({
      principalId,
      activeOrganisationId: organisationId,
      at: AUGUST,
    });

    expect(context).toMatchObject({
      principalId,
      activeOrganisationId: organisationId,
      memberships: [{ id: membershipId, principalId, organisationId }],
      assignments: [
        {
          id: assignmentId,
          membershipId,
          roleKey: "assistant_director",
          capabilities: [capability.centreRead],
          scopes: [{ type: "centre", centreId: tree.centre }],
        },
      ],
    });

    await expect(
      authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId: tree.centre,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).resolves.toMatchObject({ allowed: true, assignmentId });

    await expect(
      authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId: tree.centre,
        capability: capability.centreManage,
        at: AUGUST,
      }),
    ).resolves.toEqual({ allowed: false, reason: "capability_missing" });

    const decisionClock = vi.fn(() => AUGUST);
    await expect(
      authoriseCentreFromDatabase(
        {
          principalId,
          activeOrganisationId: organisationId,
          centreId: tree.centre,
          capability: capability.centreRead,
        },
        decisionClock,
      ),
    ).resolves.toMatchObject({ allowed: true, assignmentId });
    expect(decisionClock).toHaveBeenCalledTimes(1);
  });

  test("Centre Director and Area Manager access only assigned centres", async () => {
    const organisationId = await addOrganisation("Centre isolation organisation");
    const centreA = await addSimpleCentreTree(organisationId, "Assigned A");
    const centreB = await addSimpleCentreTree(organisationId, "Unassigned B");
    const otherOrganisationId = await addOrganisation("Other tenant");
    const otherCentre = await addSimpleCentreTree(otherOrganisationId, "Other tenant");

    const directorId = await addPrincipal("Synthetic Centre Director");
    const directorMembershipId = await addMembership(organisationId, directorId);
    await addAssignment({
      organisationId,
      membershipId: directorMembershipId,
      roleKey: "centre_director",
      scopes: [{ scope: { type: "centre", centreId: centreA.centre } }],
    });

    expect(
      await authoriseCentreFromDatabase({
        principalId: directorId,
        activeOrganisationId: organisationId,
        centreId: centreA.centre,
        capability: capability.centreManage,
        at: AUGUST,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await authoriseCentreFromDatabase({
        principalId: directorId,
        activeOrganisationId: organisationId,
        centreId: centreB.centre,
        capability: capability.centreManage,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });
    expect(
      await authoriseCentreFromDatabase({
        principalId: directorId,
        activeOrganisationId: organisationId,
        centreId: otherCentre.centre,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "invalid_resource" });

    const areaManagerId = await addPrincipal("Synthetic Area Manager");
    const areaMembershipId = await addMembership(
      organisationId,
      areaManagerId,
    );
    await addAssignment({
      organisationId,
      membershipId: areaMembershipId,
      roleKey: "area_manager",
      scopes: [{ scope: { type: "centre", centreId: centreA.centre } }],
    });

    expect(
      await authoriseCentreFromDatabase({
        principalId: areaManagerId,
        activeOrganisationId: organisationId,
        centreId: centreA.centre,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await authoriseCentreFromDatabase({
        principalId: areaManagerId,
        activeOrganisationId: organisationId,
        centreId: centreB.centre,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });
  });

  test("resolves state and region ancestors without caller-supplied IDs", async () => {
    const organisationId = await addOrganisation("Hierarchy organisation");
    const stateA = await addUnit(organisationId, "state", "State A");
    const regionA = await addUnit(organisationId, "region", "Region A", stateA);
    const groupA = await addUnit(
      organisationId,
      "centre_group",
      "Group A",
      regionA,
    );
    const centreA = await addCentre(organisationId, "Nested centre A");
    await placeCentre(organisationId, centreA, groupA);

    const regionB = await addUnit(organisationId, "region", "Region B", stateA);
    const groupB = await addUnit(
      organisationId,
      "centre_group",
      "Group B",
      regionB,
    );
    const centreB = await addCentre(organisationId, "Sibling centre B");
    await placeCentre(organisationId, centreB, groupB);

    const stateC = await addUnit(organisationId, "state", "State C");
    const regionC = await addUnit(organisationId, "region", "Region C", stateC);
    const centreC = await addCentre(organisationId, "Other-state centre C");
    await placeCentre(organisationId, centreC, regionC);

    const expiredPlacementCentre = await addCentre(
      organisationId,
      "Expired-placement centre",
    );
    await placeCentre(
      organisationId,
      expiredPlacementCentre,
      groupA,
      JANUARY,
      JUNE,
    );

    const stateLeaderId = await addPrincipal("Synthetic state leader");
    const stateMembershipId = await addMembership(
      organisationId,
      stateLeaderId,
    );
    await addAssignment({
      organisationId,
      membershipId: stateMembershipId,
      roleKey: "operations_leadership",
      scopes: [
        {
          scope: {
            type: "organisational_unit",
            organisationalUnitId: stateA,
          },
        },
      ],
    });

    expect(
      await authoriseCentreFromDatabase({
        principalId: stateLeaderId,
        activeOrganisationId: organisationId,
        centreId: centreA,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await authoriseCentreFromDatabase({
        principalId: stateLeaderId,
        activeOrganisationId: organisationId,
        centreId: centreC,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });
    expect(
      await authoriseCentreFromDatabase({
        principalId: stateLeaderId,
        activeOrganisationId: organisationId,
        centreId: expiredPlacementCentre,
        capability: capability.centreRead,
        at: new Date("2026-05-01T00:00:00.000Z"),
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await authoriseCentreFromDatabase({
        principalId: stateLeaderId,
        activeOrganisationId: organisationId,
        centreId: expiredPlacementCentre,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });

    const regionLeaderId = await addPrincipal("Synthetic region leader");
    const regionMembershipId = await addMembership(
      organisationId,
      regionLeaderId,
    );
    await addAssignment({
      organisationId,
      membershipId: regionMembershipId,
      roleKey: "operations_leadership",
      scopes: [
        {
          scope: {
            type: "organisational_unit",
            organisationalUnitId: regionA,
          },
        },
      ],
    });

    expect(
      await authoriseCentreFromDatabase({
        principalId: regionLeaderId,
        activeOrganisationId: organisationId,
        centreId: centreA,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await authoriseCentreFromDatabase({
        principalId: regionLeaderId,
        activeOrganisationId: organisationId,
        centreId: centreB,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });
    expect(
      await authoriseCentreFromDatabase({
        principalId: regionLeaderId,
        activeOrganisationId: organisationId,
        centreId: centreC,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });
  });

  test("applies half-open assignment and portfolio scope windows", async () => {
    const organisationId = await addOrganisation("Effective assignment organisation");
    const activeCentre = await addSimpleCentreTree(organisationId, "Active scope");
    const futureCentre = await addSimpleCentreTree(organisationId, "Future scope");
    const expiredCentre = await addSimpleCentreTree(organisationId, "Expired scope");
    const removedCentre = await addSimpleCentreTree(organisationId, "Removed portfolio");
    const principalId = await addPrincipal("Synthetic effective Area Manager");
    const membershipId = await addMembership(organisationId, principalId);

    await addAssignment({
      organisationId,
      membershipId,
      roleKey: "area_manager",
      scopes: [
        { scope: { type: "centre", centreId: activeCentre.centre } },
        {
          scope: { type: "centre", centreId: removedCentre.centre },
          effectiveTo: JUNE,
        },
      ],
    });
    await addAssignment({
      organisationId,
      membershipId,
      roleKey: "area_manager",
      effectiveFrom: OCTOBER,
      scopes: [{ scope: { type: "centre", centreId: futureCentre.centre } }],
    });
    await addAssignment({
      organisationId,
      membershipId,
      roleKey: "area_manager",
      effectiveTo: JUNE,
      scopes: [{ scope: { type: "centre", centreId: expiredCentre.centre } }],
    });

    expect(
      await authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId: activeCentre.centre,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId: futureCentre.centre,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });
    expect(
      await authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId: expiredCentre.centre,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });
    expect(
      await authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId: removedCentre.centre,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });
    expect(
      await authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId: removedCentre.centre,
        capability: capability.centreRead,
        at: new Date("2026-05-01T00:00:00.000Z"),
      }),
    ).toMatchObject({ allowed: true });
  });

  test("a centre move changes ancestor access at the exact effective boundary", async () => {
    const organisationId = await addOrganisation("Centre move organisation");
    const oldState = await addUnit(organisationId, "state", "Old state");
    const oldRegion = await addUnit(
      organisationId,
      "region",
      "Old region",
      oldState,
    );
    const newState = await addUnit(organisationId, "state", "New state");
    const newRegion = await addUnit(
      organisationId,
      "region",
      "New region",
      newState,
    );
    const centreId = await addCentre(organisationId, "Moving centre");
    await placeCentre(organisationId, centreId, oldRegion, JANUARY, JULY);
    await placeCentre(organisationId, centreId, newRegion, JULY);

    const principalId = await addPrincipal("Synthetic moving-scope leader");
    const membershipId = await addMembership(organisationId, principalId);
    const oldAssignmentId = await addAssignment({
      organisationId,
      membershipId,
      roleKey: "operations_leadership",
      scopes: [
        {
          scope: {
            type: "organisational_unit",
            organisationalUnitId: oldState,
          },
        },
      ],
    });
    const newAssignmentId = await addAssignment({
      organisationId,
      membershipId,
      roleKey: "operations_leadership",
      scopes: [
        {
          scope: {
            type: "organisational_unit",
            organisationalUnitId: newState,
          },
        },
      ],
    });

    expect(
      await authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId,
        capability: capability.centreRead,
        at: JUNE,
      }),
    ).toMatchObject({ allowed: true, assignmentId: oldAssignmentId });
    expect(
      await authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId,
        capability: capability.centreRead,
        at: JULY,
      }),
    ).toMatchObject({ allowed: true, assignmentId: newAssignmentId });
  });

  test("overlapping roles remain complete grants without privilege recombination", async () => {
    const organisationId = await addOrganisation("Atomic grants organisation");
    const centreA = await addSimpleCentreTree(organisationId, "Director centre");
    const centreB = await addSimpleCentreTree(organisationId, "Operations centre");
    const principalId = await addPrincipal("Synthetic multi-role principal");
    const membershipId = await addMembership(organisationId, principalId);
    await addAssignment({
      organisationId,
      membershipId,
      roleKey: "centre_director",
      scopes: [{ scope: { type: "centre", centreId: centreA.centre } }],
    });
    await addAssignment({
      organisationId,
      membershipId,
      roleKey: "operations_leadership",
      scopes: [
        {
          scope: {
            type: "organisational_unit",
            organisationalUnitId: centreB.state,
          },
        },
      ],
    });

    expect(
      await authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId: centreA.centre,
        capability: capability.centreManage,
        at: AUGUST,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId: centreB.centre,
        capability: capability.assignmentRead,
        at: AUGUST,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      await authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId: centreB.centre,
        capability: capability.centreManage,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });
    expect(
      await authoriseCentreFromDatabase({
        principalId,
        activeOrganisationId: organisationId,
        centreId: centreA.centre,
        capability: capability.assignmentRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });
  });

  test("inactive, missing, expired, ambiguous, and conflicting contexts fail closed", async () => {
    const organisationId = await addOrganisation("Fail-closed organisation");
    const tree = await addSimpleCentreTree(organisationId, "Fail closed");

    const inactivePrincipalId = await addPrincipal("Inactive principal");
    await addMembership(organisationId, inactivePrincipalId);
    await centreSuccessDB.exec`
      UPDATE principals SET status = 'suspended' WHERE id = ${inactivePrincipalId}
    `;
    expect(
      await authoriseCentreFromDatabase({
        principalId: inactivePrincipalId,
        activeOrganisationId: organisationId,
        centreId: tree.centre,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "principal_inactive" });

    const missingMembershipPrincipalId = await addPrincipal(
      "Missing membership principal",
    );
    expect(
      await authoriseCentreFromDatabase({
        principalId: missingMembershipPrincipalId,
        activeOrganisationId: organisationId,
        centreId: tree.centre,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "membership_missing" });

    const expiredMembershipPrincipalId = await addPrincipal(
      "Expired membership principal",
    );
    await addMembership(organisationId, expiredMembershipPrincipalId, {
      effectiveTo: JUNE,
    });
    expect(
      await authoriseCentreFromDatabase({
        principalId: expiredMembershipPrincipalId,
        activeOrganisationId: organisationId,
        centreId: tree.centre,
        capability: capability.centreRead,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "membership_missing" });

    const ambiguousPrincipalId = await addPrincipal("Ambiguous principal");
    await addMembership(organisationId, ambiguousPrincipalId);
    await addMembership(organisationId, ambiguousPrincipalId);
    await expect(
      loadPrincipalAuthorisationContext({
        principalId: ambiguousPrincipalId,
        activeOrganisationId: organisationId,
        at: AUGUST,
      }),
    ).rejects.toMatchObject({
      code: "membership_ambiguous",
    });

    const conflictingCentre = await addCentre(
      organisationId,
      "Conflicting hierarchy centre",
    );
    await placeCentre(organisationId, conflictingCentre, tree.region);
    await placeCentre(organisationId, conflictingCentre, tree.state);
    await expect(
      loadCentreAuthorisationResource({
        organisationId,
        centreId: conflictingCentre,
        at: AUGUST,
      }),
    ).rejects.toMatchObject({
      code: "hierarchy_ambiguous",
    });

    const cycleState = await addUnit(
      organisationId,
      "state",
      "Cycle state",
    );
    const cycleRegion = await addUnit(
      organisationId,
      "region",
      "Cycle region",
      cycleState,
    );
    await centreSuccessDB.exec`
      UPDATE organisational_units
      SET parent_id = ${cycleRegion}
      WHERE organisation_id = ${organisationId}
        AND id = ${cycleState}
    `;
    const cycleCentre = await addCentre(organisationId, "Cycle centre");
    await placeCentre(organisationId, cycleCentre, cycleRegion);

    await expect(
      loadCentreAuthorisationResource({
        organisationId,
        centreId: cycleCentre,
        at: AUGUST,
      }),
    ).rejects.toMatchObject({ code: "hierarchy_cycle" });
  });

  test("System Administrator technical access does not imply centre content read", async () => {
    const organisationId = await addOrganisation("System administration organisation");
    const tree = await addSimpleCentreTree(organisationId, "System admin");
    const principalId = await addPrincipal("Synthetic System Administrator");
    const membershipId = await addMembership(organisationId, principalId);
    await addAssignment({
      organisationId,
      membershipId,
      roleKey: "system_administrator",
      scopes: [{ scope: { type: "organisation" } }],
    });

    const context = await loadPrincipalAuthorisationContext({
      principalId,
      activeOrganisationId: organisationId,
      at: AUGUST,
    });
    const centreResource = await loadCentreAuthorisationResource({
      organisationId,
      centreId: tree.centre,
      at: AUGUST,
    });

    expect(
      authorise({
        context,
        capability: capability.systemConfigure,
        resource: { kind: "organisation", organisationId },
        at: AUGUST,
      }),
    ).toMatchObject({ allowed: true });
    expect(
      authorise({
        context,
        capability: capability.centreRead,
        resource: centreResource,
        at: AUGUST,
      }),
    ).toEqual({ allowed: false, reason: "capability_missing" });
  });
});
