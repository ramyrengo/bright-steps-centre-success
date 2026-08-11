-- Milestone 2B acceptance remediation.
-- Preserve withdrawn findings/actions as history while removing them from active risk.
ALTER TABLE findings
    DROP CONSTRAINT findings_status_check,
    ADD COLUMN withdrawn_at TIMESTAMPTZ,
    ADD COLUMN withdrawn_by_principal_id UUID REFERENCES principals(id),
    ADD COLUMN withdrawal_reason TEXT
        CHECK (
            withdrawal_reason IS NULL
            OR char_length(btrim(withdrawal_reason)) BETWEEN 1 AND 1000
        ),
    ADD CONSTRAINT findings_status_check
        CHECK (status IN ('OPEN', 'RESOLVED', 'WITHDRAWN')),
    ADD CONSTRAINT findings_withdrawal_metadata_check
        CHECK (
            (status = 'WITHDRAWN') = (
                withdrawn_at IS NOT NULL
                AND withdrawn_by_principal_id IS NOT NULL
                AND withdrawal_reason IS NOT NULL
            )
        );

ALTER TABLE corrective_actions
    DROP CONSTRAINT corrective_actions_status_check,
    ADD COLUMN withdrawn_at TIMESTAMPTZ,
    ADD COLUMN withdrawn_by_principal_id UUID REFERENCES principals(id),
    ADD COLUMN withdrawal_reason TEXT
        CHECK (
            withdrawal_reason IS NULL
            OR char_length(btrim(withdrawal_reason)) BETWEEN 1 AND 1000
        ),
    ADD CONSTRAINT corrective_actions_status_check
        CHECK (status IN (
            'OPEN', 'IN_PROGRESS', 'VERIFICATION_REQUIRED', 'CLOSED',
            'MORE_INFORMATION_REQUIRED', 'REJECTED', 'WITHDRAWN'
        )),
    ADD CONSTRAINT corrective_actions_withdrawal_metadata_check
        CHECK (
            (status = 'WITHDRAWN') = (
                withdrawn_at IS NOT NULL
                AND withdrawn_by_principal_id IS NOT NULL
                AND withdrawal_reason IS NOT NULL
            )
        );

-- Product Owner rule: every immediate or critical configured action requires
-- independent verification. Refuse migration rather than silently rewriting a
-- released template if an invalid historical row is found.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM audit_item_outcome_configurations
        WHERE (immediate OR severity = 'CRITICAL')
          AND NOT independent_verification_required
    ) THEN
        RAISE EXCEPTION
            'critical or immediate audit configuration lacks independent verification';
    END IF;
END;
$$;

ALTER TABLE audit_item_outcome_configurations
    ADD CONSTRAINT audit_item_outcome_independent_verification_check
    CHECK (
        NOT (immediate OR severity = 'CRITICAL')
        OR independent_verification_required
    );

-- Oversight interpretation belongs to the versioned scoring policy, not an
-- application constant. The current released policy uses MINIMUM_STANDARD_MET
-- as its last band that is not below the internal threshold.
ALTER TABLE audit_performance_bands
    ADD COLUMN below_internal_threshold BOOLEAN;

DO $$
BEGIN
    IF EXISTS (
        SELECT scoring_policy_id
        FROM audit_performance_bands
        GROUP BY scoring_policy_id
        HAVING count(*) FILTER (WHERE band_code = 'MINIMUM_STANDARD_MET') <> 1
    ) THEN
        RAISE EXCEPTION
            'released scoring policy has no unambiguous internal threshold band';
    END IF;
END;
$$;

-- These migration-only corrections fill decimal gaps and record the existing
-- policy interpretation. Released configuration remains immutable afterward.
DROP TRIGGER audit_performance_bands_require_draft_parent
    ON audit_performance_bands;

WITH threshold_band AS (
    SELECT scoring_policy_id, priority
    FROM audit_performance_bands
    WHERE band_code = 'MINIMUM_STANDARD_MET'
)
UPDATE audit_performance_bands AS band
SET below_internal_threshold = band.priority > threshold.priority
FROM threshold_band AS threshold
WHERE threshold.scoring_policy_id = band.scoring_policy_id;

WITH complete_boundaries AS (
    SELECT
        id,
        COALESCE(
            lead(minimum_score) OVER (
                PARTITION BY scoring_policy_id
                ORDER BY minimum_score, priority, id
            ),
            100::numeric
        ) AS complete_maximum
    FROM audit_performance_bands
)
UPDATE audit_performance_bands AS band
SET maximum_score = boundary.complete_maximum
FROM complete_boundaries AS boundary
WHERE boundary.id = band.id
  AND band.maximum_score IS DISTINCT FROM boundary.complete_maximum;

CREATE TRIGGER audit_performance_bands_require_draft_parent
BEFORE INSERT OR UPDATE OR DELETE ON audit_performance_bands
FOR EACH ROW EXECUTE FUNCTION require_draft_scoring_policy_parent();

ALTER TABLE audit_performance_bands
    ALTER COLUMN below_internal_threshold SET NOT NULL,
    ALTER COLUMN below_internal_threshold SET DEFAULT FALSE,
    DROP CONSTRAINT audit_performance_bands_check,
    ADD CONSTRAINT audit_performance_bands_range_order_check
        CHECK (maximum_score > minimum_score),
    ADD CONSTRAINT audit_performance_bands_priority_unique
        UNIQUE (scoring_policy_id, priority);

-- Bands use [minimum, maximum), except that the final maximum of 100 is
-- inclusive. Completeness is validated when a policy becomes active.
CREATE FUNCTION validate_audit_performance_band_set(policy_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    band_count INTEGER;
    first_minimum NUMERIC(5,2);
    final_maximum NUMERIC(5,2);
    discontinuity_count INTEGER;
BEGIN
    SELECT count(*), min(minimum_score), max(maximum_score)
    INTO band_count, first_minimum, final_maximum
    FROM audit_performance_bands
    WHERE scoring_policy_id = policy_id;

    IF band_count = 0 OR first_minimum <> 0 OR final_maximum <> 100 THEN
        RAISE EXCEPTION 'audit performance bands must cover scores from 0 through 100';
    END IF;

    SELECT count(*)
    INTO discontinuity_count
    FROM (
        SELECT
            minimum_score,
            lag(maximum_score) OVER (
                ORDER BY minimum_score, priority, id
            ) AS previous_maximum
        FROM audit_performance_bands
        WHERE scoring_policy_id = policy_id
    ) AS ordered
    WHERE previous_maximum IS NOT NULL
      AND minimum_score <> previous_maximum;

    IF discontinuity_count <> 0 THEN
        RAISE EXCEPTION 'audit performance bands contain a gap or overlap';
    END IF;
END;
$$;

CREATE FUNCTION validate_activated_audit_scoring_policy_bands()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.status = 'active'
       AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'active') THEN
        PERFORM validate_audit_performance_band_set(NEW.id);
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER audit_scoring_policies_validate_bands_before_activation
BEFORE INSERT OR UPDATE ON audit_scoring_policies
FOR EACH ROW EXECUTE FUNCTION validate_activated_audit_scoring_policy_bands();

DO $$
DECLARE
    policy RECORD;
BEGIN
    FOR policy IN
        SELECT id
        FROM audit_scoring_policies
        WHERE status = 'active'
    LOOP
        PERFORM validate_audit_performance_band_set(policy.id);
    END LOOP;
END;
$$;
