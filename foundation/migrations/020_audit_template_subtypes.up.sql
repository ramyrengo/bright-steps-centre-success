-- Milestone 4A reuses immutable template content without turning an
-- operational check into a quarterly audit. The subtype is carried and bound
-- at every source boundary so direct SQL cannot cross the two families.

ALTER TABLE audit_templates
    ADD COLUMN IF NOT EXISTS template_subtype TEXT;

UPDATE audit_templates
SET template_subtype = 'QUARTERLY_REVIEW'
WHERE template_subtype IS NULL;

ALTER TABLE audit_templates
    ALTER COLUMN template_subtype SET NOT NULL,
    ALTER COLUMN template_subtype SET DEFAULT 'QUARTERLY_REVIEW',
    DROP CONSTRAINT IF EXISTS audit_templates_audit_type_check;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_templates'::regclass
          AND conname = 'audit_templates_template_subtype_check'
    ) THEN
        ALTER TABLE audit_templates
            ADD CONSTRAINT audit_templates_template_subtype_check
            CHECK (template_subtype IN ('QUARTERLY_REVIEW', 'OPERATIONAL_STANDARD'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_templates'::regclass
          AND conname = 'audit_templates_type_mapping_check'
    ) THEN
        ALTER TABLE audit_templates
            ADD CONSTRAINT audit_templates_type_mapping_check
            CHECK (
                (template_subtype = 'QUARTERLY_REVIEW' AND audit_type = 'quarterly_review')
                OR
                (template_subtype = 'OPERATIONAL_STANDARD' AND audit_type = 'operational_standard')
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_templates'::regclass
          AND conname = 'audit_templates_subtype_identity_unique'
    ) THEN
        ALTER TABLE audit_templates
            ADD CONSTRAINT audit_templates_subtype_identity_unique
            UNIQUE (organisation_id, id, template_subtype);
    END IF;
END;
$$;

ALTER TABLE audit_template_versions
    ADD COLUMN IF NOT EXISTS template_subtype TEXT;

DROP TRIGGER IF EXISTS audit_template_versions_prevent_released_mutation
    ON audit_template_versions;

UPDATE audit_template_versions AS version
SET template_subtype = template.template_subtype
FROM audit_templates AS template
WHERE template.organisation_id = version.organisation_id
  AND template.id = version.audit_template_id
  AND version.template_subtype IS NULL;

ALTER TABLE audit_template_versions
    ALTER COLUMN template_subtype SET NOT NULL,
    ALTER COLUMN template_subtype SET DEFAULT 'QUARTERLY_REVIEW',
    ALTER COLUMN scoring_policy_id DROP NOT NULL,
    DROP CONSTRAINT IF EXISTS audit_template_versions_source_classification_check;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_template_versions'::regclass
          AND conname = 'audit_template_versions_subtype_check'
    ) THEN
        ALTER TABLE audit_template_versions
            ADD CONSTRAINT audit_template_versions_subtype_check
            CHECK (template_subtype IN ('QUARTERLY_REVIEW', 'OPERATIONAL_STANDARD'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_template_versions'::regclass
          AND conname = 'audit_template_versions_scoring_by_subtype_check'
    ) THEN
        ALTER TABLE audit_template_versions
            ADD CONSTRAINT audit_template_versions_scoring_by_subtype_check
            CHECK (
                (template_subtype = 'QUARTERLY_REVIEW' AND scoring_policy_id IS NOT NULL)
                OR
                (template_subtype = 'OPERATIONAL_STANDARD' AND scoring_policy_id IS NULL)
            );
    END IF;
END;
$$;

ALTER TABLE audit_template_versions
    ADD CONSTRAINT audit_template_versions_source_classification_check
        CHECK (
            (
                template_subtype = 'QUARTERLY_REVIEW'
                AND source_classification IN ('BSA_INTERNAL', 'BSA_DEVELOPMENT_TEST')
            )
            OR
            (
                template_subtype = 'OPERATIONAL_STANDARD'
                AND source_classification = 'SYNTHETIC_STAGING_TEST'
                AND synthetic
            )
        );

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_template_versions'::regclass
          AND conname = 'audit_template_versions_parent_subtype_fk'
    ) THEN
        ALTER TABLE audit_template_versions
            ADD CONSTRAINT audit_template_versions_parent_subtype_fk
            FOREIGN KEY (organisation_id, audit_template_id, template_subtype)
            REFERENCES audit_templates(organisation_id, id, template_subtype);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_template_versions'::regclass
          AND conname = 'audit_template_versions_subtype_identity_unique'
    ) THEN
        ALTER TABLE audit_template_versions
            ADD CONSTRAINT audit_template_versions_subtype_identity_unique
            UNIQUE (organisation_id, id, template_subtype);
    END IF;
END;
$$;

ALTER TABLE audit_runs
    ADD COLUMN IF NOT EXISTS template_subtype TEXT;

DROP TRIGGER IF EXISTS audit_runs_prevent_finalised_mutation
    ON audit_runs;

