-- Milestone 4A operational sources and source-aware finding families.

CREATE TABLE IF NOT EXISTS operational_standard_deployments (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    template_version_id UUID NOT NULL,
    template_subtype TEXT NOT NULL DEFAULT 'OPERATIONAL_STANDARD'
        CHECK (template_subtype = 'OPERATIONAL_STANDARD'),
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'ACTIVE', 'INACTIVE')),
    effective_from DATE NOT NULL,
    effective_to DATE,
    synthetic_notice TEXT
        CHECK (synthetic_notice IS NULL OR char_length(btrim(synthetic_notice)) BETWEEN 1 AND 1000),
    created_by_principal_id UUID REFERENCES principals(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, centre_id, id),
    UNIQUE (organisation_id, centre_id, id, template_version_id),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    FOREIGN KEY (organisation_id, template_version_id, template_subtype)
        REFERENCES audit_template_versions(organisation_id, id, template_subtype),
    CHECK (effective_to IS NULL OR effective_to >= effective_from),
    CHECK (updated_at >= created_at)
);

CREATE TABLE IF NOT EXISTS operational_standard_schedule_revisions (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    deployment_id UUID NOT NULL,
    revision INTEGER NOT NULL CHECK (revision > 0),
    frequency TEXT NOT NULL CHECK (frequency = 'DAILY'),
    opens_local_time TIME(0) WITHOUT TIME ZONE NOT NULL,
    due_local_time TIME(0) WITHOUT TIME ZONE NOT NULL,
    effective_from DATE NOT NULL,
    effective_to DATE,
    created_by_principal_id UUID REFERENCES principals(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, centre_id, deployment_id, id),
    UNIQUE (deployment_id, revision),
    FOREIGN KEY (organisation_id, centre_id, deployment_id)
        REFERENCES operational_standard_deployments(organisation_id, centre_id, id),
    CHECK (due_local_time > opens_local_time),
    CHECK (effective_to IS NULL OR effective_to >= effective_from)
);

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

    IF version_status IS NULL OR version_status <> 'active' OR NOT version_synthetic THEN
        RAISE EXCEPTION 'operational Standard deployment requires an active synthetic Standard version';
    END IF;
    IF NEW.synthetic_notice IS NULL THEN
        RAISE EXCEPTION 'synthetic operational Standard deployments require a visible notice';
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

DROP TRIGGER IF EXISTS operational_standard_deployments_validate
    ON operational_standard_deployments;

CREATE TRIGGER operational_standard_deployments_validate
BEFORE INSERT OR UPDATE OR DELETE ON operational_standard_deployments
FOR EACH ROW EXECUTE FUNCTION validate_operational_standard_deployment();

CREATE OR REPLACE FUNCTION validate_operational_schedule_revision()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    deployment_from DATE;
    deployment_to DATE;
    expected_revision INTEGER;
BEGIN
    SELECT effective_from, effective_to
    INTO deployment_from, deployment_to
    FROM operational_standard_deployments
    WHERE organisation_id = NEW.organisation_id
      AND centre_id = NEW.centre_id
      AND id = NEW.deployment_id
    FOR UPDATE;

    IF deployment_from IS NULL THEN
        RAISE EXCEPTION 'operational Standard deployment is unavailable';
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

DROP TRIGGER IF EXISTS operational_standard_schedule_revisions_validate
    ON operational_standard_schedule_revisions;

CREATE TRIGGER operational_standard_schedule_revisions_validate
BEFORE INSERT ON operational_standard_schedule_revisions
FOR EACH ROW EXECUTE FUNCTION validate_operational_schedule_revision();

