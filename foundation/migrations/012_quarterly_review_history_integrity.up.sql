CREATE FUNCTION prevent_finalised_audit_run_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = 'FINALISED' THEN
        RAISE EXCEPTION 'finalised audit result is immutable';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_runs_prevent_finalised_mutation
BEFORE UPDATE OR DELETE ON audit_runs
FOR EACH ROW EXECUTE FUNCTION prevent_finalised_audit_run_mutation();

CREATE FUNCTION require_draft_scoring_policy_parent()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    policy_id UUID;
BEGIN
    policy_id := COALESCE(NEW.scoring_policy_id, OLD.scoring_policy_id);
    IF NOT EXISTS (
        SELECT 1
        FROM audit_scoring_policies
        WHERE id = policy_id AND status = 'draft'
    ) THEN
        RAISE EXCEPTION 'released audit scoring configuration is immutable';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_scoring_outcome_rules_require_draft_parent
BEFORE INSERT OR UPDATE OR DELETE ON audit_scoring_outcome_rules
FOR EACH ROW EXECUTE FUNCTION require_draft_scoring_policy_parent();

CREATE TRIGGER audit_performance_bands_require_draft_parent
BEFORE INSERT OR UPDATE OR DELETE ON audit_performance_bands
FOR EACH ROW EXECUTE FUNCTION require_draft_scoring_policy_parent();

CREATE FUNCTION prevent_released_scoring_policy_mutation()
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
           AND NEW.policy_key = OLD.policy_key
           AND NEW.version = OLD.version
           AND NEW.name = OLD.name
           AND NEW.rounding_scale = OLD.rounding_scale
           AND NEW.source_classification = OLD.source_classification THEN
            RETURN NEW;
        END IF;
        RAISE EXCEPTION 'released audit scoring policies are immutable';
    END IF;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER audit_scoring_policies_prevent_released_mutation
BEFORE UPDATE OR DELETE ON audit_scoring_policies
FOR EACH ROW EXECUTE FUNCTION prevent_released_scoring_policy_mutation();
