import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, test } from "vitest";
import { centreSuccessDB } from "../db";
import { FOUNDATION_CAPABILITIES } from "../authorization/capabilities";
import { buildAuthorisedNavigation } from "../navigation/service";
import {
  buildCentreBudgetMonth,
  buildPortfolioBudgetMonth,
  CentreBudgetError,
  recordCentreBudgetActual,
} from "./service";

/**
 * Centre Budgets runs against a fully isolated organisation per fixture so
 * every assertion is deterministic and unaffected by other integration files
 * that mutate the shared development seed.
 */

const AT = new Date("2036-03-20T02:00:00.000Z");
const MONTH = "2036-03";
const MONTH_KEY = "2036-03-01";
const TIMEZONE = "Australia/Sydney";
const CURRENCY = "AUD";
const now = () => AT;

interface BudgetFixture {
  organisationId: string;
  centreIds: string[];
  categoryIds: string[];
  centreDirectorId: string;
  otherCentreDirectorId: string;
  areaManagerId: string;
  systemAdministratorId: string;
  financeId: string;
}

let fixture: BudgetFixture;

async function grant(
  organisationId: string,
  principalId: string,
  displayName: string,
  roleKey: string,
  scope: { type: "organisation" } | { type: "centre"; centreId: string },
): Promise<void> {
  const membershipId = randomUUID();
  const assignmentId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO principals (id, display_name, status)
    VALUES (${principalId}, ${displayName}, 'active')
  `;
  await centreSuccessDB.exec`
    INSERT INTO organisation_memberships (id, organisation_id, principal_id, status, effective_from)
    VALUES (${membershipId}, ${organisationId}, ${principalId}, 'active', '2030-01-01')
  `;
  const role = await centreSuccessDB.queryRow<{ id: string }>`
    SELECT id FROM role_definitions
    WHERE organisation_id = ${organisationId} AND role_key = ${roleKey} AND status = 'active'
  `;
  if (!role) throw new Error(`${roleKey} role unavailable`);
  await centreSuccessDB.exec`
    INSERT INTO role_assignments (
      id, organisation_id, organisation_membership_id, role_definition_id,
      status, effective_from, grant_source_type, reason
    ) VALUES (
      ${assignmentId}, ${organisationId}, ${membershipId}, ${role.id},
      'active', '2030-01-01', 'system', 'Synthetic Centre Budgets fixture.'
    )
  `;
  await centreSuccessDB.exec`
    INSERT INTO assignment_scopes (
      id, organisation_id, role_assignment_id, scope_type, centre_id, effective_from
    ) VALUES (
      ${randomUUID()}, ${organisationId}, ${assignmentId}, ${scope.type},
      ${scope.type === "centre" ? scope.centreId : null}, '2030-01-01'
    )
  `;
}

async function budgetLine(
  organisationId: string,
  centreId: string,
  categoryId: string,
  amount: string,
  recordedBy: string,
  currency = CURRENCY,
): Promise<string> {
  const id = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO centre_budget_lines (
      id, organisation_id, centre_id, category_id, period_month,
      amount, currency_code, source_kind, recorded_by_principal_id
    ) VALUES (
      ${id}, ${organisationId}, ${centreId}, ${categoryId}, ${MONTH_KEY}::date,
      ${amount}::numeric, ${currency}, 'manual_entry', ${recordedBy}
    )
  `;
  return id;
}

interface BudgetFixtureOptions {
  /**
   * Approved budget lines are seeded by default. A test that needs an empty
   * month asks for none rather than deleting the seeded rows: budget facts are
   * append-only at the database level, so no fixture may ever tear one down.
   */
  seedApprovedBudget?: boolean;
}

