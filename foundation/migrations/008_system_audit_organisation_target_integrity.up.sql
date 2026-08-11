ALTER TABLE system_audit_events
    ADD CONSTRAINT system_audit_events_organisation_target_check
        CHECK (
            resource_type <> 'organisation'
            OR (
                organisation_id IS NOT NULL
                AND resource_id IS NOT NULL
                AND resource_id = organisation_id
            )
        );
