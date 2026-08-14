-- Centre Budgets approved threshold rules.
--
-- 028 recorded, at length, why the two approved threshold rules could not be
-- seeded against the 027 schema. This migration changes the schema so both can
-- be stated exactly as they were approved, and then states them.
--
-- The two rules, from the BSA Budget Expenses template supplied by Karen (Area
-- Manager), approved organisation-wide by the Product Owner on 14 August 2026:
--
--   Rule A, "budget used", a percentage of the approved monthly budget.
--       used > 100%            RED
--       85% <= used <= 100%    AMBER
--       used < 85%             GREEN
--
--   Rule B, "remaining budget", a dollar balance judged as a proportion of that
--   month's approved budget.
--       remaining < 0                      RED
--       0 <= remaining < 10% of approved   AMBER
--       remaining >= 10% of approved       GREEN
--
-- Rule B is deliberately proportional rather than a flat dollar figure, because
-- $50 remaining is comfortable on a $2,000 budget and alarming on a $200 one.
-- It is NOT Rule A restated: the two agree only while the approved budget is
-- strictly positive. At an approved budget of zero, percent used is undefined
-- and Rule A cannot judge the month, while Rule B still can. At a negative
-- approved budget the two orderings invert. `amount` carries no non-negative
-- CHECK, so both states are reachable, and the rules are therefore stored,
-- resolved and reported separately. Nothing here merges them.
--
-- What each part of this migration closes, in the numbering 028 used:
--   1. A rule dimension, so a bound on `remaining` has somewhere to live.
--   2. Independent rules with their own measure, so Rule B is never recast as
--      Rule A.
--   3. Explicit inclusive/exclusive flags on both bounds, so "100 inclusive,
--      red strictly above" is stated rather than approximated with 100.01.
--   4. One resolved band per rule, carried per rule all the way to the wire, so
--      two rules can disagree and both are shown.
--   5. An approval source type, so an approval that happened outside this
--      system is attributed to the document and the person that carry it,
--      without a principal row being invented for a migration to point at.
--
-- Unknown is not zero, and it is not a colour either. Seeding bands is exactly
-- the change that could make an absent actual start resolving to whichever band
-- happens to contain zero. `budget_threshold_band_matches` therefore returns
-- FALSE for a measure that could not be computed, in one place, before any
-- bound is considered.

-- ---------------------------------------------------------------------------
-- Blocker 5. Approval attribution that does not require a runtime principal.
--
-- `role_assignments` already models this: `grant_source_type` names the kind of
-- actor, and a CHECK ties the principal column to it, so a system or bootstrap
-- grant is honestly unattributed to a person rather than pointing at a fabricated
-- one. 027 uses the same shape on its own facts, where a manual entry names the
-- human and an import names the connection, and "neither may masquerade as the
-- other". A policy approved in a meeting and recorded in a document is a third
-- real case: there is a named approver and a citable reference, and there is no
-- principal row, because approval did not happen in this system.
-- ---------------------------------------------------------------------------

ALTER TABLE budget_threshold_policies
    ADD COLUMN approval_source_type TEXT,
    -- The person or body named by the source document. Only ever populated for
    -- a `governed_document` approval, where no principal row exists to name.
    ADD COLUMN approved_by_name TEXT
        CHECK (approved_by_name IS NULL OR char_length(btrim(approved_by_name)) BETWEEN 1 AND 200),
    -- The date the source document records the approval as having been given,
    -- which is a different fact from when this row was written.
    ADD COLUMN approved_on DATE;

-- Every row that exists predates this column and either names a principal or is
-- an unattributed draft, so 'principal' describes all of them without asserting
-- anything new. No row is given a name or a date it did not have.
UPDATE budget_threshold_policies SET approval_source_type = 'principal';

ALTER TABLE budget_threshold_policies
    ALTER COLUMN approval_source_type SET NOT NULL;

