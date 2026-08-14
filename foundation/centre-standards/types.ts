import { CANONICAL_UUID } from "../quarterly-reviews/types";

export type OperationalOccurrenceStatus = "OPEN" | "COMPLETED";
export type OperationalTimeliness =
  | "DUE"
  | "OVERDUE"
  | "COMPLETED_ON_TIME"
  | "COMPLETED_LATE";

export class CentreStandardsError extends Error {
  constructor(
    readonly code:
      | "invalid_input"
      | "access_denied"
      | "not_found"
      | "invalid_state"
      | "incomplete_response"
      | "context_unavailable",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CentreStandardsError";
  }
}

export function requireStandardsUuid(value: string, field: string): string {
  if (!CANONICAL_UUID.test(value)) {
    throw new CentreStandardsError("invalid_input", `${field} is invalid`);
  }
  return value.toLowerCase();
}

export function deriveOperationalTimeliness(input: {
  status: OperationalOccurrenceStatus;
  dueAt: Date;
  completedAt: Date | null;
  decisionAt: Date;
}): OperationalTimeliness {
  if (input.status === "OPEN") {
    return input.dueAt.getTime() <= input.decisionAt.getTime() ? "OVERDUE" : "DUE";
  }
  if (!input.completedAt) {
    throw new CentreStandardsError(
      "context_unavailable",
      "completed occurrence has no completion time",
    );
  }
  return input.completedAt.getTime() <= input.dueAt.getTime()
    ? "COMPLETED_ON_TIME"
    : "COMPLETED_LATE";
}
