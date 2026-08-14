-- Area Manager Template & Form Builder.
--
-- Mutable authoring data is deliberately separate from the released content
-- tables. Publication copies one validated draft into the existing immutable
-- audit_template_versions/sections/items lineage used by Centre Standards.

ALTER TABLE audit_templates
    ADD COLUMN IF NOT EXISTS created_by_principal_id UUID REFERENCES principals(id),
    ADD COLUMN IF NOT EXISTS retired_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS retired_by_principal_id UUID REFERENCES principals(id);

ALTER TABLE audit_templates
    DROP CONSTRAINT IF EXISTS audit_templates_operational_retirement_attribution_check,
    ADD CONSTRAINT audit_templates_operational_retirement_attribution_check
        CHECK (
            created_by_principal_id IS NULL
            OR template_subtype <> 'OPERATIONAL_STANDARD'
            OR (
                (status = 'active' AND retired_at IS NULL AND retired_by_principal_id IS NULL)
                OR
                (status = 'inactive' AND retired_at IS NOT NULL AND retired_by_principal_id IS NOT NULL)
            )
        );

CREATE OR REPLACE FUNCTION validate_builder_operational_template_root()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.template_subtype <> 'OPERATIONAL_STANDARD'
       OR OLD.created_by_principal_id IS NULL THEN
        RETURN COALESCE(NEW, OLD);
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'operational template history cannot be deleted';
    END IF;
    IF NEW.id <> OLD.id
       OR NEW.organisation_id <> OLD.organisation_id
       OR NEW.template_key <> OLD.template_key
       OR NEW.audit_type <> OLD.audit_type
       OR NEW.template_subtype <> OLD.template_subtype
       OR NEW.created_by_principal_id <> OLD.created_by_principal_id
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'operational template identity is immutable';
    END IF;
    IF OLD.status = 'inactive' THEN
        RAISE EXCEPTION 'retired operational templates are immutable';
    END IF;
    IF NEW.status = 'inactive'
       AND (NEW.retired_at IS NULL OR NEW.retired_by_principal_id IS NULL) THEN
        RAISE EXCEPTION 'operational template retirement requires attribution';
    END IF;
    IF NEW.lock_version <> OLD.lock_version + 1 OR NEW.updated_at < OLD.updated_at THEN
        RAISE EXCEPTION 'operational template version must advance exactly once';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER audit_templates_validate_builder_operational_root
BEFORE UPDATE OR DELETE ON audit_templates
FOR EACH ROW EXECUTE FUNCTION validate_builder_operational_template_root();

ALTER TABLE audit_template_versions
    ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS published_by_principal_id UUID REFERENCES principals(id),
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DROP TRIGGER IF EXISTS audit_template_versions_prevent_released_mutation
    ON audit_template_versions;

UPDATE audit_template_versions
SET published_at = effective_from
WHERE status IN ('active', 'superseded')
  AND published_at IS NULL;

ALTER TABLE audit_template_versions
    DROP CONSTRAINT IF EXISTS audit_template_versions_metadata_object_check,
    ADD CONSTRAINT audit_template_versions_metadata_object_check
        CHECK (jsonb_typeof(metadata) = 'object');

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_template_versions'::regclass
          AND conname = 'audit_template_versions_template_identity_unique'
    ) THEN
        ALTER TABLE audit_template_versions
            ADD CONSTRAINT audit_template_versions_template_identity_unique
            UNIQUE (organisation_id, id, audit_template_id);
    END IF;
END;
$$;

ALTER TABLE audit_template_versions
    DROP CONSTRAINT IF EXISTS audit_template_versions_source_classification_check,
    ADD CONSTRAINT audit_template_versions_source_classification_check
        CHECK (
            (
                template_subtype = 'QUARTERLY_REVIEW'
                AND source_classification IN ('BSA_INTERNAL', 'BSA_DEVELOPMENT_TEST')
            )
            OR
            (
                template_subtype = 'OPERATIONAL_STANDARD'
                AND (
                    (source_classification = 'BSA_INTERNAL' AND NOT synthetic)
                    OR
                    (source_classification = 'SYNTHETIC_STAGING_TEST' AND synthetic)
                )
            )
        );