-- 027's approval CHECK is unnamed, so it is located by what it constrains
-- rather than by a generated name that could differ. It required a principal on
-- every active policy, which is precisely what makes an approval given outside
-- this system impossible to record, so it is replaced rather than kept.
DO $$
DECLARE
    constraint_name TEXT;
    dropped INTEGER := 0;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'budget_threshold_policies'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%approved_by_principal_id%'
    LOOP
        EXECUTE format(
            'ALTER TABLE budget_threshold_policies DROP CONSTRAINT %I',
            constraint_name
        );
        dropped := dropped + 1;
    END LOOP;

    IF dropped <> 1 THEN
        RAISE EXCEPTION
            'expected exactly one approver CHECK on budget_threshold_policies, found %',
            dropped;
    END IF;
END;
$$;

ALTER TABLE budget_threshold_policies
    ADD CONSTRAINT budget_threshold_policies_approval_source_check
        CHECK (approval_source_type IN ('principal', 'governed_document')),
    -- Neither form may masquerade as the other, in any status. A policy
    -- approved outside this system never names a principal, and a policy
    -- approved inside it never carries a hand-written name.
    ADD CONSTRAINT budget_threshold_policies_approval_shape_check
        CHECK (
            (
                approval_source_type = 'principal'
                AND approved_by_name IS NULL
                AND approved_on IS NULL
            )
            OR (
                approval_source_type = 'governed_document'
                AND approved_by_principal_id IS NULL
            )
        ),
    -- An active policy is fully attributed, one way or the other. A draft may
    -- still be incomplete, exactly as it could before.
    ADD CONSTRAINT budget_threshold_policies_active_approval_check
        CHECK (
            status <> 'active'
            OR (
                approval_reference IS NOT NULL
                AND (
                    (approval_source_type = 'principal' AND approved_by_principal_id IS NOT NULL)
                    OR (
                        approval_source_type = 'governed_document'
                        AND approved_by_name IS NOT NULL
                        AND approved_on IS NOT NULL
                    )
                )
            )
        );

-- ---------------------------------------------------------------------------
-- Blockers 1 and 2. A rule dimension, each rule naming the quantity it judges.
--
-- The discriminator goes on a rule that owns its bands, not on the policy,
-- because both rules are one approval: one approver, one reference, one date,
-- one effective-dated version. Splitting them across two policies would let
-- their effective ranges drift apart, would need the same approval recorded
-- twice, and would make "the policy in force for this month" ambiguous where it
-- is currently a single row. Putting the measure on each band instead would let
-- two bands of one rule disagree about what they are measuring.
-- ---------------------------------------------------------------------------

CREATE TABLE budget_threshold_rules (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    threshold_policy_id UUID NOT NULL,
    rule_code TEXT NOT NULL CHECK (rule_code ~ '^[A-Z][A-Z0-9_]{0,49}$'),
    label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
    -- The quantity this rule's bands are compared against.
    -- `percent_used`     recorded actual as a percentage of approved budget,
    --                    which is undefined when the approved budget is zero.
    -- `remaining_amount` approved budget less recorded actual, an exact money
    --                    amount in the position's own currency.
    -- Both are known only when an approved budget and an actual both exist.
    measure TEXT NOT NULL CHECK (measure IN ('percent_used', 'remaining_amount')),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, threshold_policy_id, id),
    UNIQUE (threshold_policy_id, rule_code),
    UNIQUE (threshold_policy_id, sort_order),
    FOREIGN KEY (organisation_id, threshold_policy_id)
        REFERENCES budget_threshold_policies(organisation_id, id)
);

-- ---------------------------------------------------------------------------
-- Blockers 1, 2 and 3. Bands belong to a rule, and each bound states its own
-- basis and its own inclusivity.
--
-- A bound is either absent, meaning open ended, or a value in one of two bases:
--   `measure_units`       the bound is in the measure's own units: percentage
--                         points for `percent_used`, money for
--                         `remaining_amount`.
--   `percent_of_approved` the bound is that percentage of the approved budget,
--                         evaluated for the position being judged. This is what
--                         makes Rule B's "10% of approved" a proportion rather
--                         than a flat dollar figure, and it is why Rule B cannot
--                         be written as a fixed range.
-- ---------------------------------------------------------------------------

