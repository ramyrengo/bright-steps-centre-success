CREATE TABLE audit_templates (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    template_key TEXT NOT NULL CHECK (template_key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    audit_type TEXT NOT NULL CHECK (audit_type = 'quarterly_review'),
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, template_key),
    CHECK (updated_at >= created_at)
);

CREATE TABLE audit_scoring_policies (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    policy_key TEXT NOT NULL CHECK (policy_key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    version INTEGER NOT NULL CHECK (version > 0),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded')),
    rounding_scale INTEGER NOT NULL DEFAULT 1 CHECK (rounding_scale BETWEEN 0 AND 2),
    source_classification TEXT NOT NULL CHECK (source_classification IN ('BSA_INTERNAL', 'BSA_DEVELOPMENT_TEST')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, policy_key, version)
);

CREATE TABLE audit_scoring_outcome_rules (
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    scoring_policy_id UUID NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN (
        'COMPLIANT', 'PARTIALLY_COMPLIANT', 'NON_COMPLIANT',
        'NOT_APPLICABLE', 'NOT_OBSERVED',
        'IMMEDIATE_ACTION_REQUIRED', 'POSITIVE_PRACTICE'
    )),
    score_factor NUMERIC(6,4),
    denominator_treatment TEXT NOT NULL CHECK (denominator_treatment IN ('included', 'excluded')),
    requires_reason BOOLEAN NOT NULL DEFAULT FALSE,
    PRIMARY KEY (scoring_policy_id, outcome),
    FOREIGN KEY (organisation_id, scoring_policy_id)
        REFERENCES audit_scoring_policies(organisation_id, id),
    CHECK (
        (denominator_treatment = 'included' AND score_factor BETWEEN 0 AND 1)
        OR (denominator_treatment = 'excluded' AND score_factor IS NULL)
    )
);

CREATE TABLE audit_performance_bands (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    scoring_policy_id UUID NOT NULL,
    band_code TEXT NOT NULL CHECK (band_code ~ '^[A-Z][A-Z0-9_]{0,49}$'),
    label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
    minimum_score NUMERIC(5,2) NOT NULL CHECK (minimum_score BETWEEN 0 AND 100),
    maximum_score NUMERIC(5,2) NOT NULL CHECK (maximum_score BETWEEN 0 AND 100),
    priority INTEGER NOT NULL CHECK (priority > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (scoring_policy_id, band_code),
    FOREIGN KEY (organisation_id, scoring_policy_id)
        REFERENCES audit_scoring_policies(organisation_id, id),
    CHECK (maximum_score >= minimum_score)
);

CREATE TABLE audit_template_versions (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    audit_template_id UUID NOT NULL,
    scoring_policy_id UUID NOT NULL,
    version INTEGER NOT NULL CHECK (version > 0),
    title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
    instructions TEXT NOT NULL CHECK (char_length(btrim(instructions)) BETWEEN 1 AND 2000),
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded')),
    effective_from TIMESTAMPTZ NOT NULL,
    source_classification TEXT NOT NULL CHECK (source_classification IN ('BSA_INTERNAL', 'BSA_DEVELOPMENT_TEST')),
    synthetic BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, audit_template_id, version),
    FOREIGN KEY (organisation_id, audit_template_id)
        REFERENCES audit_templates(organisation_id, id),
    FOREIGN KEY (organisation_id, scoring_policy_id)
        REFERENCES audit_scoring_policies(organisation_id, id)
);

CREATE UNIQUE INDEX audit_template_versions_one_active
    ON audit_template_versions (audit_template_id)
    WHERE status = 'active';

CREATE TABLE audit_template_sections (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    template_version_id UUID NOT NULL,
    stable_key TEXT NOT NULL CHECK (stable_key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 150),
    instructions TEXT CHECK (instructions IS NULL OR char_length(btrim(instructions)) BETWEEN 1 AND 1000),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, template_version_id, id),
    UNIQUE (template_version_id, stable_key),
    UNIQUE (template_version_id, sort_order),
    FOREIGN KEY (organisation_id, template_version_id)
        REFERENCES audit_template_versions(organisation_id, id)
);