CREATE OR REPLACE FUNCTION validate_operational_template_version_publication()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF jsonb_typeof(NEW.metadata) <> 'object' THEN
        RAISE EXCEPTION 'template version metadata must be a JSON object';
    END IF;
    IF NEW.template_subtype = 'OPERATIONAL_STANDARD'
       AND NEW.source_classification = 'BSA_INTERNAL'
       AND NEW.status IN ('active', 'superseded')
       AND (NEW.published_at IS NULL OR NEW.published_by_principal_id IS NULL) THEN
        RAISE EXCEPTION 'published operational template versions require publication attribution';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_template_versions_validate_operational_publication
    ON audit_template_versions;

CREATE TRIGGER audit_template_versions_validate_operational_publication
BEFORE INSERT OR UPDATE ON audit_template_versions
FOR EACH ROW EXECUTE FUNCTION validate_operational_template_version_publication();

-- Include the builder publication fields in the already accepted release
-- immutability rule. The only released transition remains active->superseded.
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
           AND NEW.synthetic = OLD.synthetic
           AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at
           AND NEW.published_by_principal_id IS NOT DISTINCT FROM OLD.published_by_principal_id
           AND NEW.metadata = OLD.metadata THEN
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

CREATE TABLE operational_template_drafts (
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    template_id UUID PRIMARY KEY,
    template_subtype TEXT NOT NULL DEFAULT 'OPERATIONAL_STANDARD'
        CHECK (template_subtype = 'OPERATIONAL_STANDARD'),
    title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    instructions TEXT NOT NULL CHECK (char_length(btrim(instructions)) BETWEEN 1 AND 2000),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(metadata) = 'object'),
    created_by_principal_id UUID NOT NULL REFERENCES principals(id),
    updated_by_principal_id UUID NOT NULL REFERENCES principals(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, template_id),
    FOREIGN KEY (organisation_id, template_id, template_subtype)
        REFERENCES audit_templates(organisation_id, id, template_subtype),
    CHECK (updated_at >= created_at)
);

CREATE OR REPLACE FUNCTION validate_operational_template_draft_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'operational template drafts cannot be deleted';
    END IF;
    IF NEW.organisation_id <> OLD.organisation_id
       OR NEW.template_id <> OLD.template_id
       OR NEW.template_subtype <> OLD.template_subtype
       OR NEW.created_by_principal_id <> OLD.created_by_principal_id
       OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'operational template draft identity is immutable';
    END IF;
    IF NEW.lock_version <> OLD.lock_version + 1 OR NEW.updated_at < OLD.updated_at THEN
        RAISE EXCEPTION 'operational template draft version must advance exactly once';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER operational_template_drafts_validate_mutation
BEFORE UPDATE OR DELETE ON operational_template_drafts
FOR EACH ROW EXECUTE FUNCTION validate_operational_template_draft_mutation();

CREATE TABLE operational_template_draft_sections (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    template_id UUID NOT NULL,
    stable_key TEXT NOT NULL CHECK (stable_key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 150),
    instructions TEXT
        CHECK (instructions IS NULL OR char_length(btrim(instructions)) BETWEEN 1 AND 1000),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    UNIQUE (organisation_id, template_id, id),
    UNIQUE (template_id, stable_key),
    UNIQUE (template_id, sort_order),
    FOREIGN KEY (organisation_id, template_id)
        REFERENCES operational_template_drafts(organisation_id, template_id)
        ON DELETE CASCADE
);

