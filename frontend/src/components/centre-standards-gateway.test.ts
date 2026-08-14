import { describe, expect, test, vi } from "vitest";

import type { centre_standards } from "@/lib/client.generated";

import { CentreStandardsUnavailableError } from "./centre-standards-contract";
import {
  createCentreStandardsGateway,
  toCompleteCheckResult,
  toStandardsCheckDetail,
  toStandardsWorkspace,
  type CentreStandardsApi,
} from "./centre-standards-gateway";

function openSummary(
  overrides: Partial<centre_standards.OpenStandardsCheckSummary> = {},
): centre_standards.OpenStandardsCheckSummary {
  return {
    occurrenceId: "occurrence-1",
    standardName: "Opening checks",
    synthetic: false,
    centreName: "Parramatta",
    businessDate: "2026-08-14",
    dueLocalTime: "9:00am",
    timeliness: "DUE",
    questionCount: 2,
    state: "OPEN",
    canComplete: true,
    ...overrides,
  };
}

function detail(
  overrides: Partial<centre_standards.StandardsCheckDetailResponse> = {},
): centre_standards.StandardsCheckDetailResponse {
  return {
    cacheControl: "private, no-store",
    occurrenceId: "occurrence-1",
    standardName: "Opening checks",
    synthetic: false,
    centreName: "Parramatta",
    businessDate: "2026-08-14",
    dueLocalTime: "9:00am",
    timeliness: "DUE",
    state: "OPEN",
    questionCount: 1,
    canComplete: true,
    questions: [
      {
        questionId: "question-1",
        wording: "Are the gates secured?",
        options: [{ value: "COMPLIANT", label: "Yes" }],
      },
    ],
    ...overrides,
  };
}

describe("workspace mapping", () => {
  test("maps a ready workspace and its open checks", () => {
    const workspace = toStandardsWorkspace({
      status: "ready",
      openChecks: [openSummary()],
      cacheControl: "private, no-store",
      asOf: "2026-08-14T00:00:00Z",
    });

    expect(workspace.status).toBe("ready");
    expect(workspace).toMatchObject({
      openChecks: [
        {
          occurrenceId: "occurrence-1",
          standardName: "Opening checks",
          centreName: "Parramatta",
          state: "OPEN",
          timeliness: "DUE",
          canComplete: true,
          synthetic: false,
        },
      ],
    });
  });

  test("drops checks that arrive alongside an unsupported status", () => {
    // `unsupported` means the source was never established. Any checks that
    // came with it would imply it had been, so the contract gives them nowhere
    // to live and the mapping must not smuggle them through.
    const workspace = toStandardsWorkspace({
      status: "unsupported",
      openChecks: [openSummary()],
      cacheControl: "private, no-store",
      asOf: "2026-08-14T00:00:00Z",
    });

    expect(workspace).toEqual({ status: "unsupported" });
  });

  test("refuses a ready workspace that returned no checks at all", () => {
    // The dangerous case. An absent list rendered as an empty one reads to an
    // Educator as "nothing is due", which is the one thing an unknown source
    // must never say.
    expect(() =>
      toStandardsWorkspace({
        status: "ready",
        cacheControl: "private, no-store",
        asOf: "2026-08-14T00:00:00Z",
      }),
    ).toThrow(CentreStandardsUnavailableError);
  });

  test("keeps an empty list that the source did establish", () => {
    // Distinct from the case above: here the backend did look, and found none.
    const workspace = toStandardsWorkspace({
      status: "ready",
      openChecks: [],
      cacheControl: "private, no-store",
      asOf: "2026-08-14T00:00:00Z",
    });

    expect(workspace).toEqual({ status: "ready", openChecks: [] });
  });

  test("refuses partial coverage that does not explain itself", () => {
    for (const warning of [undefined, "   "]) {
      expect(() =>
        toStandardsWorkspace({
          status: "partial",
          openChecks: [openSummary()],
          ...(warning === undefined ? {} : { warning }),
          cacheControl: "private, no-store",
          asOf: "2026-08-14T00:00:00Z",
        }),
      ).toThrow(CentreStandardsUnavailableError);
    }
  });

  test("carries the warning through on partial coverage", () => {
    const workspace = toStandardsWorkspace({
      status: "partial",
      openChecks: [openSummary()],
      warning: "One centre could not be checked.",
      cacheControl: "private, no-store",
      asOf: "2026-08-14T00:00:00Z",
    });

    expect(workspace).toMatchObject({
      status: "partial",
      warning: "One centre could not be checked.",
    });
  });
});

