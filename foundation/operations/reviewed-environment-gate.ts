import type { EnvironmentMeta } from "encore.dev";

/**
 * The environment gate shared by every reviewed, out-of-band operator tool that
 * is allowed to write to a deployed environment — ADR-0021 D5.
 *
 * It was first written for `authentication/first-administrator-ceremony.ts`,
 * which needed a gate for the most privileged operation in the system, and was
 * extracted here unchanged so the organisation reference load could adopt the
 * same one rather than invent a second. There is deliberately one definition of
 * "which environments may a reviewed tool write to", not one per tool: two
 * copies drift, and the copy that drifts is the one nobody re-reviewed.
 *
 * The gate is four independent locks. None of them replaces a tool's own
 * safety property — those are environment-independent and stay with the tool.
 *
 * 1. The operator NAMES the target environment, and it must equal the running
 *    environment reported by `appMeta()`. An operator who believes they are on
 *    staging and is actually connected to production gets a refusal, not a
 *    write. This applies to dry runs too, so a rehearsal proves something about
 *    the environment the operator actually named.
 * 2. Applying is confined to a closed, reviewed allow-list of environment names.
 *    Widening it is a source change that goes through review; it is not
 *    something an operator flag can do.
 * 3. `ephemeral` and `test` environment TYPES can never apply, whatever they are
 *    named, so a preview environment cannot impersonate staging by taking its
 *    name.
 * 4. Production additionally requires an explicit confirmation flag, and that
 *    flag is REFUSED everywhere else, so it cannot sit on the command line as a
 *    habitual paste waiting for the day the operator finally points at
 *    production.
 *
 * A dry run writes nothing and is permitted in any environment, but still has to
 * pass lock 1.
 */

/**
 * The closed set of DEPLOYED environments a reviewed tool may **apply** in.
 *
 * ADR-0021 D3 fixes the topology as `local`, `development`, `preview`,
 * `staging`, and `production`. Only the two deployed environments D5 names are
 * listed: staging, where an operation is rehearsed end to end, and production.
 *
 * `local` is deliberately absent. A tool that is also legitimately used in local
 * development adds it to its OWN allow-list — see
 * `ORGANISATION_LOAD_APPLY_ENVIRONMENT_NAMES` — so that admitting local is a
 * visible, per-tool, reviewed decision rather than a quiet widening of the
 * shared list for everybody.
 */
export const REVIEWED_APPLY_ENVIRONMENT_NAMES = ["staging", "production"] as const;

/** Environments that additionally require the explicit confirmation flag. */
export const REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES = ["production"] as const;

/**
 * Environment types that can never apply, whatever they are called. A preview
 * environment is `ephemeral` and a test run is `test`; neither may make a real
 * change even if somebody names it `staging`.
 */
export const REFUSED_APPLY_ENVIRONMENT_TYPES = ["ephemeral", "test"] as const;

export type ReviewedEnvironmentGateFailureCode =
  | "environment_not_declared"
  | "environment_mismatch"
  | "environment_not_permitted"
  | "environment_type_not_permitted"
  | "production_confirmation_required"
  | "confirmation_not_applicable";

export interface ReviewedEnvironmentGateRequest {
  /**
   * The environment the operator believes they are pointed at, typed out in
   * full. It has no default: naming it is the point.
   */
  declaredEnvironment: string;
  /** Dry run is every caller's default; this is the caller's resolved decision. */
  apply: boolean;
  /** Required only when applying to production. Refused anywhere else. */
  confirmProduction?: boolean;
}

export interface ReviewedEnvironmentGatePolicy {
  /**
   * The environment names THIS tool may apply in. Normally
   * `REVIEWED_APPLY_ENVIRONMENT_NAMES`; a tool that is also a supported local
   * development tool names local here as well.
   */
  applyEnvironmentNames: readonly string[];
  /** Normally `REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES`. */
  confirmationEnvironmentNames: readonly string[];
  /** Completes "environment type <type> can never …", in the tool's own terms. */
  refusedTypeConsequence: string;
  /** Completes "only <names> may apply; …", in the tool's own terms. */
  notPermittedNote: string;
}

export interface ReviewedEnvironmentGateRefusal {
  code: ReviewedEnvironmentGateFailureCode;
  detail: string;
}

/** "a and b"; "a, b and c". Two names render exactly as `join(" and ")` does. */
function joinNames(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function environmentRequiresConfirmation(
  environmentName: string,
  confirmationEnvironmentNames: readonly string[] = REVIEWED_CONFIRMATION_ENVIRONMENT_NAMES,
): boolean {
  return confirmationEnvironmentNames.includes(environmentName);
}

/**
 * Evaluates the gate and returns the first refusal, or null when the operation
 * may proceed.
 *
 * It returns a refusal rather than throwing so that each tool keeps its own
 * error type and its own failure-code union — an operator reading a refusal
 * should see the tool they invoked, not a shared helper. Every caller must
 * evaluate this BEFORE opening a transaction: a refused environment must not be
 * able to open one that could commit.
 */
export function evaluateReviewedEnvironmentGate(
  request: ReviewedEnvironmentGateRequest,
  environment: Pick<EnvironmentMeta, "cloud" | "name" | "type">,
  policy: ReviewedEnvironmentGatePolicy,
): ReviewedEnvironmentGateRefusal | null {
  const declared = request.declaredEnvironment.trim();
  if (declared.length === 0) {
    return {
      code: "environment_not_declared",
      detail:
        "the target environment is explicit operator input and has no default",
    };
  }

  if (declared !== environment.name) {
    return {
      code: "environment_mismatch",
      detail: `operator named ${JSON.stringify(declared)}; this deployment reports ${JSON.stringify(environment.name)}`,
    };
  }

  const confirmationRequired = environmentRequiresConfirmation(
    declared,
    policy.confirmationEnvironmentNames,
  );

  // Checked on dry runs too. The flag must never be something an operator can
  // leave lying on the command line while rehearsing.
  if (request.confirmProduction === true && !confirmationRequired) {
    return {
      code: "confirmation_not_applicable",
      detail: `the production confirmation flag is refused in ${declared}`,
    };
  }

  if (!request.apply) {
    return null;
  }

  if (
    (REFUSED_APPLY_ENVIRONMENT_TYPES as readonly string[]).includes(
      environment.type,
    )
  ) {
    return {
      code: "environment_type_not_permitted",
      detail: `environment type ${environment.type} can never ${policy.refusedTypeConsequence}`,
    };
  }

  if (!policy.applyEnvironmentNames.includes(declared)) {
    return {
      code: "environment_not_permitted",
      detail: `only ${joinNames(policy.applyEnvironmentNames)} may apply; ${policy.notPermittedNote}`,
    };
  }

  if (confirmationRequired && request.confirmProduction !== true) {
    return {
      code: "production_confirmation_required",
      detail: "applying in production requires the explicit confirmation flag",
    };
  }

  return null;
}