async function createBudgetFixture(
  centreCount = 3,
  options: BudgetFixtureOptions = {},
): Promise<BudgetFixture> {
  const organisationId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO organisations (id, name, status, default_timezone)
    VALUES (
      ${organisationId},
      ${`Centre Budgets fixture ${organisationId.slice(0, 8)}`},
      'active', ${TIMEZONE}
    )
  `;

  const centreIds = Array.from({ length: centreCount }, () => randomUUID());
  for (const [index, centreId] of centreIds.entries()) {
    await centreSuccessDB.exec`
      INSERT INTO centres (id, organisation_id, code, name, jurisdiction_code, timezone, status)
      VALUES (
        ${centreId}, ${organisationId}, ${`CB-${organisationId.slice(0, 4)}-${index}`},
        ${`Budget Centre ${String(index).padStart(2, "0")}`}, 'SYNTHETIC', ${TIMEZONE}, 'active'
      )
    `;
  }

  // Categories are governed rows, not an enum. These are synthetic fixture
  // rows and are not a proposed Bright Steps chart of accounts.
  const categoryIds = [randomUUID(), randomUUID()];
  for (const [index, categoryId] of categoryIds.entries()) {
    await centreSuccessDB.exec`
      INSERT INTO budget_categories (id, organisation_id, code, name, status, sort_order)
      VALUES (
        ${categoryId}, ${organisationId}, ${`synthetic_category_${index}`},
        ${`Synthetic category ${index}`}, 'active', ${index + 1}
      )
    `;
  }

  const centreDirectorId = randomUUID();
  const otherCentreDirectorId = randomUUID();
  const areaManagerId = randomUUID();
  const systemAdministratorId = randomUUID();
  const financeId = randomUUID();
  await grant(organisationId, centreDirectorId, "Budget Centre Director", "centre_director", {
    type: "centre",
    centreId: centreIds[0],
  });
  await grant(
    organisationId,
    otherCentreDirectorId,
    "Other Budget Centre Director",
    "centre_director",
    { type: "centre", centreId: centreIds[centreIds.length - 1] },
  );
  await grant(organisationId, areaManagerId, "Budget Area Manager", "area_manager", {
    type: "organisation",
  });
  await grant(
    organisationId,
    systemAdministratorId,
    "Budget System Administrator",
    "system_administrator",
    { type: "organisation" },
  );
  await grant(organisationId, financeId, "Budget Finance", "finance", {
    type: "organisation",
  });

  // Every centre gets an approved budget for both categories, and no actuals,
  // unless the caller asked for a month with nothing approved at all.
  if (options.seedApprovedBudget !== false) {
    for (const centreId of centreIds) {
      for (const categoryId of categoryIds) {
        await budgetLine(organisationId, centreId, categoryId, "1000.00", centreDirectorId);
      }
    }
  }

  return {
    organisationId,
    centreIds,
    categoryIds,
    centreDirectorId,
    otherCentreDirectorId,
    areaManagerId,
    systemAdministratorId,
    financeId,
  };
}

beforeAll(async () => {
  fixture = await createBudgetFixture(3);
});

describe("authorised read", () => {
  test("a Centre Director reads the approved budget for their own centre", async () => {
    const result = await buildCentreBudgetMonth(
      {
        principalId: fixture.centreDirectorId,
        centreId: fixture.centreIds[0],
        month: MONTH,
      },
      { now },
    );

    expect(result.response.centreId).toBe(fixture.centreIds[0]);
    expect(result.response.categories).toHaveLength(2);
    expect(result.response.canEnterActual).toBe(true);
    for (const position of result.response.categories) {
      expect(position.approvedBudget?.amount).toBe("1000.00");
      expect(position.approvedBudget?.currency).toBe(CURRENCY);
    }
  });

  test("an Area Manager reads their authorised portfolio but cannot enter actuals", async () => {
    const portfolio = await buildPortfolioBudgetMonth(
      { principalId: fixture.areaManagerId, month: MONTH },
      { now },
    );

    expect(portfolio.response.status).toBe("partial");
    expect(portfolio.response.centres).toHaveLength(3);
    expect(portfolio.response.visibleCentreCount).toBe(3);

    const centre = await buildCentreBudgetMonth(
      { principalId: fixture.areaManagerId, centreId: fixture.centreIds[1], month: MONTH },
      { now },
    );
    // Read authority never implies entry authority.
    expect(centre.response.canEnterActual).toBe(false);
    await expect(
      recordCentreBudgetActual(
        {
          principalId: fixture.areaManagerId,
          request: {
            centreId: fixture.centreIds[1],
            month: MONTH,
            categoryId: fixture.categoryIds[0],
            amount: "100.00",
            currency: CURRENCY,
          },
        },
        { now },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
  });
});

describe("denied access", () => {
  test("a Centre Director cannot read another centre by changing the route", async () => {
    await expect(
      buildCentreBudgetMonth(
        {
          principalId: fixture.centreDirectorId,
          centreId: fixture.centreIds[1],
          month: MONTH,
        },
        { now },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });

    // Their portfolio contains only the centre they are actually assigned.
    const portfolio = await buildPortfolioBudgetMonth(
      { principalId: fixture.centreDirectorId, month: MONTH },
      { now },
    );
    expect(portfolio.response.centres?.map((centre) => centre.centreId)).toEqual([
      fixture.centreIds[0],
    ]);
  });

  test("a Centre Director cannot enter an actual against another centre", async () => {
    await expect(
      recordCentreBudgetActual(
        {
          principalId: fixture.centreDirectorId,
          request: {
            centreId: fixture.centreIds[1],
            month: MONTH,
            categoryId: fixture.categoryIds[0],
            amount: "500.00",
            currency: CURRENCY,
          },
        },
        { now },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });

    const written = await centreSuccessDB.queryRow<{ count: number | string }>`
      SELECT count(*) AS count FROM centre_budget_actuals
      WHERE organisation_id = ${fixture.organisationId}
        AND centre_id = ${fixture.centreIds[1]}
    `;
    expect(Number(written?.count)).toBe(0);
  });

  test("a System Administrator gets no budget content through technical privilege", async () => {
    const portfolio = await buildPortfolioBudgetMonth(
      { principalId: fixture.systemAdministratorId, month: MONTH },
      { now },
    );

    // No budget source is queried at all, so no centre list and no counts.
    expect(portfolio.response.status).toBe("unsupported");
    expect(portfolio.response.centres).toBeUndefined();
    expect(portfolio.response.visibleCentreCount).toBeUndefined();
    const serialised = JSON.stringify(portfolio.response);
    for (const centreId of fixture.centreIds) {
      expect(serialised).not.toContain(centreId);
    }
    expect(serialised).not.toContain("1000.00");

    await expect(
      buildCentreBudgetMonth(
        {
          principalId: fixture.systemAdministratorId,
          centreId: fixture.centreIds[0],
          month: MONTH,
        },
        { now },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });

    await expect(
      recordCentreBudgetActual(
        {
          principalId: fixture.systemAdministratorId,
          request: {
            centreId: fixture.centreIds[0],
            month: MONTH,
            categoryId: fixture.categoryIds[0],
            amount: "1.00",
            currency: CURRENCY,
          },
        },
        { now },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });
  });

  test("the synthetic Finance marker capability does not open the budget module", async () => {
    // `budget.summary.read` predates this module and PERMISSIONS.md states it
    // does not authorise a budget module. Finance therefore reads nothing here
    // until an owner decision grants the new capabilities.
    const portfolio = await buildPortfolioBudgetMonth(
      { principalId: fixture.financeId, month: MONTH },
      { now },
    );
    expect(portfolio.response.status).toBe("unsupported");
  });

  test("an unknown principal and a malformed month are both rejected", async () => {
    await expect(
      buildCentreBudgetMonth(
        { principalId: randomUUID(), centreId: fixture.centreIds[0], month: MONTH },
        { now },
      ),
    ).rejects.toMatchObject({ code: "access_denied" });

    await expect(
      buildCentreBudgetMonth(
        {
          principalId: fixture.centreDirectorId,
          centreId: fixture.centreIds[0],
          month: "2036-13",
        },
        { now },
      ),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("unknown is not zero", () => {
  test("a category with no actual reports no spend rather than zero spend", async () => {
    const local = await createBudgetFixture(1);
    const result = await buildCentreBudgetMonth(
      {
        principalId: local.centreDirectorId,
        centreId: local.centreIds[0],
        month: MONTH,
      },
      { now },
    );

    const position = result.response.categories[0];
    expect(position.state).toBe("AWAITING_ACTUAL");
    expect(position.approvedBudget?.amount).toBe("1000.00");
    expect(position.actual).toBeUndefined();
    expect(position.remaining).toBeUndefined();
    expect(position.percentUsed).toBeUndefined();

    // Nothing may serialise a zero into the gap.
    const serialised = JSON.stringify(position);
    expect(serialised).not.toContain('"remaining"');
    expect(serialised).not.toContain('"percentUsed"');
    expect(serialised).not.toContain('"actual"');

    // The month is not complete, so no spend-side total is published.
    expect(result.response.summary.coverage).toBe("partial");
    expect(result.response.summary.awaitingActualCount).toBe(2);
    expect(result.response.summary.totalRecordedActual).toBeUndefined();
    expect(result.response.summary.totalRemaining).toBeUndefined();
    expect(result.response.summary.totalPercentUsed).toBeUndefined();
    // The approved side is fully known, so it is safe to state.
    expect(result.response.summary.totalApprovedBudget).toBe("2000.00");
  });

  test("an entry of zero is recorded, returned and stays distinct from no entry", async () => {
    const local = await createBudgetFixture(1);

    const before = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );
    const beforePosition = before.response.categories.find(
      (position) => position.categoryId === local.categoryIds[0],
    );

    await recordCentreBudgetActual(
      {
        principalId: local.centreDirectorId,
        request: {
          centreId: local.centreIds[0],
          month: MONTH,
          categoryId: local.categoryIds[0],
          amount: "0.00",
          currency: CURRENCY,
        },
      },
      { now },
    );

    const after = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );
    const afterPosition = after.response.categories.find(
      (position) => position.categoryId === local.categoryIds[0],
    );

    expect(beforePosition?.state).toBe("AWAITING_ACTUAL");
    expect(afterPosition?.state).toBe("BUDGET_AND_ACTUAL");
    // A deliberate zero is a present value with a real remaining balance.
    expect(afterPosition?.actual?.amount).toBe("0.00");
    expect(afterPosition?.remaining).toBe("1000.00");
    expect(afterPosition?.percentUsed).toBe("0.00");
    expect(JSON.stringify(beforePosition)).not.toBe(JSON.stringify(afterPosition));
  });

  test("a centre with no approved budget and no actual reports nothing recorded", async () => {
    const local = await createBudgetFixture(1, { seedApprovedBudget: false });

    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );

    expect(result.response.categories).toHaveLength(2);
    for (const position of result.response.categories) {
      expect(position.state).toBe("NOTHING_RECORDED");
      expect(position.approvedBudget).toBeUndefined();
      expect(position.actual).toBeUndefined();
    }
    // An entirely empty month must not summarise as a complete zero month.
    expect(result.response.summary.coverage).toBe("partial");
    expect(result.response.summary.nothingRecordedCount).toBe(2);
    expect(result.response.summary.totalApprovedBudget).toBeUndefined();
    expect(result.response.summary.totalRecordedActual).toBeUndefined();
  });

  test("a fully entered month publishes its totals", async () => {
    const local = await createBudgetFixture(1);
    for (const categoryId of local.categoryIds) {
      await recordCentreBudgetActual(
        {
          principalId: local.centreDirectorId,
          request: {
            centreId: local.centreIds[0],
            month: MONTH,
            categoryId,
            amount: "250.00",
            currency: CURRENCY,
          },
        },
        { now },
      );
    }

    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );

    expect(result.response.status).toBe("ready");
    expect(result.response.summary.coverage).toBe("complete");
    expect(result.response.summary.totalApprovedBudget).toBe("2000.00");
    expect(result.response.summary.totalRecordedActual).toBe("500.00");
    expect(result.response.summary.totalRemaining).toBe("1500.00");
    expect(result.response.summary.totalPercentUsed).toBe("25.00");
    expect(result.response.summary.currency).toBe(CURRENCY);
  });

  test("a month absent from the database is empty rather than zeroed", async () => {
    const local = await createBudgetFixture(1);
    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: "2036-04" },
      { now },
    );

    for (const position of result.response.categories) {
      expect(position.state).toBe("NOTHING_RECORDED");
    }
    expect(result.response.summary.totalApprovedBudget).toBeUndefined();
  });
});

describe("money precision", () => {
  test("carries exact decimals that a float would corrupt", async () => {
    const local = await createBudgetFixture(1, { seedApprovedBudget: false });
    await budgetLine(
      local.organisationId,
      local.centreIds[0],
      local.categoryIds[0],
      "0.30",
      local.centreDirectorId,
    );
    await recordCentreBudgetActual(
      {
        principalId: local.centreDirectorId,
        request: {
          centreId: local.centreIds[0],
          month: MONTH,
          categoryId: local.categoryIds[0],
          amount: "0.10",
          currency: CURRENCY,
        },
      },
      { now },
    );

    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );
    const position = result.response.categories.find(
      (candidate) => candidate.categoryId === local.categoryIds[0],
    );

    // 0.30 - 0.10 is 0.19999999999999998 in IEEE-754. Exact NUMERIC gives 0.20.
    expect(position?.remaining).toBe("0.20");
    expect(typeof position?.remaining).toBe("string");
    expect(position?.approvedBudget?.amount).toBe("0.30");
    expect(position?.actual?.amount).toBe("0.10");
  });

  test("preserves large amounts without losing cents", async () => {
    const local = await createBudgetFixture(1, { seedApprovedBudget: false });
    await budgetLine(
      local.organisationId,
      local.centreIds[0],
      local.categoryIds[0],
      "999999999999.99",
      local.centreDirectorId,
    );

    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );
    const position = result.response.categories.find(
      (candidate) => candidate.categoryId === local.categoryIds[0],
    );
    expect(position?.approvedBudget?.amount).toBe("999999999999.99");
  });
});

describe("actual entry, attribution and provenance", () => {
  test("records the entering principal and the manual source", async () => {
    const local = await createBudgetFixture(1);
    const result = await recordCentreBudgetActual(
      {
        principalId: local.centreDirectorId,
        request: {
          centreId: local.centreIds[0],
          month: MONTH,
          categoryId: local.categoryIds[0],
          amount: "400.00",
          currency: CURRENCY,
          note: "Checked against supplier invoices.",
          confirmed: true,
        },
      },
      { now },
    );

    const actual = result.response.position.actual;
    expect(actual?.amount).toBe("400.00");
    expect(actual?.sourceKind).toBe("manual_entry");
    expect(actual?.enteredByPrincipalId).toBe(local.centreDirectorId);
    expect(actual?.note).toBe("Checked against supplier invoices.");
    expect(actual?.confirmed).toBe(true);
    expect(actual?.confirmedByPrincipalId).toBe(local.centreDirectorId);
    // A manual entry carries no source system or cutoff, and must not invent one.
    expect(actual?.sourceSystemKey).toBeUndefined();
    expect(actual?.sourceReference).toBeUndefined();
    expect(actual?.sourceCutoffAt).toBeUndefined();
    expect(result.response.position.remaining).toBe("600.00");
  });

  test("records an unconfirmed entry as a known unconfirmed state", async () => {
    const local = await createBudgetFixture(1);
    const result = await recordCentreBudgetActual(
      {
        principalId: local.centreDirectorId,
        request: {
          centreId: local.centreIds[0],
          month: MONTH,
          categoryId: local.categoryIds[0],
          amount: "400.00",
          currency: CURRENCY,
        },
      },
      { now },
    );

    expect(result.response.position.actual?.confirmed).toBe(false);
    expect(result.response.position.actual?.confirmedAt).toBeUndefined();
    expect(result.response.position.actual?.confirmedByPrincipalId).toBeUndefined();
  });

  test("writes an attributable audit event that carries no monetary detail", async () => {
    const local = await createBudgetFixture(1);
    await recordCentreBudgetActual(
      {
        principalId: local.centreDirectorId,
        request: {
          centreId: local.centreIds[0],
          month: MONTH,
          categoryId: local.categoryIds[0],
          amount: "777.77",
          currency: CURRENCY,
        },
      },
      { now },
    );

    const event = await centreSuccessDB.queryRow<{
      actor_principal_id: string;
      resource_type: string;
      scope_type: string;
      scope_id: string;
      context: Record<string, unknown>;
    }>`
      SELECT actor_principal_id, resource_type, scope_type, scope_id, context
      FROM system_audit_events
      WHERE organisation_id = ${local.organisationId}
        AND action = 'budget_actual.recorded'
    `;

    expect(event?.actor_principal_id).toBe(local.centreDirectorId);
    expect(event?.resource_type).toBe("centre_budget_actual");
    expect(event?.scope_type).toBe("centre");
    expect(event?.scope_id).toBe(local.centreIds[0]);
    expect(event?.context.periodMonth).toBe(MONTH_KEY);
    // SECURITY.md requires finance detail to be minimised in audit payloads.
    expect(JSON.stringify(event?.context)).not.toContain("777.77");
  });

  test("supersedes rather than edits when an actual is corrected", async () => {
    const local = await createBudgetFixture(1);
    const first = await recordCentreBudgetActual(
      {
        principalId: local.centreDirectorId,
        request: {
          centreId: local.centreIds[0],
          month: MONTH,
          categoryId: local.categoryIds[0],
          amount: "400.00",
          currency: CURRENCY,
        },
      },
      { now },
    );
    const firstId = first.response.position.actual?.actualId;

    const second = await recordCentreBudgetActual(
      {
        principalId: local.centreDirectorId,
        request: {
          centreId: local.centreIds[0],
          month: MONTH,
          categoryId: local.categoryIds[0],
          amount: "450.00",
          currency: CURRENCY,
          confirmed: true,
        },
      },
      { now },
    );

    expect(second.response.supersededActualId).toBe(firstId);
    expect(second.response.position.actual?.amount).toBe("450.00");

    const rows = await centreSuccessDB.queryAll<{
      id: string;
      amount: string;
      superseded_by_id: string | null;
    }>`
      SELECT id, amount::text AS amount, superseded_by_id
      FROM centre_budget_actuals
      WHERE organisation_id = ${local.organisationId}
        AND centre_id = ${local.centreIds[0]}
        AND category_id = ${local.categoryIds[0]}
      ORDER BY entered_at, amount
    `;

    // The original figure and its author survive the correction intact.
    expect(rows).toHaveLength(2);
    const original = rows.find((row) => row.id === firstId);
    expect(original?.amount).toBe("400.00");
    expect(original?.superseded_by_id).toBe(second.response.position.actual?.actualId);

    const current = await centreSuccessDB.queryAll<{ id: string }>`
      SELECT id FROM centre_budget_actuals
      WHERE organisation_id = ${local.organisationId}
        AND centre_id = ${local.centreIds[0]}
        AND category_id = ${local.categoryIds[0]}
        AND superseded_at IS NULL
    `;
    expect(current).toHaveLength(1);
  });
});

describe("database-level guarantees", () => {
  test("refuses an in-place edit of a recorded actual", async () => {
    const local = await createBudgetFixture(1);
    const recorded = await recordCentreBudgetActual(
      {
        principalId: local.centreDirectorId,
        request: {
          centreId: local.centreIds[0],
          month: MONTH,
          categoryId: local.categoryIds[0],
          amount: "400.00",
          currency: CURRENCY,
        },
      },
      { now },
    );
    const actualId = recorded.response.position.actual?.actualId;

    await expect(
      centreSuccessDB.exec`
        UPDATE centre_budget_actuals SET amount = 1.00 WHERE id = ${actualId}
      `,
    ).rejects.toThrow(/immutable|only permitted/iu);

    await expect(
      centreSuccessDB.exec`DELETE FROM centre_budget_actuals WHERE id = ${actualId}`,
    ).rejects.toThrow(/append-only/iu);

    const unchanged = await centreSuccessDB.queryRow<{ amount: string }>`
      SELECT amount::text AS amount FROM centre_budget_actuals WHERE id = ${actualId}
    `;
    expect(unchanged?.amount).toBe("400.00");
  });

  test("refuses a manual entry that claims a machine source", async () => {
    const local = await createBudgetFixture(1);
    await expect(
      centreSuccessDB.exec`
        INSERT INTO centre_budget_actuals (
          id, organisation_id, centre_id, category_id, period_month,
          amount, currency_code, source_kind, source_system_key,
          entered_by_principal_id
        ) VALUES (
          ${randomUUID()}, ${local.organisationId}, ${local.centreIds[0]},
          ${local.categoryIds[0]}, ${MONTH_KEY}::date, 100.00, ${CURRENCY},
          'manual_entry', 'some.finance.system', ${local.centreDirectorId}
        )
      `,
    ).rejects.toThrow(/attribution/iu);
  });

  test("refuses an imported actual with no source system or cutoff", async () => {
    const local = await createBudgetFixture(1);
    await expect(
      centreSuccessDB.exec`
        INSERT INTO centre_budget_actuals (
          id, organisation_id, centre_id, category_id, period_month,
          amount, currency_code, source_kind
        ) VALUES (
          ${randomUUID()}, ${local.organisationId}, ${local.centreIds[0]},
          ${local.categoryIds[0]}, ${MONTH_KEY}::date, 100.00, ${CURRENCY},
          'finance_system_import'
        )
      `,
    ).rejects.toThrow(/attribution/iu);
  });

  test("refuses an actual whose currency disagrees with its approved budget", async () => {
    const local = await createBudgetFixture(1);
    await expect(
      recordCentreBudgetActual(
        {
          principalId: local.centreDirectorId,
          request: {
            centreId: local.centreIds[0],
            month: MONTH,
            categoryId: local.categoryIds[0],
            amount: "100.00",
            currency: "NZD",
          },
        },
        { now },
      ),
    ).rejects.toMatchObject({ code: "context_unavailable" });
  });

  test("refuses a period that is not the first of a month", async () => {
    const local = await createBudgetFixture(1);
    await expect(
      centreSuccessDB.exec`
        INSERT INTO centre_budget_actuals (
          id, organisation_id, centre_id, category_id, period_month,
          amount, currency_code, source_kind, entered_by_principal_id
        ) VALUES (
          ${randomUUID()}, ${local.organisationId}, ${local.centreIds[0]},
          ${local.categoryIds[0]}, '2036-03-15'::date, 100.00, ${CURRENCY},
          'manual_entry', ${local.centreDirectorId}
        )
      `,
    ).rejects.toThrow();
  });

  test("permits only one current actual per centre-month-category", async () => {
    const local = await createBudgetFixture(1);
    await recordCentreBudgetActual(
      {
        principalId: local.centreDirectorId,
        request: {
          centreId: local.centreIds[0],
          month: MONTH,
          categoryId: local.categoryIds[0],
          amount: "100.00",
          currency: CURRENCY,
        },
      },
      { now },
    );

    await expect(
      centreSuccessDB.exec`
        INSERT INTO centre_budget_actuals (
          id, organisation_id, centre_id, category_id, period_month,
          amount, currency_code, source_kind, entered_by_principal_id
        ) VALUES (
          ${randomUUID()}, ${local.organisationId}, ${local.centreIds[0]},
          ${local.categoryIds[0]}, ${MONTH_KEY}::date, 200.00, ${CURRENCY},
          'manual_entry', ${local.centreDirectorId}
        )
      `,
    ).rejects.toThrow();
  });
});

describe("threshold bands are governed configuration", () => {
  test("provisions exactly the approved policy, and only it, to every organisation", async () => {
    const local = await createBudgetFixture(1);

    // One approved policy, organisation-wide. Any second `BSA_INTERNAL` policy
    // would be a threshold nobody in this repository is entitled to invent.
    const internal = await centreSuccessDB.queryAll<{ policy_key: string }>`
      SELECT DISTINCT policy_key FROM budget_threshold_policies
      WHERE source_classification = 'BSA_INTERNAL'
      ORDER BY policy_key
    `;
    expect(internal.map((row) => row.policy_key)).toEqual(["bsa_budget_expenses"]);

    // Every organisation holds it exactly once, including one created long
    // after the migration ran, because provisioning is a trigger and not a
    // one-off pass over whichever organisations happened to exist.
    const reach = await centreSuccessDB.queryRow<{
      organisations: number | string;
      policies: number | string;
    }>`
      SELECT
        (SELECT count(*) FROM organisations) AS organisations,
        (SELECT count(*) FROM budget_threshold_policies
         WHERE policy_key = 'bsa_budget_expenses' AND version = 1) AS policies
    `;
    expect(Number(reach?.policies)).toBe(Number(reach?.organisations));

    const policy = await centreSuccessDB.queryRow<{
      status: string;
      source_classification: string;
      effective_from_month: Date | string;
      effective_to_month: Date | string | null;
      approval_source_type: string;
      approved_by_principal_id: string | null;
      approved_by_name: string | null;
      approval_reference: string | null;
      approved_on: Date | string;
    }>`
      SELECT status, source_classification, effective_from_month, effective_to_month,
             approval_source_type, approved_by_principal_id, approved_by_name,
             approval_reference, approved_on
      FROM budget_threshold_policies
      WHERE organisation_id = ${local.organisationId} AND policy_key = 'bsa_budget_expenses'
    `;
    expect(policy?.status).toBe("active");
    expect(policy?.source_classification).toBe("BSA_INTERNAL");
    expect(String(policy?.effective_from_month).slice(0, 10)).toBe("2026-08-01");
    expect(policy?.effective_to_month).toBeNull();
    // The approval happened outside this system, so it names the document and
    // the approver rather than pointing at an invented principal row.
    expect(policy?.approval_source_type).toBe("governed_document");
    expect(policy?.approved_by_principal_id).toBeNull();
    expect(policy?.approved_by_name).toBe("Bright Steps Product Owner");
    expect(policy?.approval_reference).toBe(
      "BSA Budget Expenses template supplied by Karen (Area Manager); approved organisation-wide 14 August 2026.",
    );
    expect(String(policy?.approved_on).slice(0, 10)).toBe("2026-08-14");
  });

  test("stores both approved rules with their exact bounds and inclusivity", async () => {
    const local = await createBudgetFixture(1);

    const bands = await centreSuccessDB.queryAll<{
      rule_code: string;
      measure: string;
      band_code: string;
      minimum_basis: string | null;
      minimum_value: string | null;
      minimum_inclusive: boolean | null;
      maximum_basis: string | null;
      maximum_value: string | null;
      maximum_inclusive: boolean | null;
    }>`
      SELECT threshold_rule.rule_code, threshold_rule.measure, band.band_code,
             band.minimum_basis, band.minimum_value::text AS minimum_value,
             band.minimum_inclusive,
             band.maximum_basis, band.maximum_value::text AS maximum_value,
             band.maximum_inclusive
      FROM budget_threshold_rules AS threshold_rule
      JOIN budget_threshold_bands AS band
        ON band.threshold_rule_id = threshold_rule.id
      WHERE threshold_rule.organisation_id = ${local.organisationId}
      ORDER BY threshold_rule.sort_order, band.priority
    `;

    // The approved rules, verbatim. 100 is inclusive at the top of amber and
    // red begins strictly above it, stated by the inclusivity flags rather than
    // by a 100.01 standing in for "just over 100".
    expect(
      bands.map((band) => [
        band.rule_code,
        band.measure,
        band.band_code,
        band.minimum_basis,
        band.minimum_value,
        band.minimum_inclusive,
        band.maximum_basis,
        band.maximum_value,
        band.maximum_inclusive,
      ]),
    ).toEqual([
      ["BUDGET_USED", "percent_used", "RED", "measure_units", "100.0000", false, null, null, null],
      [
        "BUDGET_USED",
        "percent_used",
        "AMBER",
        "measure_units",
        "85.0000",
        true,
        "measure_units",
        "100.0000",
        true,
      ],
      ["BUDGET_USED", "percent_used", "GREEN", null, null, null, "measure_units", "85.0000", false],
      [
        "REMAINING_BUDGET",
        "remaining_amount",
        "RED",
        null,
        null,
        null,
        "measure_units",
        "0.0000",
        false,
      ],
      [
        "REMAINING_BUDGET",
        "remaining_amount",
        "AMBER",
        "measure_units",
        "0.0000",
        true,
        "percent_of_approved",
        "10.0000",
        false,
      ],
      [
        "REMAINING_BUDGET",
        "remaining_amount",
        "GREEN",
        "percent_of_approved",
        "10.0000",
        true,
        null,
        null,
        null,
      ],
    ]);
  });

  test("judges no month before the approval took effect", async () => {
    const local = await createBudgetFixture(1);
    // July 2026 predates the approval, so nobody had decided what good looked
    // like for it. That has to keep reporting NOT_CONFIGURED rather than being
    // graded retrospectively under a rule that did not exist at the time.
    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: "2026-07" },
      { now },
    );
    expect(result.response.thresholdPolicyConfigured).toBe(false);
    for (const position of result.response.categories) {
      expect(position.threshold.state).toBe("NOT_CONFIGURED");
      expect(position.threshold.rules).toEqual([]);
    }
  });

  test("a governed policy bands a position under the version in force that month", async () => {
    const local = await createBudgetFixture(1);
    // Synthetic bands, explicitly classified as development/test data. These
    // exercise the mechanism and are not a proposed Bright Steps threshold.
    const policyId = randomUUID();
    const ruleId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO budget_threshold_policies (
        id, organisation_id, policy_key, version, name, status,
        source_classification, effective_from_month, approval_source_type,
        approved_by_principal_id, approval_reference
      ) VALUES (
        ${policyId}, ${local.organisationId}, 'synthetic_test_policy', 1,
        'Synthetic test threshold policy', 'active',
        'BSA_DEVELOPMENT_TEST', '2036-01-01'::date, 'principal',
        ${local.centreDirectorId}, 'SYNTHETIC-FIXTURE'
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO budget_threshold_rules (
        id, organisation_id, threshold_policy_id, rule_code, label, measure, sort_order
      ) VALUES (
        ${ruleId}, ${local.organisationId}, ${policyId},
        'SYNTHETIC_RULE', 'Synthetic rule', 'percent_used', 1
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO budget_threshold_bands (
        id, organisation_id, threshold_policy_id, threshold_rule_id, band_code, label,
        minimum_basis, minimum_value, minimum_inclusive,
        maximum_basis, maximum_value, maximum_inclusive, priority
      ) VALUES (
        ${randomUUID()}, ${local.organisationId}, ${policyId}, ${ruleId},
        'SYNTHETIC_LOWER', 'Synthetic lower band',
        'measure_units', 0, TRUE, 'measure_units', 60, FALSE, 1
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO budget_threshold_bands (
        id, organisation_id, threshold_policy_id, threshold_rule_id, band_code, label,
        minimum_basis, minimum_value, minimum_inclusive,
        maximum_basis, maximum_value, maximum_inclusive, priority
      ) VALUES (
        ${randomUUID()}, ${local.organisationId}, ${policyId}, ${ruleId},
        'SYNTHETIC_UPPER', 'Synthetic upper band',
        'measure_units', 60, TRUE, NULL, NULL, NULL, 2
      )
    `;

    await recordCentreBudgetActual(
      {
        principalId: local.centreDirectorId,
        request: {
          centreId: local.centreIds[0],
          month: MONTH,
          categoryId: local.categoryIds[0],
          amount: "800.00",
          currency: CURRENCY,
        },
      },
      { now },
    );

    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );
    const banded = result.response.categories.find(
      (position) => position.categoryId === local.categoryIds[0],
    );

    expect(result.response.thresholdPolicyConfigured).toBe(true);
    expect(banded?.percentUsed).toBe("80.00");
    // The later-effective policy governs the month, so the approved policy does
    // not judge it and none of its bands appear.
    expect(banded?.threshold).toEqual({
      state: "GOVERNED",
      policyKey: "synthetic_test_policy",
      policyVersion: 1,
      policyEffectiveFromMonth: "2036-01",
      rules: [
        {
          ruleCode: "SYNTHETIC_RULE",
          ruleLabel: "Synthetic rule",
          measure: "percent_used",
          state: "BANDED",
          bandCode: "SYNTHETIC_UPPER",
          bandLabel: "Synthetic upper band",
        },
      ],
    });

    // A month before this policy took effect is judged by whichever version was
    // in force then, which here is the approved one, not this synthetic one.
    const earlier = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: "2035-12" },
      { now },
    );
    expect(earlier.response.thresholdPolicyConfigured).toBe(true);
    for (const position of earlier.response.categories) {
      expect(position.threshold.policyKey).toBe("bsa_budget_expenses");
      expect(position.threshold.rules.map((rule) => rule.ruleCode)).toEqual([
        "BUDGET_USED",
        "REMAINING_BUDGET",
      ]);
    }
  });
});

