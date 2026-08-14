-- Operational template capability codes for the Area Manager form builder.
--
-- The four codes are registered here. The canonical Area Manager version 3
-- bundle is deliberately NOT created here.
--
-- Centre Budgets claims `area_manager` version 3 in migration 026, together
-- with `centre_director` version 3, and 026 is already released. Forward-only
-- migrations mean 026 cannot be reworked to tolerate a version row this
-- migration had already inserted, and its INSERT carries no conflict clause, so
-- a version 3 created here fails the whole deploy on the primary key.
--
-- Both branches wanted the same version number for the same role. The product
-- decision is a single version 3 holding the union of both capability sets, so
-- the ordering is:
--
--   024  registers the four `template.*` capability codes (this migration)
--   026  creates area_manager v3 and centre_director v3 with the budget set
--   030  folds these operational template capabilities into that same v3
--
-- Registering the codes here keeps the capability vocabulary available to
-- everything applied between 024 and 030, and gives 030 the `capabilities(code)`
-- rows that `canonical_role_template_capabilities` needs for its foreign key.

INSERT INTO capabilities (code, description) VALUES
    ('template.read', 'View published operational templates and authorised assignment context.'),
    ('template.create', 'Create and edit owned operational template drafts within an authorised scope.'),
    ('template.publish', 'Publish or retire owned operational templates within an authorised scope.'),
    ('template.assign', 'Assign published operational templates to authorised centres or a resolved portfolio.')
ON CONFLICT (code) DO NOTHING;