CREATE TABLE operational_template_draft_questions (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    template_id UUID NOT NULL,
    section_id UUID NOT NULL,
    lineage_key TEXT NOT NULL CHECK (lineage_key ~ '^[a-z][a-z0-9_.-]{0,149}$'),
    label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 500),
    instructions TEXT
        CHECK (instructions IS NULL OR char_length(btrim(instructions)) BETWEEN 1 AND 1500),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    question_type TEXT NOT NULL CHECK (question_type IN (
        'short_text', 'long_text', 'single_choice',
        'multiple_choice', 'numeric', 'time'
    )),
    required BOOLEAN NOT NULL,
    answer_configuration JSONB NOT NULL DEFAULT '{}'::jsonb
        CHECK (jsonb_typeof(answer_configuration) = 'object'),
    UNIQUE (organisation_id, template_id, id),
    UNIQUE (template_id, lineage_key),
    UNIQUE (template_id, section_id, sort_order),
    FOREIGN KEY (organisation_id, template_id)
        REFERENCES operational_template_drafts(organisation_id, template_id)
        ON DELETE CASCADE,
    FOREIGN KEY (organisation_id, template_id, section_id)
        REFERENCES operational_template_draft_sections(organisation_id, template_id, id)
        ON DELETE CASCADE
);

ALTER TABLE audit_template_items
    ADD COLUMN IF NOT EXISTS question_type TEXT,
    ADD COLUMN IF NOT EXISTS answer_configuration JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE audit_template_items
    DROP CONSTRAINT IF EXISTS audit_template_items_source_classification_check,
    ADD CONSTRAINT audit_template_items_source_classification_check
        CHECK (source_classification IN (
            'REGULATORY_REQUIREMENT', 'QUALITY_FRAMEWORK', 'BSA_POLICY',
            'BSA_PROCEDURE', 'RECOMMENDED_PRACTICE', 'BSA_DEVELOPMENT_TEST',
            'SYNTHETIC_STAGING_TEST', 'BSA_INTERNAL'
        )),
    DROP CONSTRAINT IF EXISTS audit_template_items_question_type_check,
    ADD CONSTRAINT audit_template_items_question_type_check
        CHECK (
            question_type IS NULL OR question_type IN (
                'short_text', 'long_text', 'single_choice',
                'multiple_choice', 'numeric', 'time'
            )
        ),
    DROP CONSTRAINT IF EXISTS audit_template_items_answer_configuration_object_check,
    ADD CONSTRAINT audit_template_items_answer_configuration_object_check
        CHECK (jsonb_typeof(answer_configuration) = 'object');

-- Operational builder content uses the version's source family and carries a
-- typed answer contract. The legacy synthetic 4A pilot remains valid.
CREATE OR REPLACE FUNCTION validate_audit_item_source_family()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    subtype TEXT;
    version_source_classification TEXT;
BEGIN
    SELECT template_subtype, source_classification
    INTO subtype, version_source_classification
    FROM audit_template_versions
    WHERE organisation_id = NEW.organisation_id
      AND id = NEW.template_version_id;

    IF subtype = 'OPERATIONAL_STANDARD' THEN
        IF NEW.source_classification <> version_source_classification THEN
            RAISE EXCEPTION 'operational Standard item source must match its version';
        END IF;
        IF version_source_classification = 'BSA_INTERNAL'
           AND NEW.question_type IS NULL THEN
            RAISE EXCEPTION 'operational template questions require a supported question type';
        END IF;
    ELSIF subtype = 'QUARTERLY_REVIEW'
          AND NEW.source_classification = 'SYNTHETIC_STAGING_TEST' THEN
        RAISE EXCEPTION 'quarterly review content cannot use the operational staging classification';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operational_standard_schedule_revisions_append_only
    ON operational_standard_schedule_revisions;

ALTER TABLE operational_standard_schedule_revisions
    ADD COLUMN IF NOT EXISTS centre_timezone TEXT;

UPDATE operational_standard_schedule_revisions AS schedule
SET centre_timezone = centre.timezone
FROM centres AS centre
WHERE centre.organisation_id = schedule.organisation_id
  AND centre.id = schedule.centre_id
  AND schedule.centre_timezone IS NULL;