CREATE TABLE IF NOT EXISTS operational_check_occurrences (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    deployment_id UUID NOT NULL,
    schedule_revision_id UUID NOT NULL,
    template_version_id UUID NOT NULL,
    template_subtype TEXT NOT NULL DEFAULT 'OPERATIONAL_STANDARD'
        CHECK (template_subtype = 'OPERATIONAL_STANDARD'),
    business_date DATE NOT NULL,
    centre_timezone TEXT NOT NULL
        CHECK (char_length(btrim(centre_timezone)) BETWEEN 1 AND 100),
    opens_at TIMESTAMPTZ NOT NULL,
    due_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('OPEN', 'COMPLETED')),
    completed_by_principal_id UUID REFERENCES principals(id),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, centre_id, id),
    UNIQUE (organisation_id, centre_id, id, template_version_id),
    UNIQUE (organisation_id, deployment_id, centre_id, business_date),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    FOREIGN KEY (organisation_id, centre_id, deployment_id, template_version_id)
        REFERENCES operational_standard_deployments(
            organisation_id, centre_id, id, template_version_id
        ),
    FOREIGN KEY (organisation_id, centre_id, deployment_id, schedule_revision_id)
        REFERENCES operational_standard_schedule_revisions(
            organisation_id, centre_id, deployment_id, id
        ),
    FOREIGN KEY (organisation_id, template_version_id, template_subtype)
        REFERENCES audit_template_versions(organisation_id, id, template_subtype),
    CHECK (due_at > opens_at),
    CHECK (date_trunc('minute', opens_at) = opens_at),
    CHECK (date_trunc('minute', due_at) = due_at),
    CHECK (updated_at >= created_at),
    CHECK (
        (status = 'OPEN' AND completed_by_principal_id IS NULL AND completed_at IS NULL)
        OR
        (status = 'COMPLETED' AND completed_by_principal_id IS NOT NULL AND completed_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS operational_check_occurrences_open_idx
    ON operational_check_occurrences (organisation_id, centre_id, due_at, id)
    WHERE status = 'OPEN';

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
        centre.timezone
    INTO
        deployment_from,
        deployment_to,
        schedule_from,
        schedule_to,
        scheduled_revision,
        scheduled_open,
        scheduled_due,
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
     AND version.status = 'active'
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
    IF NEW.centre_timezone <> current_timezone
       OR (NEW.opens_at AT TIME ZONE NEW.centre_timezone)::date <> NEW.business_date
       OR (NEW.due_at AT TIME ZONE NEW.centre_timezone)::date <> NEW.business_date
       OR (NEW.opens_at AT TIME ZONE NEW.centre_timezone)::time(0) <> scheduled_open
       OR (NEW.due_at AT TIME ZONE NEW.centre_timezone)::time(0) <> scheduled_due THEN
        RAISE EXCEPTION 'operational occurrence does not match its pinned civil-time schedule';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operational_check_occurrences_validate
    ON operational_check_occurrences;

CREATE TRIGGER operational_check_occurrences_validate
BEFORE INSERT ON operational_check_occurrences
FOR EACH ROW EXECUTE FUNCTION validate_operational_check_occurrence();

CREATE TABLE IF NOT EXISTS operational_check_responses (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    occurrence_id UUID NOT NULL,
    template_version_id UUID NOT NULL,
    audit_item_id UUID NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN (
        'COMPLIANT', 'PARTIALLY_COMPLIANT', 'NON_COMPLIANT',
        'NOT_APPLICABLE', 'NOT_OBSERVED',
        'IMMEDIATE_ACTION_REQUIRED', 'POSITIVE_PRACTICE'
    )),
    responded_by_principal_id UUID NOT NULL REFERENCES principals(id),
    responded_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, centre_id, id),
    UNIQUE (organisation_id, occurrence_id, audit_item_id),
    FOREIGN KEY (organisation_id, centre_id, occurrence_id, template_version_id)
        REFERENCES operational_check_occurrences(
            organisation_id, centre_id, id, template_version_id
        ),
    FOREIGN KEY (organisation_id, template_version_id, audit_item_id)
        REFERENCES audit_template_items(organisation_id, template_version_id, id)
);

CREATE OR REPLACE FUNCTION validate_operational_check_response()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM operational_check_occurrences AS occurrence
        JOIN audit_item_outcome_configurations AS configuration
          ON configuration.organisation_id = occurrence.organisation_id
         AND configuration.audit_item_id = NEW.audit_item_id
         AND configuration.outcome = NEW.outcome
         AND configuration.permitted
        WHERE occurrence.organisation_id = NEW.organisation_id
          AND occurrence.centre_id = NEW.centre_id
          AND occurrence.id = NEW.occurrence_id
          AND occurrence.template_version_id = NEW.template_version_id
          AND occurrence.status = 'OPEN'
          AND NEW.responded_at >= occurrence.opens_at
    ) THEN
        RAISE EXCEPTION 'operational response is not permitted for the open pinned occurrence';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operational_check_responses_validate
    ON operational_check_responses;

