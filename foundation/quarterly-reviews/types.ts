export const AUDIT_OUTCOMES = [
  "COMPLIANT",
  "PARTIALLY_COMPLIANT",
  "NON_COMPLIANT",
  "NOT_APPLICABLE",
  "NOT_OBSERVED",
  "IMMEDIATE_ACTION_REQUIRED",
  "POSITIVE_PRACTICE",
] as const;

export type AuditOutcome =
  | "COMPLIANT"
  | "PARTIALLY_COMPLIANT"
  | "NON_COMPLIANT"
  | "NOT_APPLICABLE"
  | "NOT_OBSERVED"
  | "IMMEDIATE_ACTION_REQUIRED"
  | "POSITIVE_PRACTICE";

export const AUDIT_STATUSES = [
  "DRAFT",
  "IN_PROGRESS",
  "READY_FOR_REVIEW",
  "FINALISED",
] as const;

export type AuditStatus = "DRAFT" | "IN_PROGRESS" | "READY_FOR_REVIEW" | "FINALISED";

export const ACTION_STATUSES = [
  "OPEN",
  "IN_PROGRESS",
  "VERIFICATION_REQUIRED",
  "CLOSED",
  "MORE_INFORMATION_REQUIRED",
  "REJECTED",
  "WITHDRAWN",
] as const;

export type CorrectiveActionStatus =
  | "OPEN"
  | "IN_PROGRESS"
  | "VERIFICATION_REQUIRED"
  | "CLOSED"
  | "MORE_INFORMATION_REQUIRED"
  | "REJECTED"
  | "WITHDRAWN";
export type FindingStatus = "OPEN" | "RESOLVED" | "WITHDRAWN";
export type FindingSeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type AuditRiskStatus =
  | "STRONG"
  | "IMPROVEMENT_REQUIRED"
  | "AT_RISK"
  | "PRIORITY_INTERVENTION"
  | "HIGH"
  | "CRITICAL";

export class QuarterlyReviewError extends Error {
  readonly code:
    | "invalid_input"
    | "access_denied"
    | "not_found"
    | "invalid_state"
    | "version_conflict"
    | "incomplete_audit"
    | "owner_resolution_required"
    | "evidence_unavailable";

  constructor(code: QuarterlyReviewError["code"], message: string) {
    super(message);
    this.name = "QuarterlyReviewError";
    this.code = code;
  }
}

export const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function requireUuid(value: string, field: string): string {
  if (!CANONICAL_UUID.test(value)) {
    throw new QuarterlyReviewError("invalid_input", `${field} is invalid`);
  }
  return value.toLowerCase();
}

export function optionalTrimmedText(
  value: string | undefined,
  field: string,
  maximum: number,
): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maximum) {
    throw new QuarterlyReviewError("invalid_input", `${field} is invalid`);
  }
  return trimmed;
}
