import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";

const SELF = ".github/scripts/auth-scope-guard.mjs";
const ADR_0011 =
  "docs/adr/0011-clerk-authentication-centre-success-authorisation.md";

function repositoryFiles() {
  const output = execFileSync(
    "git",
    ["ls-files", "-co", "--exclude-standard", "-z"],
    { encoding: "buffer" },
  );

  return [...new Set(output.toString("utf8").split("\0").filter(Boolean))]
    .filter((file) => file !== SELF)
    .filter((file) => {
      try {
        return statSync(file).isFile();
      } catch {
        return false;
      }
    });
}

function isDocumentation(file) {
  return (
    file === "AGENTS.md" ||
    file === "README.md" ||
    file.startsWith("docs/") ||
    /^MILESTONE_\d.*\.md$/u.test(file)
  );
}

function isHistoricalDocument(file) {
  return file === ADR_0011 || /^MILESTONE_\d.*\.md$/u.test(file);
}

function isDependencyLock(file) {
  return /(^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml)$/u.test(
    file,
  );
}

function isTestOrFixture(file) {
  return (
    /(^|\/)(?:__tests__|tests?|fixtures?)(\/|$)/u.test(file) ||
    /\.(?:test|spec)\.[^/]+$/u.test(file)
  );
}

function readText(file) {
  const content = readFileSync(file);
  if (content.includes(0)) {
    return null;
  }
  return content.toString("utf8");
}

function lineNumberAt(content, index) {
  return content.slice(0, index).split("\n").length;
}

const files = repositoryFiles();
const sourceFiles = files.filter(
  (file) => !isDocumentation(file) && !isDependencyLock(file),
);
const productionFiles = sourceFiles.filter((file) => !isTestOrFixture(file));
const frontendProductionFiles = productionFiles.filter((file) =>
  file.startsWith("frontend/"),
);
const migrationFiles = productionFiles.filter((file) =>
  file.startsWith("foundation/migrations/"),
);
const environmentExampleFiles = productionFiles.filter((file) =>
  /(^|\/)\.env\.example$/u.test(file),
);

const violations = [];

function report(file, label, content, index) {
  violations.push(`${file}:${lineNumberAt(content, index)} [${label}]`);
}

function scan(filesToScan, label, pattern, { inspectPath = false } = {}) {
  for (const file of filesToScan) {
    if (inspectPath) {
      pattern.lastIndex = 0;
      const pathMatch = pattern.exec(file);
      if (pathMatch !== null) {
        violations.push(`${file}:1 [${label}] prohibited path`);
        continue;
      }
    }

    const content = readText(file);
    if (content === null) {
      continue;
    }

    pattern.lastIndex = 0;
    const match = pattern.exec(content);
    if (match !== null) {
      report(file, label, content, match.index);
    }
  }
}

scan(sourceFiles, "Clerk runtime/source/config", /clerk/giu, {
  inspectPath: true,
});

scan(
  sourceFiles,
  "Microsoft Graph SDK",
  /@microsoft\/microsoft-graph-client|@microsoftgraph\/|\bMicrosoft\.Graph\b/giu,
);

scan(
  productionFiles,
  "Microsoft Graph source path",
  /(?:^|\/)(?:microsoft[-_.]?graph|msgraph|graph[-_.]?(?:api|client))(?:[./_-]|$)/giu,
  { inspectPath: true },
);

