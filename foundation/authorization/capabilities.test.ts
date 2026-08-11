import { describe, expect, test } from "vitest";
import { centreSuccessDB } from "../db";
import { FOUNDATION_CAPABILITIES } from "./capabilities";

describe("foundation capability catalogue", () => {
  test("migration and policy code use the same canonical capability keys", async () => {
    const storedCodes: string[] = [];

    for await (const row of centreSuccessDB.query<{ code: string }>`
      SELECT code
      FROM capabilities
      ORDER BY code
    `) {
      storedCodes.push(row.code);
    }

    expect(storedCodes).toEqual(
      Object.values(FOUNDATION_CAPABILITIES).sort(),
    );
  });
});
