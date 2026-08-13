import { describe, expect, test } from "vitest";
import { FOUNDATION_CAPABILITIES as capability, type FoundationCapability } from "../authorization/capabilities";
import { deriveWorkspaceLinks } from "./workspace-links";

const CENTRE_ID = "00000000-0000-4000-8000-000000000001";

function centreCapabilities(
  values: Array<[FoundationCapability, ReadonlySet<string>]>,
) {
  return {
    centreIdsByCapability: new Map(values),
    organisationCapabilities: new Set<FoundationCapability>(),
  };
}

describe("authorised workspace link derivation", () => {
  test.each([capability.operationalCheckRead, capability.operationalCheckComplete])(
    "offers Centre Standards for scoped %s authority",
    (granted) => {
      expect(deriveWorkspaceLinks(centreCapabilities([[granted, new Set([CENTRE_ID])]])))
        .toContainEqual({ label: "Centre Standards", route: "/standards" });
    },
  );

  test("does not infer Centre Standards access from unrelated centre authority", () => {
    expect(deriveWorkspaceLinks(centreCapabilities([
      [capability.centreRead, new Set([CENTRE_ID])],
    ]))).not.toContainEqual({ label: "Centre Standards", route: "/standards" });
  });
});
