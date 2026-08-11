import { describe, expect, test } from "vitest";
import {
  FOUNDATION_CAPABILITIES as capability,
  type FoundationCapability,
} from "./capabilities";
import {
  authorise,
  type AssignmentScope,
  type AuthorisationAssignment,
  type AuthorisationResource,
  type PrincipalAuthorisationContext,
} from "./policy";
import {
  canonicalRoleBundle,
  type CanonicalRoleKey,
} from "./roles";

const NOW = new Date("2026-08-11T00:00:00.000Z");
const ACTIVE_FROM = new Date("2026-01-01T00:00:00.000Z");
const EXPIRED_AT = new Date("2026-06-01T00:00:00.000Z");

const ORG_A = "organisation-a";
const ORG_B = "organisation-b";
const NSW = "unit-nsw";
const VIC = "unit-vic";
const CENTRE_A = "centre-a";
const CENTRE_B = "centre-b";
const CENTRE_C = "centre-c";

type TestRole = CanonicalRoleKey;

function centreResource(
  centreId: string,
  organisationalUnitIds: readonly string[],
  organisationId = ORG_A,
): AuthorisationResource {
  return {
    kind: "centre",
    organisationId,
    centreId,
    organisationalUnitIds,
  };
}

function organisationResource(organisationId = ORG_A): AuthorisationResource {
  return { kind: "organisation", organisationId };
}

function organisationalUnitResource(
  organisationalUnitId: string,
): AuthorisationResource {
  return {
    kind: "organisational_unit",
    organisationId: ORG_A,
    organisationalUnitId,
  };
}

function assignment(
  role: TestRole,
  scopes: readonly AssignmentScope[],
  overrides: Partial<AuthorisationAssignment> = {},
): AuthorisationAssignment {
  return {
    id: `assignment-${role}`,
    organisationId: ORG_A,
    membershipId: "membership-a",
    roleKey: role,
    capabilities: canonicalRoleBundle(role).capabilities,
    scopes,
    status: "active",
    effectiveFrom: ACTIVE_FROM,
    ...overrides,
  };
}

function principal(
  assignments: readonly AuthorisationAssignment[],
  overrides: Partial<PrincipalAuthorisationContext> = {},
): PrincipalAuthorisationContext {
  return {
    principalId: "principal-1",
    principalStatus: "active",
    activeOrganisationId: ORG_A,
    memberships: [
      {
        id: "membership-a",
        principalId: "principal-1",
        organisationId: ORG_A,
        status: "active",
        effectiveFrom: ACTIVE_FROM,
      },
    ],
    assignments,
    ...overrides,
  };
}

function decision(
  context: PrincipalAuthorisationContext,
  requestedCapability: FoundationCapability,
  resource: AuthorisationResource,
) {
  return authorise({
    context,
    capability: requestedCapability,
    resource,
    at: NOW,
  });
}

