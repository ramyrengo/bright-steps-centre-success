/**
 * Reader-facing wording for recorded access changes.
 *
 * The access history renders the audit `action` column, which holds dotted
 * machine codes: `invitation.identity_review_required`,
 * `assignment_scope.replaced`. Replacing underscores with spaces was close
 * enough to look deliberate and wrong enough to read badly — "invitation.
 * identity review required" keeps the dot, keeps the internal noun order, and
 * tells an administrator less than the code did.
 *
 * These are the codes the People & Access service records, plus the one written
 * by role bundle migrations, which reaches the same history. An unrecognised
 * code degrades to something readable rather than exposing the raw identifier:
 * the history is shown to administrators, not to engineers, and a code that
 * arrives here unmapped is a labelling gap rather than something the reader
 * should have to decode.
 */
const HISTORY_ACTION_LABELS: Readonly<Record<string, string>> = {
  "invitation.created": "Invitation created",
  "invitation.sent": "Invitation sent",
  "invitation.resent": "Invitation resent",
  "invitation.cancelled": "Invitation cancelled",
  "invitation.expired": "Invitation expired",
  "invitation.activated": "Invitation accepted",
  "invitation.identity_review_required": "Identity review required",
  "principal.activated": "Access activated",
  "principal.reactivated": "Access reactivated",
  "principal.suspended": "Access suspended",
  "principal.revoked": "Access revoked",
  "role_assignment.granted": "Role granted",
  "role_assignment.ended": "Role ended",
  "role_assignment.bundle_migrated": "Role capabilities updated",
  "assignment_scope.replaced": "Assignment scope changed",
  "privileged_access.approved": "Privileged access approved",
};

/** Presentation-ready wording for one recorded access change. */
export function historyActionLabel(action: string): string {
  const known = HISTORY_ACTION_LABELS[action];
  if (known) return known;

  // Unknown code. Take the part after the final dot so the internal namespace
  // never reaches the reader, and make it read as a sentence.
  const tail = action.slice(action.lastIndexOf(".") + 1).replaceAll("_", " ").trim();
  if (!tail) return "Access change";
  return `${tail.charAt(0).toUpperCase()}${tail.slice(1)}`;
}