describe("portfolio query budget", () => {
  test("does not scale its query count with the number of centres", async () => {
    const one = await createBudgetFixture(1);
    const five = await createBudgetFixture(5);
    const twenty = await createBudgetFixture(20);

    const single = await buildPortfolioBudgetMonth(
      { principalId: one.areaManagerId, month: MONTH },
      { now },
    );
    const medium = await buildPortfolioBudgetMonth(
      { principalId: five.areaManagerId, month: MONTH },
      { now },
    );
    const large = await buildPortfolioBudgetMonth(
      { principalId: twenty.areaManagerId, month: MONTH },
      { now },
    );

    expect(single.response.centres).toHaveLength(1);
    expect(medium.response.centres).toHaveLength(5);
    expect(large.response.centres).toHaveLength(20);

    // Authorisation is evaluated in memory over one set-wise centre load, and
    // every budget source is queried with one centre-ID array, so no centre
    // adds a query.
    //
    // The eleven are, in order: the snapshot isolation statement; the
    // principal's single active organisation; the authorisation context loader's
    // four (principal, organisation, membership, role assignments); one
    // set-wise centre authorisation facts load; then this module's own four,
    // the categories, the governing threshold policy, the position rows and the
    // per-centre totals. A twelfth is a regression, not a feature.
    expect([
      single.diagnostics.queryCount,
      medium.diagnostics.queryCount,
      large.diagnostics.queryCount,
    ]).toEqual([11, 11, 11]);
  });

  test("keeps the centre detail query count constant regardless of portfolio size", async () => {
    const one = await createBudgetFixture(1);
    const twenty = await createBudgetFixture(20);

    const small = await buildCentreBudgetMonth(
      { principalId: one.areaManagerId, centreId: one.centreIds[0], month: MONTH },
      { now },
    );
    const large = await buildCentreBudgetMonth(
      { principalId: twenty.areaManagerId, centreId: twenty.centreIds[0], month: MONTH },
      { now },
    );

    expect(small.diagnostics.queryCount).toBe(large.diagnostics.queryCount);
    expect(small.diagnostics.queryCount).toBe(11);
  });
});