ALTER TABLE budget_threshold_bands
    ADD COLUMN threshold_rule_id UUID,
    ADD COLUMN minimum_basis TEXT,
    ADD COLUMN minimum_value NUMERIC(14,4),
    ADD COLUMN minimum_inclusive BOOLEAN,
    ADD COLUMN maximum_basis TEXT,
    ADD COLUMN maximum_value NUMERIC(14,4),
    ADD COLUMN maximum_inclusive BOOLEAN;

-- No band can be migrated onto the new shape automatically, because a band with
-- no rule has no stated measure, and choosing one for it would be inventing the
-- thing this module refuses to invent. No migration has ever seeded a band, so
-- the only rows that can exist here are synthetic development or test rows.
DO $$
DECLARE
    orphaned INTEGER;
BEGIN
    SELECT count(*) INTO orphaned FROM budget_threshold_bands;
    IF orphaned > 0 THEN
        RAISE EXCEPTION
            'cannot assign % existing threshold band(s) to a rule: a band without a rule has no stated measure, and one cannot be chosen for it here',
            orphaned;
    END IF;
END;
$$;

ALTER TABLE budget_threshold_bands
    ALTER COLUMN threshold_rule_id SET NOT NULL;

-- The band's own measure-specific columns go, rather than staying beside the
-- general ones. Leaving them would allow one band written as a percent-used
-- range and another written as a bound, with nothing saying which the read path
-- honours.
ALTER TABLE budget_threshold_bands
    DROP COLUMN minimum_percent_used,
    DROP COLUMN maximum_percent_used;

-- Band codes and priorities are unique within a rule now, not within a policy.
-- Both rules grade in the same three colours, and a policy-wide uniqueness would
-- have forced one of them to be renamed to something nobody approved.
DO $$
DECLARE
    constraint_name TEXT;
    dropped INTEGER := 0;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'budget_threshold_bands'::regclass
          AND contype = 'u'
          AND pg_get_constraintdef(oid) LIKE '%threshold_policy_id%'
    LOOP
        EXECUTE format(
            'ALTER TABLE budget_threshold_bands DROP CONSTRAINT %I',
            constraint_name
        );
        dropped := dropped + 1;
    END LOOP;

    IF dropped <> 2 THEN
        RAISE EXCEPTION
            'expected exactly two policy-scoped unique constraints on budget_threshold_bands, found %',
            dropped;
    END IF;
END;
$$;

ALTER TABLE budget_threshold_bands
    ADD CONSTRAINT budget_threshold_bands_rule_band_code_key
        UNIQUE (threshold_rule_id, band_code),
    ADD CONSTRAINT budget_threshold_bands_rule_priority_key
        UNIQUE (threshold_rule_id, priority),
    ADD CONSTRAINT budget_threshold_bands_rule_fk
        FOREIGN KEY (organisation_id, threshold_policy_id, threshold_rule_id)
        REFERENCES budget_threshold_rules(organisation_id, threshold_policy_id, id),
    -- A bound is a value, a basis and an inclusivity together, or it is absent.
    -- A half-stated bound would silently become open ended.
    ADD CONSTRAINT budget_threshold_bands_minimum_shape_check
        CHECK (
            (minimum_value IS NULL AND minimum_basis IS NULL AND minimum_inclusive IS NULL)
            OR (minimum_value IS NOT NULL AND minimum_basis IS NOT NULL AND minimum_inclusive IS NOT NULL)
        ),
    ADD CONSTRAINT budget_threshold_bands_maximum_shape_check
        CHECK (
            (maximum_value IS NULL AND maximum_basis IS NULL AND maximum_inclusive IS NULL)
            OR (maximum_value IS NOT NULL AND maximum_basis IS NOT NULL AND maximum_inclusive IS NOT NULL)
        ),
    ADD CONSTRAINT budget_threshold_bands_basis_check
        CHECK (
            (minimum_basis IS NULL OR minimum_basis IN ('measure_units', 'percent_of_approved'))
            AND (maximum_basis IS NULL OR maximum_basis IN ('measure_units', 'percent_of_approved'))
        ),
    -- Two bounds are only comparable when they share a basis. A minimum of $0
    -- and a maximum of 10% of approved order differently for different approved
    -- budgets, so no constraint here can rank them, and pretending otherwise
    -- would reject the very band Rule B needs.
    ADD CONSTRAINT budget_threshold_bands_bound_order_check
        CHECK (
            minimum_value IS NULL
            OR maximum_value IS NULL
            OR minimum_basis <> maximum_basis
            OR maximum_value >= minimum_value
        );

