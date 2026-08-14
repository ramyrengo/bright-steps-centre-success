import { appMeta } from "encore.dev";
import {
  formatOrganisationLoadReport,
  loadBrightStepsOrganisationReference,
  OrganisationLoadError,
} from "../foundation/organisation-reference/organisation-load";

/**
 * Reviewed organisation reference load — ADR-0021 Stage 7.
 *
 * Dry run is the default and writes nothing. `--apply` commits, and refuses
 * outside local development. The organisation default timezone has no default
 * value: it is operator input the Product Owner must confirm.
 *
 *   npm run organisation:load:dry-run -- --organisation-timezone=Australia/Sydney
 *   npm run organisation:load:apply   -- --organisation-timezone=Australia/Sydney
 */

const TIMEZONE_FLAG = "--organisation-timezone=";

const argv = process.argv.slice(2);
const apply = argv.includes("--apply");
const organisationTimezone = argv
  .find((argument) => argument.startsWith(TIMEZONE_FLAG))
  ?.slice(TIMEZONE_FLAG.length) ?? "";

if (organisationTimezone.trim().length === 0) {
  console.error(
    "refused: --organisation-timezone=<IANA zone> is required.\n" +
      "organisations.default_timezone drives the organisation business date in\n" +
      "Daily Success and Centre Quality. The approved Bright Steps dataset does\n" +
      "not state it, so it is an explicit Product Owner decision rather than an\n" +
      "engineering default.",
  );
  process.exit(2);
}

try {
  const report = await loadBrightStepsOrganisationReference({
    organisationTimezone,
    apply,
    environment: appMeta().environment,
  });
  console.info(formatOrganisationLoadReport(report));
  if (report.mode === "dry_run") {
    console.info("");
    console.info(
      "Re-run with --apply once a human has reviewed and approved this plan.",
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