UPDATE audit_runs
SET template_subtype = 'QUARTERLY_REVIEW'
WHERE template_subtype IS NULL;

ALTER TABLE audit_runs
    ALTER COLUMN template_subtype SET NOT NULL,
    ALTER COLUMN template_subtype SET DEFAULT 'QUARTERLY_REVIEW';

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_runs'::regclass
          AND conname = 'audit_runs_quarterly_subtype_check'
    ) THEN
        ALTER TABLE audit_runs
            ADD CONSTRAINT audit_runs_quarterly_subtype_check
            CHECK (template_subtype = 'QUARTERLY_REVIEW');
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_runs'::regclass
          AND conname = 'audit_runs_template_subtype_fk'
    ) THEN
        ALTER TABLE audit_runs
            ADD CONSTRAINT audit_runs_template_subtype_fk
            FOREIGN KEY (organisation_id, template_version_id, template_subtype)
            REFERENCES audit_template_versions(organisation_id, id, template_subtype);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_runs'::regclass
          AND conname = 'audit_runs_centre_identity_unique'
    ) THEN
        ALTER TABLE audit_runs
            ADD CONSTRAINT audit_runs_centre_identity_unique
            UNIQUE (organisation_id, centre_id, id);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION prevent_released_template_subtype_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.template_subtype IS DISTINCT FROM OLD.template_subtype
       OR NEW.audit_type IS DISTINCT FROM OLD.audit_type THEN
        RAISE EXCEPTION 'audit template subtype is immutable';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_templates_prevent_released_subtype_mutation
    ON audit_templates;

CREATE TRIGGER audit_templates_prevent_released_subtype_mutation
BEFORE UPDATE ON audit_templates
FOR EACH ROW EXECUTE FUNCTION prevent_released_template_subtype_mutation();

-- Replace the M2B trigger function so a released version's new subtype is
-- included in the immutable identity while the accepted supersede transition
-- remains available.
CREATE OR REPLACE FUNCTION prevent_released_audit_template_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND NEW.template_subtype IS DISTINCT FROM OLD.template_subtype THEN
        RAISE EXCEPTION 'audit template version subtype is immutable';
    END IF;
    IF OLD.status IN ('active', 'superseded') THEN
        IF TG_OP = 'UPDATE'
           AND OLD.status = 'active'
           AND NEW.status = 'superseded'
           AND NEW.id = OLD.id
           AND NEW.organisation_id = OLD.organisation_id
           AND NEW.audit_template_id = OLD.audit_template_id
           AND NEW.template_subtype = OLD.template_subtype
           AND NEW.scoring_policy_id IS NOT DISTINCT FROM OLD.scoring_policy_id
           AND NEW.version = OLD.version
           AND NEW.title = OLD.title
           AND NEW.instructions = OLD.instructions
           AND NEW.effective_from = OLD.effective_from
           AND NEW.source_classification = OLD.source_classification
           AND NEW.synthetic = OLD.synthetic THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'released audit template versions are immutable';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_template_versions_prevent_released_mutation
BEFORE UPDATE OR DELETE ON audit_template_versions
FOR EACH ROW EXECUTE FUNCTION prevent_released_audit_template_mutation();

ALTER TABLE audit_template_items
    DROP CONSTRAINT IF EXISTS audit_template_items_source_classification_check,
    ADD CONSTRAINT audit_template_items_source_classification_check
        CHECK (source_classification IN (
            'REGULATORY_REQUIREMENT', 'QUALITY_FRAMEWORK', 'BSA_POLICY',
            'BSA_PROCEDURE', 'RECOMMENDED_PRACTICE', 'BSA_DEVELOPMENT_TEST',
            'SYNTHETIC_STAGING_TEST'
        ));

CREATE OR REPLACE FUNCTION validate_audit_item_source_family()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    subtype TEXT;
BEGIN
    SELECT template_subtype
    INTO subtype
    FROM audit_template_versions
    WHERE organisation_id = NEW.organisation_id
      AND id = NEW.template_version_id;

    IF subtype = 'OPERATIONAL_STANDARD'
       AND NEW.source_classification <> 'SYNTHETIC_STAGING_TEST' THEN
        RAISE EXCEPTION 'operational Standard content must remain synthetic staging test content';
    ELSIF subtype = 'QUARTERLY_REVIEW'
       AND NEW.source_classification = 'SYNTHETIC_STAGING_TEST' THEN
        RAISE EXCEPTION 'quarterly review content cannot use the operational staging classification';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_template_items_validate_source_family
    ON audit_template_items;

CREATE TRIGGER audit_template_items_validate_source_family
BEFORE INSERT OR UPDATE ON audit_template_items
FOR EACH ROW EXECUTE FUNCTION validate_audit_item_source_family();

DROP TRIGGER IF EXISTS audit_runs_prevent_finalised_mutation
    ON audit_runs;

CREATE TRIGGER audit_runs_prevent_finalised_mutation
BEFORE UPDATE OR DELETE ON audit_runs
FOR EACH ROW EXECUTE FUNCTION prevent_finalised_audit_run_mutation();