CREATE TABLE audit_template_items (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    template_version_id UUID NOT NULL,
    section_id UUID NOT NULL,
    lineage_key TEXT NOT NULL CHECK (lineage_key ~ '^[a-z][a-z0-9_.-]{0,149}$'),
    wording TEXT NOT NULL CHECK (char_length(btrim(wording)) BETWEEN 1 AND 500),
    instructions TEXT CHECK (instructions IS NULL OR char_length(btrim(instructions)) BETWEEN 1 AND 1500),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    scoring_weight NUMERIC(8,3) NOT NULL CHECK (scoring_weight >= 0),
    scored BOOLEAN NOT NULL,
    critical BOOLEAN NOT NULL DEFAULT FALSE,
    evidence_requirement TEXT NOT NULL CHECK (evidence_requirement IN ('none', 'optional', 'required')),
    applicability TEXT NOT NULL CHECK (applicability IN ('required', 'optional')),
    source_classification TEXT NOT NULL CHECK (source_classification IN (
        'REGULATORY_REQUIREMENT', 'QUALITY_FRAMEWORK', 'BSA_POLICY',
        'BSA_PROCEDURE', 'RECOMMENDED_PRACTICE', 'BSA_DEVELOPMENT_TEST'
    )),
    source_reference TEXT CHECK (source_reference IS NULL OR char_length(btrim(source_reference)) BETWEEN 1 AND 500),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, template_version_id, id),
    UNIQUE (template_version_id, lineage_key),
    UNIQUE (template_version_id, section_id, sort_order),
    FOREIGN KEY (organisation_id, template_version_id)
        REFERENCES audit_template_versions(organisation_id, id),
    FOREIGN KEY (organisation_id, template_version_id, section_id)
        REFERENCES audit_template_sections(organisation_id, template_version_id, id),
    CHECK (scored OR scoring_weight = 0)
);

CREATE TABLE audit_item_outcome_configurations (
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    audit_item_id UUID NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN (
        'COMPLIANT', 'PARTIALLY_COMPLIANT', 'NON_COMPLIANT',
        'NOT_APPLICABLE', 'NOT_OBSERVED',
        'IMMEDIATE_ACTION_REQUIRED', 'POSITIVE_PRACTICE'
    )),
    permitted BOOLEAN NOT NULL DEFAULT TRUE,
    creates_finding BOOLEAN NOT NULL DEFAULT FALSE,
    creates_action BOOLEAN NOT NULL DEFAULT FALSE,
    immediate BOOLEAN NOT NULL DEFAULT FALSE,
    severity TEXT CHECK (severity IS NULL OR severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    due_days INTEGER CHECK (due_days IS NULL OR due_days BETWEEN 0 AND 365),
    independent_verification_required BOOLEAN NOT NULL DEFAULT FALSE,
    required_remediation TEXT CHECK (required_remediation IS NULL OR char_length(btrim(required_remediation)) BETWEEN 1 AND 1000),
    PRIMARY KEY (audit_item_id, outcome),
    FOREIGN KEY (organisation_id, audit_item_id)
        REFERENCES audit_template_items(organisation_id, id),
    CHECK (NOT immediate OR outcome = 'IMMEDIATE_ACTION_REQUIRED'),
    CHECK (NOT creates_action OR creates_finding),
    CHECK (NOT creates_action OR (severity IS NOT NULL AND due_days IS NOT NULL AND required_remediation IS NOT NULL))
);