ALTER TABLE operational_standard_schedule_revisions
    ALTER COLUMN centre_timezone SET NOT NULL,
    DROP CONSTRAINT IF EXISTS operational_standard_schedule_timezone_check,
    ADD CONSTRAINT operational_standard_schedule_timezone_check
        CHECK (char_length(btrim(centre_timezone)) BETWEEN 1 AND 100);

CREATE OR REPLACE FUNCTION validate_operational_schedule_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    deployment_from DATE;
    deployment_to DATE;
    current_timezone TEXT;
    expected_revision INTEGER;
BEGIN
    SELECT deployment.effective_from, deployment.effective_to, centre.timezone
    INTO deployment_from, deployment_to, current_timezone
    FROM operational_standard_deployments AS deployment
    JOIN centres AS centre
      ON centre.organisation_id = deployment.organisation_id
     AND centre.id = deployment.centre_id
    WHERE deployment.organisation_id = NEW.organisation_id
      AND deployment.centre_id = NEW.centre_id
      AND deployment.id = NEW.deployment_id
    FOR UPDATE OF deployment;

    IF deployment_from IS NULL THEN
        RAISE EXCEPTION 'operational Standard deployment is unavailable';
    END IF;
    IF NEW.centre_timezone <> current_timezone THEN
        RAISE EXCEPTION 'operational Standard schedule timezone must match its centre';
    END IF;
    IF NEW.effective_from < deployment_from
       OR (deployment_to IS NOT NULL AND COALESCE(NEW.effective_to, 'infinity'::date) > deployment_to) THEN
        RAISE EXCEPTION 'schedule revision falls outside its deployment window';
    END IF;

    SELECT COALESCE(max(revision), 0) + 1
    INTO expected_revision
    FROM operational_standard_schedule_revisions
    WHERE deployment_id = NEW.deployment_id;
    IF NEW.revision <> expected_revision THEN
        RAISE EXCEPTION 'schedule revisions must be contiguous';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM operational_standard_schedule_revisions AS existing
        WHERE existing.deployment_id = NEW.deployment_id
          AND existing.effective_from >= NEW.effective_from
    ) THEN
        RAISE EXCEPTION 'operational Standard schedule revisions must advance their effective date';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER operational_standard_schedule_revisions_append_only
BEFORE UPDATE OR DELETE ON operational_standard_schedule_revisions
FOR EACH ROW EXECUTE FUNCTION reject_append_only_business_event_mutation();

-- A later publication supersedes content in the library but must not silently
-- rewrite or stop an existing deployment pinned to the earlier release.
CREATE OR REPLACE FUNCTION validate_operational_check_occurrence()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    deployment_from DATE;
    deployment_to DATE;
    schedule_from DATE;
    schedule_to DATE;
    scheduled_revision INTEGER;
    scheduled_open TIME(0) WITHOUT TIME ZONE;
    scheduled_due TIME(0) WITHOUT TIME ZONE;
    scheduled_timezone TEXT;
    current_timezone TEXT;
