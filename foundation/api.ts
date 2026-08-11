import { api, APIError } from "encore.dev/api";
import { centreSuccessDB } from "./db";

export interface FoundationHealthResponse {
  status: "operational";
  milestone: "1";
  backend: "connected";
  database: "available";
  checkedAt: string;
}

/**
 * Public liveness/readiness proof for local development and the foundation
 * shell. It intentionally exposes no organisation, centre, or principal data.
 */
export const health = api(
  { expose: true, method: "GET", path: "/foundation/health" },
  async (): Promise<FoundationHealthResponse> => {
    try {
      const row = await centreSuccessDB.queryRow<{ ready: boolean }>`
        SELECT TRUE AS ready
      `;

      if (!row?.ready) {
        throw new Error("database readiness query returned no result");
      }
    } catch (cause) {
      throw APIError.unavailable(
        "foundation database is unavailable",
        cause instanceof Error ? cause : undefined,
      );
    }

    return {
      status: "operational",
      milestone: "1",
      backend: "connected",
      database: "available",
      checkedAt: new Date().toISOString(),
    };
  },
);
