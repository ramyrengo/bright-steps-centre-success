import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

/**
 * Fails the build when application code declares an Encore secret that is not
 * configured for the environment types a deploy needs.
 *
 * Milestone 2A and Milestone 2C each shipped a new `secret()` declaration that
 * nobody configured in Encore Cloud. Both passed every gate and then failed at
 * deploy time with `secret key(s) not defined`, because no check compared the
 * declarations in the repository against the values in the account. This guard
 * closes that gap on the pull request instead of in a deploy log.
 *
 * A secret may be deliberately unconfigured. Record it in DEFERRED_SECRETS with
 * the decision that governs it; the guard then also fails if such a secret is
 * later configured, or if it disappears from the code, so the list cannot drift
 * out of step with reality.
 */

const SELF = ".github/scripts/secret-configuration-guard.mjs";
const SOURCE_PREFIX = "foundation/";
const REQUIRED_ENVIRONMENT_TYPES = ["development", "preview"];
const SECRET_DECLARATION = /\bsecret\(\s*"([A-Za-z][A-Za-z0-9_]*)"\s*\)/gu;

/** Secrets intentionally left unconfigured, each with its governing record. */
const DEFERRED_SECRETS = new Map([
  [
    "InvitationPublicBaseUrl",
    "no approved Development/Preview frontend origin exists; see docs/adr/0008-production-cors-and-deployment.md",
  ],
]);

function isSourceFile(file) {
  return (
    file.startsWith(SOURCE_PREFIX) &&
    file.endsWith(".ts") &&
    !file.includes(".test.") &&
    file !== SELF
  );
}

function declaredSecrets() {
  const output = execFileSync("git", ["ls-files", "-co", "--exclude-standard", "-z"], {
    encoding: "buffer",
  });
  const declarations = new Map();
  for (const file of output.toString("utf8").split("\0").filter(Boolean)) {
    if (!isSourceFile(file)) continue;
    try {
      if (!statSync(file).isFile()) continue;
    } catch {
      continue;
    }
    const contents = readFileSync(file, "utf8");
    for (const match of contents.matchAll(SECRET_DECLARATION)) {
      const sites = declarations.get(match[1]) ?? [];
      sites.push(file);
      declarations.set(match[1], sites);
    }
  }
  return declarations;
}

/**
 * Reads `encore secret list <keys...>`, whose rows are
 * `ID  Secret Key  Environment(s)` separated by runs of spaces. Key matching is
 * exact, so a row can only describe a key that was asked for.
 */
function configuredEnvironmentTypes(names) {
  if (names.length === 0) return new Map();
  let output;
  try {
    output = execFileSync("encore", ["secret", "list", ...names], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    console.error("Unable to read Encore secret configuration.");
    console.error("Authenticate the Encore CLI before running this guard.");
    console.error(detail.split("\n")[0]);
    process.exit(1);
  }

  const configured = new Map();
  for (const line of output.split("\n").slice(1)) {
    const columns = line.trim().split(/\s{2,}/u);
    if (columns.length < 3) continue;
    const [, key, environments] = columns;
    const types = configured.get(key) ?? new Set();
    for (const environment of environments.split(",")) {
      const value = environment.trim();
      if (value.startsWith("type:")) types.add(value.slice("type:".length));
    }
    configured.set(key, types);
  }
  return configured;
}

function main() {
  const declarations = declaredSecrets();
  if (declarations.size === 0) {
    console.error("No Encore secret declarations found; the guard is not matching source files.");
    process.exit(1);
  }

  const configured = configuredEnvironmentTypes([...declarations.keys()]);
  const problems = [];

  for (const [name, sites] of declarations) {
    const types = configured.get(name) ?? new Set();
    const missing = REQUIRED_ENVIRONMENT_TYPES.filter((type) => !types.has(type));
    const deferral = DEFERRED_SECRETS.get(name);

    if (deferral && missing.length === 0) {
      problems.push(
        `${name} is recorded as deliberately unconfigured but is now set for ` +
          `${REQUIRED_ENVIRONMENT_TYPES.join(" and ")}. Remove it from DEFERRED_SECRETS in ${SELF}.`,
      );
      continue;
    }
    if (deferral) continue;
    if (missing.length === 0) continue;

    problems.push(
      `${name} is declared in ${[...new Set(sites)].join(", ")} but is not configured for ` +
        `${missing.join(" and ")}. Set it with \`encore secret set --type ${missing.join(",")} ${name}\`, ` +
        `or record the deferral with its governing decision in ${SELF}.`,
    );
  }

  for (const [name, reason] of DEFERRED_SECRETS) {
    if (declarations.has(name)) continue;
    problems.push(
      `${name} is recorded as deliberately unconfigured (${reason}) but no longer appears in ${SOURCE_PREFIX}. ` +
        `Remove the stale entry from DEFERRED_SECRETS in ${SELF}.`,
    );
  }

  if (problems.length > 0) {
    console.error("Encore secret configuration guard failed.\n");
    for (const problem of problems) console.error(`- ${problem}`);
    console.error(
      "\nA declared secret that is not configured passes every build check and then " +
        "fails the deploy with `secret key(s) not defined`.",
    );
    process.exit(1);
  }

  const deferred = [...DEFERRED_SECRETS.keys()].filter((name) => declarations.has(name));
  console.log(
    `Encore secret configuration guard passed. ${declarations.size} declared secret(s) checked for ` +
      `${REQUIRED_ENVIRONMENT_TYPES.join(" and ")}` +
      (deferred.length > 0 ? `; deliberately unconfigured: ${deferred.join(", ")}.` : "."),
  );
}

main();
