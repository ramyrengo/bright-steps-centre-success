import { describe, expect, test, vi } from "vitest";
import { FOUNDATION_CAPABILITIES as capability, type FoundationCapability } from "../authorization/capabilities";
import type { DailySuccessQueryExecutor } from "./types";
import { CorrectiveActionDailySource } from "./corrective-action-source";
import { PeopleAccessDailySource } from "./people-access-source";
import { OperationalCheckDailySource } from "./operational-check-source";
import { QuarterlyReviewDailySource } from "./quarterly-review-source";
import type { DailySourceInput } from "./types";

const CENTRE_ID = "00000000-0000-4000-8000-000000000001";
const PRINCIPAL_ID = "00000000-0000-4000-8000-000000000002";
const ORGANISATION_ID = "00000000-0000-4000-8000-000000000003";
const AT = new Date("2026-08-11T10:00:00.000Z");

function sourceInput(
  rows: unknown[],
  perspective: DailySourceInput["perspective"],
  capabilities: FoundationCapability[],
): DailySourceInput {
  const queryAll = vi.fn().mockResolvedValue(rows);
  const ids = new Map<FoundationCapability, ReadonlySet<string>>(
    capabilities.map((key) => [key, new Set([CENTRE_ID])]),
  );
  return {
    executor: {
      queryAll,
      queryRow: vi.fn(),
      exec: vi.fn(),
    } as unknown as DailySuccessQueryExecutor,
    authorisation: {
      principalId: PRINCIPAL_ID,
      organisationId: ORGANISATION_ID,
      decisionAt: AT,
      centres: [{
        id: CENTRE_ID,
        name: "Synthetic Centre",
        timezone: "Australia/Sydney",
        resource: { kind: "centre", organisationId: ORGANISATION_ID, centreId: CENTRE_ID, organisationalUnitIds: [] },
      }],
      centreIdsByCapability: ids,
      invalidCentreIdsByCapability: new Map(),
      organisationCapabilities: new Set(capabilities),
    },
    perspective,
  };
}

