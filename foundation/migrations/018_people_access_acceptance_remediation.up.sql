-- Coalesce the last-reachable-administrator check to one deferred validation
-- per affected organisation and transaction. The advisory lock is still
-- acquired before the first affected row is changed, preserving the
-- concurrent-removal invariant without re-running the reachability query for
-- every row touched by a bulk mutation.
CREATE TABLE people_admin_guard_validation_queue (
    transaction_id BIGINT NOT NULL,
    organisation_id UUID NOT NULL,
    queued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (transaction_id, organisation_id)
);

CREATE OR REPLACE FUNCTION lock_people_admin_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_organisation UUID;
    validation_was_queued BOOLEAN;
BEGIN
    IF TG_OP <> 'DELETE' THEN
        FOR target_organisation IN
            SELECT DISTINCT organisation_id
            FROM people_admin_guard_organisation_ids(to_jsonb(NEW), TG_TABLE_NAME) AS organisation_id
            ORDER BY organisation_id
        LOOP
            validation_was_queued := FALSE;
            INSERT INTO people_admin_guard_validation_queue (
                transaction_id,
                organisation_id
            ) VALUES (
                txid_current(),
                target_organisation
            )
            ON CONFLICT DO NOTHING
            RETURNING TRUE INTO validation_was_queued;

            IF validation_was_queued THEN
                PERFORM pg_advisory_xact_lock(
                    hashtextextended(target_organisation::TEXT, 20503)
                );
            END IF;
        END LOOP;
    END IF;

    IF TG_OP <> 'INSERT' THEN
        FOR target_organisation IN
            SELECT DISTINCT organisation_id
            FROM people_admin_guard_organisation_ids(to_jsonb(OLD), TG_TABLE_NAME) AS organisation_id
            ORDER BY organisation_id
        LOOP
            validation_was_queued := FALSE;
            INSERT INTO people_admin_guard_validation_queue (
                transaction_id,
                organisation_id
            ) VALUES (
                txid_current(),
                target_organisation
            )
            ON CONFLICT DO NOTHING
            RETURNING TRUE INTO validation_was_queued;

            IF validation_was_queued THEN
                PERFORM pg_advisory_xact_lock(
                    hashtextextended(target_organisation::TEXT, 20503)
                );
            END IF;
        END LOOP;
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER organisations_enforce_people_admin_guard ON organisations;
DROP TRIGGER principals_enforce_people_admin_guard ON principals;
DROP TRIGGER mappings_enforce_people_admin_guard ON external_identity_mappings;
DROP TRIGGER memberships_enforce_people_admin_guard ON organisation_memberships;
DROP TRIGGER assignments_enforce_people_admin_guard ON role_assignments;
DROP TRIGGER scopes_enforce_people_admin_guard ON assignment_scopes;
DROP TRIGGER definitions_enforce_people_admin_guard ON role_definitions;
DROP TRIGGER capabilities_enforce_people_admin_guard ON role_capabilities;

DROP FUNCTION enforce_people_admin_guard();

CREATE FUNCTION enforce_queued_people_admin_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    reachable_count INTEGER;
    protection_enabled BOOLEAN;
BEGIN
    -- The first affected row already acquired this transaction-scoped lock.
    -- Reacquiring it is harmless and keeps direct queue inserts fail-safe.
    PERFORM pg_advisory_xact_lock(
        hashtextextended(NEW.organisation_id::TEXT, 20503)
    );

    INSERT INTO organisation_access_invariants (organisation_id)
    SELECT NEW.organisation_id
    FROM organisations
    WHERE id = NEW.organisation_id
    ON CONFLICT DO NOTHING;

    SELECT last_administrator_protection_enabled
    INTO protection_enabled
    FROM organisation_access_invariants
    WHERE organisation_id = NEW.organisation_id
    FOR UPDATE;

    IF NOT FOUND THEN
        DELETE FROM people_admin_guard_validation_queue
        WHERE transaction_id = NEW.transaction_id
          AND organisation_id = NEW.organisation_id;
        RETURN NULL;
    END IF;

    SELECT reachable_system_administrator_count(NEW.organisation_id)
    INTO reachable_count;

    IF reachable_count > 0 AND NOT protection_enabled THEN
        UPDATE organisation_access_invariants
        SET last_administrator_protection_enabled = TRUE,
            enabled_at = now(),
            updated_at = now()
        WHERE organisation_id = NEW.organisation_id;
    ELSIF reachable_count = 0 AND protection_enabled THEN
        RAISE EXCEPTION 'mutation would remove the last reachable System Administrator';
    END IF;

    DELETE FROM people_admin_guard_validation_queue
    WHERE transaction_id = NEW.transaction_id
      AND organisation_id = NEW.organisation_id;

    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER people_admin_guard_validate_once
AFTER INSERT ON people_admin_guard_validation_queue
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION enforce_queued_people_admin_guard();

-- Successful delivery is terminal and idempotent, so the recoverable
-- invitation credential is no longer needed. Preserve delivery metadata while
-- erasing the ciphertext. Retryable and unpublished rows must retain a complete
-- encrypted credential tuple.
ALTER TABLE people_notification_outbox
    ALTER COLUMN encrypted_token DROP NOT NULL,
    ALTER COLUMN encryption_iv DROP NOT NULL,
    ALTER COLUMN encryption_tag DROP NOT NULL;

UPDATE people_notification_outbox
SET encrypted_token = NULL,
    encryption_iv = NULL,
    encryption_tag = NULL,
    updated_at = now(),
    lock_version = lock_version + 1
WHERE status = 'DELIVERED';

ALTER TABLE people_notification_outbox
    ADD CONSTRAINT people_notification_outbox_delivery_material_check
    CHECK (
        (
            status = 'DELIVERED'
            AND encrypted_token IS NULL
            AND encryption_iv IS NULL
            AND encryption_tag IS NULL
        )
        OR
        (
            status <> 'DELIVERED'
            AND encrypted_token IS NOT NULL
            AND encryption_iv IS NOT NULL
            AND encryption_tag IS NOT NULL
        )
    );
