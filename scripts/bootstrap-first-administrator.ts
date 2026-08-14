import { parseArgs } from "node:util";
import { appMeta } from "encore.dev";
import { loadRuntimeEntraVerificationConfig } from "../foundation/authentication/entra-configuration";
import {
  formatFirstAdministratorCeremonyReport,
  FirstAdministratorCeremonyError,
  runFirstAdministratorCeremony,
} from "../foundation/authentication/first-administrator-ceremony";

/**
 * Production first-administrator ceremony — ADR-0021 D5.
 *
 * Out-of-band operator tooling only. It is run through `encore exec`, defines no
 * API, is reachable from no browser, and appears in no generated client. Every
 * identifying value is supplied on the command line at run time; nothing about a
 * real person is committed to this repository.
 *
 * Dry run is the default and writes nothing. `--apply` commits, and refuses
 * outside the reviewed environments; production additionally requires
 * `--confirm-production-first-administrator`.
 *
 *   npm run admin:bootstrap:dry-run -- \
 *     --environment=staging \
 *     --organisation-id=<uuid> \
 *     --tenant-id=<entra tid> \
 *     --oid=<entra oid> \
 *     --display-name="<the administrator's name>" \
 *     --reason="<approved change record>"
 *
 *   npm run admin:bootstrap:apply -- ... [--confirm-production-first-administrator]
 *
 * Running `--apply` is a separate, human-approved step. Do not run it because a
 * dry run looked correct; run it because a human approved that dry run.
 */

const { values } = parseArgs({
  allowPositionals: false,
  // Strict parsing means a typo refuses rather than silently defaulting. On the
  // most privileged operation in the system, an unrecognised flag must be an
  // error, never an ignored argument.
  strict: true,
  options: {
    environment: { type: "string" },
    "organisation-id": { type: "string" },
    "tenant-id": { type: "string" },
    oid: { type: "string" },
    "display-name": { type: "string" },
    reason: { type: "string" },
    apply: { type: "boolean" },
    "confirm-production-first-administrator": { type: "boolean" },
  },
});

const required = [
  "environment",
  "organisation-id",
  "tenant-id",
  "oid",
  "display-name",
  "reason",
] as const;

const missing = required.filter(
  (flag) => (values[flag] ?? "").trim().length === 0,
);

if (missing.length > 0) {
  console.error(
    `refused: missing required operator input: ${missing.map((flag) => `--${flag}`).join(", ")}.\n` +
      "This ceremony discovers nobody. The target environment, the target\n" +
      "organisation, and the first administrator's Entra tid + oid are all\n" +
      "supplied out of band by the operator, and none of them has a default.",
  );
  process.exit(2);
}

const environment = appMeta().environment;
const tenantId = values["tenant-id"] ?? "";
const oid = values.oid ?? "";

try {
  const report = await runFirstAdministratorCeremony(
    {
      declaredEnvironment: values.environment ?? "",
      organisationId: values["organisation-id"] ?? "",
      tenantId,
      oid,
      displayName: values["display-name"] ?? "",
      reason: values.reason ?? "",
      apply: values.apply === true,
      confirmProduction:
        values["confirm-production-first-administrator"] === true,
    },
    {
      environment,
      configuredTenantId: loadRuntimeEntraVerificationConfig().tenantId,
    },
  );

  console.info(
    formatFirstAdministratorCeremonyReport(report, { tenantId, oid }),
  );

  if (report.mode === "dry_run") {
    console.info("");
    console.info(
      "Nothing was written. Re-run with --apply once a human has reviewed and\n" +
        "approved this plan, and only against the environment named above.",
    );
  }
} catch (error) {
  if (error instanceof FirstAdministratorCeremonyError) {
    console.error(`refused: ${error.code}`);
    if (error.detail) console.error(error.detail);
    process.exit(1);
  }
  throw error;
}