BEGIN
    SELECT
        deployment.effective_from,
        deployment.effective_to,
        schedule.effective_from,
        schedule.effective_to,
        schedule.revision,
        schedule.opens_local_time,
        schedule.due_local_time,
        schedule.centre_timezone,
        centre.timezone
    INTO
        deployment_from,
        deployment_to,
        schedule_from,
        schedule_to,
        scheduled_revision,
        scheduled_open,
        scheduled_due,
        scheduled_timezone,
        current_timezone
    FROM operational_standard_deployments AS deployment
    JOIN operational_standard_schedule_revisions AS schedule
      ON schedule.organisation_id = deployment.organisation_id
     AND schedule.centre_id = deployment.centre_id
     AND schedule.deployment_id = deployment.id
     AND schedule.id = NEW.schedule_revision_id
    JOIN centres AS centre
      ON centre.organisation_id = deployment.organisation_id
     AND centre.id = deployment.centre_id
    JOIN audit_template_versions AS version
      ON version.organisation_id = deployment.organisation_id
     AND version.id = deployment.template_version_id
     AND version.template_subtype = 'OPERATIONAL_STANDARD'
     AND version.status IN ('active', 'superseded')
    WHERE deployment.organisation_id = NEW.organisation_id
      AND deployment.centre_id = NEW.centre_id
      AND deployment.id = NEW.deployment_id
      AND deployment.template_version_id = NEW.template_version_id
      AND deployment.status = 'ACTIVE';

    IF deployment_from IS NULL THEN
        RAISE EXCEPTION 'active operational occurrence source is unavailable';
    END IF;
    IF NEW.status <> 'OPEN'
       OR NEW.completed_by_principal_id IS NOT NULL
       OR NEW.completed_at IS NOT NULL THEN
        RAISE EXCEPTION 'operational occurrences must be created open';
    END IF;
    IF NEW.business_date < deployment_from
       OR (deployment_to IS NOT NULL AND NEW.business_date > deployment_to)
       OR NEW.business_date < schedule_from
       OR (schedule_to IS NOT NULL AND NEW.business_date > schedule_to) THEN
        RAISE EXCEPTION 'operational occurrence falls outside its source window';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM operational_standard_schedule_revisions AS newer
        WHERE newer.organisation_id = NEW.organisation_id
          AND newer.centre_id = NEW.centre_id
          AND newer.deployment_id = NEW.deployment_id
          AND newer.effective_from <= NEW.business_date
          AND (newer.effective_to IS NULL OR newer.effective_to >= NEW.business_date)
          AND (
              newer.effective_from > schedule_from
              OR (
                  newer.effective_from = schedule_from
                  AND newer.revision > scheduled_revision
              )
          )
    ) THEN
        RAISE EXCEPTION 'operational occurrence must use the latest applicable schedule revision';
    END IF;
    IF scheduled_timezone <> current_timezone
       OR NEW.centre_timezone <> scheduled_timezone
       OR (NEW.opens_at AT TIME ZONE NEW.centre_timezone)::date <> NEW.business_date
       OR (NEW.due_at AT TIME ZONE NEW.centre_timezone)::date <> NEW.business_date
       OR (NEW.opens_at AT TIME ZONE NEW.centre_timezone)::time(0) <> scheduled_open
       OR (NEW.due_at AT TIME ZONE NEW.centre_timezone)::time(0) <> scheduled_due THEN
        RAISE EXCEPTION 'operational occurrence does not match its pinned civil-time schedule';
    END IF;
    RETURN NEW;
END;
$$;

