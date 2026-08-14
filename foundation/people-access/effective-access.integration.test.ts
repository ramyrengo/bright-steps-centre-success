import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import { authoriseCentreFromDatabase } from "../authorization/database-authoriser";
import { centreSuccessDB } from "../db";
import { getEffectiveAccess } from "./effective-access";

const DECISION_AT = new Date("2026-08-11T12:00:00.000Z");

interface Fixture {
  organisationId: string;
  centreA: string;
  centreB: string;
  directorId: string;
  inactiveId: string;
}

let fixture: Fixture;

async function addCentre(organisationId: string, label: string): Promise<string> {
  const id = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO centres (
      id, organisation_id, code, name, jurisdiction_code, timezone, status
    ) VALUES (
      ${id}, ${organisationId}, ${id.slice(0, 12)}, ${label}, 'NSW', 'Australia/Sydney', 'active'
    )
  `;
  return id;
}

/**
 * Builds a principal holding one canonical role at one centre scope. The role
 * definitions are provisioned for the organisation by the ADR-0006 trigger, so
 * this reads the definition back rather than inventing capability rows.
 */
async function addCentreScopedPerson(
  organisationId: string,
  label: string,
  roleKey: string,
  centreId: string,
): Promise<string> {
  const principalId = randomUUID();
  const membershipId = randomUUID();
  const assignmentId = randomUUID();
  const role = await centreSuccessDB.queryRow<{ id: string }>`
    SELECT id FROM role_definitions
    WHERE organisation_id = ${organisationId}
      AND role_key = ${roleKey}
      AND status = 'active'
  `;
  if (!role) throw new Error(`${roleKey} role missing`);
  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${principalId}, ${label}, 'active')
  `;
  await centreSuccessDB.exec`
    INSERT INTO organisation_memberships (
      id, organisation_id, principal_id, status, effective_from
    ) VALUES (${membershipId}, ${organisationId}, ${principalId}, 'active', '2026-01-01')
  `;
  await centreSuccessDB.exec`
    INSERT INTO role_assignments (
      id, organisation_id, organisation_membership_id, role_definition_id,
      status, effective_from, granted_by_principal_id, grant_source_type, reason
    ) VALUES (
      ${assignmentId}, ${organisationId}, ${membershipId}, ${role.id}, 'active',
      '2026-01-01', NULL, 'bootstrap', 'Synthetic effective-access integration fixture.'
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO assignment_scopes (
      id, organisation_id, role_assignment_id, scope_type, centre_id, effective_from
    ) VALUES (
      ${randomUUID()}, ${organisationId}, ${assignmentId}, 'centre', ${centreId}, '2026-01-01'
    )
  `;
  return principalId;
}

