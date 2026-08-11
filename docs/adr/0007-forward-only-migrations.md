# ADR-0007: Forward-only migrations and recovery posture

## Status

Accepted for Milestone 1.

## Context

`docs/MVP_BUILD_PLAN.md` requires migrations to be reviewed, forward-safe,
source-controlled, and tested, and asks each slice to state a rollback and
recovery approach. Encore applies numbered `*.up.sql` migrations in order; the
repository contains no `*.down.sql` files, and the absence of a documented
recovery position could be mistaken for an oversight.

## Decision

Migrations are forward-only. A mistake is corrected by a new numbered migration
that moves the schema forward, never by editing or reversing an applied one.
Data loss or a corrupt applied migration is recovered from a database backup for
the affected environment, not by a schema down-path.

Migrations must therefore be written to be safe to apply against existing data:
add columns nullable and backfill before constraining, validate with a trigger
or check rather than assuming clean input, and keep each migration independently
reviewable.

## Consequences

Applied history stays linear and auditable, and no environment can diverge by
partially reversing a migration. The cost is that a destructive migration cannot
be undone in place, which raises the review bar before merge — the CI schema and
integration gates run on every pull request for this reason.

Backup, restore, retention, and the environment-specific recovery runbook are
production operations concerns and remain deferred with ADR-0008. Milestone 1
runs only against local and synthetic data, where recovery means recreating the
local database.
