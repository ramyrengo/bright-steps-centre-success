import { CANONICAL_UUID } from "../quarterly-reviews/types";

export type OperationalTemplateErrorCode =
  | "invalid_input"
  | "access_denied"
  | "not_found"
  | "version_conflict"
  | "invalid_state"
  | "context_unavailable";

export class OperationalTemplateError extends Error {
  constructor(
    readonly code: OperationalTemplateErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "OperationalTemplateError";
  }
}

export function requireOperationalTemplateUuid(value: string, field: string): string {
  if (!CANONICAL_UUID.test(value)) {
    throw new OperationalTemplateError("invalid_input", `${field} is invalid`);
  }
  return value.toLowerCase();
}