CREATE INDEX budget_threshold_bands_rule_idx
    ON budget_threshold_bands (threshold_rule_id, priority);

-- A bound expressed as a percentage of the approved budget evaluates to a money
-- amount, which is comparable with `remaining_amount` and meaningless against
-- `percent_used`. That relationship spans two tables, so it is a trigger.
CREATE FUNCTION validate_budget_threshold_band_basis()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    rule_measure TEXT;
BEGIN
    SELECT measure INTO rule_measure
    FROM budget_threshold_rules
    WHERE id = NEW.threshold_rule_id;

    IF rule_measure IS NULL THEN
        RAISE EXCEPTION 'threshold band references an unknown rule';
    END IF;

    IF rule_measure = 'percent_used'
       AND (
           NEW.minimum_basis = 'percent_of_approved'
           OR NEW.maximum_basis = 'percent_of_approved'
       ) THEN
        RAISE EXCEPTION
            'a percent-used band is already normalised against the approved budget, so a percent-of-approved bound would compare a percentage with an amount';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER budget_threshold_bands_validate_basis
BEFORE INSERT OR UPDATE ON budget_threshold_bands
FOR EACH ROW
EXECUTE FUNCTION validate_budget_threshold_band_basis();

-- ---------------------------------------------------------------------------
-- Blocker 3. Band resolution, in one auditable place.
-- ---------------------------------------------------------------------------