describe("synthetic origin", () => {
  test("refuses staging content whose notice is missing or blank", () => {
    // Pilot content without its approved notice reads as real content. The
    // notice is never composed in the browser, so if it did not arrive there is
    // nothing safe to show.
    for (const syntheticNotice of [undefined, "", "   "]) {
      expect(() =>
        toStandardsWorkspace({
          status: "ready",
          openChecks: [
            openSummary({
              synthetic: true,
              ...(syntheticNotice === undefined ? {} : { syntheticNotice }),
            }),
          ],
          cacheControl: "private, no-store",
          asOf: "2026-08-14T00:00:00Z",
        }),
      ).toThrow(CentreStandardsUnavailableError);
    }
  });

  test("carries the notice when it is present", () => {
    const workspace = toStandardsWorkspace({
      status: "ready",
      openChecks: [
        openSummary({ synthetic: true, syntheticNotice: "Staging test content" }),
      ],
      cacheControl: "private, no-store",
      asOf: "2026-08-14T00:00:00Z",
    });

    expect(workspace).toMatchObject({
      openChecks: [{ synthetic: true, syntheticNotice: "Staging test content" }],
    });
  });
});

describe("check detail mapping", () => {
  test("maps an open check with its questions", () => {
    const mapped = toStandardsCheckDetail(
      detail({
        questions: [
          {
            questionId: "question-1",
            wording: "Are the gates secured?",
            instructions: "Walk the perimeter.",
            options: [
              { value: "COMPLIANT", label: "Yes", description: "All secure" },
              { value: "NON_COMPLIANT", label: "No" },
            ],
          },
        ],
      }),
    );

    expect(mapped).toMatchObject({
      state: "OPEN",
      timeliness: "DUE",
      canComplete: true,
      questions: [
        {
          questionId: "question-1",
          instructions: "Walk the perimeter.",
          options: [
            { value: "COMPLIANT", label: "Yes", description: "All secure" },
            { value: "NON_COMPLIANT", label: "No" },
          ],
        },
      ],
    });
    expect(mapped.questions[0]?.options[1]).not.toHaveProperty("description");
  });

  test("omits blank optional text rather than rendering emptiness", () => {
    const mapped = toStandardsCheckDetail(
      detail({
        questions: [
          {
            questionId: "question-1",
            wording: "Are the gates secured?",
            instructions: "   ",
            options: [{ value: "COMPLIANT", label: "Yes", description: "  " }],
          },
        ],
      }),
    );

    expect(mapped.questions[0]).not.toHaveProperty("instructions");
    expect(mapped.questions[0]?.options[0]).not.toHaveProperty("description");
  });

  test("degrades an unstated completion authority to no authority", () => {
    // The opposite direction to the refusals above: silence here costs a button
    // the reader might have been entitled to, which is smaller than inventing
    // authority they do not hold. So it resolves rather than throws.
    const mapped = toStandardsCheckDetail({ ...detail(), canComplete: undefined });

    expect(mapped).toMatchObject({ state: "OPEN", canComplete: false });
  });

  test("refuses a state and timeliness that contradict each other", () => {
    expect(() =>
      toStandardsCheckDetail(detail({ state: "OPEN", timeliness: "COMPLETED_ON_TIME" })),
    ).toThrow(CentreStandardsUnavailableError);

    expect(() =>
      toStandardsCheckDetail(
        detail({ state: "COMPLETED", timeliness: "DUE", completedLocalTime: "9:05am" }),
      ),
    ).toThrow(CentreStandardsUnavailableError);
  });

  test("refuses a completed check with no completion time", () => {
    expect(() =>
      toStandardsCheckDetail(detail({ state: "COMPLETED", timeliness: "COMPLETED_LATE" })),
    ).toThrow(CentreStandardsUnavailableError);
  });

  test("maps a completed check and its recorded responses", () => {
    const mapped = toStandardsCheckDetail(
      detail({
        state: "COMPLETED",
        timeliness: "COMPLETED_ON_TIME",
        completedLocalTime: "8:45am",
        responses: [
          { questionId: "question-1", wording: "Are the gates secured?", answerLabel: "Yes" },
        ],
      }),
    );

    expect(mapped).toMatchObject({
      state: "COMPLETED",
      timeliness: "COMPLETED_ON_TIME",
      completedLocalTime: "8:45am",
      responses: [{ questionId: "question-1", answerLabel: "Yes" }],
    });
  });

  test("omits responses entirely when the reader may not see them", () => {
    const mapped = toStandardsCheckDetail(
      detail({
        state: "COMPLETED",
        timeliness: "COMPLETED_ON_TIME",
        completedLocalTime: "8:45am",
      }),
    );

    expect(mapped).not.toHaveProperty("responses");
  });
});

