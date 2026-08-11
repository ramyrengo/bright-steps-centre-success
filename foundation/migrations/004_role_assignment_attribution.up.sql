ALTER TABLE role_assignments
    ADD COLUMN grant_source_type TEXT;

UPDATE role_assignments
SET grant_source_type = CASE
        WHEN granted_by_principal_id IS NULL THEN 'bootstrap'
        ELSE 'principal'
    END,
    reason = CASE
        WHEN char_length(btrim(reason)) = 0 THEN 'Migrated foundation assignment.'
        ELSE reason
    END;

ALTER TABLE role_assignments
    ALTER COLUMN grant_source_type SET NOT NULL,
    ALTER COLUMN reason DROP DEFAULT;

ALTER TABLE role_assignments
    ADD CONSTRAINT role_assignments_grant_source_check
        CHECK (grant_source_type IN ('principal', 'system', 'bootstrap')),
    ADD CONSTRAINT role_assignments_grant_actor_check
        CHECK (
            (grant_source_type = 'principal' AND granted_by_principal_id IS NOT NULL)
            OR (grant_source_type IN ('system', 'bootstrap') AND granted_by_principal_id IS NULL)
        ),
    ADD CONSTRAINT role_assignments_reason_check
        CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500);

CREATE FUNCTION validate_role_assignment_grantor()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.grant_source_type = 'principal' AND NOT EXISTS (
        SELECT 1
        FROM organisation_memberships
        WHERE organisation_id = NEW.organisation_id
          AND principal_id = NEW.granted_by_principal_id
          AND status = 'active'
          AND effective_from <= NEW.created_at
          AND (effective_to IS NULL OR effective_to > NEW.created_at)
    ) THEN
        RAISE EXCEPTION 'role-assignment grantor is not an active organisation member';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER role_assignments_validate_grantor
BEFORE INSERT OR UPDATE OF
    organisation_id,
    granted_by_principal_id,
    grant_source_type,
    created_at
ON role_assignments
FOR EACH ROW
EXECUTE FUNCTION validate_role_assignment_grantor();