-- Which quantity a rule judges. The read path computes both in NUMERIC and
-- hands them over; this only chooses.
CREATE FUNCTION budget_threshold_measured_value(
    p_measure TEXT,
    p_percent_used NUMERIC,
    p_remaining NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE p_measure
        WHEN 'percent_used' THEN p_percent_used
        WHEN 'remaining_amount' THEN p_remaining
    END;
$$;

-- A bound in the units the comparison is made in. All of it is NUMERIC: a
-- proportion of an approved budget is money, and money never touches a float.
CREATE FUNCTION budget_threshold_bound_value(
    p_basis TEXT,
    p_value NUMERIC,
    p_approved NUMERIC
)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_basis IS NULL OR p_value IS NULL THEN NULL
        WHEN p_basis = 'measure_units' THEN p_value
        WHEN p_basis = 'percent_of_approved' AND p_approved IS NOT NULL
            THEN p_approved * p_value / 100
    END;
$$;

-- Whether one band covers one measured value.
--
-- Two refusals matter more than the arithmetic. A measure that could not be
-- computed matches nothing, so a centre-month with no actual recorded stays
-- unbanded however wide the bands are: absence is not a value that can fall
-- into a range. And a bound that names a proportion of an approved budget that
-- is not known cannot be evaluated, so it refuses rather than quietly behaving
-- as though the band were open ended in that direction.
CREATE FUNCTION budget_threshold_band_matches(
    p_measured NUMERIC,
    p_approved NUMERIC,
    p_minimum_basis TEXT,
    p_minimum_value NUMERIC,
    p_minimum_inclusive BOOLEAN,
    p_maximum_basis TEXT,
    p_maximum_value NUMERIC,
    p_maximum_inclusive BOOLEAN
)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN p_measured IS NULL THEN FALSE
        WHEN p_minimum_value IS NOT NULL AND bound.minimum IS NULL THEN FALSE
        WHEN p_maximum_value IS NOT NULL AND bound.maximum IS NULL THEN FALSE
        ELSE (
            bound.minimum IS NULL
            OR CASE
                WHEN p_minimum_inclusive THEN p_measured >= bound.minimum
                ELSE p_measured > bound.minimum
            END
        )
        AND (
            bound.maximum IS NULL
            OR CASE
                WHEN p_maximum_inclusive THEN p_measured <= bound.maximum
                ELSE p_measured < bound.maximum
            END
        )
    END
    FROM (
        SELECT
            budget_threshold_bound_value(p_minimum_basis, p_minimum_value, p_approved) AS minimum,
            budget_threshold_bound_value(p_maximum_basis, p_maximum_value, p_approved) AS maximum
    ) AS bound;
$$;

-- ---------------------------------------------------------------------------
-- The approved rules, as canonical configuration.
--
-- 028 seeded categories directly into every organisation that existed when it
-- ran, and recorded that an organisation created afterwards would receive none,
-- because there was "no canonical template table and no `AFTER INSERT ON
-- organisations` provisioning hook ... of the kind
-- `provision_canonical_role_definitions` gives canonical roles". A threshold
-- policy seeded that way would reach nobody at all: no migration creates an
-- organisation, so a fresh database has none to seed, and the rules approved
-- organisation-wide would govern nothing. So thresholds get the hook, built the
-- way canonical roles already build it.
-- ---------------------------------------------------------------------------

CREATE TABLE canonical_budget_threshold_policies (
    policy_key TEXT NOT NULL CHECK (policy_key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    version INTEGER NOT NULL CHECK (version > 0),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    source_classification TEXT NOT NULL
        CHECK (source_classification IN ('BSA_INTERNAL', 'BSA_DEVELOPMENT_TEST')),
    effective_from_month DATE NOT NULL CHECK (EXTRACT(DAY FROM effective_from_month) = 1),
    effective_to_month DATE CHECK (effective_to_month IS NULL OR EXTRACT(DAY FROM effective_to_month) = 1),
    approved_by_name TEXT NOT NULL
        CHECK (char_length(btrim(approved_by_name)) BETWEEN 1 AND 200),
    approval_reference TEXT NOT NULL
        CHECK (char_length(btrim(approval_reference)) BETWEEN 1 AND 200),
    approved_on DATE NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (policy_key, version),
    CHECK (effective_to_month IS NULL OR effective_to_month > effective_from_month)
);

CREATE TABLE canonical_budget_threshold_rules (
    policy_key TEXT NOT NULL,
    policy_version INTEGER NOT NULL,
    rule_code TEXT NOT NULL CHECK (rule_code ~ '^[A-Z][A-Z0-9_]{0,49}$'),
    label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
    measure TEXT NOT NULL CHECK (measure IN ('percent_used', 'remaining_amount')),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    PRIMARY KEY (policy_key, policy_version, rule_code),
    UNIQUE (policy_key, policy_version, sort_order),
    FOREIGN KEY (policy_key, policy_version)
        REFERENCES canonical_budget_threshold_policies(policy_key, version)
);

CREATE TABLE canonical_budget_threshold_bands (
    policy_key TEXT NOT NULL,
    policy_version INTEGER NOT NULL,
    rule_code TEXT NOT NULL,
    band_code TEXT NOT NULL CHECK (band_code ~ '^[A-Z][A-Z0-9_]{0,49}$'),
    label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
    minimum_basis TEXT CHECK (minimum_basis IS NULL OR minimum_basis IN ('measure_units', 'percent_of_approved')),
    minimum_value NUMERIC(14,4),
    minimum_inclusive BOOLEAN,
    maximum_basis TEXT CHECK (maximum_basis IS NULL OR maximum_basis IN ('measure_units', 'percent_of_approved')),
    maximum_value NUMERIC(14,4),
    maximum_inclusive BOOLEAN,
    priority INTEGER NOT NULL CHECK (priority > 0),
    PRIMARY KEY (policy_key, policy_version, rule_code, band_code),
    UNIQUE (policy_key, policy_version, rule_code, priority),
    FOREIGN KEY (policy_key, policy_version, rule_code)
        REFERENCES canonical_budget_threshold_rules(policy_key, policy_version, rule_code),
    CHECK (
        (minimum_value IS NULL AND minimum_basis IS NULL AND minimum_inclusive IS NULL)
        OR (minimum_value IS NOT NULL AND minimum_basis IS NOT NULL AND minimum_inclusive IS NOT NULL)
    ),
    CHECK (
        (maximum_value IS NULL AND maximum_basis IS NULL AND maximum_inclusive IS NULL)
        OR (maximum_value IS NOT NULL AND maximum_basis IS NOT NULL AND maximum_inclusive IS NOT NULL)
    )
);

-- The approval itself. `effective_from_month` is the month the approval was
-- given, because a monthly budget is graded as a whole month and August 2026 is
-- the first month these rules existed for. Every month before it stays
-- ungoverned and keeps reporting that nobody had decided what good looked like,
-- which is true. A later change of mind is a new version with a later
-- `effective_from_month`, so it can never re-grade a month already judged.
INSERT INTO canonical_budget_threshold_policies (
    policy_key, version, name, status, source_classification,
    effective_from_month, effective_to_month,
    approved_by_name, approval_reference, approved_on
) VALUES (
    'bsa_budget_expenses', 1,
    'BSA Budget Expenses spending thresholds', 'active', 'BSA_INTERNAL',
    '2026-08-01'::date, NULL,
    'Bright Steps Product Owner',
    'BSA Budget Expenses template supplied by Karen (Area Manager); approved organisation-wide 14 August 2026.',
    '2026-08-14'::date
);

INSERT INTO canonical_budget_threshold_rules (
    policy_key, policy_version, rule_code, label, measure, sort_order
) VALUES
    ('bsa_budget_expenses', 1, 'BUDGET_USED', 'Budget used', 'percent_used', 1),
    ('bsa_budget_expenses', 1, 'REMAINING_BUDGET', 'Remaining budget', 'remaining_amount', 2);

-- Rule A. Percentage points, compared against percent used.
--
-- The three bands are disjoint and cover every percentage: below 85, 85 through
-- 100 with both ends included, and strictly above 100. `maximum_inclusive` is
-- what carries "100 is still amber" without a 100.01 standing in for it, and
-- `minimum_inclusive = FALSE` on the red band is what carries "red begins
-- strictly above 100". Priority orders by severity, so if a future version ever
-- did overlap, the more serious band would win rather than whichever sorted
-- first.
INSERT INTO canonical_budget_threshold_bands (
    policy_key, policy_version, rule_code, band_code, label,
    minimum_basis, minimum_value, minimum_inclusive,
    maximum_basis, maximum_value, maximum_inclusive,
    priority
) VALUES
    (
        'bsa_budget_expenses', 1, 'BUDGET_USED', 'RED',
        'More than 100% of the approved budget used',
        'measure_units', 100, FALSE,
        NULL, NULL, NULL,
        1
    ),
    (
        'bsa_budget_expenses', 1, 'BUDGET_USED', 'AMBER',
        '85% to 100% of the approved budget used',
        'measure_units', 85, TRUE,
        'measure_units', 100, TRUE,
        2
    ),
    (
        'bsa_budget_expenses', 1, 'BUDGET_USED', 'GREEN',
        'Less than 85% of the approved budget used',
        NULL, NULL, NULL,
        'measure_units', 85, FALSE,
        3
    ),

-- Rule B. Money, compared against the remaining balance.
--
-- Zero is an amount and stays an amount: overspending is overspending whatever
-- the budget was. The 10% bound is a proportion of that month's approved budget,
-- which is the whole point of the rule, and is why it cannot be written as a
-- fixed dollar range.
    (
        'bsa_budget_expenses', 1, 'REMAINING_BUDGET', 'RED',
        'Remaining budget is below zero',
        NULL, NULL, NULL,
        'measure_units', 0, FALSE,
        1
    ),
    (
        'bsa_budget_expenses', 1, 'REMAINING_BUDGET', 'AMBER',
        'Less than 10% of the approved budget remaining',
        'measure_units', 0, TRUE,
        'percent_of_approved', 10, FALSE,
        2
    ),
    (
        'bsa_budget_expenses', 1, 'REMAINING_BUDGET', 'GREEN',
        '10% or more of the approved budget remaining',
        'percent_of_approved', 10, TRUE,
        NULL, NULL, NULL,
        3
    );

-- ---------------------------------------------------------------------------
-- Provisioning, on the shape `provision_canonical_role_definitions` established.
-- ---------------------------------------------------------------------------

CREATE FUNCTION provision_canonical_budget_threshold_policies(target_organisation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    canonical_policy canonical_budget_threshold_policies%ROWTYPE;
    canonical_rule canonical_budget_threshold_rules%ROWTYPE;
    policy_id UUID;
    rule_id UUID;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM organisations
        WHERE id = target_organisation_id
    ) THEN
        RAISE EXCEPTION 'cannot provision budget threshold policies for an unknown organisation';
    END IF;

    FOR canonical_policy IN
        SELECT *
        FROM canonical_budget_threshold_policies
        WHERE status = 'active'
        ORDER BY policy_key, version
    LOOP
        SELECT id INTO policy_id
        FROM budget_threshold_policies
        WHERE organisation_id = target_organisation_id
          AND policy_key = canonical_policy.policy_key
          AND version = canonical_policy.version;

        -- An organisation that already holds this policy version keeps exactly
        -- what it holds. Provisioning adds what is missing and overwrites
        -- nothing: a governed threshold, once in force, has already judged
        -- months, and rewriting it here would re-grade them silently.
        CONTINUE WHEN policy_id IS NOT NULL;

        policy_id := gen_random_uuid();

        INSERT INTO budget_threshold_policies (
            id, organisation_id, policy_key, version, name, status,
            source_classification, effective_from_month, effective_to_month,
            approval_source_type, approved_by_principal_id,
            approved_by_name, approval_reference, approved_on
        ) VALUES (
            policy_id, target_organisation_id,
            canonical_policy.policy_key, canonical_policy.version,
            canonical_policy.name, 'active',
            canonical_policy.source_classification,
            canonical_policy.effective_from_month,
            canonical_policy.effective_to_month,
            'governed_document', NULL,
            canonical_policy.approved_by_name,
            canonical_policy.approval_reference,
            canonical_policy.approved_on
        );

        FOR canonical_rule IN
            SELECT *
            FROM canonical_budget_threshold_rules
            WHERE policy_key = canonical_policy.policy_key
              AND policy_version = canonical_policy.version
            ORDER BY sort_order
        LOOP
            rule_id := gen_random_uuid();

            INSERT INTO budget_threshold_rules (
                id, organisation_id, threshold_policy_id,
                rule_code, label, measure, sort_order
            ) VALUES (
                rule_id, target_organisation_id, policy_id,
                canonical_rule.rule_code, canonical_rule.label,
                canonical_rule.measure, canonical_rule.sort_order
            );

            INSERT INTO budget_threshold_bands (
                id, organisation_id, threshold_policy_id, threshold_rule_id,
                band_code, label,
                minimum_basis, minimum_value, minimum_inclusive,
                maximum_basis, maximum_value, maximum_inclusive,
                priority
            )
            SELECT
                gen_random_uuid(), target_organisation_id, policy_id, rule_id,
                canonical_band.band_code, canonical_band.label,
                canonical_band.minimum_basis, canonical_band.minimum_value,
                canonical_band.minimum_inclusive,
                canonical_band.maximum_basis, canonical_band.maximum_value,
                canonical_band.maximum_inclusive,
                canonical_band.priority
            FROM canonical_budget_threshold_bands AS canonical_band
            WHERE canonical_band.policy_key = canonical_rule.policy_key
              AND canonical_band.policy_version = canonical_rule.policy_version
              AND canonical_band.rule_code = canonical_rule.rule_code;
        END LOOP;
    END LOOP;
END;
$$;

SELECT provision_canonical_budget_threshold_policies(id)
FROM organisations;

CREATE FUNCTION provision_canonical_budget_thresholds_for_new_organisation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM provision_canonical_budget_threshold_policies(NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER organisations_provision_canonical_budget_thresholds
AFTER INSERT ON organisations
FOR EACH ROW
EXECUTE FUNCTION provision_canonical_budget_thresholds_for_new_organisation();
