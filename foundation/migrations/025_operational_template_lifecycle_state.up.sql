-- Keep the Area Manager builder lifecycle explicit at every reused source
-- boundary. The columns were already NOT NULL; these defaults make omitted
-- seed/internal inserts enter the only safe initial states instead of relying
-- on caller-specific SQL.

ALTER TABLE audit_templates
    ALTER COLUMN status SET DEFAULT 'active';

ALTER TABLE audit_template_versions
    ALTER COLUMN status SET DEFAULT 'draft';

ALTER TABLE operational_standard_deployments
    ALTER COLUMN status SET DEFAULT 'DRAFT';

-- Published builder versions must always retain their attributable release
-- facts. Synthetic 4A pilot versions remain governed by their separate source
-- boundary and are not reclassified as BSA internal content here.
ALTER TABLE audit_template_versions
    DROP CONSTRAINT IF EXISTS audit_template_versions_operational_publication_state_check,
    ADD CONSTRAINT audit_template_versions_operational_publication_state_check
        CHECK (
            template_subtype <> 'OPERATIONAL_STANDARD'
            OR source_classification <> 'BSA_INTERNAL'
            OR status = 'draft'
            OR (published_at IS NOT NULL AND published_by_principal_id IS NOT NULL)
        );

-- Fail the migration closed if an earlier partially applied builder change
-- somehow left a lifecycle state outside the non-null enum columns.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM audit_templates WHERE status IS NULL
        UNION ALL
        SELECT 1 FROM audit_template_versions WHERE status IS NULL
        UNION ALL
        SELECT 1 FROM operational_standard_deployments WHERE status IS NULL
    ) THEN
        RAISE EXCEPTION 'operational template lifecycle state cannot be null';
    END IF;
END;
$$;
