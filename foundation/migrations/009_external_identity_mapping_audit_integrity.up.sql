CREATE FUNCTION validate_external_identity_mapping_audit_target()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.resource_type = 'external_identity_mapping' THEN
        IF NEW.organisation_id IS NULL
           OR NEW.resource_id IS NULL
           OR NOT EXISTS (
               SELECT 1
               FROM external_identity_mappings AS mapping
               JOIN organisation_memberships AS membership
                 ON membership.principal_id = mapping.principal_id
                AND membership.organisation_id = NEW.organisation_id
               WHERE mapping.id = NEW.resource_id
           ) THEN
            RAISE EXCEPTION 'audit external-identity-mapping resource does not belong to organisation';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER system_audit_events_validate_external_identity_mapping
BEFORE INSERT ON system_audit_events
FOR EACH ROW
EXECUTE FUNCTION validate_external_identity_mapping_audit_target();
