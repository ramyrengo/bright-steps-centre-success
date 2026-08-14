-- Governed Centre Budgets reporting categories.
--
-- 027 created `budget_categories` empty on purpose, because no Bright Steps
-- reporting taxonomy had been approved and choosing one would have been an
-- invented financial rule. These three now carry an owner decision: they come
-- from the BSA Budget Expenses template supplied by Karen (Area Manager), and
-- the Product Owner approved them on 14 August 2026 for organisation-wide use.
-- Nothing beyond those three names and their stated display order is asserted
-- here. `description` stays NULL rather than inventing prose for a governed row.
--
-- Provenance. `budget_categories` carries no source or approval column of the
-- kind `budget_threshold_policies` has (`approved_by_principal_id`,
-- `approval_reference`, `source_classification`), so the attribution above can
-- only live in this comment. That is a gap in 027, not a decision taken here.
--
-- Reach. There is no canonical template table and no `AFTER INSERT ON
-- organisations` provisioning hook for categories, of the kind
-- `provision_canonical_role_definitions` gives canonical roles. This therefore
-- seeds the organisations that exist when it runs; an organisation created
-- afterwards receives no categories until some governed path provisions them.
-- Closing that gap needs a new table or a new trigger, and neither is in scope
-- for a seed migration.
--
-- ---------------------------------------------------------------------------
-- What this migration deliberately does NOT seed: the threshold bands.
-- ---------------------------------------------------------------------------
-- Two rules were approved alongside these categories, and both are meant to be
-- displayed even when they disagree:
--   Rule A, "budget used"      a percentage of the approved monthly budget.
--   Rule B, "remaining budget" a dollar balance judged as a proportion of that
--                              month's approved budget.
-- Neither is seeded, because `budget_threshold_bands` as 027 defines it cannot
-- carry them without changing what they say:
--
--   1. A band spans `[minimum_percent_used, maximum_percent_used)` over a
--      single measure, percent of budget used. There is no column expressing a
--      bound on `remaining`, and none expressing `remaining` as a proportion of
--      the approved budget, so Rule B has nowhere to be written.
--   2. Rule B is not a restatement of Rule A. Recast onto percent used it is
--      only equivalent while the approved budget is strictly positive: at an
--      approved budget of zero, percent used is undefined and no band resolves,
--      yet Rule B is still defined; and for a negative approved budget the two
--      orderings invert, so a percent-used band would grade the month backwards.
--   3. Both rules put 100% in amber and start red strictly above it. The band
--      interval is closed below and open above, so no `maximum_percent_used`
--      both includes exactly 100 and excludes everything greater.
--   4. The read path resolves exactly one band per position (`ORDER BY
--      priority LIMIT 1`) and one governing policy per month, and the wire
--      contract carries one `bandCode`. Two rules seeded together would silently
--      collapse into whichever one sorted first, which is precisely the merge
--      the approval forbids.
--   5. An `active` policy must name its approver: `approved_by_principal_id`
--      references `principals(id)`, and the CHECK requires it whenever
--      `status = 'active'`. Principals are created at runtime, so a migration
--      has no identifier for Karen or the Product Owner to record, and
--      inventing one would fabricate an approval.
--
-- Until those are resolved, every position keeps reporting `NOT_CONFIGURED`,
-- which states that nobody has decided what good looks like. That is the
-- honest answer, and it is a far better one than a colour derived from a rule
-- bent to fit the available columns.

INSERT INTO budget_categories (
    id, organisation_id, code, name, status, sort_order
)
SELECT
    gen_random_uuid(),
    organisation.id,
    approved.code,
    approved.name,
    'active',
    approved.sort_order
FROM organisations AS organisation
CROSS JOIN (
    VALUES
        ('supplies', 'Supplies', 1),
        ('staff_engagement', 'Staff Engagement', 2),
        ('special_days', 'Special Days', 3)
) AS approved (code, name, sort_order)
-- Only an organisation with no taxonomy at all is seeded, and it receives all
-- three or none. An organisation that already holds categories keeps exactly
-- what its owner governed into existence: this seed never overwrites, renumbers
-- or merges. Merging per row would be the worse failure, because a clash on one
-- code or one display position would leave that organisation holding some of
-- the approved categories and not others, and a month missing a category looks
-- complete while the spend it should have carried has nowhere to go.
WHERE NOT EXISTS (
    SELECT 1
    FROM budget_categories AS existing
    WHERE existing.organisation_id = organisation.id
);
