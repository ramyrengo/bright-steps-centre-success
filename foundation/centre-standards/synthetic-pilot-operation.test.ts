import { describe, expect, test } from "vitest";

import { SyntheticStandardsSeedError } from "./synthetic-environment";
import { seedSyntheticStandardsPilotForPrincipal } from "./synthetic-pilot-operation";

/**
 * The environment gate is asserted before any database work, so these cases need
 * no fixtures. They run in the integration suite only because importing the
 * module pulls in the Encore runtime. The ordering is the point: an attempt to
 * seed the wrong environment is refused before a transaction is ever opened.
 *
 * If any of these ever needs a database to run, the gate has moved and the
 * refusal is no longer the first thing that happens.
 */

const PRINCIPAL = "b5c40000-0000-4000-8000-0000000000f1";
const CENTRE = "b5c40000-0000-4000-8000-0000000000f2";

function seedIn(environment: { cloud: string; name: string; type: string }) {
  return seedSyntheticStandardsPilotForPrincipal({
    principalId: PRINCIPAL,
    centreId: CENTRE,
    environment: environment as never,
    now: () => new Date("2026-08-14T00:00:00.000Z"),
  });
}

describe("synthetic pilot seeding gate", () => {
  test.each([
    ["production", { cloud: "encore", name: "production", type: "production" }],
    ["a preview environment", { cloud: "encore", name: "pr-42", type: "development" }],
    ["something merely named staging elsewhere", { cloud: "aws", name: "staging", type: "development" }],
    ["a production-type environment named staging", { cloud: "encore", name: "staging", type: "production" }],
    ["local by name but not by cloud", { cloud: "encore", name: "local", type: "development" }],
  ])("refuses %s before touching the database", async (_label, environment) => {
    await expect(seedIn(environment)).rejects.toBeInstanceOf(SyntheticStandardsSeedError);
  });

  test("rejects a malformed principal or centre identifier", async () => {
    const staging = { cloud: "encore", name: "staging", type: "development" };
    await expect(
      seedSyntheticStandardsPilotForPrincipal({
        principalId: "not-a-uuid",
        centreId: CENTRE,
        environment: staging as never,
      }),
    ).rejects.toThrow();
    await expect(
      seedSyntheticStandardsPilotForPrincipal({
        principalId: PRINCIPAL,
        centreId: "not-a-uuid",
        environment: staging as never,
      }),
    ).rejects.toThrow();
  });

  test("the exact staging shape is the one that passes the gate", async () => {
    // It must fail for a reason beyond the environment — there is no database
    // here, so anything other than the seed error means the gate let it through
    // and it went on to do real work.
    const error = await seedIn({
      cloud: "encore",
      name: "staging",
      type: "development",
    }).catch((failure: unknown) => failure);

    expect(error).toBeDefined();
    expect(error).not.toBeInstanceOf(SyntheticStandardsSeedError);
  });
});