CREATE TABLE audit_runs (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    template_version_id UUID NOT NULL,
    auditor_principal_id UUID NOT NULL REFERENCES principals(id),
    review_period_start DATE NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('DRAFT', 'IN_PROGRESS', 'READY_FOR_REVIEW', 'FINALISED')),
    started_at TIMESTAMPTZ NOT NULL,
    ready_at TIMESTAMPTZ,
    finalised_at TIMESTAMPTZ,
    finalised_by_principal_id UUID REFERENCES principals(id),
    overall_score NUMERIC(5,2) CHECK (overall_score IS NULL OR overall_score BETWEEN 0 AND 100),
    performance_band_code TEXT,
    performance_band_label TEXT,
    risk_status TEXT CHECK (risk_status IS NULL OR risk_status IN ('STRONG', 'IMPROVEMENT_REQUIRED', 'AT_RISK', 'PRIORITY_INTERVENTION', 'HIGH', 'CRITICAL')),
    coverage_percent NUMERIC(5,2) CHECK (coverage_percent IS NULL OR coverage_percent BETWEEN 0 AND 100),
    critical_finding_count INTEGER NOT NULL DEFAULT 0 CHECK (critical_finding_count >= 0),
    high_finding_count INTEGER NOT NULL DEFAULT 0 CHECK (high_finding_count >= 0),
    action_count INTEGER NOT NULL DEFAULT 0 CHECK (action_count >= 0),
    positive_practice_count INTEGER NOT NULL DEFAULT 0 CHECK (positive_practice_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, centre_id, template_version_id, review_period_start),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    FOREIGN KEY (organisation_id, template_version_id)
        REFERENCES audit_template_versions(organisation_id, id),
    CHECK (date_trunc('quarter', review_period_start::timestamp)::date = review_period_start),
    CHECK (updated_at >= created_at),
    CHECK ((status = 'FINALISED') = (finalised_at IS NOT NULL AND finalised_by_principal_id IS NOT NULL))
);

CREATE INDEX audit_runs_centre_time_idx
    ON audit_runs (organisation_id, centre_id, review_period_start DESC);

CREATE TABLE audit_responses (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    audit_run_id UUID NOT NULL,
    audit_item_id UUID NOT NULL,
    outcome TEXT NOT NULL CHECK (outcome IN (
        'COMPLIANT', 'PARTIALLY_COMPLIANT', 'NON_COMPLIANT',
        'NOT_APPLICABLE', 'NOT_OBSERVED',
        'IMMEDIATE_ACTION_REQUIRED', 'POSITIVE_PRACTICE'
    )),
    comment TEXT CHECK (comment IS NULL OR char_length(btrim(comment)) BETWEEN 1 AND 2000),
    location_context TEXT CHECK (location_context IS NULL OR char_length(btrim(location_context)) BETWEEN 1 AND 300),
    selected_owner_principal_id UUID REFERENCES principals(id),
    responded_by_principal_id UUID NOT NULL REFERENCES principals(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, audit_run_id, audit_item_id),
    FOREIGN KEY (organisation_id, audit_run_id)
        REFERENCES audit_runs(organisation_id, id),
    FOREIGN KEY (organisation_id, audit_item_id)
        REFERENCES audit_template_items(organisation_id, id),
    CHECK (updated_at >= created_at)
);

CREATE TABLE audit_section_results (
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    audit_run_id UUID NOT NULL,
    section_id UUID NOT NULL,
    eligible_weight NUMERIC(12,3) NOT NULL CHECK (eligible_weight >= 0),
    achieved_weight NUMERIC(12,3) NOT NULL CHECK (achieved_weight >= 0),
    score NUMERIC(5,2) CHECK (score IS NULL OR score BETWEEN 0 AND 100),
    coverage_percent NUMERIC(5,2) NOT NULL CHECK (coverage_percent BETWEEN 0 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (audit_run_id, section_id),
    FOREIGN KEY (organisation_id, audit_run_id)
        REFERENCES audit_runs(organisation_id, id),
    FOREIGN KEY (organisation_id, section_id)
        REFERENCES audit_template_sections(organisation_id, id)
);

CREATE TABLE findings (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    audit_run_id UUID NOT NULL,
    audit_response_id UUID NOT NULL,
    item_lineage_key TEXT NOT NULL CHECK (char_length(btrim(item_lineage_key)) BETWEEN 1 AND 150),
    severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 1500),
    source_classification TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('OPEN', 'RESOLVED')),
    created_by_principal_id UUID NOT NULL REFERENCES principals(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, audit_response_id),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    FOREIGN KEY (organisation_id, audit_run_id)
        REFERENCES audit_runs(organisation_id, id),
    FOREIGN KEY (organisation_id, audit_response_id)
        REFERENCES audit_responses(organisation_id, id),
    CHECK (updated_at >= created_at)
);

