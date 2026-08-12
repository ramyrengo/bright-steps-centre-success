import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const routerMocks = vi.hoisted(() => ({ push: vi.fn() }));
const authMocks = vi.hoisted(() => ({
  signIn: vi.fn(() => Promise.resolve()),
  signOut: vi.fn(() => Promise.resolve()),
}));
const clientMocks = vi.hoisted(() => ({
  foundation: {
    listAssignedAuditCentres: vi.fn(),
    listCorrectiveActionVerificationQueue: vi.fn(),
    getAuditPreparation: vi.fn(),
    startQuarterlyAudit: vi.fn(),
    getQuarterlyAudit: vi.fn(),
    saveQuarterlyAuditResponse: vi.fn(),
    markQuarterlyAuditReady: vi.fn(),
    finaliseQuarterlyAudit: vi.fn(),
    requestEvidenceUpload: vi.fn(),
    completeEvidenceUpload: vi.fn(),
    getEvidenceAccess: vi.fn(),
    listMyCorrectiveActions: vi.fn(),
    getCorrectiveAction: vi.fn(),
    startCorrectiveAction: vi.fn(),
    submitCorrectiveActionEvidence: vi.fn(),
    acknowledgeQuarterlyAudit: vi.fn(),
    verifyAndCloseCorrectiveAction: vi.fn(),
    returnCorrectiveAction: vi.fn(),
    getComplianceOversight: vi.fn(),
  },
}));
const foundation = clientMocks.foundation;

vi.mock("next/navigation", () => ({ useRouter: () => routerMocks }));
vi.mock("../lib/centre-success-authentication", () => ({
  useCentreSuccessAuthentication: () => ({
    state: { kind: "signed-in", accountKey: "synthetic-account" },
    signIn: authMocks.signIn,
    signOut: authMocks.signOut,
    getAccessToken: vi.fn(),
  }),
}));
vi.mock("../lib/centre-success-client", () => ({
  useAuthenticatedCentreSuccessClient: () => clientMocks,
}));

import { AreaManagerWorkspace } from "./area-manager-workspace";
import { CentreActionWorkspace, CentreActionsWorkspace } from "./centre-actions-workspace";
import { CentreReviewWorkspace } from "./centre-review-workspace";
import { ComplianceOversightWorkspace } from "./compliance-oversight-workspace";
import { QuarterlyAuditWorkspace } from "./quarterly-audit-workspace";
import { VerificationWorkspace } from "./verification-workspace";

const ACTION = {
  id: "00000000-0000-4000-8000-000000000301",
  centreId: "00000000-0000-4000-8000-000000000101",
  centreName: "Synthetic North Centre",
  title: "Emergency information available",
  severity: "CRITICAL" as const,
  dueAt: "2026-08-12T00:00:00.000Z",
  status: "VERIFICATION_REQUIRED" as const,
  ownerPrincipalId: "00000000-0000-4000-8000-000000000201",
  verificationRequired: true,
  submittedAt: "2026-08-11T12:00:00.000Z",
};

const ACTION_DETAIL = {
  ...ACTION,
  finding: {
    id: "00000000-0000-4000-8000-000000000401",
    description: "Synthetic internal review finding",
    originatingAuditId: "00000000-0000-4000-8000-000000000501",
    originatingAuditStatus: "FINALISED" as const,
    originatingAuditAcknowledged: false,
    itemLineageKey: "emergency_information_available",
    repeatCount: 1,
  },
  requiredRemediation: "Address the synthetic development finding.",
  evidenceRequirement: "required" as const,
  lockVersion: 3,
  evidence: [{
    id: "00000000-0000-4000-8000-000000000601",
    filename: "synthetic-proof.pdf",
    mediaType: "application/pdf",
    byteSize: 24,
    scanStatus: "not_scanned" as const,
    availabilityStatus: "AVAILABLE_LOCAL_UNSCANNED",
  }],
  history: [
    { eventType: "action.created", toStatus: "OPEN", occurredAt: "2026-08-11T10:00:00.000Z" },
    { eventType: "remediation.verification_requested", fromStatus: "IN_PROGRESS", toStatus: "VERIFICATION_REQUIRED", occurredAt: "2026-08-11T12:00:00.000Z" },
  ],
};

