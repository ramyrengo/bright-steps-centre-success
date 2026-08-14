import { parseArgs } from "node:util";
import { appMeta } from "encore.dev";
import {
  formatOrganisationLoadReport,
  loadBrightStepsOrganisationReference,
  OrganisationLoadError,
} from "../foundation/organisation-reference/organisation-load";

/**
 * Reviewed organisation reference load — ADR-0021 Stage 7.
 *
 * Out-of-band operator tooling only. It is run through `encore exec`, defines no
 * API, is reachable from no browser, and appears in no generated client.
 *
 * Dry run is the default and writes nothing. `--apply` commits, and passes the
 * same reviewed environment gate as the ADR-0021 D5 first-administrator
 * ceremony: the operator names the target environment and it must equal the
 * running one, applying is confined to a reviewed allow-list, ephemeral and test
 * environment types can never apply, and production additionally requires
 * `--confirm-production-organisation-load`.
 *
 * Unlike that ceremony this is also a supported local development tool, so
 * `local` is in the allow-list — and an environment named `local` must still be
 * genuine local development to qualify.
 *
 *   npm run organisation:load:dry-run -- \
 *     --environment=local \
 *     --organisation-timezone=Australia/Sydney
 *
 *   npm run organisation:load:apply -- \
 *     --environment=local \
 *     --organisation-timezone=Australia/Sydney
 *
 *   npm run organisation:load:apply -- \
 *     --environment=production \
 *     --organisation-timezone=Australia/Sydney \
 *     --confirm-production-organisation-load
 *
 * Running `--apply` is a separate, human-approved step. Do not run it because a
 * dry run looked correct; run it because a human approved that dry run.
 */

const { values } = parseArgs({
  allowPositionals: false,
  // Strict parsing means a typo refuses rather than silently defaulting. On a
  // tool that can now write to production, an unrecognised flag must be an
  // error, never an ignored argument.
  strict: true,
  options: {
    environment: { type: "string" },
    "organisation-timezone": { type: "string" },
    apply: { type: "boolean" },
    "confirm-production-organisation-load": { type: "boolean" },
  },
});

const required = ["environment", "organisation-timezone"] as const;
const missing = required.filter(
  (flag) => (values[flag] ?? "").trim().length === 0,
);

if (missing.length > 0) {
  console.error(
    `refused: missing required operator input: ${missing.map((flag) => `--${flag}`).join(", ")}.\n` +
      "\n" +
      "--environment names the environment you believe you are pointed at. It is\n" +
      "matched against the running deployment and has no default, including no\n" +
      "default of local: an operator who thinks they are on staging and is\n" +
      "actually connected to production must get a refusal, not a write.\n" +
      "\n" +
      "--organisation-timezone sets organisations.default_timezone, which drives\n" +
      "the organisation business date in Daily Success and Centre Quality. The\n" +
      "approved Bright Steps dataset does not state it, so it is an explicit\n" +
      "Product Owner decision rather than an engineering default.",
  );
  process.exit(2);
}

try {
  const report = await loadBrightStepsOrganisationReference({
    declaredEnvironment: values.environment ?? "",
    organisationTimezone: values["organisation-timezone"] ?? "",
    apply: values.apply === true,
    confirmProduction: values["confirm-production-organisation-load"] === true,
    environment: appMeta().environment,
  });
  console.info(formatOrganisationLoadReport(report));
  if (report.mode === "dry_run") {
    console.info("");
    console.info(
      "Nothing was written. Re-run with --apply once a human has reviewed and\n" +
        "approved this plan, and only against the environment named above.",
    );
  }
} catch (error) {
  if (error instanceof OrganisationLoadError) {
    console.error(`refused: ${error.code}`);
    if (error.detail) console.error(error.detail);
    process.exit(1);
  }
  throw error;
}