describe("capability registration", () => {
  test("registers both budget capabilities exactly once", async () => {
    const rows = await centreSuccessDB.queryAll<{ code: string }>`
      SELECT code FROM capabilities
      WHERE code IN ('budget.position.read', 'budget.actual.enter')
      ORDER BY code
    `;
    expect(rows.map((row) => row.code)).toEqual([
      FOUNDATION_CAPABILITIES.budgetActualEnter,
      FOUNDATION_CAPABILITIES.budgetPositionRead,
    ]);
  });

  test("gives the System Administrator template no budget capability", async () => {
    const rows = await centreSuccessDB.queryAll<{ capability_code: string }>`
      SELECT role_capability.capability_code
      FROM canonical_role_templates AS template
      JOIN canonical_role_template_capabilities AS role_capability
        ON role_capability.role_key = template.role_key
       AND role_capability.role_version = template.version
      WHERE template.status = 'active'
        AND template.role_key = 'system_administrator'
        AND role_capability.capability_code LIKE 'budget.%'
    `;
    expect(rows).toEqual([]);
  });

  test("grants entry only to the Centre Director bundle", async () => {
    const rows = await centreSuccessDB.queryAll<{ role_key: string }>`
      SELECT template.role_key
      FROM canonical_role_templates AS template
      JOIN canonical_role_template_capabilities AS role_capability
        ON role_capability.role_key = template.role_key
       AND role_capability.role_version = template.version
      WHERE template.status = 'active'
        AND role_capability.capability_code = 'budget.actual.enter'
      ORDER BY template.role_key
    `;
    expect(rows.map((row) => row.role_key)).toEqual(["centre_director"]);
  });
});

