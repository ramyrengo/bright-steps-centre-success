import type { EnvironmentMeta } from "encore.dev";

export class SyntheticStandardsSeedError extends Error {}

/**
 * Synthetic Centre Standards content is never valid outside the reviewed
 * local-development and exact staging environments.
 */
export function assertSyntheticStandardsEnvironment(
  environment: Pick<EnvironmentMeta, "cloud" | "name" | "type">,
): void {
  const local =
    environment.cloud === "local" &&
    environment.name === "local" &&
    environment.type === "development";
  const staging =
    environment.cloud === "encore" &&
    environment.name === "staging" &&
    environment.type === "development";

  if (!local && !staging) {
    throw new SyntheticStandardsSeedError(
      "synthetic Centre Standards pilot is restricted to local or exact staging",
    );
  }
}