const AUDIT = {
  id: "00000000-0000-4000-8000-000000000501",
  centre: { id: ACTION.centreId, name: ACTION.centreName },
  template: { id: "template", title: "BSA Quarterly Centre Review — Development Template", version: 1, synthetic: true, sourceClassification: "BSA_DEVELOPMENT_TEST" },
  status: "IN_PROGRESS" as const,
  reviewPeriodStart: "2026-07-01",
  lockVersion: 2,
  progress: { answered: 1, total: 1 },
  ownerCandidates: [{ principalId: ACTION.ownerPrincipalId, displayName: "Synthetic Centre Director" }],
  sections: [{ id: "section", title: "Health & Safety", items: [{
    id: "item",
    lineageKey: "emergency_information_available",
    wording: "Emergency information available",
    instructions: "Synthetic development item only.",
    weight: 1,
    scored: true,
    critical: true,
    evidenceRequirement: "required" as const,
    allowedOutcomes: ["COMPLIANT", "IMMEDIATE_ACTION_REQUIRED"] as const,
    response: { id: "response", outcome: "COMPLIANT" as const, lockVersion: 1 },
  }]}],
  positivePractices: [],
  acknowledged: false,
};

beforeEach(() => {
  for (const mock of Object.values(foundation)) mock.mockReset();
  routerMocks.push.mockReset();
});

afterEach(cleanup);