beforeAll(async () => {
  const organisationId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (${organisationId}, 'Effective access organisation', 'active', 'Australia/Sydney')
  `;
  const centreA = await addCentre(organisationId, "Effective Access Centre A");
  const centreB = await addCentre(organisationId, "Effective Access Centre B");
  const directorId = await addCentreScopedPerson(
    organisationId,
    "Effective Access Director",
    "centre_director",
    centreA,
  );
  // Suspended after the fact, not created suspended: an active membership
  // requires an active principal, so the only reachable way to reach this state
  // is the one a real suspension takes.
  const inactiveId = await addCentreScopedPerson(
    organisationId,
    "Effective Access Suspended Person",
    "centre_director",
    centreA,
  );
  await centreSuccessDB.exec`
    UPDATE principals SET status = 'suspended' WHERE id = ${inactiveId}
  `;
  fixture = { organisationId, centreA, centreB, directorId, inactiveId };
});

function evaluatedReport(report: Awaited<ReturnType<typeof getEffectiveAccess>>) {
  if (!report.evaluated) {
    throw new Error(`expected an evaluated report, got blocker ${report.blockedBy}`);
  }
  return report;
}

describe("administrator support diagnostics — effective access", () => {
  test("reports a held capability as allowed only within the assigned scope", async () => {
    const report = evaluatedReport(
      await getEffectiveAccess({
        organisationId: fixture.organisationId,
        principalId: fixture.directorId,
        at: DECISION_AT,
      }),
    );

    const budget = report.capabilities.find(
      (entry) => entry.capability === capability.budgetPositionRead,
    );
    const atA = budget?.centres.find((centre) => centre.centreId === fixture.centreA);
    const atB = budget?.centres.find((centre) => centre.centreId === fixture.centreB);

    expect(atA?.decision.allowed).toBe(true);
    expect(atB?.decision).toEqual({ allowed: false, reason: "scope_mismatch" });
    expect(budget?.organisation).toEqual({ allowed: false, reason: "scope_mismatch" });
  });

  test("distinguishes a capability the role does not hold from a scope mismatch", async () => {
    const report = evaluatedReport(
      await getEffectiveAccess({
        organisationId: fixture.organisationId,
        principalId: fixture.directorId,
        at: DECISION_AT,
      }),
    );

    const principalManage = report.capabilities.find(
      (entry) => entry.capability === capability.principalManage,
    );

    // A Centre Director holds no principal.manage at any scope, so every centre
    // must say capability_missing. Reporting scope_mismatch here would send an
    // administrator to widen a scope that was never the reason for the refusal.
    expect(principalManage?.organisation).toEqual({
      allowed: false,
      reason: "capability_missing",
    });
    for (const centre of principalManage?.centres ?? []) {
      expect(centre.decision).toEqual({ allowed: false, reason: "capability_missing" });
    }
  });

  test("names the assignment and role that granted an allowed capability", async () => {
    const report = evaluatedReport(
      await getEffectiveAccess({
        organisationId: fixture.organisationId,
        principalId: fixture.directorId,
        at: DECISION_AT,
      }),
    );

    const centreRead = report.capabilities
      .find((entry) => entry.capability === capability.centreRead)
      ?.centres.find((centre) => centre.centreId === fixture.centreA);

    expect(centreRead?.decision).toMatchObject({
      allowed: true,
      roleKey: "centre_director",
    });
    if (centreRead?.decision.allowed) {
      expect(centreRead.decision.assignmentId).toMatch(/^[0-9a-f-]{36}$/i);
    }
  });

  test("every reported decision matches what the enforcement path decides", async () => {
    const report = evaluatedReport(
      await getEffectiveAccess({
        organisationId: fixture.organisationId,
        principalId: fixture.directorId,
        at: DECISION_AT,
      }),
    );

    // The diagnostic is only worth consulting if it agrees with the code that
    // actually refuses requests. Comparing against the enforcement seam rather
    // than against a second expectation table is what makes that true.
    const sampled = [
      capability.centreRead,
      capability.budgetPositionRead,
      capability.principalManage,
      capability.quarterlyAuditRead,
    ];

    for (const sample of sampled) {
      const entry = report.capabilities.find((item) => item.capability === sample);
      expect(entry, `capability ${sample} missing from the report`).toBeDefined();

      for (const centreId of [fixture.centreA, fixture.centreB]) {
        const reported = entry?.centres.find((centre) => centre.centreId === centreId);
        const enforced = await authoriseCentreFromDatabase({
          principalId: fixture.directorId,
          activeOrganisationId: fixture.organisationId,
          centreId,
          capability: sample,
          at: DECISION_AT,
        });
        expect(reported?.decision, `${sample} at ${centreId}`).toEqual(enforced);
      }
    }
  });

  test("reports an inactive principal as a blocker rather than as no access", async () => {
    const report = await getEffectiveAccess({
      organisationId: fixture.organisationId,
      principalId: fixture.inactiveId,
      at: DECISION_AT,
    });

    // The support answer to "they cannot sign in" is this blocker. Returning an
    // evaluated report with every capability denied would be a different and
    // wrong answer: it would read as a scope problem to go and fix.
    expect(report.evaluated).toBe(false);
    if (!report.evaluated) {
      expect(report.blockedBy).toBe("principal_inactive");
    }
  });

  test("reports an unknown principal as a blocker", async () => {
    const report = await getEffectiveAccess({
      organisationId: fixture.organisationId,
      principalId: randomUUID(),
      at: DECISION_AT,
    });

    expect(report.evaluated).toBe(false);
    if (!report.evaluated) {
      expect(report.blockedBy).toBe("principal_missing");
    }
  });

  test("covers every capability in the catalogue at every active centre", async () => {
    const report = evaluatedReport(
      await getEffectiveAccess({
        organisationId: fixture.organisationId,
        principalId: fixture.directorId,
        at: DECISION_AT,
      }),
    );

    // A report that silently omitted a capability would read as "not held".
    expect(report.capabilities.map((entry) => entry.capability).sort()).toEqual(
      Object.values(capability).slice().sort(),
    );
    for (const entry of report.capabilities) {
      expect(entry.centres.map((centre) => centre.centreId).sort()).toEqual(
        [fixture.centreA, fixture.centreB].sort(),
      );
    }
    expect(report.unevaluatedCentres).toEqual([]);
  });
});
