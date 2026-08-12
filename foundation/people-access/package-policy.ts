import { createHash } from "node:crypto";
import type { ProposedAssignment, ProposedScope, PrivilegeClass } from "./types";
import { PeopleAccessError, requireUuid } from "./types";

const STANDARD_ROLES = new Set([
  "educator",
  "assistant_director",
  "centre_director",
  "area_manager",
]);
const PRIVILEGED_ROLES = new Set([
  "system_administrator",
  "executive",
  "finance",
  "compliance_manager",
]);

function validateScope(scope: ProposedScope): ProposedScope {
  if (scope.scopeType === "organisation") return scope;
  if (scope.scopeType === "organisational_unit") {
    return { scopeType: scope.scopeType, organisationalUnitId: requireUuid(scope.organisationalUnitId) };
  }
  return { scopeType: scope.scopeType, centreId: requireUuid(scope.centreId) };
}

export function classifyAssignmentPackage(
  assignments: ProposedAssignment[],
): PrivilegeClass {
  if (assignments.length < 1 || assignments.length > 20) {
    throw new PeopleAccessError("invalid_input", "at least one reviewed assignment is required");
  }

  let classification: PrivilegeClass = "STANDARD";
  for (const assignment of assignments) {
    const roleKey = assignment.roleKey.trim();
    const scopes = assignment.scopes.map(validateScope);
    if (scopes.length === 0 || scopes.length > 100) {
      throw new PeopleAccessError("invalid_input", "assignment scopes are invalid");
    }

    const onlyCentres = scopes.every((scope) => scope.scopeType === "centre");
    if (roleKey === "educator" && !onlyCentres) {
      throw new PeopleAccessError("invalid_input", "Educator requires explicit centres");
    }
    if (
      (roleKey === "assistant_director" || roleKey === "centre_director") &&
      (!onlyCentres || scopes.length !== 1)
    ) {
      throw new PeopleAccessError("invalid_input", `${roleKey} requires one explicit centre`);
    }
    if (roleKey === "area_manager" && !onlyCentres) {
      throw new PeopleAccessError("invalid_input", "Area Manager requires an explicit centre portfolio");
    }
    if (roleKey === "system_administrator" || roleKey === "executive" || roleKey === "compliance_manager") {
      if (scopes.length !== 1 || scopes[0].scopeType !== "organisation") {
        throw new PeopleAccessError("invalid_input", `${roleKey} requires explicit organisation scope`);
      }
    }
    if (roleKey === "operations_leadership" && scopes.some((scope) => scope.scopeType === "organisation")) {
      if (classification !== "REVIEW") classification = "PRIVILEGED";
    } else if (PRIVILEGED_ROLES.has(roleKey)) {
      if (classification !== "REVIEW") classification = "PRIVILEGED";
    } else if (!STANDARD_ROLES.has(roleKey)) {
      classification = "REVIEW";
    }
  }
  return classification;
}

export function legacyPackageDigest(assignments: ProposedAssignment[]): Buffer {
  const canonical = assignments.map((assignment) => ({
    roleKey: assignment.roleKey,
    effectiveFrom: assignment.effectiveFrom ?? null,
    effectiveTo: assignment.effectiveTo ?? null,
    scopes: assignment.scopes
      .map((scope) => ({ ...scope }))
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  }));
  return createHash("sha256").update(JSON.stringify(canonical)).digest();
}

export interface CanonicalPackageAssignment {
  roleDefinitionId: string;
  roleKey: string;
  roleVersion: number;
  privilegeClass: PrivilegeClass;
  scopes: ProposedScope[];
  effectiveFrom: string;
  effectiveTo?: string | null;
}

export interface CanonicalPackageFacts {
  organisationId: string;
  privilegeClass: PrivilegeClass;
  assignments: CanonicalPackageAssignment[];
}

function canonicalTimestamp(value: string | null | undefined, required: boolean): string | null {
  if (value === null || value === undefined) {
    if (required) {
      throw new PeopleAccessError("invalid_input", "package effective date is invalid");
    }
    return null;
  }
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) {
    throw new PeopleAccessError("invalid_input", "package effective date is invalid");
  }
  return timestamp.toISOString();
}

function canonicalScope(scope: ProposedScope): {
  scopeType: ProposedScope["scopeType"];
  targetId: string | null;
} {
  if (scope.scopeType === "organisation") {
    return { scopeType: "organisation", targetId: null };
  }
  if (scope.scopeType === "organisational_unit") {
    return {
      scopeType: "organisational_unit",
      targetId: requireUuid(scope.organisationalUnitId, "unit ID"),
    };
  }
  return {
    scopeType: "centre",
    targetId: requireUuid(scope.centreId, "centre ID"),
  };
}

/**
 * Package-format version 2. Every object is rebuilt with a fixed key order,
 * set-like collections are sorted, timestamps are ISO-normalised, and absent
 * effective ends are represented as null before hashing.
 */
export function canonicalPackageDigest(input: CanonicalPackageFacts): Buffer {
  const assignments = input.assignments.map((assignment) => {
    if (!Number.isInteger(assignment.roleVersion) || assignment.roleVersion < 1) {
      throw new PeopleAccessError("invalid_input", "package role version is invalid");
    }
    const scopes = assignment.scopes
      .map(canonicalScope)
      .sort((left, right) => {
        const byType = left.scopeType.localeCompare(right.scopeType);
        return byType !== 0
          ? byType
          : (left.targetId ?? "").localeCompare(right.targetId ?? "");
      });
    return {
      roleDefinitionId: requireUuid(assignment.roleDefinitionId, "role definition ID"),
      roleKey: assignment.roleKey.trim(),
      roleVersion: assignment.roleVersion,
      privilegeClass: assignment.privilegeClass,
      effectiveFrom: canonicalTimestamp(assignment.effectiveFrom, true),
      effectiveTo: canonicalTimestamp(assignment.effectiveTo, false),
      scopes,
    };
  }).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

  const canonical = {
    packageFormatVersion: 2,
    organisationId: requireUuid(input.organisationId, "organisation ID"),
    privilegeClass: input.privilegeClass,
    assignments,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest();
}