-- Builder-created internal versions are deployable through the same Centre
-- Standards source table. Synthetic versions retain their mandatory notice.
CREATE OR REPLACE FUNCTION validate_operational_standard_deployment()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    version_status TEXT;
    version_synthetic BOOLEAN;
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'operational Standard deployment history cannot be deleted';
    END IF;

    SELECT status, synthetic
    INTO version_status, version_synthetic
    FROM audit_template_versions
    WHERE organisation_id = NEW.organisation_id
      AND id = NEW.template_version_id
      AND template_subtype = 'OPERATIONAL_STANDARD';

    IF version_status IS NULL
       OR (TG_OP = 'INSERT' AND version_status <> 'active')
       OR (TG_OP = 'UPDATE' AND version_status NOT IN ('active', 'superseded')) THEN
        RAISE EXCEPTION 'operational Standard deployment requires an active Standard version';
    END IF;
    IF version_synthetic AND NEW.synthetic_notice IS NULL THEN
        RAISE EXCEPTION 'synthetic operational Standard deployments require a visible notice';
    END IF;
    IF NOT version_synthetic AND NEW.synthetic_notice IS NOT NULL THEN
        RAISE EXCEPTION 'internal operational Standard deployments cannot carry a synthetic notice';
    END IF;

    IF TG_OP = 'UPDATE' THEN
        IF NEW.id <> OLD.id
           OR NEW.organisation_id <> OLD.organisation_id
           OR NEW.centre_id <> OLD.centre_id
           OR NEW.template_version_id <> OLD.template_version_id
           OR NEW.template_subtype <> OLD.template_subtype
           OR NEW.effective_from <> OLD.effective_from
           OR NEW.effective_to IS DISTINCT FROM OLD.effective_to
           OR NEW.synthetic_notice IS DISTINCT FROM OLD.synthetic_notice
           OR NEW.created_by_principal_id IS DISTINCT FROM OLD.created_by_principal_id
           OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'operational Standard deployment source facts are immutable';
        END IF;
        IF OLD.status = 'INACTIVE' AND NEW.status <> 'INACTIVE' THEN
            RAISE EXCEPTION 'inactive operational Standard deployments cannot be reactivated';
        END IF;
        IF OLD.status = 'ACTIVE' AND NEW.status NOT IN ('ACTIVE', 'INACTIVE') THEN
            RAISE EXCEPTION 'active operational Standard deployments can only be deactivated';
        END IF;
        IF NEW.lock_version <> OLD.lock_version + 1 OR NEW.updated_at < OLD.updated_at THEN
            RAISE EXCEPTION 'operational Standard deployment version must advance exactly once';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TABLE operational_template_assignments (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    template_id UUID NOT NULL,
    template_version_id UUID NOT NULL,
    template_subtype TEXT NOT NULL DEFAULT 'OPERATIONAL_STANDARD'
        CHECK (template_subtype = 'OPERATIONAL_STANDARD'),
    target_kind TEXT NOT NULL CHECK (target_kind IN ('CENTRES', 'PORTFOLIO')),
    frequency TEXT NOT NULL CHECK (frequency = 'DAILY'),
    opens_local_time TIME(0) WITHOUT TIME ZONE NOT NULL,
    due_local_time TIME(0) WITHOUT TIME ZONE NOT NULL,
    effective_from DATE NOT NULL,
    assigned_by_principal_id UUID NOT NULL REFERENCES principals(id),
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    FOREIGN KEY (organisation_id, template_id, template_subtype)
        REFERENCES audit_templates(organisation_id, id, template_subtype),
    FOREIGN KEY (organisation_id, template_version_id, template_id)
        REFERENCES audit_template_versions(organisation_id, id, audit_template_id),
    CHECK (due_local_time > opens_local_time)
);

CREATE TABLE operational_template_assignment_centres (
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    assignment_id UUID NOT NULL,
    centre_id UUID NOT NULL,
    deployment_id UUID NOT NULL,
    centre_timezone TEXT NOT NULL
        CHECK (char_length(btrim(centre_timezone)) BETWEEN 1 AND 100),
    PRIMARY KEY (assignment_id, centre_id),
    UNIQUE (deployment_id),
    FOREIGN KEY (organisation_id, assignment_id)
        REFERENCES operational_template_assignments(organisation_id, id),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    FOREIGN KEY (organisation_id, centre_id, deployment_id)
        REFERENCES operational_standard_deployments(organisation_id, centre_id, id)
);

CREATE OR REPLACE FUNCTION validate_operational_template_assignment_centre()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM operational_template_assignments AS assignment
        JOIN operational_standard_deployments AS deployment
          ON deployment.organisation_id = assignment.organisation_id
         AND deployment.centre_id = NEW.centre_id
         AND deployment.id = NEW.deployment_id
         AND deployment.template_version_id = assignment.template_version_id
        JOIN centres AS centre
          ON centre.organisation_id = assignment.organisation_id
         AND centre.id = NEW.centre_id
         AND centre.timezone = NEW.centre_timezone
        WHERE assignment.organisation_id = NEW.organisation_id
          AND assignment.id = NEW.assignment_id
    ) THEN
        RAISE EXCEPTION 'operational template assignment centre source is inconsistent';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER operational_template_assignment_centres_validate
