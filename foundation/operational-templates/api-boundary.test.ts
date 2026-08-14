import { APIError } from "encore.dev/api";
import { describe, expect, test, vi } from "vitest";
import type { OperationalTemplateApiDependencies } from "./api";
import {
  createOperationalTemplateEndpoint,
  previewOperationalTemplateEndpoint,
  publishOperationalTemplateEndpoint,
} from "./api";
import type { OperationalTemplateDraft, OperationalTemplateVersion } from "./contracts";
import { OperationalTemplateError } from "./types";

const PRINCIPAL = "f0200000-0000-4000-8000-000000000001";
const TEMPLATE = "f0200000-0000-4000-8000-000000000002";
const VERSION = "f0200000-0000-4000-8000-000000000003";
const draft: OperationalTemplateDraft = {
  templateId: TEMPLATE,
  lifecycle: "DRAFT",
  title: "Opening readiness",
  instructions: "Complete before opening.",
  metadata: {},
  authorId: PRINCIPAL,
  lockVersion: 1,
  updatedAt: "2026-08-13T00:00:00.000Z",
  sections: [],
};
const version: OperationalTemplateVersion = {
  templateId: TEMPLATE,
  versionId: VERSION,
  versionNumber: 1,
  lifecycle: "PUBLISHED",
  title: draft.title,
  instructions: draft.instructions,
  metadata: {},
  sourceKind: "BSA_INTERNAL",
  authorId: PRINCIPAL,
  publishedAt: "2026-08-13T00:00:00.000Z",
  sections: [],
};

function dependencies(
  overrides: Partial<OperationalTemplateApiDependencies> = {},
): OperationalTemplateApiDependencies {
  return {
    getTrustedAuthData: () => ({ userID: PRINCIPAL }),
    createDraft: vi.fn(async () => draft),
    updateDraft: vi.fn(async () => draft),
    publish: vi.fn(async () => version),
    list: vi.fn(async () => ({ templates: [], assignmentFilter: { kind: "PORTFOLIO" as const } })),
    getVersion: vi.fn(async () => version),
    previewDraft: vi.fn(async () => draft),
    getWorkspace: vi.fn(async () => ({
      templateId: TEMPLATE,
      title: draft.title,
      lifecycle: "DRAFT" as const,
      draft,
      versions: [],
    })),
    assignmentOptions: vi.fn(async () => ({
      centres: [],
      portfolioAvailable: false,
      portfolioCentreCount: 0,
    })),
    assign: vi.fn(async () => ({
      assignmentId: VERSION,
      templateId: TEMPLATE,
      versionId: VERSION,
      targetKind: "PORTFOLIO" as const,
      frequency: "DAILY" as const,
      centreCount: 0,
      deployments: [],
    })),
    retire: vi.fn(async () => ({
      templateId: TEMPLATE,
      lifecycle: "RETIRED" as const,
      lockVersion: 2,
    })),
    ...overrides,
  };
}

describe("operational template protected HTTP boundary", () => {
  test("forwards trusted AuthData through create, preview, and publish flows", async () => {
    const deps = dependencies();
    await expect(createOperationalTemplateEndpoint({
      title: draft.title,
      instructions: draft.instructions,
      sections: [],
    }, deps)).resolves.toBe(draft);
    await expect(previewOperationalTemplateEndpoint({ templateId: TEMPLATE }, deps))
      .resolves.toEqual({ device: "PHONE", source: "DRAFT", template: draft });
    await expect(publishOperationalTemplateEndpoint({
      templateId: TEMPLATE,
      lockVersion: 1,
    }, deps)).resolves.toBe(version);
    expect(deps.createDraft).toHaveBeenCalledWith(expect.objectContaining({ principalId: PRINCIPAL }));
    expect(deps.previewDraft).toHaveBeenCalledWith({ principalId: PRINCIPAL, templateId: TEMPLATE });
    expect(deps.publish).toHaveBeenCalledWith(expect.objectContaining({ principalId: PRINCIPAL }));
  });

  test("rejects absent AuthData before calling the service", async () => {
    const createDraft = vi.fn();
    const deps = dependencies({ getTrustedAuthData: () => null, createDraft });
    await expect(createOperationalTemplateEndpoint({
      title: draft.title,
      instructions: draft.instructions,
      sections: [],
    }, deps)).rejects.toBeInstanceOf(APIError);
    expect(createDraft).not.toHaveBeenCalled();
  });

  test("maps scope denial and unexpected failures to non-disclosing errors", async () => {
    await expect(publishOperationalTemplateEndpoint({ templateId: TEMPLATE, lockVersion: 1 },
      dependencies({
        publish: vi.fn(async () => {
          throw new OperationalTemplateError("access_denied", "secret centre detail");
        }),
      }))).rejects.toMatchObject({ code: "permission_denied", message: "template is not available" });
    await expect(previewOperationalTemplateEndpoint({ templateId: TEMPLATE }, dependencies({
      previewDraft: vi.fn(async () => { throw new Error("database secret detail"); }),
    }))).rejects.toMatchObject({
      code: "unavailable",
      message: "template library is temporarily unavailable",
    });
  });
});
