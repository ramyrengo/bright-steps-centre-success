import { describe, expect, test, vi } from "vitest";
import type { AuthorisationQueryExecutor } from "./database";
import { loadOrganisationCentreAuthorisationFacts } from "./batch-centres";

const ORGANISATION_ID = "00000000-0000-4000-8000-000000000090";
const OTHER_ORGANISATION_ID = "00000000-0000-4000-8000-000000000091";
const AT = new Date("2026-08-12T00:00:00.000Z");

function row(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `Centre ${id.slice(-2)}`,
    timezone: "Australia/Sydney",
    direct_membership_count: 1,
    organisational_unit_ids: ["00000000-0000-4000-8000-000000000010"],
    has_cycle: false,
    has_inactive_unit: false,
    ...overrides,
  };
}

async function load(rows: unknown[]) {
  const queryAll = vi.fn().mockResolvedValue(rows);
  const result = await loadOrganisationCentreAuthorisationFacts(
    { queryAll, queryRow: vi.fn() } as unknown as AuthorisationQueryExecutor,
    ORGANISATION_ID,
    AT,
  );
  return { result, queryAll };
}

describe("set-wise centre authorization facts", () => {
  test("isolates ambiguous membership while retaining valid centres", async () => {
    const validId = "00000000-0000-4000-8000-000000000001";
    const invalidId = "00000000-0000-4000-8000-000000000002";
    const { result } = await load([row(validId), row(invalidId, { direct_membership_count: 2 })]);
    expect(result.centres.map((centre) => centre.id)).toEqual([validId]);
    expect(result.invalidCentres).toEqual([
      expect.objectContaining({ id: invalidId, reason: "hierarchy_ambiguous" }),
    ]);
  });

  test("isolates a hierarchy cycle without authorizing the affected centre", async () => {
    const invalidId = "00000000-0000-4000-8000-000000000003";
    const { result } = await load([row(invalidId, { has_cycle: true })]);
    expect(result.centres).toEqual([]);
    expect(result.invalidCentres).toEqual([
      expect.objectContaining({ id: invalidId, reason: "hierarchy_cycle" }),
    ]);
  });

  test("isolates an inactive ancestor without weakening the hierarchy check", async () => {
    const invalidId = "00000000-0000-4000-8000-000000000004";
    const { result } = await load([row(invalidId, { has_inactive_unit: true })]);
    expect(result.centres).toEqual([]);
    expect(result.invalidCentres).toEqual([
      expect.objectContaining({ id: invalidId, reason: "hierarchy_inactive" }),
    ]);
  });

  test("returns a mixed organisation's valid facts and all invalid centre reasons", async () => {
    const { result } = await load([
      row("00000000-0000-4000-8000-000000000005"),
      row("00000000-0000-4000-8000-000000000006", { direct_membership_count: 2 }),
      row("00000000-0000-4000-8000-000000000007", { has_cycle: true }),
      row("00000000-0000-4000-8000-000000000008", { has_inactive_unit: true }),
    ]);
    expect(result.centres).toHaveLength(1);
    expect(result.invalidCentres.map((centre) => centre.reason)).toEqual([
      "hierarchy_ambiguous",
      "hierarchy_cycle",
      "hierarchy_inactive",
    ]);
  });

  test("pins every set-wise query predicate to the requested organisation", async () => {
    const { queryAll } = await load([]);
    const interpolatedValues = queryAll.mock.calls[0].slice(1);
    expect(interpolatedValues).toContain(ORGANISATION_ID);
    expect(interpolatedValues).not.toContain(OTHER_ORGANISATION_ID);
  });
});