CREATE INDEX findings_recurrence_idx
    ON findings (organisation_id, centre_id, item_lineage_key, created_at DESC);

CREATE TABLE corrective_actions (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    finding_id UUID NOT NULL,
    owner_principal_id UUID REFERENCES principals(id),
    title TEXT NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 300),
    required_remediation TEXT NOT NULL CHECK (char_length(btrim(required_remediation)) BETWEEN 1 AND 1500),
    evidence_requirement TEXT NOT NULL CHECK (evidence_requirement IN ('none', 'optional', 'required')),
    severity TEXT NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL')),
    due_at TIMESTAMPTZ NOT NULL,
    independent_verification_required BOOLEAN NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'OPEN', 'IN_PROGRESS', 'EVIDENCE_SUBMITTED', 'VERIFICATION_REQUIRED',
        'VERIFIED', 'CLOSED', 'MORE_INFORMATION_REQUIRED', 'REJECTED'
    )),
    remediation_submitted_by_principal_id UUID REFERENCES principals(id),
    remediation_submitted_at TIMESTAMPTZ,
    verified_by_principal_id UUID REFERENCES principals(id),
    verified_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, finding_id),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    FOREIGN KEY (organisation_id, finding_id)
        REFERENCES findings(organisation_id, id),
    CHECK (updated_at >= created_at),
    CHECK ((status = 'CLOSED') = (closed_at IS NOT NULL))
);

CREATE INDEX corrective_actions_owner_status_idx
    ON corrective_actions (organisation_id, owner_principal_id, status, due_at);

CREATE TABLE corrective_action_events (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    corrective_action_id UUID NOT NULL,
    actor_principal_id UUID NOT NULL REFERENCES principals(id),
    event_type TEXT NOT NULL CHECK (event_type ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    from_status TEXT,
    to_status TEXT NOT NULL,
    reason TEXT CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 1000),
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    FOREIGN KEY (organisation_id, corrective_action_id)
        REFERENCES corrective_actions(organisation_id, id)
);

CREATE TABLE positive_observations (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    audit_run_id UUID NOT NULL,
    audit_response_id UUID NOT NULL,
    description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 1500),
    created_by_principal_id UUID NOT NULL REFERENCES principals(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, audit_response_id),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    FOREIGN KEY (organisation_id, audit_run_id)
        REFERENCES audit_runs(organisation_id, id),
    FOREIGN KEY (organisation_id, audit_response_id)
        REFERENCES audit_responses(organisation_id, id)
);

CREATE TABLE audit_acknowledgements (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    audit_run_id UUID NOT NULL,
    principal_id UUID NOT NULL REFERENCES principals(id),
    comment TEXT CHECK (comment IS NULL OR char_length(btrim(comment)) BETWEEN 1 AND 1000),
    acknowledged_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, audit_run_id, principal_id),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    FOREIGN KEY (organisation_id, audit_run_id)
        REFERENCES audit_runs(organisation_id, id)
);