CREATE TRIGGER operational_check_responses_validate
BEFORE INSERT ON operational_check_responses
FOR EACH ROW EXECUTE FUNCTION validate_operational_check_response();

DROP TRIGGER IF EXISTS operational_check_responses_append_only
    ON operational_check_responses;

CREATE TRIGGER operational_check_responses_append_only
BEFORE UPDATE OR DELETE ON operational_check_responses
FOR EACH ROW EXECUTE FUNCTION reject_append_only_business_event_mutation();

CREATE OR REPLACE FUNCTION validate_operational_outcome_configuration()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    subtype TEXT;
BEGIN
    SELECT version.template_subtype
    INTO subtype
    FROM audit_template_items AS item
    JOIN audit_template_versions AS version
      ON version.organisation_id = item.organisation_id
     AND version.id = item.template_version_id
    WHERE item.organisation_id = NEW.organisation_id
      AND item.id = NEW.audit_item_id;

    IF subtype = 'OPERATIONAL_STANDARD' THEN
        IF NEW.creates_finding IS DISTINCT FROM NEW.creates_action THEN
            RAISE EXCEPTION 'operational outcomes must create both finding and action or neither';
        END IF;
        IF NEW.immediate THEN
            RAISE EXCEPTION 'operational outcome effects are created atomically at completion';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_item_outcome_config_validate_operational
    ON audit_item_outcome_configurations;

CREATE TRIGGER audit_item_outcome_config_validate_operational
BEFORE INSERT OR UPDATE ON audit_item_outcome_configurations
FOR EACH ROW EXECUTE FUNCTION validate_operational_outcome_configuration();

CREATE OR REPLACE FUNCTION prevent_completed_operational_occurrence_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'operational occurrence history cannot be deleted';
    END IF;
    IF OLD.status = 'COMPLETED' THEN
        RAISE EXCEPTION 'completed operational occurrence is immutable';
    END IF;
    IF NEW.id <> OLD.id
       OR NEW.organisation_id <> OLD.organisation_id
       OR NEW.centre_id <> OLD.centre_id
       OR NEW.deployment_id <> OLD.deployment_id
       OR NEW.schedule_revision_id <> OLD.schedule_revision_id
       OR NEW.template_version_id <> OLD.template_version_id
       OR NEW.template_subtype <> OLD.template_subtype
       OR NEW.business_date <> OLD.business_date
       OR NEW.centre_timezone <> OLD.centre_timezone
       OR NEW.opens_at <> OLD.opens_at
       OR NEW.due_at <> OLD.due_at THEN
        RAISE EXCEPTION 'operational occurrence source facts are immutable';
    END IF;
    IF NEW.status = 'COMPLETED' THEN
        IF NEW.completed_at < OLD.opens_at THEN
            RAISE EXCEPTION 'operational occurrence cannot be completed before it opens';
        END IF;
        IF NOT EXISTS (
            SELECT 1
            FROM audit_template_items
            WHERE organisation_id = OLD.organisation_id
              AND template_version_id = OLD.template_version_id
        ) OR EXISTS (
            SELECT 1
            FROM audit_template_items AS item
            WHERE item.organisation_id = OLD.organisation_id
              AND item.template_version_id = OLD.template_version_id
              AND NOT EXISTS (
                  SELECT 1
                  FROM operational_check_responses AS response
                  WHERE response.organisation_id = OLD.organisation_id
                    AND response.centre_id = OLD.centre_id
                    AND response.occurrence_id = OLD.id
                    AND response.template_version_id = OLD.template_version_id
                    AND response.audit_item_id = item.id
              )
        ) THEN
            RAISE EXCEPTION 'operational occurrence completion requires one response for every pinned item';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS operational_check_occurrences_immutable_history
    ON operational_check_occurrences;

CREATE TRIGGER operational_check_occurrences_immutable_history
BEFORE UPDATE OR DELETE ON operational_check_occurrences
FOR EACH ROW EXECUTE FUNCTION prevent_completed_operational_occurrence_mutation();

