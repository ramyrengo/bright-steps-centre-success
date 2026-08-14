-- Centre Budgets domain.
--
-- Scope discipline. BUDGET_ACCOUNTABILITY.md is explicit that no Bright Steps
-- finance system, chart of accounts, reporting calendar, threshold, approval
-- authority, or integration mechanism is assumed. This migration therefore
-- creates the shape those governed facts will occupy and seeds none of them.
-- In particular `budget_threshold_bands` is created empty on purpose: the
-- source material lists overspend severities as "Candidate categories—not
-- approved thresholds", so choosing a green/amber/red percentage here would
-- be inventing a financial rule.
--
-- Money. Every monetary column is NUMERIC(14,2) with an explicit ISO-4217-shaped
-- currency code, per DATABASE_SCHEMA.md: "Monetary values use fixed precision,
-- explicit currency, financial period, and source date—not floating point."
--
-- Unknown is not zero. There is no DEFAULT 0 on any monetary column and no
-- row is pre-created for a centre-month-category. A missing row means the
-- value is unknown; a row holding 0.00 means a real zero was recorded. The
-- read model must keep those two states distinguishable, so the database must
-- never manufacture the first from the second.

-- ---------------------------------------------------------------------------
-- Governed reporting categories. Names are data, not a TypeScript union, so a
-- category can be added or retired without a deploy.
-- ---------------------------------------------------------------------------
CREATE TABLE budget_categories (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    code TEXT NOT NULL CHECK (code ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
    description TEXT CHECK (description IS NULL OR char_length(btrim(description)) BETWEEN 1 AND 500),
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    sort_order INTEGER NOT NULL CHECK (sort_order > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, code),
    UNIQUE (organisation_id, sort_order),
    CHECK (updated_at >= created_at)
);

-- ---------------------------------------------------------------------------
-- Versioned threshold configuration. A policy is effective-dated so a
-- historical month stays interpretable under the bands that were in force when
-- it was recorded, rather than being re-judged under today's configuration.
-- ---------------------------------------------------------------------------
CREATE TABLE budget_threshold_policies (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    policy_key TEXT NOT NULL CHECK (policy_key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    version INTEGER NOT NULL CHECK (version > 0),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status TEXT NOT NULL CHECK (status IN ('draft', 'active', 'superseded')),
    -- Keeps a synthetic development or test policy permanently distinguishable
    -- from bands Finance actually approved. No row of either kind is seeded.
    source_classification TEXT NOT NULL CHECK (source_classification IN ('BSA_INTERNAL', 'BSA_DEVELOPMENT_TEST')),
    -- The first month this policy governs, as a first-of-month period key.
    effective_from_month DATE NOT NULL CHECK (EXTRACT(DAY FROM effective_from_month) = 1),
    -- Exclusive upper bound, so consecutive versions form half-open intervals.
    effective_to_month DATE CHECK (effective_to_month IS NULL OR EXTRACT(DAY FROM effective_to_month) = 1),
    -- Who approved these bands. Required, because an unattributed financial
    -- threshold is exactly the kind of invented rule this module must refuse.
    approved_by_principal_id UUID REFERENCES principals(id),
    approval_reference TEXT CHECK (approval_reference IS NULL OR char_length(btrim(approval_reference)) BETWEEN 1 AND 200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, policy_key, version),
    CHECK (effective_to_month IS NULL OR effective_to_month > effective_from_month),
    CHECK (
        status <> 'active'
        OR (approved_by_principal_id IS NOT NULL AND approval_reference IS NOT NULL)
    )
);

CREATE INDEX budget_threshold_policies_effective_idx
    ON budget_threshold_policies (organisation_id, effective_from_month DESC)
    WHERE status = 'active';

-- Bands are percentage-of-budget-used ranges. Half-open [minimum, maximum),
-- with an open-ended final band, so every percentage lands in exactly one band
-- without an overlap or a gap. No row is seeded.
CREATE TABLE budget_threshold_bands (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    threshold_policy_id UUID NOT NULL,
    band_code TEXT NOT NULL CHECK (band_code ~ '^[A-Z][A-Z0-9_]{0,49}$'),
    label TEXT NOT NULL CHECK (char_length(btrim(label)) BETWEEN 1 AND 100),
    -- Inclusive lower bound of percent-of-budget-used.
    minimum_percent_used NUMERIC(7,2) NOT NULL CHECK (minimum_percent_used >= 0),
    -- Exclusive upper bound; NULL means open ended.
    maximum_percent_used NUMERIC(7,2),
    priority INTEGER NOT NULL CHECK (priority > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (threshold_policy_id, band_code),
    UNIQUE (threshold_policy_id, priority),
    FOREIGN KEY (organisation_id, threshold_policy_id)
        REFERENCES budget_threshold_policies(organisation_id, id),
    CHECK (maximum_percent_used IS NULL OR maximum_percent_used > minimum_percent_used)
);

-- ---------------------------------------------------------------------------
-- Approved budget lines. BUDGET_ACCOUNTABILITY.md defines approved budget as
-- "an immutable approved source snapshot for a financial period/version", so a
-- line is written once and corrected only by supersession.
-- ---------------------------------------------------------------------------
CREATE TABLE centre_budget_lines (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    category_id UUID NOT NULL,
    -- First-of-month key. The organisation's financial calendar is an open
    -- decision in BUDGET_ACCOUNTABILITY.md; this column commits only to the
    -- calendar month the product slice was authorised to show.
    period_month DATE NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
    amount NUMERIC(14,2) NOT NULL,
    currency_code TEXT NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    -- Finance-system seam: where this approved figure came from.
    source_kind TEXT NOT NULL CHECK (source_kind IN ('manual_entry', 'finance_system_import')),
    source_system_key TEXT CHECK (source_system_key IS NULL OR source_system_key ~ '^[a-z][a-z0-9_.:-]{0,99}$'),
    source_reference TEXT CHECK (source_reference IS NULL OR char_length(btrim(source_reference)) BETWEEN 1 AND 200),
    source_cutoff_at TIMESTAMPTZ,
    recorded_by_principal_id UUID REFERENCES principals(id),
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    superseded_at TIMESTAMPTZ,
    superseded_by_id UUID,
    UNIQUE (organisation_id, id),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    FOREIGN KEY (organisation_id, category_id)
        REFERENCES budget_categories(organisation_id, id),
    -- Deferred so a correction can mark the old row superseded before the
    -- replacement row exists, which is the order the "one current row" partial
    -- unique index below requires.
    FOREIGN KEY (organisation_id, superseded_by_id)
        REFERENCES centre_budget_lines(organisation_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    -- Attribution guard. A human entry names the human; a machine import names
    -- the connection. Neither may masquerade as the other.
    CONSTRAINT centre_budget_lines_attribution_check CHECK (
        (
            source_kind = 'manual_entry'
            AND recorded_by_principal_id IS NOT NULL
            AND source_system_key IS NULL
            AND source_reference IS NULL
        )
        OR (
            source_kind = 'finance_system_import'
            AND recorded_by_principal_id IS NULL
            AND source_system_key IS NOT NULL
        )
    ),
    CONSTRAINT centre_budget_lines_supersession_check CHECK (
        (superseded_at IS NULL AND superseded_by_id IS NULL)
        OR (superseded_at IS NOT NULL AND superseded_by_id IS NOT NULL)
    ),
    CHECK (superseded_by_id IS NULL OR superseded_by_id <> id)
);

-- At most one current approved line per centre-month-category.
CREATE UNIQUE INDEX centre_budget_lines_one_current
    ON centre_budget_lines (organisation_id, centre_id, category_id, period_month)
    WHERE superseded_at IS NULL;

CREATE INDEX centre_budget_lines_period_idx
    ON centre_budget_lines (organisation_id, period_month, centre_id)
    WHERE superseded_at IS NULL;

-- ---------------------------------------------------------------------------
-- Recorded actuals. Centre Success is not the accounting ledger, so every
-- actual states where it came from and every correction is a new row.
-- ---------------------------------------------------------------------------
CREATE TABLE centre_budget_actuals (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    category_id UUID NOT NULL,
    period_month DATE NOT NULL CHECK (EXTRACT(DAY FROM period_month) = 1),
    -- No DEFAULT. An absent row is unknown; 0.00 here is a recorded zero.
    amount NUMERIC(14,2) NOT NULL,
    currency_code TEXT NOT NULL CHECK (currency_code ~ '^[A-Z]{3}$'),
    -- Finance-system seam. 'manual_entry' is the only source this slice
    -- writes; 'finance_system_import' exists so a later reconciliation can
    -- tell a typed-in figure from a posted one without a schema change.
    source_kind TEXT NOT NULL CHECK (source_kind IN ('manual_entry', 'finance_system_import')),
    source_system_key TEXT CHECK (source_system_key IS NULL OR source_system_key ~ '^[a-z][a-z0-9_.:-]{0,99}$'),
    source_reference TEXT CHECK (source_reference IS NULL OR char_length(btrim(source_reference)) BETWEEN 1 AND 200),
    -- BUDGET_ACCOUNTABILITY.md: an actual is posted expenditure "as of a stated
    -- cutoff". A manual entry has no source cutoff and must not fabricate one.
    source_cutoff_at TIMESTAMPTZ,
    note TEXT CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 500),
    entered_by_principal_id UUID REFERENCES principals(id),
    entered_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Confirmation is a state on this record, not an approval workflow. It
    -- says the Centre Director who entered or reviewed the figure stands
    -- behind it. There is deliberately no approver capability, no pending
    -- state, and no separation of duties between entering and confirming: a
    -- second-person approval is not authorised, and a column implying one
    -- would read as an approval that never happens.
    confirmed_at TIMESTAMPTZ,
    confirmed_by_principal_id UUID REFERENCES principals(id),
    superseded_at TIMESTAMPTZ,
    superseded_by_id UUID,
    UNIQUE (organisation_id, id),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    FOREIGN KEY (organisation_id, category_id)
        REFERENCES budget_categories(organisation_id, id),
    FOREIGN KEY (organisation_id, superseded_by_id)
        REFERENCES centre_budget_actuals(organisation_id, id)
        DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT centre_budget_actuals_attribution_check CHECK (
        (
            source_kind = 'manual_entry'
            AND entered_by_principal_id IS NOT NULL
            AND source_system_key IS NULL
            AND source_reference IS NULL
            AND source_cutoff_at IS NULL
        )
        OR (
            source_kind = 'finance_system_import'
            AND entered_by_principal_id IS NULL
            AND source_system_key IS NOT NULL
            AND source_cutoff_at IS NOT NULL
        )
    ),
    CONSTRAINT centre_budget_actuals_supersession_check CHECK (
        (superseded_at IS NULL AND superseded_by_id IS NULL)
        OR (superseded_at IS NOT NULL AND superseded_by_id IS NOT NULL)
    ),
    -- Confirmation always names who and when, or neither.
    CONSTRAINT centre_budget_actuals_confirmation_check CHECK (
        (confirmed_at IS NULL AND confirmed_by_principal_id IS NULL)
        OR (confirmed_at IS NOT NULL AND confirmed_by_principal_id IS NOT NULL)
    ),
    CHECK (confirmed_at IS NULL OR confirmed_at >= entered_at),
    CHECK (superseded_by_id IS NULL OR superseded_by_id <> id)
);

CREATE UNIQUE INDEX centre_budget_actuals_one_current
    ON centre_budget_actuals (organisation_id, centre_id, category_id, period_month)
    WHERE superseded_at IS NULL;

CREATE INDEX centre_budget_actuals_period_idx
    ON centre_budget_actuals (organisation_id, period_month, centre_id)
    WHERE superseded_at IS NULL;

-- ---------------------------------------------------------------------------
-- Immutability guards. Application code is not the only place these rules
-- live: a financial fact that could be edited in place would destroy the
-- provenance the finance seam exists to preserve.
-- ---------------------------------------------------------------------------

CREATE FUNCTION reject_centre_budget_fact_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'centre budget facts are append-only; supersede instead of deleting';
    END IF;

    -- Supersession is the one permitted transition, and it is one-way.
    IF OLD.superseded_at IS NOT NULL THEN
        RAISE EXCEPTION 'a superseded centre budget fact can never be modified again';
    END IF;

    IF NEW.superseded_at IS NULL OR NEW.superseded_by_id IS NULL THEN
        RAISE EXCEPTION 'the only permitted centre budget fact update is supersession';
    END IF;

    IF ROW(
        NEW.id, NEW.organisation_id, NEW.centre_id, NEW.category_id,
        NEW.period_month, NEW.amount, NEW.currency_code,
        NEW.source_kind, NEW.source_system_key, NEW.source_reference,
        NEW.source_cutoff_at
    ) IS DISTINCT FROM ROW(
        OLD.id, OLD.organisation_id, OLD.centre_id, OLD.category_id,
        OLD.period_month, OLD.amount, OLD.currency_code,
        OLD.source_kind, OLD.source_system_key, OLD.source_reference,
        OLD.source_cutoff_at
    ) THEN
        RAISE EXCEPTION 'recorded centre budget values and provenance are immutable';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER centre_budget_lines_enforce_immutability
BEFORE UPDATE OR DELETE ON centre_budget_lines
FOR EACH ROW
EXECUTE FUNCTION reject_centre_budget_fact_mutation();

CREATE FUNCTION reject_centre_budget_actual_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'centre budget actuals are append-only; supersede instead of deleting';
    END IF;

    IF OLD.superseded_at IS NOT NULL THEN
        RAISE EXCEPTION 'a superseded centre budget actual can never be modified again';
    END IF;

    IF NEW.superseded_at IS NULL OR NEW.superseded_by_id IS NULL THEN
        RAISE EXCEPTION 'the only permitted centre budget actual update is supersession';
    END IF;

    IF ROW(
        NEW.id, NEW.organisation_id, NEW.centre_id, NEW.category_id,
        NEW.period_month, NEW.amount, NEW.currency_code,
        NEW.source_kind, NEW.source_system_key, NEW.source_reference,
        NEW.source_cutoff_at, NEW.note,
        NEW.entered_by_principal_id, NEW.entered_at,
        NEW.confirmed_at, NEW.confirmed_by_principal_id
    ) IS DISTINCT FROM ROW(
        OLD.id, OLD.organisation_id, OLD.centre_id, OLD.category_id,
        OLD.period_month, OLD.amount, OLD.currency_code,
        OLD.source_kind, OLD.source_system_key, OLD.source_reference,
        OLD.source_cutoff_at, OLD.note,
        OLD.entered_by_principal_id, OLD.entered_at,
        OLD.confirmed_at, OLD.confirmed_by_principal_id
    ) THEN
        RAISE EXCEPTION 'recorded centre budget actual values and attribution are immutable';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER centre_budget_actuals_enforce_immutability
BEFORE UPDATE OR DELETE ON centre_budget_actuals
FOR EACH ROW
EXECUTE FUNCTION reject_centre_budget_actual_mutation();

-- ---------------------------------------------------------------------------
-- Tenant and attribution integrity that a CHECK constraint cannot express.
-- ---------------------------------------------------------------------------

CREATE FUNCTION validate_centre_budget_actual_entry()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    budget_currency TEXT;
BEGIN
    -- A manual entry must name a principal who is actually a member of the
    -- owning organisation, so an actual can never be attributed across tenants.
    IF NEW.entered_by_principal_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM organisation_memberships
        WHERE organisation_id = NEW.organisation_id
          AND principal_id = NEW.entered_by_principal_id
    ) THEN
        RAISE EXCEPTION 'centre budget actual author is not a member of the owning organisation';
    END IF;

    IF NEW.confirmed_by_principal_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM organisation_memberships
        WHERE organisation_id = NEW.organisation_id
          AND principal_id = NEW.confirmed_by_principal_id
    ) THEN
        RAISE EXCEPTION 'centre budget actual confirmer is not a member of the owning organisation';
    END IF;

    -- A machine import states a posted figure; it does not carry a human's
    -- confirmation, and inventing one would misattribute accountability.
    IF NEW.source_kind = 'finance_system_import' AND NEW.confirmed_at IS NOT NULL THEN
        RAISE EXCEPTION 'an imported centre budget actual cannot carry a manual confirmation';
    END IF;

    -- Mixing currencies inside one centre-month-category would silently make
    -- remaining and percent-used meaningless.
    SELECT currency_code INTO budget_currency
    FROM centre_budget_lines
    WHERE organisation_id = NEW.organisation_id
      AND centre_id = NEW.centre_id
      AND category_id = NEW.category_id
      AND period_month = NEW.period_month
      AND superseded_at IS NULL;

    IF budget_currency IS NOT NULL AND budget_currency <> NEW.currency_code THEN
        RAISE EXCEPTION 'centre budget actual currency % does not match approved budget currency %',
            NEW.currency_code, budget_currency;
    END IF;

    -- An inactive category cannot receive new entries, while historical rows
    -- against it stay readable.
    IF NOT EXISTS (
        SELECT 1
        FROM budget_categories
        WHERE organisation_id = NEW.organisation_id
          AND id = NEW.category_id
          AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'centre budget actual references a category that is not active';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER centre_budget_actuals_validate_entry
BEFORE INSERT ON centre_budget_actuals
FOR EACH ROW
EXECUTE FUNCTION validate_centre_budget_actual_entry();

CREATE FUNCTION validate_centre_budget_line_currency()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    actual_currency TEXT;
BEGIN
    SELECT currency_code INTO actual_currency
    FROM centre_budget_actuals
    WHERE organisation_id = NEW.organisation_id
      AND centre_id = NEW.centre_id
      AND category_id = NEW.category_id
      AND period_month = NEW.period_month
      AND superseded_at IS NULL;

    IF actual_currency IS NOT NULL AND actual_currency <> NEW.currency_code THEN
        RAISE EXCEPTION 'approved budget currency % does not match recorded actual currency %',
            NEW.currency_code, actual_currency;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER centre_budget_lines_validate_currency
BEFORE INSERT ON centre_budget_lines
FOR EACH ROW
EXECUTE FUNCTION validate_centre_budget_line_currency();
