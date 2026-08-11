import { describe, expect, test } from "vitest";
import { health } from "./api";

describe("foundation health API", () => {
  test("reports the Encore backend and PostgreSQL as available", async () => {
    const response = await health();

    expect(response).toMatchObject({
      status: "operational",
      milestone: "1",
      backend: "connected",
      database: "available",
    });
    expect(Number.isNaN(Date.parse(response.checkedAt))).toBe(false);
  });
});