/**
 * Unknown is not zero, and it is not a colour either.
 *
 * Seeding bands is the change most likely to break that quietly: once a policy
 * governs a month, a centre-month with no actual recorded could start
 * resolving to whichever band happens to cover zero, and a green light would
 * appear where nobody has entered anything at all.
 *
 * The policy installed here is the worst case for that failure — a single band
 * spanning every percentage from zero upwards, so any band lookup that ran at
 * all would return a colour. It is classified as development/test data and is
 * not a proposed Bright Steps threshold.
 */
async function installCoveringPolicy(local: BudgetFixture): Promise<string> {
  const policyId = randomUUID();
  await centreSuccessDB.exec`
    INSERT INTO budget_threshold_policies (
      id, organisation_id, policy_key, version, name, status,
      source_classification, effective_from_month, approval_source_type,
      approved_by_principal_id, approval_reference
    ) VALUES (
      ${policyId}, ${local.organisationId}, 'synthetic_covering_policy', 1,
      'Synthetic policy whose band covers every value', 'active',
      'BSA_DEVELOPMENT_TEST', '2036-01-01'::date, 'principal',
      ${local.centreDirectorId}, 'SYNTHETIC-FIXTURE'
    )
  `;
  // One rule per measure, each with a single unbounded band. Every value of
  // every measure falls inside it, so anything a lookup returns at all is a
  // colour, which is exactly the failure these tests are watching for.
  for (const [index, measure] of ["percent_used", "remaining_amount"].entries()) {
    const ruleId = randomUUID();
    await centreSuccessDB.exec`
      INSERT INTO budget_threshold_rules (
        id, organisation_id, threshold_policy_id, rule_code, label, measure, sort_order
      ) VALUES (
        ${ruleId}, ${local.organisationId}, ${policyId},
        ${`SYNTHETIC_RULE_${index}`}, ${`Synthetic covering rule ${index}`},
        ${measure}, ${index + 1}
      )
    `;
    await centreSuccessDB.exec`
      INSERT INTO budget_threshold_bands (
        id, organisation_id, threshold_policy_id, threshold_rule_id, band_code, label,
        minimum_basis, minimum_value, minimum_inclusive,
        maximum_basis, maximum_value, maximum_inclusive, priority
      ) VALUES (
        ${randomUUID()}, ${local.organisationId}, ${policyId}, ${ruleId},
        'SYNTHETIC_EVERYTHING', 'Synthetic band covering every value',
        NULL, NULL, NULL, NULL, NULL, NULL, 1
      )
    `;
  }
  return policyId;
}