CREATE TABLE evidence_items (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    object_key TEXT NOT NULL CHECK (char_length(btrim(object_key)) BETWEEN 1 AND 500),
    object_version TEXT,
    original_filename TEXT NOT NULL CHECK (char_length(btrim(original_filename)) BETWEEN 1 AND 255),
    media_type TEXT NOT NULL CHECK (char_length(btrim(media_type)) BETWEEN 1 AND 150),
    byte_size BIGINT CHECK (byte_size IS NULL OR byte_size BETWEEN 1 AND 10485760),
    checksum TEXT CHECK (checksum IS NULL OR checksum ~ '^[a-f0-9]{64}$'),
    classification TEXT NOT NULL CHECK (classification = 'CONFIDENTIAL_AUDIT_EVIDENCE'),
    purpose TEXT NOT NULL CHECK (purpose IN ('AUDIT_RESPONSE', 'CORRECTIVE_ACTION_REMEDIATION')),
    upload_status TEXT NOT NULL CHECK (upload_status IN ('PENDING', 'UPLOADED', 'FAILED')),
    scan_status TEXT NOT NULL CHECK (scan_status IN ('not_scanned', 'clean', 'rejected')),
    availability_status TEXT NOT NULL CHECK (availability_status IN ('PENDING', 'AVAILABLE_LOCAL_UNSCANNED', 'AVAILABLE', 'RESTRICTED')),
    uploaded_by_principal_id UUID NOT NULL REFERENCES principals(id),
    uploaded_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (object_key),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    CHECK (updated_at >= created_at)
);

CREATE TABLE audit_response_evidence (
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    audit_response_id UUID NOT NULL,
    evidence_item_id UUID NOT NULL,
    linked_by_principal_id UUID NOT NULL REFERENCES principals(id),
    linked_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (audit_response_id, evidence_item_id),
    FOREIGN KEY (organisation_id, audit_response_id)
        REFERENCES audit_responses(organisation_id, id),
    FOREIGN KEY (organisation_id, evidence_item_id)
        REFERENCES evidence_items(organisation_id, id)
);

CREATE TABLE corrective_action_evidence (
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    corrective_action_id UUID NOT NULL,
    evidence_item_id UUID NOT NULL,
    linked_by_principal_id UUID NOT NULL REFERENCES principals(id),
    linked_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (corrective_action_id, evidence_item_id),
    FOREIGN KEY (organisation_id, corrective_action_id)
        REFERENCES corrective_actions(organisation_id, id),
    FOREIGN KEY (organisation_id, evidence_item_id)
        REFERENCES evidence_items(organisation_id, id)
);

CREATE FUNCTION validate_audit_response_template_item()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM audit_runs AS run
        JOIN audit_template_items AS item
          ON item.organisation_id = run.organisation_id
         AND item.template_version_id = run.template_version_id
        WHERE run.organisation_id = NEW.organisation_id
          AND run.id = NEW.audit_run_id
          AND item.id = NEW.audit_item_id
    ) THEN
        RAISE EXCEPTION 'audit response item does not belong to pinned template version';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER audit_responses_validate_template_item
BEFORE INSERT OR UPDATE ON audit_responses
FOR EACH ROW EXECUTE FUNCTION validate_audit_response_template_item();

CREATE FUNCTION prevent_released_audit_template_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status IN ('active', 'superseded') THEN
        IF TG_OP = 'UPDATE'
           AND OLD.status = 'active'
           AND NEW.status = 'superseded'
           AND NEW.id = OLD.id
           AND NEW.organisation_id = OLD.organisation_id
           AND NEW.audit_template_id = OLD.audit_template_id
           AND NEW.scoring_policy_id = OLD.scoring_policy_id
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

CREATE FUNCTION require_draft_audit_template_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    parent_version_id UUID;
BEGIN
    IF TG_TABLE_NAME = 'audit_template_sections' THEN
        parent_version_id := COALESCE(NEW.template_version_id, OLD.template_version_id);
    ELSIF TG_TABLE_NAME = 'audit_template_items' THEN
        parent_version_id := COALESCE(NEW.template_version_id, OLD.template_version_id);
    ELSE
        SELECT item.template_version_id
        INTO parent_version_id
        FROM audit_template_items AS item
        WHERE item.id = COALESCE(NEW.audit_item_id, OLD.audit_item_id);
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM audit_template_versions
        WHERE id = parent_version_id AND status = 'draft'
    ) THEN
        RAISE EXCEPTION 'released audit template content is immutable';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_template_sections_require_draft_parent
