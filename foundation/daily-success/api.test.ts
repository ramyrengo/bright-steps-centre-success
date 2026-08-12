import { APIError } from "encore.dev/api";
import { describe, expect, test, vi } from "vitest";
import { loadDailySuccess } from "./api";
import { DailySuccessError } from "./service";

const RESPONSE = {
  cacheControl: "private, no-store" as const,
  asOf: "2026-08-12T00:00:00.000Z",
  status: "unsupported" as const,
  availablePerspectives: [],
  businessDates: [],
  sections: [],
  attentionCentres: [],
  verificationItems: [],
  aggregateCounts: { coverage: "complete" as const, active: 0, urgent: 0, dueToday: 0, waiting: 0, distinctCentres: 0 },
  sourceHealth: [],
  authorisationHealth: { status: "available" as const },
  workspaceLinks: [],
};

describe("Daily Success protected endpoint boundary", () => {
  test("uses only trusted Encore AuthData and forwards presentation context", async () => {
    const build = vi.fn().mockResolvedValue({ response: RESPONSE, diagnostics: { queryCount: 8, sourceDurationsMs: {} } });
    await expect(loadDailySuccess({ perspective: "centre", centreId: "requested-centre" }, {
      getTrustedAuthData: () => ({ userID: "00000000-0000-4000-8000-000000000001" }),
      build,
    })).resolves.toBe(RESPONSE);
    expect(build).toHaveBeenCalledWith({
      principalId: "00000000-0000-4000-8000-000000000001",
      request: { perspective: "centre", centreId: "requested-centre" },
    });
    expect(RESPONSE.cacheControl).toBe("private, no-store");
  });

  test("rejects absent AuthData before projection work", async () => {
    const build = vi.fn();
    await expect(loadDailySuccess({}, { getTrustedAuthData: () => null, build })).rejects.toBeInstanceOf(APIError);
    expect(build).not.toHaveBeenCalled();
  });

  test("maps unauthorized perspective selection and internal failure to safe errors", async () => {
    await expect(loadDailySuccess({}, {
      getTrustedAuthData: () => ({ userID: "00000000-0000-4000-8000-000000000001" }),
      build: vi.fn().mockRejectedValue(new DailySuccessError("access_denied")),
    })).rejects.toMatchObject({ code: "permission_denied", message: "Daily Success perspective is not available" });
    await expect(loadDailySuccess({}, {
      getTrustedAuthData: () => ({ userID: "00000000-0000-4000-8000-000000000001" }),
      build: vi.fn().mockRejectedValue(new Error("database secret detail")),
    })).rejects.toMatchObject({ code: "unavailable", message: "Daily Success is temporarily unavailable" });
    await expect(loadDailySuccess({}, {
      getTrustedAuthData: () => ({ userID: "00000000-0000-4000-8000-000000000001" }),
      build: vi.fn().mockRejectedValue(new DailySuccessError("centre_context_unavailable")),
    })).rejects.toMatchObject({ code: "unavailable", message: "Centre priorities could not be checked safely" });
  });
});
