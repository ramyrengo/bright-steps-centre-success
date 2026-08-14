-- Centre Budgets capability boundary.
--
-- `budget.summary.read` already exists from migration 001. It is the synthetic
-- Finance marker that proved a scoped financial capability can be represented;
-- PERMISSIONS.md states explicitly that it does not authorise a budget module.
-- It is therefore left exactly as it is, and Centre Budgets introduces its own
-- capabilities so that read of budget content and entry of an actual are
-- separately grantable, as BUDGET_ACCOUNTABILITY.md requires ("Separate
-- summary, detail, import, configuration, forecast, and export capabilities").
--
-- System Administrator receives neither capability. Technical administration
-- confers no authority over financial content.

INSERT INTO capabilities (code, description) VALUES
    ('budget.position.read', 'View approved budget, recorded actual, remaining, and threshold position for permitted centres, periods, and categories within an authorised scope.'),
    ('budget.actual.enter', 'Record or confirm a monthly actual for a permitted centre, period, and category within an authorised scope.');

UPDATE canonical_role_templates
SET status = 'inactive'
WHERE role_key IN ('area_manager', 'centre_director')
  AND status = 'active';

INSERT INTO canonical_role_templates (
    role_key, version, name, description, status
) VALUES
    ('area_manager', 3, 'Area Manager', 'Assigned-centre quarterly review conduct, finalisation, findings, evidence, independent action verification, and assigned-centre budget position read.', 'active'),
    ('centre_director', 3, 'Centre Director', 'Assigned-centre review read/acknowledgement, corrective-action remediation/evidence, and centre budget position read with monthly actual entry.', 'active');

INSERT INTO canonical_role_template_capabilities (
    role_key, role_version, capability_code
) VALUES
    ('area_manager', 3, 'centre.read'),
    ('area_manager', 3, 'quarterly_audit.read'),
    ('area_manager', 3, 'quarterly_audit.conduct'),
    ('area_manager', 3, 'quarterly_audit.finalise'),
    ('area_manager', 3, 'finding.read'),
    ('area_manager', 3, 'corrective_action.read'),
    ('area_manager', 3, 'corrective_action.verify'),
    ('area_manager', 3, 'evidence.read'),
    ('area_manager', 3, 'budget.position.read'),
    ('centre_director', 3, 'centre.read'),
    ('centre_director', 3, 'centre.manage'),
    ('centre_director', 3, 'quarterly_audit.read'),
    ('centre_director', 3, 'quarterly_audit.acknowledge'),
    ('centre_director', 3, 'finding.read'),
    ('centre_director', 3, 'corrective_action.read'),
    ('centre_director', 3, 'corrective_action.remediate'),
    ('centre_director', 3, 'evidence.read'),
    ('centre_director', 3, 'evidence.upload'),
    ('centre_director', 3, 'budget.position.read'),
    ('centre_director', 3, 'budget.actual.enter');

UPDATE role_definitions
SET status = 'inactive',
    updated_at = now(),
    lock_version = lock_version + 1
WHERE role_key IN ('area_manager', 'centre_director')
  AND status = 'active';

SELECT provision_canonical_role_definitions(id)
FROM organisations;

UPDATE role_assignments AS assignment
SET role_definition_id = replacement.id,
    updated_at = now(),
    lock_version = assignment.lock_version + 1
FROM role_definitions AS previous,
     role_definitions AS replacement
WHERE assignment.organisation_id = previous.organisation_id
  AND assignment.role_definition_id = previous.id
  AND previous.role_key IN ('area_manager', 'centre_director')
  AND previous.version = 2
  AND replacement.organisation_id = previous.organisation_id
  AND replacement.role_key = previous.role_key
  AND replacement.version = 3
  AND replacement.status = 'active';

INSERT INTO system_audit_events (
    id,
    organisation_id,
    actor_principal_id,
    action,
    resource_type,
    resource_id,
    scope_type,
    scope_id,
    context,
    correlation_id,
    occurred_at
)
SELECT
    gen_random_uuid(),
    assignment.organisation_id,
    NULL,
    'role_assignment.bundle_migrated',
    'role_assignment',
    assignment.id,
    'organisation',
    assignment.organisation_id,
    jsonb_build_object(
        'source', 'centre_budgets',
        'toVersion', 3,
        'roleKey', role_definition.role_key
    ),
    'centre-budgets-role-bundle-migration',
    now()
FROM role_assignments AS assignment
JOIN role_definitions AS role_definition
  ON role_definition.organisation_id = assignment.organisation_id
 AND role_definition.id = assignment.role_definition_id
WHERE role_definition.role_key IN ('area_manager', 'centre_director')
  AND role_definition.version = 3;
