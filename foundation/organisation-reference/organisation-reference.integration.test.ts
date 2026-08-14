import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import { centreSuccessDB } from "../db";
import { CANONICAL_ROLE_BUNDLES } from "../authorization/roles";
import {
  BRIGHT_STEPS_ORGANISATION_ID,
  BRIGHT_STEPS_ORGANISATION_NAME,
  BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM,
  BRIGHT_STEPS_STATES,
  BRIGHT_STEPS_TRADING_CENTRES,
} from "./bright-steps-academy";
import {
  formatOrganisationLoadReport,
  loadBrightStepsOrganisationReference,
  OrganisationLoadError,
} from "./organisation-load";

const LOCAL_ENVIRONMENT = {
  cloud: "local",
  name: "local",
  type: "development",
} as const;

/**
 * Supplied on every call because `organisations.default_timezone` has no
 * approved value and the tool deliberately refuses to guess one.
 */
const OPERATOR_TIMEZONE = "Australia/Sydney";

const EXPECTED_CREATES =
  1 + BRIGHT_STEPS_STATES.length + BRIGHT_STEPS_TRADING_CENTRES.length * 2;

interface ReferenceCounts {
  organisations: number;
  units: number;
  centres: number;
  placements: number;
  roles: number;
  memberships: number;
  assignments: number;
  audit_events: number;
}

async function referenceCounts(): Promise<ReferenceCounts> {
  const row = await centreSuccessDB.queryRow<ReferenceCounts>`
    SELECT
      (SELECT count(*)::integer FROM organisations
       WHERE id = ${BRIGHT_STEPS_ORGANISATION_ID}) AS organisations,
      (SELECT count(*)::integer FROM organisational_units
       WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}) AS units,
      (SELECT count(*)::integer FROM centres
       WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}) AS centres,
      (SELECT count(*)::integer FROM centre_organisational_unit_memberships
       WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}) AS placements,
      (SELECT count(*)::integer FROM role_definitions
       WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
         AND status = 'active') AS roles,
      (SELECT count(*)::integer FROM organisation_memberships
       WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}) AS memberships,
      (SELECT count(*)::integer FROM role_assignments
       WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}) AS assignments,
      (SELECT count(*)::integer FROM system_audit_events
       WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
         AND action = 'organisation_reference.loaded') AS audit_events
  `;
  if (row === null) throw new Error("reference count query returned no row");
  return row;
}

const EMPTY: ReferenceCounts = {
  organisations: 0,
  units: 0,
  centres: 0,
  placements: 0,
  roles: 0,
  memberships: 0,
  assignments: 0,
  audit_events: 0,
};

const LOADED: ReferenceCounts = {
  organisations: 1,
  units: BRIGHT_STEPS_STATES.length,
  centres: BRIGHT_STEPS_TRADING_CENTRES.length,
  placements: BRIGHT_STEPS_TRADING_CENTRES.length,
  roles: CANONICAL_ROLE_BUNDLES.length,
  memberships: 0,
  assignments: 0,
  audit_events: EXPECTED_CREATES,
};