describe("a seeded band never turns an absent actual into a colour", () => {
  test("an approved budget with no actual is unbanded under a policy covering every percentage", async () => {
    const local = await createBudgetFixture(1);
    await installCoveringPolicy(local);

    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );

    // The policy is in force, so this is not the NOT_CONFIGURED case: a band
    // lookup really did run for every category and really did return nothing.
    expect(result.response.thresholdPolicyConfigured).toBe(true);
    expect(result.response.categories.length).toBeGreaterThan(0);
    for (const position of result.response.categories) {
      expect(position.state).toBe("AWAITING_ACTUAL");
      expect(position.threshold.state).toBe("GOVERNED");
      // Both rules were asked, and neither could answer. Not one of them
      // returned the band that covers everything.
      expect(position.threshold.rules).toHaveLength(2);
      for (const rule of position.threshold.rules) {
        expect(rule.state).toBe("NOT_APPLICABLE");
        expect(rule.bandCode).toBeUndefined();
        expect(rule.bandLabel).toBeUndefined();
      }
      expect(position.actual).toBeUndefined();
      expect(position.remaining).toBeUndefined();
      expect(position.percentUsed).toBeUndefined();
    }

    // Nor may the month-level roll-up carry one, because the month is not
    // complete and a total over a partly entered month understates spend.
    expect(result.response.summary.coverage).toBe("partial");
    expect(result.response.summary.threshold).toBeUndefined();
    expect(result.response.summary.totalRecordedActual).toBeUndefined();
    expect(result.response.summary.totalRemaining).toBeUndefined();
    expect(result.response.summary.totalPercentUsed).toBeUndefined();
    // No absent figure may have been rendered as a spend of zero on the way out.
    expect(JSON.stringify(result.response)).not.toMatch(
      /"(?:actual|remaining|percentUsed)":\s*"?0/u,
    );
  });

  test("a category with nothing recorded at all is unbanded under the same policy", async () => {
    const local = await createBudgetFixture(1, { seedApprovedBudget: false });
    await installCoveringPolicy(local);

    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );

    expect(result.response.thresholdPolicyConfigured).toBe(true);
    expect(result.response.categories.length).toBeGreaterThan(0);
    for (const position of result.response.categories) {
      expect(position.state).toBe("NOTHING_RECORDED");
      expect(position.threshold.state).toBe("GOVERNED");
      expect(position.threshold.rules).toHaveLength(2);
      for (const rule of position.threshold.rules) {
        expect(rule.state).toBe("NOT_APPLICABLE");
        expect(rule.bandCode).toBeUndefined();
      }
      expect(position.approvedBudget).toBeUndefined();
      expect(position.actual).toBeUndefined();
    }
    expect(result.response.summary.nothingRecordedCount).toBe(
      result.response.categories.length,
    );
    expect(result.response.summary.totalApprovedBudget).toBeUndefined();
  });

  /**
   * The control for the two assertions above. Without it they could pass
   * because no band ever resolves, rather than because absence is respected.
   */
  test("bands the one category whose actual was actually recorded, and no other", async () => {
    const local = await createBudgetFixture(1);
    await installCoveringPolicy(local);

    await recordCentreBudgetActual(
      {
        principalId: local.centreDirectorId,
        request: {
          centreId: local.centreIds[0],
          month: MONTH,
          categoryId: local.categoryIds[0],
          amount: "250.00",
          currency: CURRENCY,
        },
      },
      { now },
    );

    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );

    const entered = result.response.categories.find(
      (position) => position.categoryId === local.categoryIds[0],
    );
    expect(entered?.state).toBe("BUDGET_AND_ACTUAL");
    expect(entered?.threshold.state).toBe("GOVERNED");
    // Both rules had something to measure, so both returned the covering band.
    // Without this the two assertions above could pass because no band ever
    // resolves, rather than because absence is respected.
    expect(entered?.threshold.rules.map((rule) => [rule.state, rule.bandCode])).toEqual([
      ["BANDED", "SYNTHETIC_EVERYTHING"],
      ["BANDED", "SYNTHETIC_EVERYTHING"],
    ]);

    for (const position of result.response.categories) {
      if (position.categoryId === local.categoryIds[0]) continue;
      expect(position.state).toBe("AWAITING_ACTUAL");
      expect(position.threshold.state).toBe("GOVERNED");
      for (const rule of position.threshold.rules) {
        expect(rule.state).toBe("NOT_APPLICABLE");
        expect(rule.bandCode).toBeUndefined();
      }
    }
  });
});