-- Backfill immutable centre ownership onto audit responses before findings are
-- made polymorphic. This allows PostgreSQL to prove run/response/centre identity.
ALTER TABLE audit_responses
    ADD COLUMN IF NOT EXISTS centre_id UUID;

DROP TRIGGER IF EXISTS audit_responses_prevent_finalised_mutation
    ON audit_responses;

UPDATE audit_responses AS response
SET centre_id = run.centre_id
FROM audit_runs AS run
WHERE run.organisation_id = response.organisation_id
  AND run.id = response.audit_run_id
  AND response.centre_id IS NULL;

ALTER TABLE audit_responses
    ALTER COLUMN centre_id SET NOT NULL;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_responses'::regclass
          AND conname = 'audit_responses_run_centre_fk'
    ) THEN
        ALTER TABLE audit_responses
            ADD CONSTRAINT audit_responses_run_centre_fk
            FOREIGN KEY (organisation_id, centre_id, audit_run_id)
            REFERENCES audit_runs(organisation_id, centre_id, id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'audit_responses'::regclass
          AND conname = 'audit_responses_source_identity_unique'
    ) THEN
        ALTER TABLE audit_responses
            ADD CONSTRAINT audit_responses_source_identity_unique
            UNIQUE (organisation_id, centre_id, audit_run_id, id);
    END IF;
END;
$$;

-- Preserve the accepted quarterly-write contract while making centre
-- ownership explicit for source-safe finding constraints. Existing callers
-- supply the audit run; PostgreSQL derives and verifies its centre.
CREATE OR REPLACE FUNCTION populate_audit_response_centre()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    resolved_centre_id UUID;
BEGIN
    SELECT centre_id
    INTO resolved_centre_id
    FROM audit_runs
    WHERE organisation_id = NEW.organisation_id
      AND id = NEW.audit_run_id;

    IF resolved_centre_id IS NULL THEN
        RAISE EXCEPTION 'audit response run is unavailable';
    END IF;
    IF NEW.centre_id IS NOT NULL AND NEW.centre_id <> resolved_centre_id THEN
        RAISE EXCEPTION 'audit response centre does not match its run';
    END IF;
    NEW.centre_id := resolved_centre_id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_responses_populate_centre
    ON audit_responses;

CREATE TRIGGER audit_responses_populate_centre
BEFORE INSERT OR UPDATE OF organisation_id, audit_run_id, centre_id
ON audit_responses
FOR EACH ROW EXECUTE FUNCTION populate_audit_response_centre();

DROP TRIGGER IF EXISTS audit_responses_prevent_finalised_mutation
    ON audit_responses;

CREATE TRIGGER audit_responses_prevent_finalised_mutation
BEFORE UPDATE OR DELETE ON audit_responses
FOR EACH ROW EXECUTE FUNCTION prevent_finalised_audit_history_mutation();

ALTER TABLE findings
    ADD COLUMN IF NOT EXISTS source_family TEXT,
    ADD COLUMN IF NOT EXISTS check_response_id UUID;

UPDATE findings
SET source_family = 'QUARTERLY_AUDIT'
WHERE source_family IS NULL;