describe("foundation capability and scope policy", () => {
  test.each([
    ["Educator", "educator"],
    ["Assistant Director", "assistant_director"],
  ] as const)("%s reads only the assigned centre", (_label, role) => {
    const context = principal(
      [assignment(role, [{ type: "centre", centreId: CENTRE_A }])],
    );

    expect(decision(context, capability.centreRead, centreResource(CENTRE_A, [NSW])).allowed).toBe(true);
    expect(decision(context, capability.centreRead, centreResource(CENTRE_B, [NSW]))).toEqual({
      allowed: false,
      reason: "scope_mismatch",
    });
    expect(decision(context, capability.organisationRead, organisationResource()).allowed).toBe(false);
  });

  test("Assistant Director does not inherit Centre Director management", () => {
    const context = principal([
      assignment("assistant_director", [
        { type: "centre", centreId: CENTRE_A },
      ]),
    ]);

    expect(
      decision(context, capability.centreManage, centreResource(CENTRE_A, [NSW])),
    ).toEqual({ allowed: false, reason: "capability_missing" });
  });

  test("Centre Director manages own centre but not another centre", () => {
    const context = principal([
      assignment("centre_director", [{ type: "centre", centreId: CENTRE_A }]),
    ]);

    expect(decision(context, capability.centreManage, centreResource(CENTRE_A, [NSW])).allowed).toBe(true);
    expect(decision(context, capability.centreManage, centreResource(CENTRE_B, [NSW])).allowed).toBe(false);
  });

  test("Area Manager reads all assigned centres and no unassigned centre", () => {
    const context = principal([
      assignment("area_manager", [
        { type: "centre", centreId: CENTRE_A },
        { type: "centre", centreId: CENTRE_B },
      ]),
    ]);

    expect(decision(context, capability.centreRead, centreResource(CENTRE_A, [NSW])).allowed).toBe(true);
    expect(decision(context, capability.centreRead, centreResource(CENTRE_B, [NSW])).allowed).toBe(true);
    expect(decision(context, capability.centreRead, centreResource(CENTRE_C, [VIC])).allowed).toBe(false);
  });

  test("Compliance Manager reads only within the assigned organisation", () => {
    const context = principal([
      assignment("compliance_manager", [{ type: "organisation" }]),
    ]);

    expect(decision(context, capability.centreRead, centreResource(CENTRE_A, [NSW])).allowed).toBe(true);
    expect(decision(context, capability.centreRead, centreResource(CENTRE_A, [NSW], ORG_B))).toEqual({
      allowed: false,
      reason: "active_organisation_mismatch",
    });
    expect(decision(context, capability.budgetSummaryRead, organisationResource()).allowed).toBe(false);
    expect(decision(context, capability.systemConfigure, organisationResource()).allowed).toBe(false);
  });

  test("Operations Leadership regional scope allows only centres in that unit", () => {
    const context = principal([
      assignment("operations_leadership", [
        { type: "organisational_unit", organisationalUnitId: NSW },
      ]),
    ]);

    expect(decision(context, capability.centreRead, centreResource(CENTRE_A, [NSW])).allowed).toBe(true);
    expect(
      decision(
        context,
        capability.organisationRead,
        organisationalUnitResource(NSW),
      ).allowed,
    ).toBe(true);
    expect(decision(context, capability.assignmentRead, centreResource(CENTRE_A, [NSW])).allowed).toBe(true);
    expect(decision(context, capability.centreRead, centreResource(CENTRE_C, [VIC]))).toEqual({
      allowed: false,
      reason: "scope_mismatch",
    });
    expect(
      decision(
        context,
        capability.organisationRead,
        organisationalUnitResource(VIC),
      ),
    ).toEqual({ allowed: false, reason: "scope_mismatch" });
  });

  test("Operations Leadership organisation scope allows all centres in that organisation", () => {
    const context = principal([
      assignment("operations_leadership", [{ type: "organisation" }]),
    ]);

    expect(decision(context, capability.centreRead, centreResource(CENTRE_A, [NSW])).allowed).toBe(true);
    expect(decision(context, capability.centreRead, centreResource(CENTRE_C, [VIC])).allowed).toBe(true);
    expect(decision(context, capability.systemConfigure, organisationResource()).allowed).toBe(false);
  });

  test("Operations Leadership without an assignment is denied by default", () => {
    const context = principal([]);

    expect(decision(context, capability.centreRead, centreResource(CENTRE_A, [NSW]))).toEqual({
      allowed: false,
      reason: "capability_missing",
    });
  });

  test("Finance recognises scoped finance access without mutation or administration", () => {
    const context = principal([
      assignment("finance", [{ type: "organisation" }]),
    ]);

    expect(decision(context, capability.budgetSummaryRead, organisationResource()).allowed).toBe(true);
    expect(decision(context, capability.centreManage, centreResource(CENTRE_A, [NSW])).allowed).toBe(false);
    expect(decision(context, capability.assignmentManage, organisationResource()).allowed).toBe(false);
  });

  test("Executive strategic read does not imply mutation or technical administration", () => {
    const context = principal([
      assignment("executive", [{ type: "organisation" }]),
    ]);

    expect(decision(context, capability.organisationRead, organisationResource()).allowed).toBe(true);
    expect(decision(context, capability.centreManage, centreResource(CENTRE_A, [NSW])).allowed).toBe(false);
    expect(decision(context, capability.systemConfigure, organisationResource()).allowed).toBe(false);
  });

  test("System Administrator has technical administration without business-content read", () => {
    const context = principal([
      assignment("system_administrator", [{ type: "organisation" }]),
    ]);

    expect(decision(context, capability.identityMappingManage, organisationResource()).allowed).toBe(true);
    expect(decision(context, capability.principalManage, organisationResource()).allowed).toBe(true);
    expect(decision(context, capability.assignmentManage, organisationResource()).allowed).toBe(true);
    expect(decision(context, capability.systemConfigure, organisationResource()).allowed).toBe(true);
    expect(decision(context, capability.systemHealthRead, organisationResource()).allowed).toBe(true);
    expect(decision(context, capability.centreRead, centreResource(CENTRE_A, [NSW]))).toEqual({
      allowed: false,
      reason: "capability_missing",
    });
  });

  test("multi-role capabilities stay bound to their own assignment scopes", () => {
    const context = principal([
      assignment(
        "operations_leadership",
        [{ type: "organisational_unit", organisationalUnitId: NSW }],
        { id: "assignment-operations-leadership-nsw" },
      ),
      assignment(
        "centre_director",
        [{ type: "centre", centreId: CENTRE_C }],
        { id: "assignment-director-centre-c" },
      ),
    ]);

    expect(decision(context, capability.assignmentRead, centreResource(CENTRE_A, [NSW])).allowed).toBe(true);
    expect(decision(context, capability.assignmentRead, centreResource(CENTRE_C, [VIC]))).toEqual({
      allowed: false,
      reason: "scope_mismatch",
    });
    expect(decision(context, capability.centreManage, centreResource(CENTRE_C, [VIC])).allowed).toBe(true);
    expect(decision(context, capability.centreManage, centreResource(CENTRE_A, [NSW]))).toEqual({
      allowed: false,
      reason: "scope_mismatch",
    });
  });

  test("cross-organisation assignments cannot cross the tenant boundary", () => {
    const context = principal([
      assignment("executive", [{ type: "organisation" }]),
    ]);

    expect(decision(context, capability.organisationRead, organisationResource(ORG_B))).toEqual({
      allowed: false,
      reason: "active_organisation_mismatch",
    });
  });

  test("a dual-organisation principal is bound to the active organisation", () => {
    const organisationBAssignment = assignment(
      "executive",
      [{ type: "organisation" }],
      {
        id: "assignment-executive-b",
        organisationId: ORG_B,
        membershipId: "membership-b",
      },
    );
    const memberships = [
      {
        id: "membership-a",
        principalId: "principal-1",
        organisationId: ORG_A,
        status: "active" as const,
        effectiveFrom: ACTIVE_FROM,
      },
      {
        id: "membership-b",
        principalId: "principal-1",
        organisationId: ORG_B,
        status: "active" as const,
        effectiveFrom: ACTIVE_FROM,
      },
    ];
    const assignments = [
      assignment("executive", [{ type: "organisation" }]),
      organisationBAssignment,
    ];

    expect(
      decision(
        principal(assignments, { memberships }),
        capability.organisationRead,
        organisationResource(ORG_B),
      ),
    ).toEqual({ allowed: false, reason: "active_organisation_mismatch" });

    expect(
      decision(
        principal(assignments, {
          activeOrganisationId: ORG_B,
          memberships,
        }),
        capability.organisationRead,
        organisationResource(ORG_B),
      ).allowed,
    ).toBe(true);
  });

  test("a membership owned by another principal cannot authorise access", () => {
    const context = principal(
      [assignment("educator", [{ type: "centre", centreId: CENTRE_A }])],
      {
        memberships: [
          {
            id: "membership-a",
            principalId: "principal-2",
            organisationId: ORG_A,
            status: "active",
            effectiveFrom: ACTIVE_FROM,
          },
        ],
      },
    );

    expect(
      decision(context, capability.centreRead, centreResource(CENTRE_A, [NSW])),
    ).toEqual({ allowed: false, reason: "membership_missing" });
  });

  test("inactive principals, inactive memberships, and expired assignments are denied", () => {
    const activeAssignment = assignment("educator", [
      { type: "centre", centreId: CENTRE_A },
    ]);
    const resource = centreResource(CENTRE_A, [NSW]);

    expect(
      decision(
        principal([activeAssignment], { principalStatus: "inactive" }),
        capability.centreRead,
        resource,
      ),
    ).toEqual({ allowed: false, reason: "principal_inactive" });

    expect(
      decision(
        principal([activeAssignment], {
          memberships: [
            {
              id: "membership-a",
              principalId: "principal-1",
              organisationId: ORG_A,
              status: "inactive",
              effectiveFrom: ACTIVE_FROM,
            },
          ],
        }),
        capability.centreRead,
        resource,
      ),
    ).toEqual({ allowed: false, reason: "membership_missing" });

    expect(
      decision(
        principal([
          assignment(
            "educator",
            [{ type: "centre", centreId: CENTRE_A }],
            { effectiveTo: EXPIRED_AT },
          ),
        ]),
        capability.centreRead,
        resource,
      ),
    ).toEqual({ allowed: false, reason: "capability_missing" });
  });

  test("ambiguous active membership context is denied", () => {
    const context = principal(
      [assignment("educator", [{ type: "centre", centreId: CENTRE_A }])],
      {
        memberships: [
          {
            id: "membership-a",
            principalId: "principal-1",
            organisationId: ORG_A,
            status: "active",
            effectiveFrom: ACTIVE_FROM,
          },
          {
            id: "membership-a-duplicate",
            principalId: "principal-1",
            organisationId: ORG_A,
            status: "active",
            effectiveFrom: ACTIVE_FROM,
          },
        ],
      },
    );

    expect(decision(context, capability.centreRead, centreResource(CENTRE_A, [NSW]))).toEqual({
      allowed: false,
      reason: "membership_ambiguous",
    });
  });

  test("invalid or empty resource identity is denied", () => {
    const context = principal([
      assignment("executive", [{ type: "organisation" }]),
    ]);

    expect(
      decision(context, capability.organisationRead, {
        kind: "organisation",
        organisationId: " ",
      }),
    ).toEqual({ allowed: false, reason: "invalid_resource" });
  });

  test("empty principal or active organisation identity is invalid context", () => {
    const context = principal(
      [assignment("executive", [{ type: "organisation" }])],
      { principalId: " " },
    );

    expect(
      decision(context, capability.organisationRead, organisationResource()),
    ).toEqual({ allowed: false, reason: "invalid_context" });

    expect(
      decision(
        principal([assignment("executive", [{ type: "organisation" }])], {
          activeOrganisationId: " ",
        }),
        capability.organisationRead,
        organisationResource(),
      ),
    ).toEqual({ allowed: false, reason: "invalid_context" });
  });
});
