INSERT INTO capabilities (code, description) VALUES
    ('template.read', 'View published operational templates and authorised assignment context.'),
    ('template.create', 'Create and edit owned operational template drafts within an authorised scope.'),
    ('template.publish', 'Publish or retire owned operational templates within an authorised scope.'),
    ('template.assign', 'Assign published operational templates to authorised centres or a resolved portfolio.')
ON CONFLICT (code) DO NOTHING;

UPDATE canonical_role_templates
SET status = 'inactive'
WHERE role_key = 'area_manager'
  AND version <> 3
  AND status = 'active';

INSERT INTO canonical_role_templates (
    role_key, version, name, description, status
) VALUES (
    'area_manager',
    3,
    'Area Manager',
    'Assigned-centre quarterly review and operational template authoring, publication, assignment, and verification.',
    'active'
) ON CONFLICT (role_key, version) DO NOTHING;

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
    ('area_manager', 3, 'template.read'),
    ('area_manager', 3, 'template.create'),
    ('area_manager', 3, 'template.publish'),
    ('area_manager', 3, 'template.assign')
ON CONFLICT DO NOTHING;

UPDATE role_definitions
SET status = 'inactive',
    updated_at = now(),
    lock_version = lock_version + 1
WHERE role_key = 'area_manager'
  AND version <> 3
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
  AND previous.role_key = 'area_manager'
  AND previous.version <> 3
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
        'source', 'area_manager_template_builder',
        'toVersion', 3,
        'roleKey', role_definition.role_key
    ),
    'area-manager-template-builder-role-bundle-migration',
    now()
FROM role_assignments AS assignment
JOIN role_definitions AS role_definition
  ON role_definition.organisation_id = assignment.organisation_id
 AND role_definition.id = assignment.role_definition_id
WHERE role_definition.role_key = 'area_manager'
  AND role_definition.version = 3
  AND NOT EXISTS (
      SELECT 1
      FROM system_audit_events AS existing
      WHERE existing.organisation_id = assignment.organisation_id
        AND existing.resource_type = 'role_assignment'
        AND existing.resource_id = assignment.id
        AND existing.correlation_id = 'area-manager-template-builder-role-bundle-migration'
  );
