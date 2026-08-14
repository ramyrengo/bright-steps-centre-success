-- Register the four `template.*` capability codes on any database that never
-- applied migration 024.
--
-- Migration 024 registers these codes and migration 030 grants them to the
-- canonical Area Manager version 3, where `canonical_role_template_capabilities
-- .capability_code` carries `REFERENCES capabilities(code)`. On a database
-- created from scratch that pairing is sound: 001-031 apply in order, 024 runs,
-- and 030 finds its four rows.
--
-- It is not sound on every database. `main` carried 001-019 and then jumped
-- straight to 026, 027, 028 and 029; 020-025 were only merged afterwards, below
-- a version those databases had already passed. golang-migrate tracks a single
-- watermark and applies only versions above it, so on any database that reached
-- 26 or beyond before 020-025 existed, those six migrations are permanently
-- below the waterline and will never run. Staging is such a database: its
-- `schema_migrations` version is 29, and 030 therefore ran against a schema
-- where `template.*` had never been registered, failing on the foreign key.
--
-- This migration closes the capability half of that gap. It is idempotent: on a
-- fresh database 024 has already inserted all four rows and every INSERT here is
-- a no-op, and the descriptions are held identical to 024's so the two paths
-- cannot drift.
--
-- Scope and ordering, stated plainly so this file is not mistaken for a fix it
-- is not. A migration numbered 032 is applied *after* 030, so it cannot unblock
-- the 030 failure on a database still sitting at version 29 — golang-migrate
-- reaches 030 first and stops there. Nothing numbered above 031 can run earlier
-- than 030. Restoring a stranded database is therefore an operational step that
-- has to happen before the deploy, not a migration; the harness at
-- `scripts/simulate-migration-waterline.sh` reproduces the stranded shape and
-- exercises that repair. What this migration guarantees is the end state: once a
-- database reaches version 32 by any route, the four codes exist.

INSERT INTO capabilities (code, description) VALUES
    ('template.read', 'View published operational templates and authorised assignment context.'),
    ('template.create', 'Create and edit owned operational template drafts within an authorised scope.'),
    ('template.publish', 'Publish or retire owned operational templates within an authorised scope.'),
    ('template.assign', 'Assign published operational templates to authorised centres or a resolved portfolio.')
ON CONFLICT (code) DO NOTHING;

-- Fail closed rather than leave a later grant to discover the gap through a
-- foreign key error. If the vocabulary is still incomplete here, the assumption
-- this migration exists to guarantee is wrong.
DO $$
DECLARE
    registered INTEGER;
BEGIN
    SELECT count(*)
    INTO registered
    FROM capabilities
    WHERE code IN ('template.read', 'template.create', 'template.publish', 'template.assign');

    IF registered <> 4 THEN
        RAISE EXCEPTION
            'expected the four operational template capability codes to be registered, found %',
            registered;
    END IF;
END;
$$;
