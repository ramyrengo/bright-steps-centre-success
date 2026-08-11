ALTER TABLE assignment_scopes
    ADD COLUMN effective_from TIMESTAMPTZ,
    ADD COLUMN effective_to TIMESTAMPTZ;

UPDATE assignment_scopes AS scope
SET
    effective_from = assignment.effective_from,
    effective_to = assignment.effective_to
FROM role_assignments AS assignment
WHERE assignment.organisation_id = scope.organisation_id
  AND assignment.id = scope.role_assignment_id;

ALTER TABLE assignment_scopes
    ALTER COLUMN effective_from SET NOT NULL,
    ALTER COLUMN effective_from SET DEFAULT now(),
    ADD CONSTRAINT assignment_scopes_effective_window_check
        CHECK (effective_to IS NULL OR effective_to > effective_from);

CREATE FUNCTION validate_assignment_scope_effective_window()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    assignment_from TIMESTAMPTZ;
    assignment_to TIMESTAMPTZ;
BEGIN
    SELECT effective_from, effective_to
    INTO assignment_from, assignment_to
    FROM role_assignments
    WHERE organisation_id = NEW.organisation_id
      AND id = NEW.role_assignment_id;

    IF assignment_from IS NULL
       OR NEW.effective_from < assignment_from
       OR (
           assignment_to IS NOT NULL
           AND (NEW.effective_to IS NULL OR NEW.effective_to > assignment_to)
       ) THEN
        RAISE EXCEPTION 'assignment scope must remain within its role-assignment window';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER assignment_scopes_validate_effective_window
BEFORE INSERT OR UPDATE OF
    organisation_id,
    role_assignment_id,
    effective_from,
    effective_to
ON assignment_scopes
FOR EACH ROW
EXECUTE FUNCTION validate_assignment_scope_effective_window();

CREATE FUNCTION validate_role_assignment_scope_windows()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM assignment_scopes
        WHERE organisation_id = NEW.organisation_id
          AND role_assignment_id = NEW.id
          AND (
              effective_from < NEW.effective_from
              OR (
                  NEW.effective_to IS NOT NULL
                  AND (effective_to IS NULL OR effective_to > NEW.effective_to)
              )
          )
    ) THEN
        RAISE EXCEPTION 'role-assignment window cannot exclude an existing scope window';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER role_assignments_validate_scope_windows
BEFORE UPDATE OF organisation_id, effective_from, effective_to
ON role_assignments
FOR EACH ROW
EXECUTE FUNCTION validate_role_assignment_scope_windows();
