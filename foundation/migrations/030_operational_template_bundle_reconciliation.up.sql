-- Fold the operational template capabilities into the canonical Area Manager
-- version 3 that migration 026 created.
--
-- Two branches independently claimed `area_manager` version 3: the form builder
-- (024, operational template authoring) and Centre Budgets (026, budget position
-- read). 026 is already released and is therefore immutable, so it keeps
-- ownership of the version row and of the role definition, assignment and audit
-- promotion that goes with it. 024 was reduced to registering its capability
-- codes. This migration restores the other half of 024 on top of the version
-- that 026 built.
--
-- After this migration there is exactly one version 3 per affected role:
--
--   area_manager    v3 = 026's nine capabilities
--                        + template.read, template.create,
--                          template.publish, template.assign
--   centre_director v3 = exactly as 026 wrote it, untouched here
--
-- That is the union of what the two migrations granted and nothing more. No
-- role gains a capability neither migration granted it, and none loses one.

-- Fail closed rather than silently granting nothing. If 026 did not leave an
-- active version 3 in place, the assumption this migration is built on is wrong
-- and the deploy must stop here instead of shipping an Area Manager who cannot
-- author a template.
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM canonical_role_templates
        WHERE role_key = 'area_manager'
          AND version = 3
          AND status = 'active'
    ) THEN
        RAISE EXCEPTION
            'canonical area_manager version 3 must be active before the operational template bundle can be folded into it';
    END IF;
END;
$$;

INSERT INTO canonical_role_template_capabilities (
    role_key, role_version, capability_code
) VALUES
    ('area_manager', 3, 'template.read'),
    ('area_manager', 3, 'template.create'),
    ('area_manager', 3, 'template.publish'),
    ('area_manager', 3, 'template.assign')
ON CONFLICT DO NOTHING;

-- 026 wrote the version 3 description for the budget half of the bundle alone.
-- Restate it for the union so the stored description is not quietly narrower
-- than the authority the bundle now carries.
UPDATE canonical_role_templates
SET description = 'Assigned-centre quarterly review conduct, finalisation, findings, evidence, independent action verification, assigned-centre budget position read, and operational template authoring, publication, and assignment.'
WHERE role_key = 'area_manager'
  AND version = 3;

-- Role definitions copy the template description at provision time, so the
-- already-provisioned version 3 rows would otherwise keep 026's narrower text.
UPDATE role_definitions AS definition
SET description = template.description,
    updated_at = now(),
    lock_version = definition.lock_version + 1
FROM canonical_role_templates AS template
WHERE template.role_key = 'area_manager'
  AND template.version = 3
  AND definition.source_template_key = template.role_key
  AND definition.source_template_version = template.version
  AND definition.description IS DISTINCT FROM template.description;

-- Carry the four capabilities into every organisation's existing version 3 role
-- definition. Provisioning inserts missing template capabilities and skips the
-- ones already present, so this adds exactly the operational template bundle.
SELECT provision_canonical_role_definitions(id)
FROM organisations;

-- Preserve the provenance migration 024 used to record. The assignment still
-- points at the same role definition; what changed is the capability set behind
-- it, which is the fact an auditor needs to be able to find.
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
        'roleKey', role_definition.role_key,
        'capabilitiesAdded', jsonb_build_array(
            'template.read',
            'template.create',
            'template.publish',
            'template.assign'
        )
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