BEFORE INSERT OR UPDATE ON operational_template_assignment_centres
FOR EACH ROW EXECUTE FUNCTION validate_operational_template_assignment_centre();

CREATE TRIGGER operational_template_assignments_append_only
BEFORE UPDATE OR DELETE ON operational_template_assignments
FOR EACH ROW EXECUTE FUNCTION reject_append_only_business_event_mutation();

CREATE TRIGGER operational_template_assignment_centres_append_only
BEFORE UPDATE OR DELETE ON operational_template_assignment_centres
FOR EACH ROW EXECUTE FUNCTION reject_append_only_business_event_mutation();

-- Extend the existing tenant/scope audit target validator for builder sources.
CREATE OR REPLACE FUNCTION validate_centre_standards_audit_target()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    resource_centre_id UUID;
BEGIN
    IF NEW.resource_type = 'operational_check_occurrence' THEN
        SELECT centre_id INTO resource_centre_id
        FROM operational_check_occurrences
        WHERE organisation_id = NEW.organisation_id AND id = NEW.resource_id;
    ELSIF NEW.resource_type = 'operational_check_response' THEN
        SELECT centre_id INTO resource_centre_id
        FROM operational_check_responses
        WHERE organisation_id = NEW.organisation_id AND id = NEW.resource_id;
    ELSIF NEW.resource_type = 'operational_standard_deployment' THEN
        SELECT centre_id INTO resource_centre_id
        FROM operational_standard_deployments
        WHERE organisation_id = NEW.organisation_id AND id = NEW.resource_id;
    END IF;

    IF NEW.resource_type IN (
        'operational_check_occurrence',
        'operational_check_response',
        'operational_standard_deployment'
    ) THEN
        IF resource_centre_id IS NULL THEN
            RAISE EXCEPTION 'audit operational resource does not belong to organisation';
        END IF;
        IF NEW.scope_type <> 'centre' OR NEW.scope_id IS DISTINCT FROM resource_centre_id THEN
            RAISE EXCEPTION 'audit operational resource scope does not match its centre';
        END IF;
    ELSIF NEW.resource_type = 'operational_template' THEN
        IF NOT EXISTS (
            SELECT 1 FROM audit_templates
            WHERE organisation_id = NEW.organisation_id
              AND id = NEW.resource_id
              AND template_subtype = 'OPERATIONAL_STANDARD'
        ) THEN
            RAISE EXCEPTION 'audit operational template does not belong to organisation';
        END IF;
        IF NEW.scope_type <> 'organisation' OR NEW.scope_id IS DISTINCT FROM NEW.organisation_id THEN
            RAISE EXCEPTION 'audit operational template must use organisation scope';
        END IF;
    ELSIF NEW.resource_type = 'operational_template_version' THEN
        IF NOT EXISTS (
            SELECT 1 FROM audit_template_versions
            WHERE organisation_id = NEW.organisation_id
              AND id = NEW.resource_id
              AND template_subtype = 'OPERATIONAL_STANDARD'
        ) THEN
            RAISE EXCEPTION 'audit operational template version does not belong to organisation';
        END IF;
        IF NEW.scope_type <> 'organisation' OR NEW.scope_id IS DISTINCT FROM NEW.organisation_id THEN
            RAISE EXCEPTION 'audit operational template version must use organisation scope';
        END IF;
    ELSIF NEW.resource_type = 'operational_template_assignment' THEN
        IF NOT EXISTS (
            SELECT 1 FROM operational_template_assignments
            WHERE organisation_id = NEW.organisation_id AND id = NEW.resource_id
        ) THEN
            RAISE EXCEPTION 'audit operational template assignment does not belong to organisation';
        END IF;
        IF NEW.scope_type <> 'organisation' OR NEW.scope_id IS DISTINCT FROM NEW.organisation_id THEN
            RAISE EXCEPTION 'audit operational template assignment must use organisation scope';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;
