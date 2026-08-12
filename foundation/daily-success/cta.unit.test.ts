import { describe, expect, test } from "vitest";
import { controlledDailyCta, DailySuccessCtaError } from "./cta";

describe("Daily Success controlled CTA routes", () => {
  test.each([
    "/area-manager",
    "/compliance",
    "/area-manager/verification/00000000-0000-4000-8000-000000000001",
    "/area-manager/centres/00000000-0000-4000-8000-000000000001/audit/00000000-0000-4000-8000-000000000002",
    "/centre/actions/00000000-0000-4000-8000-000000000001",
    "/centre/reviews/00000000-0000-4000-8000-000000000001",
    "/admin/people/invitations/00000000-0000-4000-8000-000000000001",
  ])("accepts the controlled source route %s", (route) => {
    expect(controlledDailyCta("Continue", route)).toEqual({ label: "Continue", route });
  });

  test.each([
    "https://example.invalid/centre/actions/00000000-0000-4000-8000-000000000001",
    "//example.invalid/path",
    "/centre/actions/not-a-uuid",
    "/admin/people",
    "/centre/actions/00000000-0000-4000-8000-000000000001?next=https://example.invalid",
  ])("rejects uncontrolled or malformed route %s", (route) => {
    expect(() => controlledDailyCta("Continue", route)).toThrow(DailySuccessCtaError);
  });
});