/**
 * The same risk, now against the bands that were actually approved rather than
 * a synthetic stand-in. Both approved rules band every value their measure can
 * take: Rule A covers every percentage and Rule B covers every amount, with no
 * gap between them. So from the moment they are seeded, any lookup that ran
 * where nothing was recorded would come back with a colour.
 */
describe("the approved bands never turn an absent actual into a colour", () => {
  function ruleStates(position: {
    threshold: { rules: readonly { ruleCode: string; state: string; bandCode?: string }[] };
  }): [string, string, string | undefined][] {
    return position.threshold.rules.map((rule) => [rule.ruleCode, rule.state, rule.bandCode]);
  }

  test("an approved budget with no actual is unbanded by both approved rules", async () => {
    const local = await createBudgetFixture(1);
    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );

    // The approved policy is in force, so a band lookup really did run for
    // every category, against bands that cover every value, and returned none.
    expect(result.response.thresholdPolicyConfigured).toBe(true);
    expect(result.response.categories.length).toBeGreaterThan(0);
    for (const position of result.response.categories) {
      expect(position.state).toBe("AWAITING_ACTUAL");
      expect(position.threshold.policyKey).toBe("bsa_budget_expenses");
      expect(ruleStates(position)).toEqual([
        ["BUDGET_USED", "NOT_APPLICABLE", undefined],
        ["REMAINING_BUDGET", "NOT_APPLICABLE", undefined],
      ]);
    }
    expect(result.response.summary.threshold).toBeUndefined();
    // Nothing absent may have been rendered as a spend of zero on the way out.
    expect(JSON.stringify(result.response)).not.toMatch(
      /"(?:actual|remaining|percentUsed)":\s*"?0/u,
    );
  });

  test("a category with nothing recorded at all is unbanded by both approved rules", async () => {
    const local = await createBudgetFixture(1, { seedApprovedBudget: false });
    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );

    expect(result.response.thresholdPolicyConfigured).toBe(true);
    expect(result.response.categories.length).toBeGreaterThan(0);
    for (const position of result.response.categories) {
      expect(position.state).toBe("NOTHING_RECORDED");
      expect(ruleStates(position)).toEqual([
        ["BUDGET_USED", "NOT_APPLICABLE", undefined],
        ["REMAINING_BUDGET", "NOT_APPLICABLE", undefined],
      ]);
    }
  });

  /**
   * The control for both assertions above, and the boundary table for the
   * approved rules. Without it the two could pass because the approved bands
   * never resolve at all, rather than because absence is respected.
   *
   * Every centre-month here has an approved budget of 1000.00 in one category.
   */
  test("bands every recorded actual exactly as the approval states", async () => {
    const local = await createBudgetFixture(1);
    const cases = [
      // Rule A's lower boundary: 85 is amber, just under it is green.
      { actual: "840.00", percentUsed: "84.00", remaining: "160.00", bands: ["GREEN", "GREEN"] },
      { actual: "850.00", percentUsed: "85.00", remaining: "150.00", bands: ["AMBER", "GREEN"] },
      // Rule B's boundary: exactly 10% of the approved budget is still green.
      { actual: "900.00", percentUsed: "90.00", remaining: "100.00", bands: ["AMBER", "GREEN"] },
      { actual: "901.00", percentUsed: "90.10", remaining: "99.00", bands: ["AMBER", "AMBER"] },
      // Rule A's upper boundary: 100 is inclusive, so it is still amber, and
      // nothing is left, so Rule B is amber too.
      { actual: "1000.00", percentUsed: "100.00", remaining: "0.00", bands: ["AMBER", "AMBER"] },
      // A cent over. Red begins strictly above 100, and the judgement is made
      // on the exact ratio, so it is red even though the percentage displayed
      // beside it has rounded back down to 100.00.
      { actual: "1000.01", percentUsed: "100.00", remaining: "-0.01", bands: ["RED", "RED"] },
      { actual: "1100.00", percentUsed: "110.00", remaining: "-100.00", bands: ["RED", "RED"] },
    ];

    for (const expected of cases) {
      await recordCentreBudgetActual(
        {
          principalId: local.centreDirectorId,
          request: {
            centreId: local.centreIds[0],
            month: MONTH,
            categoryId: local.categoryIds[0],
            amount: expected.actual,
            currency: CURRENCY,
          },
        },
        { now },
      );

      const result = await buildCentreBudgetMonth(
        { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
        { now },
      );
      const banded = result.response.categories.find(
        (position) => position.categoryId === local.categoryIds[0],
      );

      expect(banded?.percentUsed, expected.actual).toBe(expected.percentUsed);
      expect(banded?.remaining, expected.actual).toBe(expected.remaining);
      expect(ruleStates(banded!), expected.actual).toEqual([
        ["BUDGET_USED", "BANDED", expected.bands[0]],
        ["REMAINING_BUDGET", "BANDED", expected.bands[1]],
      ]);

      // The category nobody entered stays unbanded throughout, in the same
      // response, under the same bands that just graded its neighbour.
      const untouched = result.response.categories.find(
        (position) => position.categoryId === local.categoryIds[1],
      );
      expect(untouched?.state, expected.actual).toBe("AWAITING_ACTUAL");
      expect(ruleStates(untouched!), expected.actual).toEqual([
        ["BUDGET_USED", "NOT_APPLICABLE", undefined],
        ["REMAINING_BUDGET", "NOT_APPLICABLE", undefined],
      ]);
    }
  });

  /**
   * The reason the two rules are stored and resolved separately rather than one
   * being derived from the other. Against an approved budget of zero there is
   * no percentage to judge, and there is still a real balance to judge, so the
   * rules do not agree and neither may stand in for the other.
   */
  test("judges an overspent zero budget on what remains, with no percentage to judge", async () => {
    const local = await createBudgetFixture(1, { seedApprovedBudget: false });
    await budgetLine(
      local.organisationId,
      local.centreIds[0],
      local.categoryIds[0],
      "0.00",
      local.centreDirectorId,
    );
    await recordCentreBudgetActual(
      {
        principalId: local.centreDirectorId,
        request: {
          centreId: local.centreIds[0],
          month: MONTH,
          categoryId: local.categoryIds[0],
          amount: "125.00",
          currency: CURRENCY,
        },
      },
      { now },
    );

    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );
    const position = result.response.categories.find(
      (candidate) => candidate.categoryId === local.categoryIds[0],
    );

    expect(position?.remaining).toBe("-125.00");
    expect(position?.percentUsed).toBeUndefined();
    expect(position?.threshold.rules).toEqual([
      {
        ruleCode: "BUDGET_USED",
        ruleLabel: "Budget used",
        measure: "percent_used",
        state: "NOT_APPLICABLE",
        reason: "The approved budget is zero, so percent used is undefined.",
      },
      {
        ruleCode: "REMAINING_BUDGET",
        ruleLabel: "Remaining budget",
        measure: "remaining_amount",
        state: "BANDED",
        bandCode: "RED",
        bandLabel: "Remaining budget is below zero",
      },
    ]);
  });

  test("judges the month total by both rules once every category is recorded", async () => {
    const local = await createBudgetFixture(1);
    for (const categoryId of local.categoryIds) {
      await recordCentreBudgetActual(
        {
          principalId: local.centreDirectorId,
          request: {
            centreId: local.centreIds[0],
            month: MONTH,
            categoryId,
            amount: "850.00",
            currency: CURRENCY,
          },
        },
        { now },
      );
    }

    const result = await buildCentreBudgetMonth(
      { principalId: local.centreDirectorId, centreId: local.centreIds[0], month: MONTH },
      { now },
    );
    const summary = result.response.summary;

    expect(summary.coverage).toBe("complete");
    expect(summary.totalApprovedBudget).toBe("2000.00");
    expect(summary.totalRemaining).toBe("300.00");
    expect(summary.totalPercentUsed).toBe("85.00");
    // 85% used is amber, and 300.00 of a 2000.00 budget is 15% remaining, which
    // is green. Both are true at once and both are reported.
    expect(
      summary.threshold?.rules.map((rule) => [rule.ruleCode, rule.state, rule.bandCode]),
    ).toEqual([
      ["BUDGET_USED", "BANDED", "AMBER"],
      ["REMAINING_BUDGET", "BANDED", "GREEN"],
    ]);
  });
});