ALTER TABLE findings
    ALTER COLUMN source_family SET NOT NULL,
    ALTER COLUMN source_family SET DEFAULT 'QUARTERLY_AUDIT',
    ALTER COLUMN audit_run_id DROP NOT NULL,
    ALTER COLUMN audit_response_id DROP NOT NULL,
    DROP CONSTRAINT IF EXISTS findings_organisation_id_audit_response_id_key;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'findings'::regclass
          AND conname = 'findings_source_family_check'
    ) THEN
        ALTER TABLE findings
            ADD CONSTRAINT findings_source_family_check
            CHECK (source_family IN ('QUARTERLY_AUDIT', 'OPERATIONAL_CHECK'));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'findings'::regclass
          AND conname = 'findings_exact_source_check'
    ) THEN
        ALTER TABLE findings
            ADD CONSTRAINT findings_exact_source_check
            CHECK (
                (
                    source_family = 'QUARTERLY_AUDIT'
                    AND audit_run_id IS NOT NULL
                    AND audit_response_id IS NOT NULL
                    AND check_response_id IS NULL
                )
                OR
                (
                    source_family = 'OPERATIONAL_CHECK'
                    AND audit_run_id IS NULL
                    AND audit_response_id IS NULL
                    AND check_response_id IS NOT NULL
                )
            );
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'findings'::regclass
          AND conname = 'findings_audit_source_identity_fk'
    ) THEN
        ALTER TABLE findings
            ADD CONSTRAINT findings_audit_source_identity_fk
            FOREIGN KEY (organisation_id, centre_id, audit_run_id, audit_response_id)
            REFERENCES audit_responses(organisation_id, centre_id, audit_run_id, id);
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'findings'::regclass
          AND conname = 'findings_operational_source_identity_fk'
    ) THEN
        ALTER TABLE findings
            ADD CONSTRAINT findings_operational_source_identity_fk
            FOREIGN KEY (organisation_id, centre_id, check_response_id)
            REFERENCES operational_check_responses(organisation_id, centre_id, id);
    END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS findings_quarterly_response_unique
    ON findings (organisation_id, centre_id, audit_run_id, audit_response_id)
    WHERE source_family = 'QUARTERLY_AUDIT';

CREATE UNIQUE INDEX IF NOT EXISTS findings_operational_response_unique
    ON findings (organisation_id, centre_id, check_response_id)
    WHERE source_family = 'OPERATIONAL_CHECK';

DROP INDEX IF EXISTS findings_recurrence_idx;

CREATE INDEX IF NOT EXISTS findings_quarterly_recurrence_idx
    ON findings (organisation_id, centre_id, item_lineage_key, created_at DESC)
    WHERE source_family = 'QUARTERLY_AUDIT';

CREATE OR REPLACE FUNCTION prevent_finding_source_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.source_family IS DISTINCT FROM OLD.source_family
       OR NEW.audit_run_id IS DISTINCT FROM OLD.audit_run_id
       OR NEW.audit_response_id IS DISTINCT FROM OLD.audit_response_id
       OR NEW.check_response_id IS DISTINCT FROM OLD.check_response_id
       OR NEW.organisation_id IS DISTINCT FROM OLD.organisation_id
       OR NEW.centre_id IS DISTINCT FROM OLD.centre_id THEN
        RAISE EXCEPTION 'finding source identity is immutable';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS findings_prevent_source_mutation
    ON findings;

CREATE TRIGGER findings_prevent_source_mutation
BEFORE UPDATE ON findings
FOR EACH ROW EXECUTE FUNCTION prevent_finding_source_mutation();

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
        IF resource_centre_id IS NULL THEN
            RAISE EXCEPTION 'audit operational occurrence does not belong to organisation';
        END IF;
        IF NEW.scope_type <> 'centre' OR NEW.scope_id IS DISTINCT FROM resource_centre_id THEN
            RAISE EXCEPTION 'audit operational occurrence scope does not match its centre';
        END IF;
    ELSIF NEW.resource_type = 'operational_check_response' THEN
        SELECT centre_id INTO resource_centre_id
        FROM operational_check_responses
        WHERE organisation_id = NEW.organisation_id AND id = NEW.resource_id;
        IF resource_centre_id IS NULL THEN
            RAISE EXCEPTION 'audit operational response does not belong to organisation';
        END IF;
        IF NEW.scope_type <> 'centre' OR NEW.scope_id IS DISTINCT FROM resource_centre_id THEN
            RAISE EXCEPTION 'audit operational response scope does not match its centre';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS system_audit_events_validate_centre_standards_target
    ON system_audit_events;

CREATE TRIGGER system_audit_events_validate_centre_standards_target
BEFORE INSERT ON system_audit_events
FOR EACH ROW EXECUTE FUNCTION validate_centre_standards_audit_target();

DROP TRIGGER IF EXISTS operational_standard_schedule_revisions_append_only
    ON operational_standard_schedule_revisions;

CREATE TRIGGER operational_standard_schedule_revisions_append_only
BEFORE UPDATE OR DELETE ON operational_standard_schedule_revisions
FOR EACH ROW EXECUTE FUNCTION reject_append_only_business_event_mutation();
