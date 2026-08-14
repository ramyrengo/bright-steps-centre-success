import { randomUUID } from "node:crypto";
import type { EnvironmentMeta } from "encore.dev";
import { describe, expect, test } from "vitest";
import { centreSuccessDB } from "../db";
import {
  runFirstAdministratorCeremony,
  type FirstAdministratorCeremonyInput,
} from "../authentication/first-administrator-ceremony";
import {
  CANONICAL_ROLE_BUNDLES,
  canonicalRoleBundle,
} from "../authorization/roles";
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
  ORGANISATION_LOAD_APPLY_ENVIRONMENT_NAMES,
  OrganisationLoadError,
  type OrganisationLoadOptions,
  type OrganisationLoadReport,
} from "./organisation-load";

type LoadEnvironment = Pick<EnvironmentMeta, "cloud" | "name" | "type">;

const LOCAL_ENVIRONMENT = {
  cloud: "local",
  name: "local",
  type: "development",
} as const satisfies LoadEnvironment;
const STAGING = {
  cloud: "encore",
  name: "staging",
  type: "development",
} as const satisfies LoadEnvironment;
const PRODUCTION = {
  cloud: "gcp",
  name: "production",
  type: "production",
} as const satisfies LoadEnvironment;
const CLOUD_DEVELOPMENT = {
  cloud: "encore",
  name: "development",
  type: "development",
} as const satisfies LoadEnvironment;
const PREVIEW = {
  cloud: "encore",
  name: "pr-42",
  type: "ephemeral",
} as const satisfies LoadEnvironment;

/**
 * Supplied on every call because `organisations.default_timezone` has no
 * approved value and the tool deliberately refuses to guess one.
 */
const OPERATOR_TIMEZONE = "Australia/Sydney";

/**
 * Local development remains the ordinary way to run this tool, so it is the
 * default here. The one thing local gained is that the operator must still name
 * the environment, exactly as they must in staging and production.
 */
function load(
  overrides: Partial<OrganisationLoadOptions> = {},
): Promise<OrganisationLoadReport> {
  return loadBrightStepsOrganisationReference({
    declaredEnvironment: "local",
    organisationTimezone: OPERATOR_TIMEZONE,
    environment: LOCAL_ENVIRONMENT,
    ...overrides,
  });
}

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
    await expect(load({ organisationTimezone: "   " })).rejects.toMatchObject({
      code: "organisation_timezone_required",
    });
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("refuses a timezone that is not a resolvable IANA zone", async () => {
    await expect(load({ organisationTimezone: "AEST" })).rejects.toMatchObject({
      code: "organisation_timezone_invalid",
    });
    expect(await referenceCounts()).toEqual(EMPTY);
  });
});

/**
 * The gate is the ADR-0021 D5 one, taken from the first-administrator ceremony
 * rather than reinvented. It differs from the ceremony's in exactly one way:
 * `local` is in this tool's allow-list, because unlike that ceremony this is a
 * supported local development tool. Everything else — naming the environment,
 * the closed list, the refused types, the production confirmation flag — is the
 * same, and every refusal below happens before a transaction can open.
 */
