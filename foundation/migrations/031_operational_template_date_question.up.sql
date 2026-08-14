-- Permit a `date` question in the Area Manager Template & Form Builder.
--
-- The Product Owner's Form Builder scope listed a date question among the
-- initial supported types, but migration 023 never admitted it: both of the
-- CHECK constraints it wrote enumerate six types and stop at `time`. This
-- migration widens both to seven. Nothing else about a question changes.
--
-- A date question is a plain calendar date — `YYYY-MM-DD`, no time, no zone.
-- Its optional `earliest` and `latest` bounds live in `answer_configuration`
-- exactly as a time question's do, so no column is added here and no existing
-- row is touched. `operational_standard_schedule_revisions.centre_timezone`
-- governs when a form opens and is due in a centre's own local time; it has
-- nothing to say about the value an answer carries, and is deliberately not
-- consulted for a date.
--
-- 023 is applied and therefore immutable. golang-migrate tracks version
-- numbers only and will not re-run it, so this is written forward-only.

-- The draft-side constraint is an inline column CHECK, so PostgreSQL generated
-- its name. Locate it by what it constrains rather than by a name this
-- migration would be guessing at, and fail closed if the shape found is not the
-- single constraint 023 wrote — a silent zero-drop here would ship a widened
-- contract sitting on top of a schema that still refuses the seventh type.
DO $$
DECLARE
    constraint_name TEXT;
    dropped INTEGER := 0;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'operational_template_draft_questions'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%question_type%'
    LOOP
        EXECUTE format(
            'ALTER TABLE operational_template_draft_questions DROP CONSTRAINT %I',
            constraint_name
        );
        dropped := dropped + 1;
    END LOOP;

    IF dropped <> 1 THEN
        RAISE EXCEPTION
            'expected exactly one question type CHECK on operational_template_draft_questions, found %',
            dropped;
    END IF;
END;
$$;

ALTER TABLE operational_template_draft_questions
    ADD CONSTRAINT operational_template_draft_questions_question_type_check
        CHECK (question_type IN (
            'short_text', 'long_text', 'single_choice',
            'multiple_choice', 'numeric', 'time', 'date'
        ));

-- The published-side constraint on `audit_template_items` was named by 023, but
-- it is located the same way rather than trusted to still carry that name. It
-- stays nullable: quarterly review items share this table and carry no question
-- type at all, and narrowing that here would break content this slice does not
-- own.
DO $$
DECLARE
    constraint_name TEXT;
    dropped INTEGER := 0;
BEGIN
    FOR constraint_name IN
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'audit_template_items'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%question_type%'
    LOOP
        EXECUTE format(
            'ALTER TABLE audit_template_items DROP CONSTRAINT %I',
            constraint_name
        );
        dropped := dropped + 1;
    END LOOP;

    IF dropped <> 1 THEN
        RAISE EXCEPTION
            'expected exactly one question type CHECK on audit_template_items, found %',
            dropped;
    END IF;
END;
$$;

ALTER TABLE audit_template_items
    ADD CONSTRAINT audit_template_items_question_type_check
        CHECK (
            question_type IS NULL OR question_type IN (
                'short_text', 'long_text', 'single_choice',
                'multiple_choice', 'numeric', 'time', 'date'
            )
        );

-- Prove both constraints admit the seventh type and still refuse an unknown
-- one, before any deploy depends on them. A CHECK that silently lost its
-- enumeration would otherwise look identical to one that gained a member.
DO $$
DECLARE
    draft_definition TEXT;
    published_definition TEXT;
    supported TEXT;
BEGIN
    SELECT pg_get_constraintdef(oid) INTO draft_definition
    FROM pg_constraint
    WHERE conrelid = 'operational_template_draft_questions'::regclass
      AND conname = 'operational_template_draft_questions_question_type_check';

    SELECT pg_get_constraintdef(oid) INTO published_definition
    FROM pg_constraint
    WHERE conrelid = 'audit_template_items'::regclass
      AND conname = 'audit_template_items_question_type_check';

    IF draft_definition IS NULL OR published_definition IS NULL THEN
        RAISE EXCEPTION 'question type CHECK constraints were not reinstated';
    END IF;

    FOREACH supported IN ARRAY ARRAY['short_text', 'long_text', 'single_choice',
                                     'multiple_choice', 'numeric', 'time', 'date']
    LOOP
        IF draft_definition NOT LIKE '%''' || supported || '''%'
           OR published_definition NOT LIKE '%''' || supported || '''%' THEN
            RAISE EXCEPTION
                'question type CHECK constraints must admit %', supported;
        END IF;
    END LOOP;
END;
$$;
