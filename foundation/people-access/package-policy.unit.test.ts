import { randomUUID } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  canonicalPackageDigest,
  classifyAssignmentPackage,
  type CanonicalPackageFacts,
} from "./package-policy";

const centre = () => ({ scopeType: "centre" as const, centreId: randomUUID() });

describe("People & Access reviewed package policy", () => {
  test("classifies the exact approved standard packages", () => {
    expect(classifyAssignmentPackage([{ roleKey: "educator", scopes: [centre(), centre()] }])).toBe("STANDARD");
    expect(classifyAssignmentPackage([{ roleKey: "assistant_director", scopes: [centre()] }])).toBe("STANDARD");
    expect(classifyAssignmentPackage([{ roleKey: "centre_director", scopes: [centre()] }])).toBe("STANDARD");
    expect(classifyAssignmentPackage([{ roleKey: "area_manager", scopes: [centre(), centre()] }])).toBe("STANDARD");
  });

  test("requires independent approval for every approved privileged package", () => {
    for (const roleKey of ["system_administrator", "executive", "finance", "compliance_manager"]) {
      expect(classifyAssignmentPackage([{ roleKey, scopes: [{ scopeType: "organisation" }] }])).toBe("PRIVILEGED");
    }
    expect(classifyAssignmentPackage([{ roleKey: "operations_leadership", scopes: [{ scopeType: "organisation" }] }])).toBe("PRIVILEGED");
  });

  test("fails unclassified or unsupported packages into review and rejects invalid scope shapes", () => {
    expect(classifyAssignmentPackage([{ roleKey: "operations_leadership", scopes: [centre()] }])).toBe("REVIEW");
    expect(classifyAssignmentPackage([{ roleKey: "custom_role", scopes: [centre()] }])).toBe("REVIEW");
    expect(() => classifyAssignmentPackage([{ roleKey: "centre_director", scopes: [centre(), centre()] }])).toThrow();
    expect(() => classifyAssignmentPackage([{ roleKey: "area_manager", scopes: [{ scopeType: "organisation" }] }])).toThrow();
  });

  test("canonical package digest ignores JSON key and set-like collection order", () => {
    const organisationId = randomUUID();
    const roleDefinitionId = randomUUID();
    const first = centre();
    const second = centre();
    const left: CanonicalPackageFacts = {
      organisationId,
      privilegeClass: "STANDARD",
      assignments: [{
        roleDefinitionId,
        roleKey: "educator",
        roleVersion: 3,
        privilegeClass: "STANDARD",
        scopes: [first, second],
        effectiveFrom: "2026-08-11T10:00:00+10:00",
        effectiveTo: undefined,
      }],
    };
    const right = JSON.parse(JSON.stringify({
      assignments: [{
        scopes: [second, first].map((scope) => ({
          centreId: scope.centreId,
          scopeType: scope.scopeType,
        })),
        effectiveTo: null,
        privilegeClass: "STANDARD",
        roleVersion: 3,
        effectiveFrom: "2026-08-11T00:00:00.000Z",
        roleKey: "educator",
        roleDefinitionId,
      }],
      privilegeClass: "STANDARD",
      organisationId,
    })) as CanonicalPackageFacts;
    expect(canonicalPackageDigest(left)).toEqual(canonicalPackageDigest(right));
  });

  test("canonical package digest changes for every authority-relevant fact", () => {
    const first = centre();
    const second = centre();
    const base: CanonicalPackageFacts = {
      organisationId: randomUUID(),
      privilegeClass: "STANDARD",
      assignments: [{
        roleDefinitionId: randomUUID(),
        roleKey: "educator",
        roleVersion: 1,
        privilegeClass: "STANDARD",
        scopes: [first],
        effectiveFrom: "2026-08-11T00:00:00.000Z",
        effectiveTo: null,
      }],
    };
    const digest = canonicalPackageDigest(base);
    const assignment = base.assignments[0];
    for (const changed of [
      { ...base, organisationId: randomUUID() },
      { ...base, privilegeClass: "PRIVILEGED" as const },
      { ...base, assignments: [{ ...assignment, roleDefinitionId: randomUUID() }] },
      { ...base, assignments: [{ ...assignment, roleKey: "area_manager" }] },
      { ...base, assignments: [{ ...assignment, roleVersion: 2 }] },
      { ...base, assignments: [{ ...assignment, scopes: [second] }] },
      { ...base, assignments: [{ ...assignment, effectiveFrom: "2026-08-12T00:00:00.000Z" }] },
      { ...base, assignments: [{ ...assignment, effectiveTo: "2026-09-01T00:00:00.000Z" }] },
    ]) {
      expect(canonicalPackageDigest(changed)).not.toEqual(digest);
    }
  });
});
