CREATE FUNCTION validate_system_audit_event_scope()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.scope_type = 'system' THEN
        IF NEW.organisation_id IS NOT NULL OR NEW.scope_id IS NOT NULL THEN
            RAISE EXCEPTION 'system audit scope cannot include organisation or scope IDs';
        END IF;
    ELSE
        IF NEW.organisation_id IS NULL OR NEW.scope_id IS NULL THEN
            RAISE EXCEPTION 'tenant audit scope requires organisation and scope IDs';
        END IF;

        CASE NEW.scope_type
            WHEN 'organisation' THEN
                IF NEW.scope_id <> NEW.organisation_id THEN
                    RAISE EXCEPTION 'organisation audit scope must identify its organisation';
                END IF;
            WHEN 'organisational_unit' THEN
                IF NOT EXISTS (
                    SELECT 1
                    FROM organisational_units
                    WHERE organisation_id = NEW.organisation_id
                      AND id = NEW.scope_id
                ) THEN
                    RAISE EXCEPTION 'audit organisational-unit scope does not belong to organisation';
                END IF;
            WHEN 'centre' THEN
                IF NOT EXISTS (
                    SELECT 1
                    FROM centres
                    WHERE organisation_id = NEW.organisation_id
                      AND id = NEW.scope_id
                ) THEN
                    RAISE EXCEPTION 'audit centre scope does not belong to organisation';
                END IF;
            WHEN 'principal' THEN
                IF NOT EXISTS (
                    SELECT 1
                    FROM organisation_memberships
                    WHERE organisation_id = NEW.organisation_id
                      AND principal_id = NEW.scope_id
                ) THEN
                    RAISE EXCEPTION 'audit principal scope does not belong to organisation';
                END IF;
        END CASE;

        IF NEW.actor_principal_id IS NOT NULL AND NOT EXISTS (
            SELECT 1
            FROM organisation_memberships
            WHERE organisation_id = NEW.organisation_id
              AND principal_id = NEW.actor_principal_id
        ) THEN
            RAISE EXCEPTION 'audit actor does not belong to organisation';
        END IF;
    END IF;

    CASE NEW.resource_type
        WHEN 'organisation' THEN
            IF NEW.resource_id IS NULL OR NEW.resource_id <> NEW.organisation_id THEN
                RAISE EXCEPTION 'audit organisation resource does not belong to organisation';
            END IF;
        WHEN 'organisational_unit' THEN
            IF NEW.resource_id IS NULL OR NOT EXISTS (
                SELECT 1
                FROM organisational_units
                WHERE organisation_id = NEW.organisation_id
                  AND id = NEW.resource_id
            ) THEN
                RAISE EXCEPTION 'audit organisational-unit resource does not belong to organisation';
            END IF;
        WHEN 'centre' THEN
            IF NEW.resource_id IS NULL OR NOT EXISTS (
                SELECT 1
                FROM centres
                WHERE organisation_id = NEW.organisation_id
                  AND id = NEW.resource_id
            ) THEN
                RAISE EXCEPTION 'audit centre resource does not belong to organisation';
            END IF;
        WHEN 'principal' THEN
            IF NEW.resource_id IS NULL OR NOT EXISTS (
                SELECT 1
                FROM organisation_memberships
                WHERE organisation_id = NEW.organisation_id
                  AND principal_id = NEW.resource_id
            ) THEN
                RAISE EXCEPTION 'audit principal resource does not belong to organisation';
            END IF;
        WHEN 'organisation_membership' THEN
            IF NEW.resource_id IS NULL OR NOT EXISTS (
                SELECT 1
                FROM organisation_memberships
                WHERE organisation_id = NEW.organisation_id
                  AND id = NEW.resource_id
            ) THEN
                RAISE EXCEPTION 'audit membership resource does not belong to organisation';
            END IF;
        WHEN 'role_definition' THEN
            IF NEW.resource_id IS NULL OR NOT EXISTS (
                SELECT 1
                FROM role_definitions
                WHERE organisation_id = NEW.organisation_id
                  AND id = NEW.resource_id
            ) THEN
                RAISE EXCEPTION 'audit role-definition resource does not belong to organisation';
            END IF;
        WHEN 'role_assignment' THEN
            IF NEW.resource_id IS NULL OR NOT EXISTS (
                SELECT 1
                FROM role_assignments
                WHERE organisation_id = NEW.organisation_id
                  AND id = NEW.resource_id
            ) THEN
                RAISE EXCEPTION 'audit role-assignment resource does not belong to organisation';
            END IF;
        ELSE
            NULL;
    END CASE;

    RETURN NEW;
END;
$$;

CREATE TRIGGER system_audit_events_validate_scope
BEFORE INSERT ON system_audit_events
FOR EACH ROW
EXECUTE FUNCTION validate_system_audit_event_scope();
