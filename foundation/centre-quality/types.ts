import type { Primitive } from "encore.dev/storage/sqldb";
import type { CentreAuthorisationFact } from "../authorization/batch-centres";
import type { FoundationCapability } from "../authorization/capabilities";
import type { AuthorisationQueryExecutor } from "../authorization/database";
import type { QualitySourceHealth } from "./contracts";

export interface CentreQualityQueryExecutor extends AuthorisationQueryExecutor {
  exec: (strings: TemplateStringsArray, ...values: Primitive[]) => Promise<unknown>;
}

export interface CentreQualityAuthorisationView {
  principalId: string;
  organisationId: string;
  organisationName: string;
  organisationTimezone: string;
  decisionAt: Date;
  centres: readonly CentreAuthorisationFact[];
  centreIdsByCapability: ReadonlyMap<FoundationCapability, ReadonlySet<string>>;
  invalidCentreIdsByCapability: ReadonlyMap<FoundationCapability, ReadonlySet<string>>;
  organisationCapabilities: ReadonlySet<FoundationCapability>;
}

export interface CentreQualityDiagnostics {
  queryCount: number;
  sourceDurationsMs: Record<string, number>;
}

/**
 * Explicit boundary for source failures that may safely be represented as
 * partial availability. Authorization, invariant, and programming failures
 * must never be wrapped in this class; they fail the request instead.
 */
export class CentreQualitySourceUnavailableError extends Error {
  constructor(readonly source: QualitySourceHealth["source"], options?: ErrorOptions) {
    super(`${source} source is temporarily unavailable`, options);
    this.name = "CentreQualitySourceUnavailableError";
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

export function isKnownQualitySourceFailure(error: unknown): boolean {
  if (error instanceof CentreQualitySourceUnavailableError) return true;
  if (typeof error !== "object" || error === null) return false;
  const code = Reflect.get(error, "code");
  if (typeof code === "string") {
    if (TRANSIENT_ERROR_CODES.has(code) || code.startsWith("08") || code.startsWith("53")) {
      return true;
    }
  }
  const cause = Reflect.get(error, "cause");
  return cause !== undefined && cause !== error && isKnownQualitySourceFailure(cause);
}
