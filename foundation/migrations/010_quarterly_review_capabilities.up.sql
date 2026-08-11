INSERT INTO capabilities (code, description) VALUES
    ('quarterly_audit.read', 'View quarterly internal reviews within an authorised scope.'),
    ('quarterly_audit.conduct', 'Start and record quarterly internal reviews within an authorised scope.'),
    ('quarterly_audit.finalise', 'Finalise quarterly internal reviews within an authorised scope.'),
    ('quarterly_audit.acknowledge', 'Acknowledge a finalised quarterly internal review within an authorised scope.'),
    ('finding.read', 'View internal-review findings within an authorised scope.'),
    ('corrective_action.read', 'View corrective actions within an authorised scope.'),
    ('corrective_action.remediate', 'Progress and submit corrective-action remediation within an authorised scope.'),
    ('corrective_action.verify', 'Independently verify corrective-action remediation within an authorised scope.'),
    ('evidence.read', 'View permitted audit and remediation evidence within an authorised scope.'),
    ('evidence.upload', 'Upload permitted audit and remediation evidence within an authorised scope.'),
    ('compliance.oversight.read', 'View organisation compliance oversight within an authorised scope.');

UPDATE canonical_role_templates
SET status = 'inactive'
WHERE role_key IN ('area_manager', 'centre_director', 'compliance_manager')
  AND status = 'active';

INSERT INTO canonical_role_templates (
    role_key, version, name, description, status
) VALUES
    ('area_manager', 2, 'Area Manager', 'Assigned-centre quarterly review conduct, finalisation, findings, evidence, and independent action verification.', 'active'),
    ('centre_director', 2, 'Centre Director', 'Assigned-centre review read/acknowledgement and corrective-action remediation/evidence.', 'active'),
    ('compliance_manager', 2, 'Compliance Manager', 'Organisation-scoped quarterly review, finding, action, evidence, verification, and oversight read.', 'active');

INSERT INTO canonical_role_template_capabilities (
    role_key, role_version, capability_code
) VALUES
    ('area_manager', 2, 'centre.read'),
    ('area_manager', 2, 'quarterly_audit.read'),
    ('area_manager', 2, 'quarterly_audit.conduct'),
    ('area_manager', 2, 'quarterly_audit.finalise'),
    ('area_manager', 2, 'finding.read'),
    ('area_manager', 2, 'corrective_action.read'),
    ('area_manager', 2, 'corrective_action.verify'),
    ('area_manager', 2, 'evidence.read'),
    ('centre_director', 2, 'centre.read'),
    ('centre_director', 2, 'centre.manage'),
    ('centre_director', 2, 'quarterly_audit.read'),
    ('centre_director', 2, 'quarterly_audit.acknowledge'),
    ('centre_director', 2, 'finding.read'),
    ('centre_director', 2, 'corrective_action.read'),
    ('centre_director', 2, 'corrective_action.remediate'),
    ('centre_director', 2, 'evidence.read'),
    ('centre_director', 2, 'evidence.upload'),
    ('compliance_manager', 2, 'organisation.read'),
    ('compliance_manager', 2, 'centre.read'),
    ('compliance_manager', 2, 'quarterly_audit.read'),
    ('compliance_manager', 2, 'finding.read'),
    ('compliance_manager', 2, 'corrective_action.read'),
    ('compliance_manager', 2, 'corrective_action.verify'),
    ('compliance_manager', 2, 'evidence.read'),
    ('compliance_manager', 2, 'compliance.oversight.read');

UPDATE role_definitions
SET status = 'inactive',
    updated_at = now(),
    lock_version = lock_version + 1
WHERE role_key IN ('area_manager', 'centre_director', 'compliance_manager')
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
  AND previous.role_key IN ('area_manager', 'centre_director', 'compliance_manager')
  AND previous.version = 1
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
        'source', 'milestone_2b',
        'toVersion', 2,
        'roleKey', role_definition.role_key
    ),
    'milestone-2b-role-bundle-migration',
    now()
FROM role_assignments AS assignment
JOIN role_definitions AS role_definition
  ON role_definition.organisation_id = assignment.organisation_id
 AND role_definition.id = assignment.role_definition_id
WHERE role_definition.role_key IN ('area_manager', 'centre_director', 'compliance_manager')
  AND role_definition.version = 2;
