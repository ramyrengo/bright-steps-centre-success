DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM principals WHERE status = 'inactive') THEN
        RAISE EXCEPTION USING
            MESSAGE = 'Milestone 2C cannot classify existing inactive principals automatically.',
            DETAIL = 'Classify every inactive principal as suspended or revoked through an approved data-remediation migration before retrying.',
            HINT = 'Do not rewrite inactive principals to active or guess a lifecycle state.';
    END IF;
END;
$$;

ALTER TABLE principals
    DROP CONSTRAINT principals_status_check;

ALTER TABLE principals
    ADD CONSTRAINT principals_status_check
        CHECK (status IN ('pending', 'active', 'suspended', 'revoked'));

CREATE FUNCTION validate_principal_lifecycle_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF OLD.status = NEW.status THEN
        RETURN NEW;
    END IF;

    IF NOT (
        (OLD.status = 'pending' AND NEW.status IN ('active', 'revoked'))
        OR (OLD.status = 'active' AND NEW.status IN ('suspended', 'revoked'))
        OR (OLD.status = 'suspended' AND NEW.status IN ('active', 'revoked'))
    ) THEN
        RAISE EXCEPTION 'invalid principal lifecycle transition from % to %', OLD.status, NEW.status;
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER principals_validate_lifecycle_transition
BEFORE UPDATE OF status ON principals
FOR EACH ROW
EXECUTE FUNCTION validate_principal_lifecycle_transition();

INSERT INTO capabilities (code, description) VALUES
    ('invitation.read', 'View invitation state and reviewed pending access packages within an authorised organisation scope.'),
    ('invitation.manage', 'Create, review, send, resend, and cancel invitations within an authorised organisation scope.'),
    ('access_history.read', 'View principal, invitation, assignment, and lifecycle history within an authorised organisation scope.'),
    ('privileged_access.approve', 'Independently approve reviewed privileged invitation packages within an authorised organisation scope.'),
    ('access.change.request', 'Reserved capability for a separately approved future access-change request workflow.');

UPDATE canonical_role_templates
SET status = 'inactive'
WHERE role_key = 'system_administrator'
  AND status = 'active';

INSERT INTO canonical_role_templates (
    role_key, version, name, description, status
) VALUES (
    'system_administrator',
    2,
    'System Administrator',
    'Foundation technical and People & Access administration without implicit business-content access.',
    'active'
);

INSERT INTO canonical_role_template_capabilities (
    role_key, role_version, capability_code
) VALUES
    ('system_administrator', 2, 'principal.read'),
    ('system_administrator', 2, 'principal.manage'),
    ('system_administrator', 2, 'identity.mapping.manage'),
    ('system_administrator', 2, 'assignment.read'),
    ('system_administrator', 2, 'assignment.manage'),
    ('system_administrator', 2, 'system.configure'),
    ('system_administrator', 2, 'system.health.read'),
    ('system_administrator', 2, 'invitation.read'),
    ('system_administrator', 2, 'invitation.manage'),
    ('system_administrator', 2, 'access_history.read'),
    ('system_administrator', 2, 'privileged_access.approve');

UPDATE role_definitions
SET status = 'inactive',
    updated_at = now(),
    lock_version = lock_version + 1
WHERE role_key = 'system_administrator'
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
  AND previous.role_key = 'system_administrator'
  AND previous.version = 1
  AND replacement.organisation_id = previous.organisation_id
  AND replacement.role_key = 'system_administrator'
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
        'source', 'milestone_2c',
        'toVersion', 2,
        'roleKey', role_definition.role_key
    ),
    'milestone-2c-system-administrator-bundle-migration',
    now()
FROM role_assignments AS assignment
JOIN role_definitions AS role_definition
  ON role_definition.organisation_id = assignment.organisation_id
 AND role_definition.id = assignment.role_definition_id
WHERE role_definition.role_key = 'system_administrator'
  AND role_definition.version = 2;