describe("reviewed organisation reference load — refusals", () => {
  test("refuses without an operator-supplied organisation timezone", async () => {
    await expect(
      loadBrightStepsOrganisationReference({
        organisationTimezone: "   ",
        environment: LOCAL_ENVIRONMENT,
      }),
    ).rejects.toMatchObject({ code: "organisation_timezone_required" });
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("refuses a timezone that is not a resolvable IANA zone", async () => {
    await expect(
      loadBrightStepsOrganisationReference({
        organisationTimezone: "AEST",
        environment: LOCAL_ENVIRONMENT,
      }),
    ).rejects.toMatchObject({ code: "organisation_timezone_invalid" });
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("refuses to apply outside local development, before opening a transaction", async () => {
    for (const environment of [
      { cloud: "encore", name: "staging", type: "development" },
      { cloud: "gcp", name: "production", type: "production" },
      { cloud: "local", name: "local", type: "production" },
      { cloud: "local", name: "preview-42", type: "development" },
    ] as const) {
      await expect(
        loadBrightStepsOrganisationReference({
          organisationTimezone: OPERATOR_TIMEZONE,
          apply: true,
          environment,
        }),
      ).rejects.toMatchObject({ code: "local_environment_required" });
    }
    expect(await referenceCounts()).toEqual(EMPTY);
  });
});

describe("reviewed organisation reference load — dry run", () => {
  test("reports every approved change and writes nothing", async () => {
    expect(await referenceCounts()).toEqual(EMPTY);

    const report = await loadBrightStepsOrganisationReference({
      organisationTimezone: OPERATOR_TIMEZONE,
      environment: LOCAL_ENVIRONMENT,
    });

    expect(report.mode).toBe("dry_run");
    expect(report.committed).toBe(false);
    expect(report.counts).toEqual({
      create: EXPECTED_CREATES,
      unchanged: 0,
      conflict: 0,
    });
    expect(report.seedingEffectiveFrom).toBe("2026-01-01T00:00:00.000Z");
    expect(report.changes.filter((change) => change.resource === "centre")).toHaveLength(12);
    expect(report.excludedNonTradingCentres).toHaveLength(8);

    // The dry run rehearsed the whole load inside a transaction, including the
    // ADR-0006 provisioning trigger, and rolled all of it back.
    expect(report.canonicalRoles.missing).toEqual([]);
    expect(report.canonicalRoles.present).toHaveLength(CANONICAL_ROLE_BUNDLES.length);
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("renders an operator-readable plan naming its unreviewed input and exclusions", async () => {
    // This text is the artefact a human approves before the real load, so it
    // has to keep saying the things that make approval meaningful.
    const rendered = formatOrganisationLoadReport(
      await loadBrightStepsOrganisationReference({
        organisationTimezone: OPERATOR_TIMEZONE,
        environment: LOCAL_ENVIRONMENT,
      }),
    );
    expect(rendered).toContain("DRY RUN — nothing was written");
    expect(rendered).toContain("plan: 30 create, 0 unchanged, 0 conflict");
    expect(rendered).toContain("(operator input, not approved dataset)");
    expect(rendered).toContain(
      "seeding-effective-from 2026-01-01T00:00:00.000Z  (SEEDING CONVENTION, not an opening or appointment date)",
    );
    expect(rendered).toContain("canonical role definitions present: 9/9");
    expect(rendered).toContain("Elizabeth North | Laverstock Rd");
    expect(rendered).toContain("ELIZABETH-NORTH-WOODFORD-RD → SA");
    expect(rendered).toContain("people: none.");
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("is permitted outside local development because it cannot commit", async () => {
    const report = await loadBrightStepsOrganisationReference({
      organisationTimezone: OPERATOR_TIMEZONE,
      environment: { cloud: "encore", name: "staging", type: "development" },
    });
    expect(report.committed).toBe(false);
    expect(await referenceCounts()).toEqual(EMPTY);
  });
});

describe("reviewed organisation reference load — apply", () => {
  test("creates the approved organisation, states, centres and placements", async () => {
    const report = await loadBrightStepsOrganisationReference({
      organisationTimezone: OPERATOR_TIMEZONE,
      apply: true,
      environment: LOCAL_ENVIRONMENT,
    });

    expect(report.mode).toBe("apply");
    expect(report.committed).toBe(true);
    expect(report.counts).toEqual({
      create: EXPECTED_CREATES,
      unchanged: 0,
      conflict: 0,
    });
    expect(await referenceCounts()).toEqual(LOADED);

    const organisation = await centreSuccessDB.queryRow<{
      name: string;
      status: string;
      default_timezone: string;
    }>`
      SELECT name, status, default_timezone FROM organisations
      WHERE id = ${BRIGHT_STEPS_ORGANISATION_ID}
    `;
    expect(organisation).toEqual({
      name: BRIGHT_STEPS_ORGANISATION_NAME,
      status: "active",
      default_timezone: OPERATOR_TIMEZONE,
    });
  });

  test("loads the twelve trading centres with their approved jurisdictions and zones", async () => {
    const rows = await centreSuccessDB.queryAll<{
      code: string;
      name: string;
      jurisdiction_code: string;
      timezone: string;
      status: string;
    }>`
      SELECT code, name, jurisdiction_code, timezone, status
      FROM centres WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
      ORDER BY code
    `;
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      const approved = BRIGHT_STEPS_TRADING_CENTRES.find(
        (centre) => centre.code === row.code,
      );
      expect(approved).toBeDefined();
      expect(row.name).toBe(approved?.name);
      expect(row.jurisdiction_code).toBe(approved?.stateCode);
      expect(row.timezone).toBe(approved?.timezone);
      expect(row.status).toBe("active");
    }

    const zones = new Set(rows.map((row) => row.timezone));
    expect([...zones].sort()).toEqual([
      "Australia/Adelaide",
      "Australia/Melbourne",
      "Australia/Perth",
      "Australia/Sydney",
    ]);
  });

  test("applies the seeding convention to every effective-dated row", async () => {
    const windows = await centreSuccessDB.queryRow<{
      units: number;
      placements: number;
      open_units: number;
      open_placements: number;
    }>`
      SELECT
        (SELECT count(*)::integer FROM organisational_units
         WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
           AND effective_from = ${BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM}) AS units,
        (SELECT count(*)::integer FROM centre_organisational_unit_memberships
         WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
           AND effective_from = ${BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM}) AS placements,
        (SELECT count(*)::integer FROM organisational_units
         WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
           AND effective_to IS NULL) AS open_units,
        (SELECT count(*)::integer FROM centre_organisational_unit_memberships
         WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
           AND effective_to IS NULL) AS open_placements
    `;
    expect(windows).toEqual({
      units: BRIGHT_STEPS_STATES.length,
      placements: BRIGHT_STEPS_TRADING_CENTRES.length,
      open_units: BRIGHT_STEPS_STATES.length,
      open_placements: BRIGHT_STEPS_TRADING_CENTRES.length,
    });
  });

  test("gives every centre exactly one effective placement in its approved state", async () => {
    const rows = await centreSuccessDB.queryAll<{ code: string; state: string; placements: number }>`
      SELECT centre.code AS code, unit.code AS state,
             count(placement.id)::integer AS placements
      FROM centres AS centre
      JOIN centre_organisational_unit_memberships AS placement
        ON placement.organisation_id = centre.organisation_id
       AND placement.centre_id = centre.id
      JOIN organisational_units AS unit
        ON unit.organisation_id = placement.organisation_id
       AND unit.id = placement.organisational_unit_id
      WHERE centre.organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
      GROUP BY centre.code, unit.code
      ORDER BY centre.code
    `;
    expect(rows).toHaveLength(12);
    for (const row of rows) {
      expect(row.placements).toBe(1);
      const approved = BRIGHT_STEPS_TRADING_CENTRES.find((centre) => centre.code === row.code);
      expect(row.state).toBe(approved?.stateCode);
    }
  });

  test("provisions the canonical role definitions and grants nobody anything", async () => {
    const roles = await centreSuccessDB.queryAll<{ role_key: string; source_template_key: string }>`
      SELECT role_key, source_template_key FROM role_definitions
      WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID} AND status = 'active'
      ORDER BY role_key
    `;
    expect(roles.map((role) => role.role_key)).toEqual(
      CANONICAL_ROLE_BUNDLES.map((bundle) => bundle.key).slice().sort(),
    );
    for (const role of roles) expect(role.source_template_key).toBe(role.role_key);

    // Structure only. People arrive through the invitation lifecycle.
    const counts = await referenceCounts();
    expect(counts.memberships).toBe(0);
    expect(counts.assignments).toBe(0);
  });

  test("attributes every created row to the reviewed dataset and no person", async () => {
    const events = await centreSuccessDB.queryAll<{
      actor_principal_id: string | null;
      resource_type: string;
      context: Record<string, unknown>;
    }>`
      SELECT actor_principal_id, resource_type, context FROM system_audit_events
      WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID}
        AND action = 'organisation_reference.loaded'
    `;
    expect(events).toHaveLength(EXPECTED_CREATES);
    for (const event of events) {
      expect(event.actor_principal_id).toBeNull();
      expect(event.context.source).toBe("reviewed_organisation_reference_load");
      expect(event.context.datasetApprovedOn).toBe("2026-08-14");
      expect(event.context.seedingEffectiveFrom).toBe("2026-01-01T00:00:00.000Z");
    }
    expect(
      events.filter((event) => event.resource_type === "centre"),
    ).toHaveLength(12);
  });

  test("is idempotent: a second apply reports everything unchanged and writes nothing", async () => {
    const before = await referenceCounts();
    const report = await loadBrightStepsOrganisationReference({
      organisationTimezone: OPERATOR_TIMEZONE,
      apply: true,
      environment: LOCAL_ENVIRONMENT,
    });
    expect(report.counts).toEqual({
      create: 0,
      unchanged: EXPECTED_CREATES,
      conflict: 0,
    });
    expect(await referenceCounts()).toEqual(before);
  });

  test("a dry run over loaded data reports no outstanding change", async () => {
    const report = await loadBrightStepsOrganisationReference({
      organisationTimezone: OPERATOR_TIMEZONE,
      environment: LOCAL_ENVIRONMENT,
    });
    expect(report.counts.create).toBe(0);
    expect(report.counts.conflict).toBe(0);
    expect(report.changes.every((change) => change.action === "unchanged")).toBe(true);
  });
});

describe("reviewed organisation reference load — conflict and stand-down", () => {
  test("refuses rather than overwriting a centre that diverges from the approved data", async () => {
    const kwinana = BRIGHT_STEPS_TRADING_CENTRES.find((centre) => centre.code === "KWINANA")!;
    await centreSuccessDB.exec`
      UPDATE centres SET timezone = 'Australia/Sydney'
      WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID} AND id = ${kwinana.id}
    `;
    try {
      await expect(
        loadBrightStepsOrganisationReference({
          organisationTimezone: OPERATOR_TIMEZONE,
          apply: true,
          environment: LOCAL_ENVIRONMENT,
        }),
      ).rejects.toMatchObject({ code: "reference_data_conflict" });

      // The divergent value survives: the tool reports, it does not repair.
      const row = await centreSuccessDB.queryRow<{ timezone: string }>`
        SELECT timezone FROM centres WHERE id = ${kwinana.id}
      `;
      expect(row?.timezone).toBe("Australia/Sydney");
    } finally {
      await centreSuccessDB.exec`
        UPDATE centres SET timezone = ${kwinana.timezone}
        WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID} AND id = ${kwinana.id}
      `;
    }
    const report = await loadBrightStepsOrganisationReference({
      organisationTimezone: OPERATOR_TIMEZONE,
      environment: LOCAL_ENVIRONMENT,
    });
    expect(report.counts.conflict).toBe(0);
  });

  test("refuses a timezone that disagrees with the loaded organisation", async () => {
    await expect(
      loadBrightStepsOrganisationReference({
        organisationTimezone: "Australia/Perth",
        apply: true,
        environment: LOCAL_ENVIRONMENT,
      }),
    ).rejects.toMatchObject({ code: "reference_data_conflict" });
  });

  test("stands down once the organisation has anybody in it", async () => {
    // Structural writes here bypass the normal authoriser only because there is
    // nobody to authorise them. The moment a membership exists, changes belong
    // to the authorised People & Access and centre-management paths.
    const principalId = randomUUID();
    const membershipId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO principals (id, display_name, status)
      VALUES (${principalId}, 'Reference load stand-down probe', 'active')
    `;
    await centreSuccessDB.exec`
      INSERT INTO organisation_memberships (id, organisation_id, principal_id, status, effective_from)
      VALUES (${membershipId}, ${BRIGHT_STEPS_ORGANISATION_ID}, ${principalId}, 'active',
              ${BRIGHT_STEPS_SEEDING_EFFECTIVE_FROM})
    `;
    try {
      for (const apply of [false, true]) {
        await expect(
          loadBrightStepsOrganisationReference({
            organisationTimezone: OPERATOR_TIMEZONE,
            apply,
            environment: LOCAL_ENVIRONMENT,
          }),
        ).rejects.toBeInstanceOf(OrganisationLoadError);
      }
      await expect(
        loadBrightStepsOrganisationReference({
          organisationTimezone: OPERATOR_TIMEZONE,
          environment: LOCAL_ENVIRONMENT,
        }),
      ).rejects.toMatchObject({ code: "organisation_already_populated" });
    } finally {
      await centreSuccessDB.exec`
        DELETE FROM organisation_memberships WHERE id = ${membershipId}
      `;
      await centreSuccessDB.exec`DELETE FROM principals WHERE id = ${principalId}`;
    }
  });
});