describe("Milestone 2B role-focused workflows", () => {
  test("Centre Director review route reads and acknowledges through the existing source workflow", async () => {
    const finalAudit = {
      ...AUDIT,
      status: "FINALISED" as const,
      score: 92,
      riskStatus: "STRONG" as const,
      sections: [{ ...AUDIT.sections[0], score: 92 }],
      acknowledged: false,
    };
    foundation.getQuarterlyAudit
      .mockResolvedValueOnce(finalAudit)
      .mockResolvedValueOnce({ ...finalAudit, acknowledged: true });
    foundation.acknowledgeQuarterlyAudit.mockResolvedValue({
      acknowledgementId: "00000000-0000-4000-8000-000000000799",
      acknowledgedAt: "2026-08-12T00:00:00.000Z",
    });
    render(<CentreReviewWorkspace auditId={AUDIT.id} />);
    expect(await screen.findByText("BSA Internal Audit Score")).toBeDefined();
    expect(screen.getByText(/not an ACECQA assessment or NQS rating/i)).toBeDefined();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("navigation", { name: "Centre Success workspaces" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Acknowledge review" }));
    await waitFor(() => expect(foundation.acknowledgeQuarterlyAudit).toHaveBeenCalledWith(AUDIT.id, {}));
    expect(await screen.findByText("Review acknowledged.")).toBeDefined();
  });

  test("keeps acknowledgement success when the subsequent review refresh fails", async () => {
    const finalAudit = {
      ...AUDIT,
      status: "FINALISED" as const,
      score: 92,
      riskStatus: "STRONG" as const,
      sections: [{ ...AUDIT.sections[0], score: 92 }],
      acknowledged: false,
    };
    foundation.getQuarterlyAudit
      .mockResolvedValueOnce(finalAudit)
      .mockRejectedValueOnce(new Error("synthetic refresh failure"));
    foundation.acknowledgeQuarterlyAudit.mockResolvedValue({
      acknowledgementId: "00000000-0000-4000-8000-000000000799",
      acknowledgedAt: "2026-08-12T00:00:00.000Z",
    });
    render(<CentreReviewWorkspace auditId={AUDIT.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge review" }));
    expect(await screen.findByText("Review acknowledged. Latest review details could not be refreshed.")).toBeDefined();
    expect(screen.queryByText("The review could not be acknowledged. Reload and check your access.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Acknowledge review" })).toBeNull();
    expect(foundation.acknowledgeQuarterlyAudit).toHaveBeenCalledTimes(1);
  });

  test("Area Manager sees loading, empty and can prepare then start an assigned-centre review", async () => {
    const centre = [{ id: ACTION.centreId, name: ACTION.centreName, openCorrectiveActions: 0 }];
    let resolveCentres!: (value: { centres: typeof centre }) => void;
    foundation.listAssignedAuditCentres.mockReturnValue(new Promise((resolve) => { resolveCentres = resolve; }));
    foundation.listCorrectiveActionVerificationQueue.mockResolvedValue({ actions: [] });

    const view = render(<AreaManagerWorkspace />);
    expect(screen.getByRole("status").textContent).toContain("Loading assigned centres");
    resolveCentres({ centres: [] });
    expect(await screen.findByRole("heading", { name: "No assigned centres" })).toBeDefined();
    view.unmount();

    foundation.listAssignedAuditCentres.mockResolvedValue({ centres: centre });
    foundation.listCorrectiveActionVerificationQueue.mockResolvedValue({ actions: [] });
    foundation.getAuditPreparation.mockResolvedValue({
      centre: { id: ACTION.centreId, name: ACTION.centreName },
      activeTemplate: { id: "template", title: AUDIT.template.title, version: 1, synthetic: true },
      openCorrectiveActions: 0,
    });
    foundation.startQuarterlyAudit.mockResolvedValue({ auditId: AUDIT.id, status: "DRAFT", created: true });
    render(<AreaManagerWorkspace />);
    expect(await screen.findByText(/Scores shown below are internal Bright Steps/i)).toBeDefined();
    fireEvent.click(await screen.findByRole("button", { name: "Prepare visit" }));
    expect(await screen.findByText(/BSA Internal Audit Score is an internal Bright Steps/i)).toBeDefined();
    fireEvent.click(await screen.findByRole("button", { name: "Start quarterly review" }));
    await waitFor(() => expect(foundation.startQuarterlyAudit).toHaveBeenCalledWith({ centreId: ACTION.centreId }));
    expect(routerMocks.push).toHaveBeenCalledWith(`/area-manager/centres/${ACTION.centreId}/audit/${AUDIT.id}`);
  });

  test("Area Manager saves a response and completes the ready/finalise workflow", async () => {
    const readyAudit = { ...AUDIT, status: "READY_FOR_REVIEW" as const, lockVersion: 3 };
    const finalAudit = {
      ...readyAudit,
      status: "FINALISED" as const,
      lockVersion: 4,
      score: 95,
      riskStatus: "CRITICAL" as const,
      positivePractices: [{ id: "positive", description: "Excellent synthetic practice" }],
      sections: [{
        ...AUDIT.sections[0],
        score: 95,
        items: [{
          ...AUDIT.sections[0].items[0],
          finding: { id: "finding", severity: "CRITICAL" as const, status: "OPEN" as const, repeatCount: 2, actionId: ACTION.id },
        }],
      }],
    };
    foundation.getQuarterlyAudit
      .mockResolvedValueOnce(AUDIT)
      .mockResolvedValueOnce(AUDIT)
      .mockResolvedValueOnce(readyAudit)
      .mockResolvedValueOnce(finalAudit);
    foundation.saveQuarterlyAuditResponse.mockResolvedValue({ responseId: "response", lockVersion: 2, auditStatus: "IN_PROGRESS", immediateFindingCreated: true, immediateActionCreated: true, ownerResolutionRequired: false });
    foundation.markQuarterlyAuditReady.mockResolvedValue({ status: "READY_FOR_REVIEW", lockVersion: 3 });
    foundation.finaliseQuarterlyAudit.mockResolvedValue({ auditId: AUDIT.id, status: "FINALISED", score: 95, riskStatus: "CRITICAL" });

    render(<QuarterlyAuditWorkspace auditId={AUDIT.id} />);
    const outcome = await screen.findByLabelText("Outcome");
    fireEvent.change(outcome, { target: { value: "IMMEDIATE_ACTION_REQUIRED" } });
    fireEvent.change(screen.getByLabelText("Comment or reason"), { target: { value: "Synthetic immediate concern" } });
    fireEvent.click(screen.getByRole("button", { name: "Update response" }));
    await waitFor(() => expect(foundation.saveQuarterlyAuditResponse).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: "Submit for final review" }));
    expect(await screen.findByRole("button", { name: "Finalise review" })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Finalise review" }));
    expect(await screen.findByRole("heading", { name: "95%" })).toBeDefined();
    expect(screen.getByText("BSA Internal Audit Score")).toBeDefined();
    expect(screen.getByText(/not an ACECQA assessment or NQS rating/i)).toBeDefined();
    expect(screen.getByText("Risk: CRITICAL")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Section scores" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Review action" }).getAttribute("href")).toBe(`/area-manager/verification/${ACTION.id}`);
  });

  test("requires and sends the response-correction reason shown for an active finding", async () => {
    const auditWithFinding = {
      ...AUDIT,
      sections: [{
        ...AUDIT.sections[0],
        items: [{
          ...AUDIT.sections[0].items[0],
          response: { id: "response", outcome: "IMMEDIATE_ACTION_REQUIRED" as const, lockVersion: 4 },
          finding: { id: "finding", severity: "CRITICAL" as const, status: "OPEN" as const, repeatCount: 1, actionId: ACTION.id },
        }],
      }],
    };
    foundation.getQuarterlyAudit.mockResolvedValue(auditWithFinding);
    foundation.saveQuarterlyAuditResponse.mockResolvedValue({
      responseId: "response", lockVersion: 5, auditStatus: "IN_PROGRESS",
      immediateFindingCreated: false, immediateActionCreated: false,
      ownerResolutionRequired: false,
    });
    render(<QuarterlyAuditWorkspace auditId={AUDIT.id} />);
    fireEvent.change(await screen.findByLabelText("Outcome"), { target: { value: "COMPLIANT" } });
    fireEvent.change(screen.getByLabelText("Response correction reason"), {
      target: { value: "The original outcome was selected in error." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Update response" }));
    await waitFor(() => expect(foundation.saveQuarterlyAuditResponse).toHaveBeenCalledWith(
      AUDIT.id,
      "item",
      expect.objectContaining({
        outcome: "COMPLIANT",
        responseCorrectionReason: "The original outcome was selected in error.",
        responseLockVersion: 4,
      }),
    ));
  });

  test("Centre Director sees only returned actions and submits remediation", async () => {
    foundation.listMyCorrectiveActions.mockResolvedValue({ actions: [ACTION] });
    render(<CentreActionsWorkspace />);
    expect(await screen.findByRole("heading", { name: ACTION.title })).toBeDefined();
    expect(screen.getByText(/BSA Internal Audit Score process/i)).toBeDefined();
    expect(screen.getByText(/not an ACECQA assessment or NQS rating/i)).toBeDefined();
    cleanup();

    const inProgress = { ...ACTION_DETAIL, status: "IN_PROGRESS" as const };
    foundation.getCorrectiveAction.mockResolvedValue(inProgress);
    foundation.submitCorrectiveActionEvidence.mockResolvedValue({ actionId: ACTION.id, status: "VERIFICATION_REQUIRED", lockVersion: 4 });
    render(<CentreActionWorkspace actionId={ACTION.id} />);
    fireEvent.change(await screen.findByLabelText("Remediation note"), { target: { value: "Synthetic remediation completed." } });
    fireEvent.click(screen.getByRole("button", { name: "Submit for verification" }));
    await waitFor(() => expect(foundation.submitCorrectiveActionEvidence).toHaveBeenCalledWith(ACTION.id, { lockVersion: 3, remediationNote: "Synthetic remediation completed." }));
  });

  test("Centre Director can acknowledge a final audit without changing the finding", async () => {
    foundation.getCorrectiveAction
      .mockResolvedValueOnce(ACTION_DETAIL)
      .mockResolvedValueOnce({
        ...ACTION_DETAIL,
        finding: { ...ACTION_DETAIL.finding, originatingAuditAcknowledged: true },
      });
    foundation.acknowledgeQuarterlyAudit.mockResolvedValue({
      acknowledgementId: "00000000-0000-4000-8000-000000000701",
      acknowledgedAt: "2026-08-12T03:00:00.000Z",
    });
    render(<CentreActionWorkspace actionId={ACTION.id} />);
    fireEvent.click(await screen.findByRole("button", { name: "Acknowledge final audit" }));
    await waitFor(() => expect(foundation.acknowledgeQuarterlyAudit).toHaveBeenCalledWith(
      ACTION_DETAIL.finding.originatingAuditId,
      { comment: "Reviewed in Centre Success." },
    ));
    expect(await screen.findByText("Final audit acknowledged")).toBeDefined();
  });

  test("Area Manager independently verifies submitted remediation", async () => {
    foundation.getCorrectiveAction.mockResolvedValue(ACTION_DETAIL);
    foundation.getEvidenceAccess.mockResolvedValue({ downloadUrl: "https://signed.example/evidence", expiresInSeconds: 300, scanStatus: "not_scanned" });
    foundation.verifyAndCloseCorrectiveAction.mockResolvedValue({ actionId: ACTION.id, status: "CLOSED", lockVersion: 4 });
    render(<VerificationWorkspace actionId={ACTION.id} />);
    expect(await screen.findByText("Not security scanned")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Review evidence" }));
    const evidenceLink = await screen.findByRole("link", { name: "Open evidence" });
    expect(evidenceLink.getAttribute("href")).toBe("https://signed.example/evidence");
    expect(foundation.getEvidenceAccess).toHaveBeenCalledWith(ACTION_DETAIL.evidence[0].id);
    fireEvent.click(screen.getByRole("button", { name: "Verify & close" }));
    await waitFor(() => expect(foundation.verifyAndCloseCorrectiveAction).toHaveBeenCalledWith(ACTION.id, { lockVersion: 3, verificationNote: "Evidence reviewed through Centre Success." }));
  });

  test("Compliance Manager sees updated organisation status", async () => {
    foundation.getComplianceOversight.mockResolvedValue({
      counts: { completed: 3, inProgress: 1, outstanding: 0, centresBelowInternalThreshold: 1, criticalFindings: 1, highFindings: 2, openCorrectiveActions: 4, overdueCorrectiveActions: 1, awaitingVerification: 1 },
      centres: [{ centreId: ACTION.centreId, centreName: ACTION.centreName, latestAuditId: AUDIT.id, latestScore: 86, riskStatus: "CRITICAL", openActions: 2, overdueActions: 1 }],
    });
    render(<ComplianceOversightWorkspace />);
    expect(await screen.findByRole("heading", { name: ACTION.centreName })).toBeDefined();
    expect(screen.getByText("Critical findings").nextSibling?.textContent).toBe("1");
    expect(screen.getByText("BSA Internal Audit Score: 86%")).toBeDefined();
    expect(screen.getByText(/not an ACECQA assessment or NQS rating/i)).toBeDefined();
    expect(screen.queryByText(/regulatory rating/i)).toBeNull();
  });

  test("shows a safe retryable error without leaking backend details", async () => {
    foundation.getComplianceOversight.mockRejectedValue(new Error("sensitive database details"));
    render(<ComplianceOversightWorkspace />);
    expect(await screen.findByRole("heading", { name: "Oversight unavailable" })).toBeDefined();
    expect(screen.queryByText("sensitive database details")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeDefined();
  });
});