describe("reviewed organisation reference load — environment gate", () => {
  test("its allow-list is the reviewed deployed pair plus local", () => {
    expect([...ORGANISATION_LOAD_APPLY_ENVIRONMENT_NAMES]).toEqual([
      "local",
      "staging",
      "production",
    ]);
  });

  test("refuses when the operator does not name the target environment", async () => {
    for (const apply of [false, true]) {
      await expect(
        load({ declaredEnvironment: "   ", apply }),
      ).rejects.toMatchObject({ code: "environment_not_declared" });
    }
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("refuses when the declared environment is not the running one", async () => {
    // The operator believes they are on staging; the deployment says otherwise.
    await expect(
      load({
        declaredEnvironment: "staging",
        apply: true,
        environment: PRODUCTION,
      }),
    ).rejects.toMatchObject({ code: "environment_mismatch" });

    await expect(
      load({
        declaredEnvironment: "production",
        apply: true,
        confirmProduction: true,
        environment: STAGING,
      }),
    ).rejects.toMatchObject({ code: "environment_mismatch" });

    // A rehearsal must prove something about the environment actually named,
    // so the mismatch refusal holds for dry runs too.
    await expect(
      load({ declaredEnvironment: "local", environment: STAGING }),
    ).rejects.toMatchObject({ code: "environment_mismatch" });
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("refuses to apply in an environment outside the closed allow-list", async () => {
    for (const environment of [CLOUD_DEVELOPMENT, PREVIEW] as const) {
      await expect(
        load({
          declaredEnvironment: environment.name,
          apply: true,
          environment,
        }),
      ).rejects.toMatchObject({
        code:
          environment.type === "ephemeral"
            ? "environment_type_not_permitted"
            : "environment_not_permitted",
      });
    }
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("refuses to apply in an ephemeral or test environment whatever it is named", async () => {
    for (const environment of [
      { cloud: "encore", name: "staging", type: "ephemeral" },
      { cloud: "encore", name: "local", type: "ephemeral" },
      { cloud: "local", name: "production", type: "test" },
      { cloud: "local", name: "local", type: "test" },
    ] as const) {
      await expect(
        load({
          declaredEnvironment: environment.name,
          apply: true,
          confirmProduction: environment.name === "production",
          environment,
        }),
      ).rejects.toMatchObject({ code: "environment_type_not_permitted" });
    }
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("refuses to apply in production without the explicit confirmation flag", async () => {
    await expect(
      load({
        declaredEnvironment: "production",
        apply: true,
        environment: PRODUCTION,
      }),
    ).rejects.toMatchObject({ code: "production_confirmation_required" });
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("refuses the production confirmation flag anywhere but production", async () => {
    // It must not become a habitual paste that is already on the command line
    // when the operator finally points at production — including in local,
    // where this tool is run most often.
    for (const environment of [LOCAL_ENVIRONMENT, STAGING] as const) {
      for (const apply of [false, true]) {
        await expect(
          load({
            declaredEnvironment: environment.name,
            apply,
            confirmProduction: true,
            environment,
          }),
        ).rejects.toMatchObject({ code: "confirmation_not_applicable" });
      }
    }
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("refuses an environment merely NAMED local that is not local development", async () => {
    // The local guard in local-identity-linker.ts is called, not copied, so a
    // cloud environment cannot claim the local slot in the allow-list.
    for (const environment of [
      { cloud: "gcp", name: "local", type: "production" },
      { cloud: "encore", name: "local", type: "development" },
      { cloud: "local", name: "local", type: "production" },
    ] as const) {
      await expect(
        load({ declaredEnvironment: "local", apply: true, environment }),
      ).rejects.toMatchObject({ code: "local_environment_required" });
    }
    expect(await referenceCounts()).toEqual(EMPTY);
  });
});

describe("reviewed organisation reference load — dry run", () => {
  test("reports every approved change and writes nothing", async () => {
    expect(await referenceCounts()).toEqual(EMPTY);

    const report = await load();

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

  test("forces the deferred People & Access guard, so the rehearsal is real", async () => {
    // The ADR-0006 trigger inserts role_definitions and role_capabilities rows,
    // which enqueue the DEFERRABLE INITIALLY DEFERRED last-administrator guard
    // from migrations 017 and 018. Without SET CONSTRAINTS ALL IMMEDIATE that
    // guard would fire only at COMMIT and never in a rolled-back dry run, so a
    // dry run would rehearse strictly less than an apply does. The reported
    // count is the guard's own reachability function, evaluated after it ran.
    const report = await load();
    expect(report.reachableSystemAdministrators).toBe(0);
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("the deferred guard really is pending until the constraints are forced", async () => {
    // The evidence for the line above, rather than a claim about it. Creating an
    // organisation fires the ADR-0006 trigger, which inserts role_definitions
    // and role_capabilities; migration 017's BEFORE triggers enqueue the
    // last-administrator validation, and migration 018 validates the queue with
    // a CONSTRAINT TRIGGER that is DEFERRABLE INITIALLY DEFERRED. A queued row
    // still sitting there is a check that has not run and, in a transaction that
    // ends in ROLLBACK, never would.
    const transaction = await centreSuccessDB.begin();
    try {
      await transaction.exec`
        INSERT INTO organisations (id, name, status, default_timezone)
        VALUES (${randomUUID()}, ${`Deferred guard probe ${randomUUID()}`},
                'active', ${OPERATOR_TIMEZONE})
      `;
      const queued = await transaction.queryRow<{ pending: number }>`
        SELECT count(*)::integer AS pending
        FROM people_admin_guard_validation_queue
        WHERE transaction_id = txid_current()
      `;
      expect(queued?.pending).toBeGreaterThan(0);

      await transaction.exec`SET CONSTRAINTS ALL IMMEDIATE`;

      // The deferred trigger has now run and cleared its own queue entry, which
      // is what makes the dry run as strong a rehearsal as the apply.
      const drained = await transaction.queryRow<{ pending: number }>`
        SELECT count(*)::integer AS pending
        FROM people_admin_guard_validation_queue
        WHERE transaction_id = txid_current()
      `;
      expect(drained?.pending).toBe(0);
    } finally {
      await transaction.rollback();
    }
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("renders an operator-readable plan naming its unreviewed input and exclusions", async () => {
    // This text is the artefact a human approves before the real load, so it
    // has to keep saying the things that make approval meaningful.
    const rendered = formatOrganisationLoadReport(await load());
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
    // The environment is on the artefact, so approval is approval of a plan for
    // one named environment rather than of a plan in the abstract.
    expect(rendered).toContain(
      "environment            local (type development, cloud local)",
    );
    expect(rendered).toContain(
      "declared by operator   local  (matched against appMeta)",
    );
    expect(rendered).toContain("reachable System Administrators after this load: 0");
    expect(await referenceCounts()).toEqual(EMPTY);
  });

  test("is permitted in every environment, because it cannot commit", async () => {
    for (const environment of [STAGING, PRODUCTION, PREVIEW] as const) {
      const report = await load({
        declaredEnvironment: environment.name,
        environment,
      });
      expect(report.mode).toBe("dry_run");
      expect(report.committed).toBe(false);
      expect(report.environment).toEqual({
        declared: environment.name,
        name: environment.name,
        type: environment.type,
        cloud: environment.cloud,
        confirmationRequired: environment.name === "production",
      });
      expect(await referenceCounts()).toEqual(EMPTY);
    }
  });
});

describe("reviewed organisation reference load — apply", () => {
  test("creates the approved organisation, states, centres and placements", async () => {
    // Local development, exactly as before: no confirmation flag, no ceremony.
    const report = await load({ apply: true });

    expect(report.mode).toBe("apply");
    expect(report.committed).toBe(true);
    expect(report.counts).toEqual({
      create: EXPECTED_CREATES,
      unchanged: 0,
      conflict: 0,
    });
    expect(report.reachableSystemAdministrators).toBe(0);
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

    // Structure only. People arrive through the invitation lifecycle, and the
    // loaded organisation still has no administrator anybody could sign in as.
    const counts = await referenceCounts();
    expect(counts.memberships).toBe(0);
    expect(counts.assignments).toBe(0);

    const reachable = await centreSuccessDB.queryRow<{ reachable: number }>`
      SELECT reachable_system_administrator_count(${BRIGHT_STEPS_ORGANISATION_ID}) AS reachable
    `;
    expect(reachable?.reachable).toBe(0);
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
    const report = await load({ apply: true });
    expect(report.counts).toEqual({
      create: 0,
      unchanged: EXPECTED_CREATES,
      conflict: 0,
    });
    expect(await referenceCounts()).toEqual(before);
  });

  test("a dry run over loaded data reports no outstanding change", async () => {
    const report = await load();
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
      await expect(load({ apply: true })).rejects.toMatchObject({
        code: "reference_data_conflict",
      });

      // The divergent value survives: the tool reports, it does not repair.
      const row = await centreSuccessDB.queryRow<{ timezone: string }>`
        SELECT timezone FROM centres WHERE id = ${kwinana.id}
      `;
      expect(row?.timezone).toBe("Australia/Sydney");

      // And the refusal names the exact field-level difference, in staging and
      // production as well as local: a reviewed environment gate does not make
      // divergence something the tool may quietly fix.
      await expect(
        load({
          declaredEnvironment: "staging",
          apply: true,
          environment: STAGING,
        }),
      ).rejects.toMatchObject({
        code: "reference_data_conflict",
        detail: expect.stringContaining(
          'timezone: found "Australia/Sydney", approved "Australia/Perth"',
        ),
      });
      const unrepaired = await centreSuccessDB.queryRow<{ timezone: string }>`
        SELECT timezone FROM centres WHERE id = ${kwinana.id}
      `;
      expect(unrepaired?.timezone).toBe("Australia/Sydney");
    } finally {
      await centreSuccessDB.exec`
        UPDATE centres SET timezone = ${kwinana.timezone}
        WHERE organisation_id = ${BRIGHT_STEPS_ORGANISATION_ID} AND id = ${kwinana.id}
      `;
    }
    const report = await load();
    expect(report.counts.conflict).toBe(0);
  });

  test("refuses a timezone that disagrees with the loaded organisation", async () => {
    await expect(
      load({ organisationTimezone: "Australia/Perth", apply: true }),
    ).rejects.toMatchObject({ code: "reference_data_conflict" });
  });

  test("stands down once the organisation has anybody in it", async () => {
    // Structural writes here bypass the normal authoriser only because there is
    // nobody to authorise them. The moment a membership exists, changes belong
    // to the authorised People & Access and centre-management paths. This is the
    // safety property that does not depend on the environment at all, so it is
    // asserted in every environment the tool can now reach.
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
      for (const environment of [
        LOCAL_ENVIRONMENT,
        STAGING,
        PRODUCTION,
      ] as const) {
        for (const apply of [false, true]) {
          await expect(
            load({
              declaredEnvironment: environment.name,
              apply,
              confirmProduction: apply && environment.name === "production",
              environment,
            }),
          ).rejects.toMatchObject({ code: "organisation_already_populated" });
        }
      }
      await expect(load()).rejects.toBeInstanceOf(OrganisationLoadError);
    } finally {
      await centreSuccessDB.exec`
        DELETE FROM organisation_memberships WHERE id = ${membershipId}
      `;
      await centreSuccessDB.exec`DELETE FROM principals WHERE id = ${principalId}`;
    }
  });
});

/**
 * The point of the change: there is now a reviewed path to create the Bright
 * Steps organisation in the deployed environments, so the ADR-0021 D5
 * first-administrator ceremony finally has something to target.
 *
 * These run last, against already-loaded data, so they commit no new row. What
 * they prove is that a correctly declared staging or production apply passes the
 * gate and reaches commit — the thing the old local-only assertion made
 * impossible.
 */
describe("reviewed organisation reference load — the deployed environments", () => {
  test("a correctly declared staging apply is permitted and commits", async () => {
    const report = await load({
      declaredEnvironment: "staging",
      apply: true,
      environment: STAGING,
    });
    expect(report.mode).toBe("apply");
    expect(report.committed).toBe(true);
    expect(report.environment.confirmationRequired).toBe(false);
    expect(report.counts).toEqual({
      create: 0,
      unchanged: EXPECTED_CREATES,
      conflict: 0,
    });
    expect(await referenceCounts()).toEqual(LOADED);
  });

  test("a production apply is permitted only with the confirmation flag", async () => {
    await expect(
      load({
        declaredEnvironment: "production",
        apply: true,
        environment: PRODUCTION,
      }),
    ).rejects.toMatchObject({ code: "production_confirmation_required" });

    const report = await load({
      declaredEnvironment: "production",
      apply: true,
      confirmProduction: true,
      environment: PRODUCTION,
    });
    expect(report.mode).toBe("apply");
    expect(report.committed).toBe(true);
    expect(report.environment.confirmationRequired).toBe(true);
    expect(report.reachableSystemAdministrators).toBe(0);
    expect(await referenceCounts()).toEqual(LOADED);
  });
});

/**
 * The seam between the two reviewed operator tools — the one place neither
 * tool's own tests can reach, because each is otherwise proven against an
 * organisation its own fixtures built.
 *
 * Production runs them in sequence: this load creates the organisation, then
 * the ADR-0021 D5 ceremony creates the first administrator inside it. The two
 * do not agree on what a canonical role has to look like. This load checks that
 * each canonical role KEY is present. The ceremony additionally checks the
 * definition's name, description, version and template linkage, and the exact
 * capability set on BOTH `role_capabilities` and
 * `canonical_role_template_capabilities`. The ceremony is strictly stricter, so
 * a load that reports success can still be followed by a ceremony that refuses
 * `canonical_role_unavailable` — with the organisation already committed, and
 * the ceremony refusing to run a second time to repair it.
 *
 * That the stricter check bites is proven where it belongs, in
 * `first-administrator-ceremony.test.ts`. What is proven here is the other
 * half: that the roles THIS load actually leaves behind pass it.
 *
 * The ceremony rehearses rather than applies, deliberately. A dry run is a real
 * rehearsal — the canonical-role check, every insert, `SET CONSTRAINTS ALL
 * IMMEDIATE`, the exactly-one count and the reachability guard all run against
 * the committed organisation before the transaction rolls back — and it covers
 * the whole of the disagreement above. Applying would write a membership and an
 * append-only bootstrap audit event into the shared test organisation, and
 * `system_audit_events` refuses DELETE, so no later test could undo it.
 */
describe("the chain from the loaded organisation to the first administrator", () => {
  const CEREMONY_TENANT_ID = "22222222-2222-4222-8222-222222222222";
  const SYSTEM_ADMINISTRATOR = canonicalRoleBundle("system_administrator");

  /**
   * No clock is injected, deliberately — the ceremony has no seam to inject one
   * through any more, and that is the point.
   *
   * These tests first ran while the ceremony stamped `effective_from` from the
   * APPLICATION clock, before opening its transaction, leaving migration 017 to
   * compare it against the DATABASE clock fixed at BEGIN. Two clocks, no margin:
   * the −2 ms skew on the machine this was written on was enough to make the
   * ceremony reach nobody and refuse `exactly_one_violated`, and the very first
   * run below failed exactly that way. Every ceremony test at the time pinned a
   * fixed past instant, so none of them could meet it.
   *
   * `effective_from` now comes from `now()` inside the transaction, so these run
   * against the real production path with no clock of their own. That makes the
   * first test the regression test for it: on this machine it fails without the
   * fix and passes with it.
   */
  function rehearseCeremony(
    overrides: Partial<FirstAdministratorCeremonyInput> = {},
  ) {
    return runFirstAdministratorCeremony(
      {
        declaredEnvironment: "staging",
        organisationId: BRIGHT_STEPS_ORGANISATION_ID,
        tenantId: CEREMONY_TENANT_ID,
        oid: randomUUID(),
        displayName: "Operator-supplied administrator name",
        reason: "Rehearsal over the organisation this load committed.",
        apply: false,
        ...overrides,
      },
      { environment: STAGING, configuredTenantId: CEREMONY_TENANT_ID },
    );
  }

  test("the roles this load leaves behind satisfy the ceremony's stricter check", async () => {
    // Resolving at all is the assertion: every one of the ceremony's refusals
    // throws, so a returned report means the loaded organisation was accepted.
    const report = await rehearseCeremony();

    expect(report.organisationId).toBe(BRIGHT_STEPS_ORGANISATION_ID);
    expect(report.organisationName).toBe(BRIGHT_STEPS_ORGANISATION_NAME);
    expect(report.roleKey).toBe(SYSTEM_ADMINISTRATOR.key);
    expect(report.roleVersion).toBe(SYSTEM_ADMINISTRATOR.version);
    expect([...report.capabilities]).toEqual(
      [...SYSTEM_ADMINISTRATOR.capabilities].sort(),
    );
    // Migration 017 reachability, evaluated after the deferred guard was forced:
    // the administrator this ceremony would create is genuinely able to act.
    expect(report.reachableSystemAdministrators).toBe(1);
  });

  test("the rehearsal leaves the loaded organisation exactly as it found it", async () => {
    const before = await referenceCounts();

    const report = await rehearseCeremony();
    expect(report.mode).toBe("dry_run");
    expect(report.committed).toBe(false);
    expect(await referenceCounts()).toEqual(before);

    // Nobody survived the rollback. Had a membership persisted, this load would
    // stand down with organisation_already_populated instead of reporting a
    // fully loaded, empty organisation.
    const after = await load();
    expect(after.counts).toEqual({
      create: 0,
      unchanged: EXPECTED_CREATES,
      conflict: 0,
    });
    expect(after.reachableSystemAdministrators).toBe(0);
  });

  test("the reported instant is the database's, not the application's", async () => {
    const databaseClock = async (): Promise<number> => {
      const row = await centreSuccessDB.queryRow<{
        at: Date;
      }>`SELECT now() AS at`;
      if (row === null) throw new Error("clock query returned no row");
      return row.at.getTime();
    };

    const before = await databaseClock();
    const report = await rehearseCeremony();
    const after = await databaseClock();

    expect(new Date(report.occurredAt).getTime()).toBeGreaterThanOrEqual(before);
    expect(new Date(report.occurredAt).getTime()).toBeLessThanOrEqual(after);

    // Honest about its own reach: this is a real property but not a sharp one.
    // On a machine whose clocks agree, an application-clock stamp would fall
    // inside this window too. What stops that stamp being reintroduced is the
    // structural guard in `first-administrator-ceremony.unit.test.ts`, which is
    // the right tool precisely because no behavioural test can be relied on to
    // fail on a well-synchronised machine.
  });
});