BEFORE INSERT OR UPDATE OR DELETE ON audit_template_sections
FOR EACH ROW EXECUTE FUNCTION require_draft_audit_template_parent();

CREATE TRIGGER audit_template_items_require_draft_parent
BEFORE INSERT OR UPDATE OR DELETE ON audit_template_items
FOR EACH ROW EXECUTE FUNCTION require_draft_audit_template_parent();

CREATE TRIGGER audit_item_outcome_config_require_draft_parent
BEFORE INSERT OR UPDATE OR DELETE ON audit_item_outcome_configurations
FOR EACH ROW EXECUTE FUNCTION require_draft_audit_template_parent();

CREATE FUNCTION prevent_finalised_audit_history_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    run_id UUID;
BEGIN
    run_id := COALESCE(NEW.audit_run_id, OLD.audit_run_id);
    IF EXISTS (SELECT 1 FROM audit_runs WHERE id = run_id AND status = 'FINALISED') THEN
        RAISE EXCEPTION 'finalised audit history is immutable';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_responses_prevent_finalised_mutation
BEFORE UPDATE OR DELETE ON audit_responses
FOR EACH ROW EXECUTE FUNCTION prevent_finalised_audit_history_mutation();

CREATE FUNCTION reject_append_only_business_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER corrective_action_events_append_only
BEFORE UPDATE OR DELETE ON corrective_action_events
FOR EACH ROW EXECUTE FUNCTION reject_append_only_business_event_mutation();

CREATE TRIGGER audit_acknowledgements_append_only
BEFORE UPDATE OR DELETE ON audit_acknowledgements
FOR EACH ROW EXECUTE FUNCTION reject_append_only_business_event_mutation();

CREATE TRIGGER positive_observations_append_only
BEFORE UPDATE OR DELETE ON positive_observations
FOR EACH ROW EXECUTE FUNCTION reject_append_only_business_event_mutation();

CREATE FUNCTION validate_quarterly_review_audit_target()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.resource_type = 'quarterly_audit' AND NOT EXISTS (
        SELECT 1 FROM audit_runs WHERE organisation_id = NEW.organisation_id AND id = NEW.resource_id
    ) THEN
        RAISE EXCEPTION 'audit quarterly-review resource does not belong to organisation';
    ELSIF NEW.resource_type = 'finding' AND NOT EXISTS (
        SELECT 1 FROM findings WHERE organisation_id = NEW.organisation_id AND id = NEW.resource_id
    ) THEN
        RAISE EXCEPTION 'audit finding resource does not belong to organisation';
    ELSIF NEW.resource_type = 'corrective_action' AND NOT EXISTS (
        SELECT 1 FROM corrective_actions WHERE organisation_id = NEW.organisation_id AND id = NEW.resource_id
    ) THEN
        RAISE EXCEPTION 'audit corrective-action resource does not belong to organisation';
    ELSIF NEW.resource_type = 'evidence_item' AND NOT EXISTS (
        SELECT 1 FROM evidence_items WHERE organisation_id = NEW.organisation_id AND id = NEW.resource_id
    ) THEN
        RAISE EXCEPTION 'audit evidence resource does not belong to organisation';
    ELSIF NEW.resource_type = 'audit_acknowledgement' AND NOT EXISTS (
        SELECT 1 FROM audit_acknowledgements WHERE organisation_id = NEW.organisation_id AND id = NEW.resource_id
    ) THEN
        RAISE EXCEPTION 'audit acknowledgement resource does not belong to organisation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER system_audit_events_validate_quarterly_review_target
BEFORE INSERT ON system_audit_events
FOR EACH ROW EXECUTE FUNCTION validate_quarterly_review_audit_target();
