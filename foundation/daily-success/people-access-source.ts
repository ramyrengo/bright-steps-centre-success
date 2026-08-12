import { FOUNDATION_CAPABILITIES as capability } from "../authorization/capabilities";
import type { DailySuccessItem } from "./contracts";
import { controlledDailyCta } from "./cta";
import type { DailySourceInput, DailySourceResult } from "./types";

interface PeopleAccessDailyRow {
  id: string;
  status: "AWAITING_PRIVILEGED_APPROVAL" | "ADMINISTRATOR_REVIEW";
  pending_display_name: string;
  created_by_principal_id: string;
  expires_at: Date | null;
  already_approved: boolean;
}

export const PeopleAccessDailySource = {
  async collect(input: DailySourceInput): Promise<DailySourceResult> {
    if (input.perspective.kind !== "administration") {
      return { items: [], completedTodayCount: 0, completedTodayTitles: [] };
    }
    const canRead = input.authorisation.organisationCapabilities.has(capability.invitationRead);
    const canManage = input.authorisation.organisationCapabilities.has(capability.invitationManage);
    const canApprove = input.authorisation.organisationCapabilities.has(capability.privilegedAccessApprove);
    if (!canRead || (!canManage && !canApprove)) {
      return { items: [], completedTodayCount: 0, completedTodayTitles: [] };
    }
    const rows = await input.executor.queryAll<PeopleAccessDailyRow>`
      SELECT
        invitation.id,
        invitation.status,
        pending.display_name AS pending_display_name,
        invitation.created_by_principal_id,
        invitation.expires_at,
        EXISTS (
          SELECT 1
          FROM privileged_invitation_approvals AS approval
          WHERE approval.organisation_id = invitation.organisation_id
            AND approval.invitation_id = invitation.id
            AND approval.approver_principal_id = ${input.authorisation.principalId}
            AND approval.status = 'APPROVED'
        ) AS already_approved
      FROM access_invitations AS invitation
      JOIN principals AS pending ON pending.id = invitation.pending_principal_id
      WHERE invitation.organisation_id = ${input.authorisation.organisationId}
        AND invitation.status IN ('AWAITING_PRIVILEGED_APPROVAL', 'ADMINISTRATOR_REVIEW')
        AND (invitation.expires_at IS NULL OR invitation.expires_at > ${input.authorisation.decisionAt})
        AND (
          invitation.status <> 'AWAITING_PRIVILEGED_APPROVAL'
          OR EXISTS (
            SELECT 1
            FROM invitation_role_proposals AS proposal
            WHERE proposal.organisation_id = invitation.organisation_id
              AND proposal.invitation_id = invitation.id
              AND proposal.privilege_class = 'PRIVILEGED'
          )
        )
      ORDER BY invitation.updated_at, invitation.id
    `;
    const items: DailySuccessItem[] = [];
    for (const row of rows) {
      const approval = row.status === "AWAITING_PRIVILEGED_APPROVAL";
      if (approval && (!canApprove || row.created_by_principal_id === input.authorisation.principalId || row.already_approved)) {
        continue;
      }
      if (!approval && !canManage) continue;
      items.push({
        id: `people_access:${row.id}`,
        sourceType: "people_access",
        sourceId: row.id,
        headline: approval
          ? `Independent approval needed for ${row.pending_display_name}`
          : `Administrator review needed for ${row.pending_display_name}`,
        summary: approval
          ? "A privileged access package needs another authorised administrator"
          : "An identity case needs administrator review",
        attentionBand: "TODAY",
        responsibility: "YOU_NEED_TO_ACT",
        whyShown: approval
          ? { code: "PRIVILEGED_APPROVAL_REQUIRED", label: "Eligible independent approval is required" }
          : { code: "IDENTITY_REVIEW_REQUIRED", label: "Administrator review is required" },
        riskLevel: "STANDARD",
        cta: controlledDailyCta("Review access", `/admin/people/invitations/${row.id}`),
      });
    }
    return { items, completedTodayCount: 0, completedTodayTitles: [] };
  },
};