describe("Daily Success source adapters", () => {
  test("projects returned remediation as current-user action without sensitive evidence metadata", async () => {
    const result = await CorrectiveActionDailySource.collect(sourceInput([{
      record_kind: "active",
      id: "00000000-0000-4000-8000-000000000010",
      centre_id: CENTRE_ID,
      centre_name: "Synthetic Centre",
      timezone: "Australia/Sydney",
      title: "Repair the synthetic follow-up",
      severity: "HIGH",
      due_at: new Date("2026-08-11T12:00:00.000Z"),
      status: "REJECTED",
      owner_principal_id: PRINCIPAL_ID,
      remediation_submitted_by_principal_id: PRINCIPAL_ID,
      independent_verification_required: false,
      immediate: false,
      completed_at: null,
      original_filename: "must-not-appear.pdf",
    }], { kind: "centre", label: "Synthetic Centre", centreId: CENTRE_ID }, [
      capability.correctiveActionRead,
      capability.correctiveActionRemediate,
    ]));
    expect(result.items[0]).toMatchObject({
      attentionBand: "URGENT",
      responsibility: "YOU_NEED_TO_ACT",
      whyShown: { code: "REMEDIATION_RETURNED" },
    });
    expect(JSON.stringify(result)).not.toContain("must-not-appear.pdf");
  });

  test("makes verification actionable only for an eligible independent verifier", async () => {
    const row = {
      record_kind: "active", id: "00000000-0000-4000-8000-000000000011",
      centre_id: CENTRE_ID, centre_name: "Synthetic Centre", timezone: "Australia/Sydney",
      title: "Verify remediation", severity: "HIGH", due_at: new Date("2026-08-12T10:00:00.000Z"),
      status: "VERIFICATION_REQUIRED", owner_principal_id: "00000000-0000-4000-8000-000000000099",
      remediation_submitted_by_principal_id: PRINCIPAL_ID,
      independent_verification_required: true, immediate: false, completed_at: null,
    };
    const result = await CorrectiveActionDailySource.collect(sourceInput(
      [row],
      { kind: "portfolio", label: "Portfolio" },
      [capability.correctiveActionRead, capability.correctiveActionVerify],
    ));
    expect(result.items[0]).toMatchObject({
      attentionBand: "WAITING",
      responsibility: "WAITING_ON_SOMEONE_ELSE",
      verification: { required: true, eligible: false },
    });
  });

  test.each(["CRITICAL", "HIGH"] as const)(
    "keeps %s risk classification while projecting eligible verification work",
    async (severity) => {
      const result = await CorrectiveActionDailySource.collect(sourceInput([{
        record_kind: "active",
        id: severity === "CRITICAL"
          ? "00000000-0000-4000-8000-000000000013"
          : "00000000-0000-4000-8000-000000000014",
        centre_id: CENTRE_ID,
        centre_name: "Synthetic Centre",
        timezone: "Australia/Sydney",
        title: `Verify ${severity.toLowerCase()} remediation`,
        severity,
        due_at: new Date("2026-08-12T10:00:00.000Z"),
        status: "VERIFICATION_REQUIRED",
        owner_principal_id: "00000000-0000-4000-8000-000000000099",
        remediation_submitted_by_principal_id: "00000000-0000-4000-8000-000000000098",
        independent_verification_required: true,
        immediate: false,
        completed_at: null,
      }], { kind: "portfolio", label: "Portfolio" }, [
        capability.correctiveActionRead,
        capability.correctiveActionVerify,
      ]));
      expect(result.items[0]).toMatchObject({
        riskLevel: severity === "CRITICAL" ? "CRITICAL" : "HIGH",
        attentionBand: severity === "CRITICAL" ? "URGENT" : "TODAY",
        responsibility: "YOU_NEED_TO_ACT",
        verification: { required: true, eligible: true },
        cta: { label: "Verify action" },
      });
    },
  );

  test("does not expose verification work to an unassigned Area Manager", async () => {
    const input = sourceInput([], { kind: "portfolio", label: "Portfolio" }, []);
    const result = await CorrectiveActionDailySource.collect(input);
    expect(result.items).toEqual([]);
    expect(input.executor.queryAll).not.toHaveBeenCalled();
  });

  test("projects eligible verification for a capability-scoped Compliance Manager", async () => {
    const result = await CorrectiveActionDailySource.collect(sourceInput([{
      record_kind: "active",
      id: "00000000-0000-4000-8000-000000000015",
      centre_id: CENTRE_ID,
      centre_name: "Synthetic Centre",
      timezone: "Australia/Sydney",
      title: "Verify compliance remediation",
      severity: "HIGH",
      due_at: new Date("2026-08-12T10:00:00.000Z"),
      status: "VERIFICATION_REQUIRED",
      owner_principal_id: "00000000-0000-4000-8000-000000000099",
      remediation_submitted_by_principal_id: "00000000-0000-4000-8000-000000000098",
      independent_verification_required: true,
      immediate: false,
      completed_at: null,
    }], { kind: "compliance", label: "Compliance" }, [
      capability.correctiveActionRead,
      capability.correctiveActionVerify,
    ]));
    expect(result.items[0]).toMatchObject({ verification: { required: true, eligible: true } });
  });

  test("excludes a withdrawn corrective action from active projection", async () => {
    const input = sourceInput([], { kind: "centre", label: "Synthetic Centre", centreId: CENTRE_ID }, [
      capability.correctiveActionRead,
      capability.correctiveActionRemediate,
    ]);
    const result = await CorrectiveActionDailySource.collect(input);
    expect(result.items).toEqual([]);
    const sql = (input.executor.queryAll as ReturnType<typeof vi.fn>).mock.calls[0][0]
      .join(" ");
    expect(sql).toContain("action.status NOT IN ('CLOSED', 'WITHDRAWN')");
  });

  test("surfaces a finalised unacknowledged review without inventing a due date", async () => {
    const result = await QuarterlyReviewDailySource.collect(sourceInput([{
      id: "00000000-0000-4000-8000-000000000012",
      centre_id: CENTRE_ID,
      centre_name: "Synthetic Centre",
      status: "FINALISED",
      auditor_principal_id: "00000000-0000-4000-8000-000000000099",
      critical_finding_count: 0,
      high_finding_count: 0,
      acknowledged: false,
    }], { kind: "centre", label: "Synthetic Centre", centreId: CENTRE_ID }, [
      capability.quarterlyAuditRead,
      capability.quarterlyAuditAcknowledge,
    ]));
    expect(result.items[0]).toMatchObject({
      responsibility: "YOU_NEED_TO_ACT",
      whyShown: { code: "REVIEW_REQUIRES_ACKNOWLEDGEMENT" },
      cta: { route: "/centre/reviews/00000000-0000-4000-8000-000000000012" },
    });
    expect(result.items[0].due).toBeUndefined();
  });

  test("projects only authorised OPEN Centre Standards work through a controlled CTA", async () => {
    const input = sourceInput([{
      id: "00000000-0000-4000-8000-000000000016",
      centre_id: CENTRE_ID,
      centre_name: "Synthetic Centre",
      timezone: "Australia/Sydney",
      standard_name: "Synthetic Centre Standard",
      business_date: "2026-08-11",
      due_at: new Date("2026-08-11T12:00:00.000Z"),
    }], { kind: "centre", label: "Synthetic Centre", centreId: CENTRE_ID }, [
      capability.operationalCheckComplete,
    ]);

    const result = await OperationalCheckDailySource.collect(input);

    expect(result.items).toEqual([expect.objectContaining({
      sourceType: "operational_check",
      responsibility: "YOU_NEED_TO_ACT",
      whyShown: { code: "CHECK_DUE_TODAY", label: "Centre Standard check is due today" },
      cta: {
        label: "Complete check",
        route: "/standards/checks/00000000-0000-4000-8000-000000000016",
      },
    })]);
    const sql = (input.executor.queryAll as ReturnType<typeof vi.fn>).mock.calls[0][0].join(" ");
    expect(sql).toContain("occurrence.status = 'OPEN'");
    expect(sql).toContain("occurrence.opens_at <=");
  });

  test("does not query Centre Standards without same-centre source authority", async () => {
    const input = sourceInput(
      [],
      { kind: "centre", label: "Synthetic Centre", centreId: CENTRE_ID },
      [],
    );

    await expect(OperationalCheckDailySource.collect(input)).resolves.toEqual({
      items: [],
      completedTodayCount: 0,
      completedTodayTitles: [],
    });
    expect(input.executor.queryAll).not.toHaveBeenCalled();
  });

  test("filters independent approval eligibility before the service applies its five-item response limit", async () => {
    const rows = Array.from({ length: 9 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 20).padStart(12, "0")}`,
      status: "AWAITING_PRIVILEGED_APPROVAL",
      pending_display_name: `Synthetic Person ${index}`,
      created_by_principal_id: index === 0 ? PRINCIPAL_ID : "00000000-0000-4000-8000-000000000099",
      expires_at: new Date("2026-08-12T10:00:00.000Z"),
      already_approved: index === 1,
    }));
    const result = await PeopleAccessDailySource.collect(sourceInput(
      rows,
      { kind: "administration", label: "Administration" },
      [capability.invitationRead, capability.invitationManage, capability.privilegedAccessApprove],
    ));
    expect(result.items).toHaveLength(7);
    expect(result.items.every((item) => !item.headline.includes("Synthetic Person 0") && !item.headline.includes("Synthetic Person 1"))).toBe(true);
  });
});
