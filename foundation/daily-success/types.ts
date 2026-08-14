import type { AuthorisationQueryExecutor } from "../authorization/database";
import type { Primitive } from "encore.dev/storage/sqldb";
import type { FoundationCapability } from "../authorization/capabilities";
import type { CentreAuthorisationFact } from "../authorization/batch-centres";
import type {
  DailySourceHealth,
  DailySuccessItem,
  DailySuccessPerspective,
} from "./contracts";

export interface DailySuccessQueryExecutor extends AuthorisationQueryExecutor {
  exec: (strings: TemplateStringsArray, ...values: Primitive[]) => Promise<void>;
}

export interface DailyAuthorisationView {
  principalId: string;
  organisationId: string;
  decisionAt: Date;
  centres: readonly CentreAuthorisationFact[];
  centreIdsByCapability: ReadonlyMap<FoundationCapability, ReadonlySet<string>>;
  invalidCentreIdsByCapability: ReadonlyMap<FoundationCapability, ReadonlySet<string>>;
  organisationCapabilities: ReadonlySet<FoundationCapability>;
}

export interface DailySourceInput {
  executor: DailySuccessQueryExecutor;
  authorisation: DailyAuthorisationView;
  perspective: DailySuccessPerspective;
}

export interface DailySourceResult {
  items: DailySuccessItem[];
  completedTodayCount: number;
  completedTodayTitles: string[];
}

export interface DailySuccessDiagnostics {
  queryCount: number;
  sourceDurationsMs: Record<string, number>;
}

/**
 * Explicit boundary for adapter failures that are safe to represent as
 * partial availability. Invariant, authorization, and programming failures
 * must not be wrapped in this class.
 */
export class DailySourceUnavailableError extends Error {
  constructor(readonly source: DailySourceHealth["source"], options?: ErrorOptions) {
    super(`${source} source is temporarily unavailable`, options);
    this.name = "DailySourceUnavailableError";
  }
}

const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "57014",
  "57P01",
  "57P02",
  "57P03",
]);

export function isKnownSourceAvailabilityFailure(error: unknown): boolean {
  if (error instanceof DailySourceUnavailableError) return true;
  if (typeof error !== "object" || error === null) return false;
  const code = Reflect.get(error, "code");
  if (typeof code === "string") {
    if (TRANSIENT_ERROR_CODES.has(code) || code.startsWith("08") || code.startsWith("53")) {
      return true;
    }
  }
  const cause = Reflect.get(error, "cause");
  return cause !== undefined && cause !== error && isKnownSourceAvailabilityFailure(cause);
}