describe("completion mapping", () => {
  test("treats an unstated issue as no issue raised", () => {
    expect(
      toCompleteCheckResult({
        outcome: "COMPLETED",
        completedAt: "2026-08-14T08:45:00Z",
        completedLocalTime: "8:45am",
      }),
    ).toEqual({ outcome: "COMPLETED", completedLocalTime: "8:45am", issueRaised: false });
  });

  test("carries a raised issue through", () => {
    expect(
      toCompleteCheckResult({
        outcome: "COMPLETED",
        completedAt: "2026-08-14T08:45:00Z",
        completedLocalTime: "8:45am",
        issueRaised: true,
      }),
    ).toMatchObject({ issueRaised: true });
  });

  test("maps an already-completed outcome as the success it is", () => {
    expect(
      toCompleteCheckResult({
        outcome: "ALREADY_COMPLETED",
        completedAt: "2026-08-14T08:45:00Z",
        completedLocalTime: "8:45am",
        completedByRequester: true,
      }),
    ).toEqual({
      outcome: "ALREADY_COMPLETED",
      completedLocalTime: "8:45am",
      completedByRequester: true,
    });
  });

  test("refuses a completion with no time to show", () => {
    // Safe to reject after a successful write: completion is idempotent, so a
    // retry returns ALREADY_COMPLETED rather than completing twice.
    expect(() =>
      toCompleteCheckResult({
        outcome: "COMPLETED",
        completedAt: "2026-08-14T08:45:00Z",
        completedLocalTime: "  ",
      }),
    ).toThrow(CentreStandardsUnavailableError);
  });
});

describe("gateway binding", () => {
  test("calls each endpoint and passes answers through untouched", async () => {
    const api = {
      getStandardsWorkspace: vi.fn().mockResolvedValue({
        status: "ready",
        openChecks: [],
        cacheControl: "private, no-store",
        asOf: "2026-08-14T00:00:00Z",
      }),
      getStandardsCheck: vi.fn().mockResolvedValue(detail()),
      completeStandardsOccurrence: vi.fn().mockResolvedValue({
        outcome: "COMPLETED",
        completedAt: "2026-08-14T08:45:00Z",
        completedLocalTime: "8:45am",
        issueRaised: false,
      }),
    } satisfies CentreStandardsApi;

    const gateway = createCentreStandardsGateway(api);

    await expect(gateway.loadWorkspace()).resolves.toMatchObject({ status: "ready" });
    await expect(gateway.loadCheck("occurrence-1")).resolves.toMatchObject({ state: "OPEN" });
    expect(api.getStandardsCheck).toHaveBeenCalledWith("occurrence-1");

    await expect(
      gateway.completeCheck({
        occurrenceId: "occurrence-1",
        answers: [{ questionId: "question-1", value: "COMPLIANT" }],
      }),
    ).resolves.toMatchObject({ outcome: "COMPLETED" });
    expect(api.completeStandardsOccurrence).toHaveBeenCalledWith("occurrence-1", {
      answers: [{ questionId: "question-1", value: "COMPLIANT" }],
    });
  });

  test("surfaces a transport failure unchanged", async () => {
    const failure = new Error("network down");
    const gateway = createCentreStandardsGateway({
      getStandardsWorkspace: vi.fn().mockRejectedValue(failure),
      getStandardsCheck: vi.fn(),
      completeStandardsOccurrence: vi.fn(),
    } as unknown as CentreStandardsApi);

    await expect(gateway.loadWorkspace()).rejects.toBe(failure);
  });
});
