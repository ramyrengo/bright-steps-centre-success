# Milestone 1 Developer Setup

## Prerequisites

- Node.js 20.9 or newer. The verified local runtime is Node.js 24.16.0.
- npm.
- Encore CLI 1.57.13 or newer.
- OrbStack, or another Docker-compatible runtime supported by Encore, running locally.

Diagnose every matching binary and confirm the active toolchain before setup:

```sh
type -a node npm encore
command -v node
command -v npm
command -v encore
node --version
npm --version
encore version
docker version
```

If nvm is installed, matching `.nvmrc` files at the repository root and in
`frontend/` select the verified runtime from either working directory:

```sh
nvm use
node --version
```

If `encore version` resolves an older standalone installation while Homebrew has
the verified version, keep the nvm-selected Node binary ahead of Homebrew while
selecting Homebrew's Encore for the current shell:

```sh
nvm use
verified_node_bin="$(dirname "$(command -v node)")"
export PATH="$verified_node_bin:/opt/homebrew/bin:$PATH"
hash -r
command -v node
node --version
command -v encore
encore version
```

On the verification workstation, `~/.encore/bin/encore` resolves 1.57.5 while
`/opt/homebrew/bin/encore` resolves the verified 1.57.13 release. Homebrew also
contains Node 18.20.8 on that workstation, so prepending Homebrew without first
preserving the nvm Node directory is unsafe for this project. The commands above
resolve Node 24.16.0 and Encore 1.57.13 and change only the current shell.
Persistent shell-profile changes are user-owned and should be reviewed before
editing. Do not work around an old CLI by changing the Encore App ID or
recreating the application.

## Install reviewed dependencies

From the repository root:

```sh
npm ci
cd frontend
npm ci
```

These install the dependency graphs already recorded in the two lockfiles. No secret or external identity-provider configuration is required for Milestone 1.

## Run locally

Start Encore from the repository root:

```sh
encore run
```

Encore builds the application graph, starts the `centre_success` PostgreSQL database through the local container runtime, and applies pending migrations. The public health endpoint is available at:

```text
http://localhost:4000/foundation/health
```

The local Encore dashboard is normally available at `http://localhost:9400`. It provides the API catalogue, infrastructure view, database explorer, and request traces.

In a second terminal, start Next.js:

```sh
cd frontend
npm run dev
```

Open `http://localhost:3000`. The shell calls the real Encore health endpoint through the generated client and displays backend/database availability. `NEXT_PUBLIC_ENCORE_API_URL` defaults to the generated client's local URL; copy `.env.example` to an untracked `.env.local` only when an explicit local override is needed.

Local CORS permits `http://localhost:3000` only. No wildcard origin, production origin, credentials, login, protected business API, or trusted test identity header is configured.

## Tests and quality checks

The repository separates pure policy tests from tests that require Encore's
isolated PostgreSQL infrastructure. Run from the repository root:

```sh
npm test
npm run test:unit
npm run test:integration
npm run test:backend
npm run test:frontend
npm run test:all
npm run typecheck
npm run lint
npm audit
npm --prefix frontend audit
```

`npm test` and `npm run test:unit` run the pure authorization policy without infrastructure. `npm run test:integration` invokes Encore with the integration Vitest configuration; Encore provisions an isolated PostgreSQL test database and applies every migration before running API, context/hierarchy, role, assignment, and audit tests. `npm run test:backend` runs both backend suites. `npm run test:all` adds frontend tests. Use these scripts rather than bare Vitest or an unconfigured `encore test`, so the intended suite and infrastructure are unambiguous.

Run frontend checks from `frontend/`:

```sh
npm run lint
npm run typecheck
npm test
npm run build
npm audit
```

The frontend tests cover only the foundation page and accessible
loading/success/error status behaviour. They do not simulate a business
dashboard or replace the local connected smoke test.

## Continuous integration

`.github/workflows/foundation-ci.yml` performs frozen root/frontend installs,
pins the Encore CLI, authenticates it with the required `ENCORE_AUTH_KEY`
GitHub Actions repository secret, verifies Docker, runs backend type checks and
both test suites, runs frontend lint/typecheck/tests/build, audits dependencies,
regenerates the Encore client, and fails on tracked repository drift. The auth
key must be a least-privilege Encore machine credential for this application;
never place its value in workflow YAML, source, logs, or a pull-request
variable. The workflow has read-only GitHub repository permission and contains
no deployment or production automation. A remote GitHub run is evidence only
after the workflow is committed, the secret is configured, and GitHub executes
the workflow.

## Generated API client

The reviewed generated client is committed at `frontend/src/lib/client.generated.ts`. After changing an exposed Encore API contract, regenerate it from `frontend/`:

```sh
npm run client:generate
```

The script generates only the `foundation` service client for the local Encore environment. Never hand-edit the generated file or manually duplicate its request/response contracts. Review and commit its diff with the backend contract change.

## Database access and behaviour

The database is declared in `foundation/db.ts`; migrations are in `foundation/migrations/`. Inspect the local database with:

```sh
encore db shell centre_success
```

Encore can use a containerised `psql` client when one is not installed locally. Migrations contain the foundation capability catalogue and canonical role templates; creating an organisation provisions role definitions but no principal, membership, assignment, employee, or access grant. The repository contains no development employee seed, production data, credentials, Supabase configuration, or business-module tables.

## Current boundary

The only exposed API is the non-sensitive health endpoint. The principal, membership, role, capability, scope, and audit tables are foundation storage; they are not administrator CRUD APIs. Runtime authentication, protected APIs, and Milestone 2 business functionality require separate approval.

## Framework references

- [Next.js installation and supported Node.js baseline](https://nextjs.org/docs/app/getting-started/installation)
- [Encore SQL databases and migrations](https://encore.dev/docs/ts/primitives/databases)
- [Encore testing](https://encore.dev/docs/ts/develop/testing)
- [Encore CI/CD](https://encore.dev/docs/ts/self-host/ci-cd)
- [Encore CORS configuration](https://encore.dev/docs/ts/frontend/cors)
- [Next.js Vitest testing](https://nextjs.org/docs/app/guides/testing/vitest)
