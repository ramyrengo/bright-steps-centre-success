import { describe, expect, test } from "vitest";
import { FOUNDATION_CAPABILITIES, type FoundationCapability } from "../authorization/capabilities";
import {
  deriveWorkspaceLinks,
  WORKSPACE_LINK_CENTRE_CAPABILITIES,
  type WorkspaceLinkAuthorisation,
} from "./workspace-links";

/**
 * Link derivation is pure, so the whole decision surface is testable without a
 * database. These assertions cover the Budgets destination specifically: a link
 * must appear for exactly the principals whose capability the budget read
 * endpoints themselves check, and for nobody else.
 */

const CENTRE = "11111111-1111-4111-8111-111111111111";

function authorisation(
  centre: Partial<Record<FoundationCapability, readonly string[]>> = {},
  organisation: readonly FoundationCapability[] = [],
): WorkspaceLinkAuthorisation {
  return {
    centreIdsByCapability: new Map(
      Object.entries(centre).map(([capability, centreIds]) => [
        capability as FoundationCapability,
        new Set(centreIds ?? []),
      ]),
    ),
    organisationCapabilities: new Set(organisation),
  };
}

function routes(input: WorkspaceLinkAuthorisation): string[] {
  return deriveWorkspaceLinks(input).map((link) => link.route);
}

describe("Budgets workspace link", () => {
  test("appears for a principal holding budget position read on a centre", () => {
    const links = deriveWorkspaceLinks(
      authorisation({ [FOUNDATION_CAPABILITIES.budgetPositionRead]: [CENTRE] }),
    );
    expect(links).toEqual([{ label: "Budgets", route: "/budgets" }]);
  });

  test("is withheld from a principal without that capability", () => {
    expect(routes(authorisation())).not.toContain("/budgets");
    // Holding every other workspace capability still does not produce it.
    expect(
      routes(
        authorisation(
          {
            [FOUNDATION_CAPABILITIES.correctiveActionRead]: [CENTRE],
            [FOUNDATION_CAPABILITIES.quarterlyAuditRead]: [CENTRE],
            [FOUNDATION_CAPABILITIES.correctiveActionRemediate]: [CENTRE],
            [FOUNDATION_CAPABILITIES.quarterlyAuditConduct]: [CENTRE],
          },
          [
            FOUNDATION_CAPABILITIES.complianceOversightRead,
            FOUNDATION_CAPABILITIES.invitationRead,
            FOUNDATION_CAPABILITIES.principalRead,
          ],
        ),
      ),
    ).not.toContain("/budgets");
  });

  /**
   * An empty authorised set is the shape a principal takes when the capability
   * was evaluated against every centre and allowed on none. It must read as no
   * access, not as a present-but-empty key.
   */
  test("is withheld when the capability resolves to no centre at all", () => {
    expect(
      routes(authorisation({ [FOUNDATION_CAPABILITIES.budgetPositionRead]: [] })),
    ).not.toContain("/budgets");
  });

  /**
   * PERMISSIONS.md is explicit that the pre-existing synthetic Finance marker
   * does not authorise a budget module, and migration 026 introduced
   * `budget.position.read` precisely so the two stay separable.
   */
  test("is not conferred by the synthetic budget summary capability", () => {
    expect(
      routes(
        authorisation(
          { [FOUNDATION_CAPABILITIES.budgetSummaryRead]: [CENTRE] },
          [FOUNDATION_CAPABILITIES.budgetSummaryRead],
        ),
      ),
    ).not.toContain("/budgets");
  });

  /**
   * A capability the caller never evaluates can never gate a link, so the
   * derivation and the list its callers iterate have to name the same one.
   */
  test("is derived from a capability the callers actually evaluate", () => {
    expect(WORKSPACE_LINK_CENTRE_CAPABILITIES).toContain(
      FOUNDATION_CAPABILITIES.budgetPositionRead,
    );
  });
});

describe("existing workspace links are unchanged", () => {
  test("keeps every previous destination and its order for a fully capable principal", () => {
    expect(
      routes(
        authorisation(
          {
            [FOUNDATION_CAPABILITIES.correctiveActionRead]: [CENTRE],
            [FOUNDATION_CAPABILITIES.quarterlyAuditRead]: [CENTRE],
            [FOUNDATION_CAPABILITIES.correctiveActionRemediate]: [CENTRE],
            [FOUNDATION_CAPABILITIES.quarterlyAuditConduct]: [CENTRE],
            [FOUNDATION_CAPABILITIES.budgetPositionRead]: [CENTRE],
          },
          [
            FOUNDATION_CAPABILITIES.complianceOversightRead,
            FOUNDATION_CAPABILITIES.invitationRead,
            FOUNDATION_CAPABILITIES.principalRead,
          ],
        ),
      ),
    ).toEqual(["/quality", "/centre", "/area-manager", "/budgets", "/compliance", "/admin/people"]);
  });

  test("still gates each previous destination on its own capability", () => {
    expect(routes(authorisation({ [FOUNDATION_CAPABILITIES.quarterlyAuditRead]: [CENTRE] })))
      .toEqual(["/quality"]);
    expect(
      routes(authorisation({ [FOUNDATION_CAPABILITIES.correctiveActionRemediate]: [CENTRE] })),
    ).toEqual(["/centre"]);
    expect(routes(authorisation({}, [FOUNDATION_CAPABILITIES.complianceOversightRead])))
      .toEqual(["/quality", "/compliance"]);
    expect(
      routes(
        authorisation({}, [
          FOUNDATION_CAPABILITIES.invitationRead,
          FOUNDATION_CAPABILITIES.principalRead,
        ]),
      ),
    ).toEqual(["/admin/people"]);
  });

  test("gives a principal holding nothing no destination at all", () => {
    expect(deriveWorkspaceLinks(authorisation())).toEqual([]);
  });
});
