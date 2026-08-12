-- Provider-call reservations are committed before Microsoft Graph can be
-- reached. A reservation is permanently counted even if the worker crashes
-- before it can reconcile the provider result.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM people_notification_delivery_attempts
        WHERE attempt_number > 3
    ) THEN
        RAISE EXCEPTION 'existing invitation delivery attempts exceed the provider-attempt limit';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM people_notification_delivery_attempts
        GROUP BY outbox_id
        HAVING min(attempt_number) <> 1
            OR max(attempt_number) <> count(*)
    ) THEN
        RAISE EXCEPTION 'existing invitation delivery attempts are not a contiguous sequence';
    END IF;
END;
$$;

CREATE TABLE people_notification_provider_attempts (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL,
    outbox_id UUID NOT NULL,
    attempt_number INTEGER NOT NULL CHECK (attempt_number BETWEEN 1 AND 3),
    status TEXT NOT NULL CHECK (status IN (
        'RESERVED',
        'ACCEPTED',
        'RETRYABLE_FAILURE',
        'PERMANENT_FAILURE',
        'AMBIGUOUS',
        'NOT_SENT_AFTER_REVALIDATION'
    )),
    provider_reference TEXT,
    error_class TEXT,
    reserved_at TIMESTAMPTZ NOT NULL,
    lease_expires_at TIMESTAMPTZ NOT NULL,
    completed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL,
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (outbox_id, attempt_number),
    FOREIGN KEY (organisation_id, outbox_id)
        REFERENCES people_notification_outbox(organisation_id, id),
    CHECK (lease_expires_at >= reserved_at),
    CHECK (completed_at IS NULL OR completed_at >= reserved_at),
    CHECK (provider_reference IS NULL OR char_length(btrim(provider_reference)) BETWEEN 1 AND 200),
    CHECK (error_class IS NULL OR error_class ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    CHECK (
        (status = 'RESERVED' AND completed_at IS NULL)
        OR (status <> 'RESERVED' AND completed_at IS NOT NULL)
    )
);

CREATE INDEX people_notification_provider_attempts_stale_idx
    ON people_notification_provider_attempts (status, lease_expires_at)
    WHERE status = 'RESERVED';

-- Preserve any pre-migration provider-attempt history as consumed slots.
INSERT INTO people_notification_provider_attempts (
    id,
    organisation_id,
    outbox_id,
    attempt_number,
    status,
    provider_reference,
    error_class,
    reserved_at,
    lease_expires_at,
    completed_at,
    updated_at
)
SELECT
    gen_random_uuid(),
    organisation_id,
    outbox_id,
    attempt_number,
    CASE status
        WHEN 'DELIVERED' THEN 'ACCEPTED'
        WHEN 'RETRYABLE_FAILURE' THEN 'RETRYABLE_FAILURE'
        WHEN 'PERMANENT_FAILURE' THEN 'PERMANENT_FAILURE'
        ELSE 'AMBIGUOUS'
    END,
    provider_reference,
    CASE
        WHEN status = 'DUPLICATE' THEN COALESCE(error_class, 'provider_attempt_ambiguous')
        ELSE error_class
    END,
    attempted_at,
    attempted_at,
    attempted_at,
    attempted_at
FROM people_notification_delivery_attempts;

ALTER TABLE people_notification_delivery_attempts
    DROP CONSTRAINT people_notification_delivery_attempts_status_check;

ALTER TABLE people_notification_delivery_attempts
    ADD CONSTRAINT people_notification_delivery_attempts_status_check
    CHECK (status IN (
        'DELIVERED',
        'RETRYABLE_FAILURE',
        'PERMANENT_FAILURE',
        'DUPLICATE',
        'AMBIGUOUS',
        'NOT_SENT_AFTER_REVALIDATION'
    )),
    ADD CONSTRAINT people_notification_delivery_attempts_provider_reservation_fk
    FOREIGN KEY (outbox_id, attempt_number)
        REFERENCES people_notification_provider_attempts(outbox_id, attempt_number);

CREATE FUNCTION guard_people_notification_provider_attempt_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'people_notification_provider_attempts cannot be deleted';
    END IF;

    IF OLD.organisation_id IS DISTINCT FROM NEW.organisation_id
       OR OLD.outbox_id IS DISTINCT FROM NEW.outbox_id
       OR OLD.attempt_number IS DISTINCT FROM NEW.attempt_number
       OR OLD.reserved_at IS DISTINCT FROM NEW.reserved_at
       OR OLD.lease_expires_at IS DISTINCT FROM NEW.lease_expires_at THEN
        RAISE EXCEPTION 'provider-attempt reservation identity and lease are immutable';
    END IF;

    IF OLD.status <> 'RESERVED' OR NEW.status = 'RESERVED' THEN
        RAISE EXCEPTION 'provider-attempt outcome is terminal';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER people_notification_provider_attempts_guard
BEFORE UPDATE OR DELETE ON people_notification_provider_attempts
FOR EACH ROW EXECUTE FUNCTION guard_people_notification_provider_attempt_mutation();

CREATE FUNCTION validate_people_notification_provider_attempt_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    expected_attempt_number INTEGER;
BEGIN
    -- Serialize every reservation sequence on its owning outbox row. This
    -- makes the database, rather than only the application worker, reject
    -- duplicate, skipped and fourth provider-call reservations.
    PERFORM 1
    FROM people_notification_outbox
    WHERE id = NEW.outbox_id
    FOR UPDATE;

    SELECT COALESCE(max(attempt_number), 0) + 1
    INTO expected_attempt_number
    FROM people_notification_provider_attempts
    WHERE outbox_id = NEW.outbox_id;

    IF NEW.attempt_number <> expected_attempt_number THEN
        RAISE EXCEPTION 'provider-attempt reservation must be the next contiguous attempt';
    END IF;
    IF NEW.attempt_number > 3 THEN
        RAISE EXCEPTION 'provider-attempt reservation limit exhausted';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER people_notification_provider_attempts_sequence
BEFORE INSERT ON people_notification_provider_attempts
FOR EACH ROW EXECUTE FUNCTION validate_people_notification_provider_attempt_insert();

-- Dispatch claims are durable leases. Existing PUBLISHED rows are returned to
-- PENDING once during migration so that no pre-migration publication can be
-- stranded without an expiring lease.
ALTER TABLE people_notification_outbox
    ADD COLUMN dispatch_lease_id UUID,
    ADD COLUMN dispatch_lease_expires_at TIMESTAMPTZ;

UPDATE people_notification_outbox
SET status = 'PENDING',
    next_attempt_at = LEAST(next_attempt_at, now()),
    updated_at = now(),
    lock_version = lock_version + 1
WHERE status = 'PUBLISHED';

ALTER TABLE people_notification_outbox
    ADD CONSTRAINT people_notification_outbox_dispatch_lease_check
    CHECK (
        (
            status = 'PUBLISHED'
            AND dispatch_lease_id IS NOT NULL
            AND dispatch_lease_expires_at IS NOT NULL
        )
        OR
        (
            status <> 'PUBLISHED'
            AND dispatch_lease_id IS NULL
            AND dispatch_lease_expires_at IS NULL
        )
    );

CREATE INDEX people_notification_outbox_stale_dispatch_idx
    ON people_notification_outbox (dispatch_lease_expires_at, created_at)
    WHERE status = 'PUBLISHED';