scan(
  productionFiles,
  "Microsoft Graph endpoint or User.Read scope",
  /https?:\/\/[^\s"']*graph\.microsoft\.(?:com|us)\b|\bUser\.Read[A-Za-z]*(?:\.[A-Za-z]+)*\b/giu,
);

scan(
  productionFiles,
  "client secret configuration",
  /\bclient[_-]?secret\b|\bclientSecret\b|\bNEXT_PUBLIC_[A-Z0-9_]*SECRET\b/gu,
  { inspectPath: true },
);

scan(
  productionFiles,
  "authentication bypass or trusted identity header",
  /\b(?:SKIP_AUTH|AUTH_BYPASS|BYPASS_AUTH|DISABLE_AUTH|AUTH_DISABLED|TRUST_AUTH_HEADER|TRUSTED_IDENTITY_HEADER|TRUSTED_USER_HEADER|TRUSTED_PRINCIPAL_HEADER)\b|\bX-(?:Trusted-|Test-)?(?:User|Principal|Identity)(?:-Id)?\b/giu,
);

scan(
  productionFiles,
  "fake or development authentication path",
  /(?:^|\/)(?:fake|mock|dev|development)[_-]?(?:auth|login)(?:[./_-]|$)/giu,
  { inspectPath: true },
);

scan(
  productionFiles,
  "arbitrary Entra scope configuration",
  /\bNEXT_PUBLIC_(?:ENTRA|AZURE|MSAL)[A-Z0-9_]*SCOPE[A-Z0-9_]*\b|\bprocess\.env\.(?:ENTRA|AZURE|MSAL)[A-Z0-9_]*SCOPE[A-Z0-9_]*\b|\bsecret\s*\(\s*["']Entra[A-Za-z0-9]*Scope[A-Za-z0-9]*["']/gu,
);

scan(
  environmentExampleFiles,
  "arbitrary Entra scope environment variable",
  /^(?:ENTRA|AZURE|MSAL)[A-Z0-9_]*SCOPE[A-Z0-9_]*\s*=/gmu,
);

scan(
  frontendProductionFiles,
  "manual browser token storage",
  /(?:localStorage|sessionStorage)\s*\.\s*(?:setItem|getItem)\s*\([^\n;]*(?:access[_-]?token|id[_-]?token|refresh[_-]?token|bearer|authorization)|(?:accessToken|idToken|refreshToken|bearer|authorization)[^\n;]*(?:localStorage|sessionStorage)\s*\./giu,
);

scan(
  frontendProductionFiles,
  "custom authentication token cache path",
  /(?:^|\/)(?:token|auth)[_-]?(?:store|storage|cache)(?:[./_-]|$)/giu,
  { inspectPath: true },
);

scan(
  frontendProductionFiles,
  "token in cookie or URL",
  /document\.cookie[^\n;]*(?:token|bearer|authorization)|(?:access[_-]?token|id[_-]?token|refresh[_-]?token)[^\n;]*(?:URLSearchParams|location\.(?:href|search)|router\.(?:push|replace))/giu,
);

scan(
  productionFiles,
  "authentication token logging",
  /(?:console|log|logger)\s*\.\s*(?:debug|log|info|warn|error)\s*\([^\n;]*(?:accessToken|idToken|refreshToken|bearer|authorization)/giu,
);

scan(
  frontendProductionFiles,
  "cookie credential mode",
  /\bcredentials\s*:\s*["']include["']|\bwithCredentials\s*:\s*true\b|\bstoreAuthStateInCookie\s*:\s*true\b/giu,
);

scan(
  migrationFiles,
  "authentication token persistence column",
  /\b(?:access|refresh|id)_token\b/giu,
);

scan(
  productionFiles,
  "authentication token database write",
  /(?:INSERT\s+INTO|UPDATE|CREATE\s+TABLE|ALTER\s+TABLE)[\s\S]{0,500}\b(?:access|refresh|id)_token\b/giu,
);

const allowedClerkHistoryLines = new Map([
  [
    "docs/adr/0012-microsoft-entra-id-single-tenant-authentication.md",
    [/Clerk as another identity layer/u],
  ],
  [
    "docs/adr/README.md",
    [/ADR-0011: Clerk authentication.*superseded by ADR-0012/u],
  ],
  [
    "docs/DEVELOPER_SETUP.md",
    [/no Clerk runtime package may remain/u],
  ],
]);

for (const file of files.filter(isDocumentation)) {
  if (isHistoricalDocument(file)) {
    continue;
  }

  const content = readText(file);
  if (content === null) {
    continue;
  }

  for (const [index, line] of content.split("\n").entries()) {
    if (!/clerk/iu.test(line)) {
      continue;
    }

    const allowed = (allowedClerkHistoryLines.get(file) ?? []).some((pattern) =>
      pattern.test(line),
    );
    if (!allowed) {
      violations.push(
        `${file}:${index + 1} [stale Clerk documentation]`,
      );
    }
  }
}

if (violations.length > 0) {
  console.error("Authentication scope guardrails failed:\n");
  for (const violation of violations) {
    console.error(`- ${violation}`);
  }
  console.error(
    "\nRemove the prohibited runtime/configuration or explicitly preserve genuine decision history in the reviewed allowlist.",
  );
  process.exit(1);
}

console.log("Authentication scope guardrails passed.");
