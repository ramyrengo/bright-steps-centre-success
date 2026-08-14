INSERT INTO capabilities (code, description) VALUES
    ('operational_check.read', 'View Centre Standards occurrences and authorised history within a centre scope.'),
    ('operational_check.complete', 'Discover and complete open Centre Standards occurrences within a centre scope.')
ON CONFLICT (code) DO NOTHING;

UPDATE canonical_role_templates
SET status = 'inactive'
WHERE role_key = 'educator'
  AND version <> 2
  AND status = 'active';

INSERT INTO canonical_role_templates (
    role_key, version, name, description, status
) VALUES (
    'educator',
    2,
    'Educator',
    'Assigned-centre read plus discovery and completion of open Centre Standards occurrences.',
    'active'
) ON CONFLICT (role_key, version) DO NOTHING;

INSERT INTO canonical_role_template_capabilities (
    role_key, role_version, capability_code
) VALUES
    ('educator', 2, 'centre.read'),
    ('educator', 2, 'operational_check.complete')
ON CONFLICT DO NOTHING;

UPDATE role_definitions
SET status = 'inactive',
    updated_at = now(),
    lock_version = lock_version + 1
WHERE role_key = 'educator'
  AND version <> 2
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
  AND previous.role_key = 'educator'
  AND previous.version <> 2
  AND replacement.organisation_id = previous.organisation_id
  AND replacement.role_key = previous.role_key
  AND replacement.version = 2
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
        'source', 'milestone_4a',
        'toVersion', 2,
        'roleKey', role_definition.role_key
    ),
    'milestone-4a-educator-bundle-migration',
    now()
FROM role_assignments AS assignment
JOIN role_definitions AS role_definition
  ON role_definition.organisation_id = assignment.organisation_id
 AND role_definition.id = assignment.role_definition_id
WHERE role_definition.role_key = 'educator'
  AND role_definition.version = 2
  AND NOT EXISTS (
      SELECT 1
      FROM system_audit_events AS existing
      WHERE existing.organisation_id = assignment.organisation_id
        AND existing.resource_type = 'role_assignment'
        AND existing.resource_id = assignment.id
        AND existing.correlation_id = 'milestone-4a-educator-bundle-migration'
  );