/**
 * The Budgets destination is reachable only for the capability the budget read
 * endpoints themselves check, so a link can never promise access a request
 * would then refuse.
 */
describe("Budgets navigation is derived from budget read capability", () => {
  test("gives a Centre Director and an Area Manager the Budgets destination", async () => {
    const director = await buildAuthorisedNavigation(
      { principalId: fixture.centreDirectorId },
      { now },
    );
    expect(director.response.links).toContainEqual({ label: "Budgets", route: "/budgets" });

    const areaManager = await buildAuthorisedNavigation(
      { principalId: fixture.areaManagerId },
      { now },
    );
    expect(areaManager.response.links.map((link) => link.route)).toContain("/budgets");
  });

  test("withholds it from a principal without budget position read", async () => {
    // Finance holds `budget.summary.read`, the older synthetic marker that
    // PERMISSIONS.md says does not authorise a budget module. It must not open
    // the door that `budget.position.read` guards.
    const finance = await buildAuthorisedNavigation(
      { principalId: fixture.financeId },
      { now },
    );
    expect(finance.response.links.map((link) => link.route)).not.toContain("/budgets");

    // And the endpoint agrees with the link.
    await expect(
      buildCentreBudgetMonth(
        { principalId: fixture.financeId, centreId: fixture.centreIds[0], month: MONTH },
        { now },
      ),
    ).rejects.toBeInstanceOf(CentreBudgetError);
  });

  test("gives a System Administrator no Budgets destination", async () => {
    const administrator = await buildAuthorisedNavigation(
      { principalId: fixture.systemAdministratorId },
      { now },
    );
    // Technical administration confers no authority over financial content, so
    // it produces no link and no read either.
    expect(administrator.response.links.map((link) => link.route)).not.toContain("/budgets");
    await expect(
      buildCentreBudgetMonth(
        {
          principalId: fixture.systemAdministratorId,
          centreId: fixture.centreIds[0],
          month: MONTH,
        },
        { now },
      ),
    ).rejects.toBeInstanceOf(CentreBudgetError);
  });

  test("changes no destination a principal already had", async () => {
    const director = await buildAuthorisedNavigation(
      { principalId: fixture.centreDirectorId },
      { now },
    );
    const routes = director.response.links.map((link) => link.route);
    expect(routes).toContain("/quality");
    expect(routes).toContain("/centre");
    expect(routes).not.toContain("/admin/people");
    expect(routes).not.toContain("/compliance");
  });
});
