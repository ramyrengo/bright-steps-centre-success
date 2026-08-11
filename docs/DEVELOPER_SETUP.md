# Milestone 1 Developer Setup

## Prerequisites

- Node.js 20.9 or newer. The verified local runtime is Node.js 24.16.0.
- npm.
- Encore CLI 1.57.13 or newer.
- OrbStack, or another Docker-compatible runtime supported by Encore, running locally.

Confirm the active binaries before setup:

```sh
node --version
npm --version
encore version
docker version
```

If nvm is installed, run `nvm use` before npm commands. Matching `.nvmrc` files at the repository root and in `frontend/` select the verified runtime from either working directory.

If `encore version` resolves an older standalone installation while Homebrew has a newer security release, correct the shell `PATH` so the supported CLI is selected. On the verification workstation, `~/.encore/bin/encore` still resolves 1.57.5 while `/opt/homebrew/bin/encore` resolves the installed 1.57.13 security release; the latter was used for every final Encore gate. Do not work around an old CLI by changing the Encore App ID or recreating the application.

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

Run backend checks from the repository root:

```sh
npm run typecheck
encore test
npm audit
```

`encore test` supplies the Encore test infrastructure, applies migrations to an isolated database, and runs the API, audit-event, and pure authorisation tests.

Run frontend checks from `frontend/`:

```sh
npm run lint
npm run typecheck
npm run build
npm audit
```

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

Encore can use a containerised `psql` client when one is not installed locally. The repository contains no development seed, production data, credentials, Supabase configuration, or business-module tables.

## Current boundary

The only exposed API is the non-sensitive health endpoint. The principal, membership, role, capability, scope, and audit tables are foundation storage; they are not administrator CRUD APIs. Runtime authentication, protected APIs, and Milestone 2 business functionality require separate approval.

## Framework references

- [Next.js installation and supported Node.js baseline](https://nextjs.org/docs/app/getting-started/installation)
- [Encore SQL databases and migrations](https://encore.dev/docs/ts/primitives/databases)
- [Encore testing](https://encore.dev/docs/ts/develop/testing)
- [Encore CORS configuration](https://encore.dev/docs/ts/frontend/cors)
