CREATE TABLE access_invitations (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    pending_principal_id UUID NOT NULL UNIQUE REFERENCES principals(id),
    intended_email TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (
        'DRAFT',
        'SENT',
        'IDENTITY_VERIFIED',
        'AWAITING_PRIVILEGED_APPROVAL',
        'ADMINISTRATOR_REVIEW',
        'ACTIVATED',
        'CANCELLED',
        'EXPIRED'
    )),
    privilege_class TEXT NOT NULL CHECK (privilege_class IN ('STANDARD', 'PRIVILEGED', 'REVIEW')),
    package_version INTEGER NOT NULL DEFAULT 1 CHECK (package_version > 0),
    package_digest BYTEA NOT NULL CHECK (octet_length(package_digest) = 32),
    reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
    created_by_principal_id UUID NOT NULL REFERENCES principals(id),
    verified_provider_key TEXT,
    verified_provider_subject TEXT,
    verification_reason TEXT,
    expires_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    activated_at TIMESTAMPTZ,
    cancelled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    CHECK (intended_email = lower(btrim(intended_email))),
    CHECK (char_length(intended_email) BETWEEN 3 AND 320),
    CHECK (position('@' in intended_email) > 1),
    CHECK (
        (verified_provider_key IS NULL AND verified_provider_subject IS NULL)
        OR (
            char_length(btrim(verified_provider_key)) BETWEEN 1 AND 100
            AND char_length(btrim(verified_provider_subject)) BETWEEN 1 AND 500
        )
    ),
    CHECK (updated_at >= created_at)
);

CREATE INDEX access_invitations_org_status_idx
    ON access_invitations (organisation_id, status, created_at DESC);

CREATE UNIQUE INDEX access_invitations_open_email_unique
    ON access_invitations (organisation_id, intended_email)
    WHERE status IN ('DRAFT', 'SENT', 'IDENTITY_VERIFIED', 'AWAITING_PRIVILEGED_APPROVAL', 'ADMINISTRATOR_REVIEW');

CREATE TABLE invitation_role_proposals (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL,
    invitation_id UUID NOT NULL,
    role_definition_id UUID NOT NULL,
    role_key TEXT NOT NULL CHECK (role_key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    role_version INTEGER NOT NULL CHECK (role_version > 0),
    privilege_class TEXT NOT NULL CHECK (privilege_class IN ('STANDARD', 'PRIVILEGED', 'REVIEW')),
    ordinal INTEGER NOT NULL CHECK (ordinal > 0),
    effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    UNIQUE (invitation_id, ordinal),
    FOREIGN KEY (organisation_id, invitation_id)
        REFERENCES access_invitations(organisation_id, id),
    FOREIGN KEY (organisation_id, role_definition_id)
        REFERENCES role_definitions(organisation_id, id),
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE TABLE invitation_scope_proposals (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL,
    invitation_role_proposal_id UUID NOT NULL,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('organisation', 'organisational_unit', 'centre')),
    organisational_unit_id UUID,
    centre_id UUID,
    effective_from TIMESTAMPTZ NOT NULL,
    effective_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    FOREIGN KEY (organisation_id, invitation_role_proposal_id)
        REFERENCES invitation_role_proposals(organisation_id, id),
    FOREIGN KEY (organisation_id, organisational_unit_id)
        REFERENCES organisational_units(organisation_id, id),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    CHECK (
        (scope_type = 'organisation' AND organisational_unit_id IS NULL AND centre_id IS NULL)
        OR (scope_type = 'organisational_unit' AND organisational_unit_id IS NOT NULL AND centre_id IS NULL)
        OR (scope_type = 'centre' AND organisational_unit_id IS NULL AND centre_id IS NOT NULL)
    ),
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE UNIQUE INDEX invitation_scope_proposals_organisation_unique
    ON invitation_scope_proposals (invitation_role_proposal_id)
    WHERE scope_type = 'organisation';

CREATE UNIQUE INDEX invitation_scope_proposals_unit_unique
    ON invitation_scope_proposals (invitation_role_proposal_id, organisational_unit_id)
    WHERE scope_type = 'organisational_unit';

CREATE UNIQUE INDEX invitation_scope_proposals_centre_unique
    ON invitation_scope_proposals (invitation_role_proposal_id, centre_id)
    WHERE scope_type = 'centre';

CREATE TABLE invitation_token_generations (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL,
    invitation_id UUID NOT NULL,
    generation INTEGER NOT NULL CHECK (generation > 0),
    token_digest BYTEA NOT NULL CHECK (octet_length(token_digest) = 32),
    status TEXT NOT NULL CHECK (status IN ('CURRENT', 'CONSUMED', 'INVALIDATED', 'EXPIRED')),
    expires_at TIMESTAMPTZ NOT NULL,
    consumed_at TIMESTAMPTZ,
    invalidated_at TIMESTAMPTZ,
    created_by_principal_id UUID NOT NULL REFERENCES principals(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    UNIQUE (invitation_id, generation),
    UNIQUE (token_digest),
    FOREIGN KEY (organisation_id, invitation_id)
        REFERENCES access_invitations(organisation_id, id),
    CHECK (expires_at > created_at),
    CHECK (updated_at >= created_at)
);

CREATE UNIQUE INDEX invitation_token_generations_one_current
    ON invitation_token_generations (invitation_id)
    WHERE status = 'CURRENT';

CREATE INDEX invitation_token_generations_lookup_idx
    ON invitation_token_generations (token_digest, status, expires_at);

CREATE TABLE invitation_events (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL,
    invitation_id UUID NOT NULL,
    actor_principal_id UUID REFERENCES principals(id),
    event_type TEXT NOT NULL CHECK (event_type ~ '^[A-Z][A-Z0-9_]{0,99}$'),
    from_status TEXT,
    to_status TEXT NOT NULL,
    reason TEXT,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    occurred_at TIMESTAMPTZ NOT NULL,
    event_sequence INTEGER NOT NULL CHECK (event_sequence > 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (invitation_id, event_sequence),
    FOREIGN KEY (organisation_id, invitation_id)
        REFERENCES access_invitations(organisation_id, id),
    CHECK (jsonb_typeof(context) = 'object'),
    CHECK (reason IS NULL OR char_length(btrim(reason)) BETWEEN 1 AND 500)
);

CREATE TABLE privileged_invitation_approvals (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL,
    invitation_id UUID NOT NULL,
    approver_principal_id UUID NOT NULL REFERENCES principals(id),
    package_version INTEGER NOT NULL CHECK (package_version > 0),
    package_digest BYTEA NOT NULL CHECK (octet_length(package_digest) = 32),
    status TEXT NOT NULL CHECK (status IN ('APPROVED', 'INVALIDATED')),
    reason TEXT NOT NULL CHECK (char_length(btrim(reason)) BETWEEN 1 AND 500),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    invalidated_at TIMESTAMPTZ,
    UNIQUE (organisation_id, id),
    FOREIGN KEY (organisation_id, invitation_id)
        REFERENCES access_invitations(organisation_id, id)
);

CREATE UNIQUE INDEX privileged_invitation_approvals_one_current
    ON privileged_invitation_approvals (invitation_id)
    WHERE status = 'APPROVED';

CREATE TABLE people_notification_outbox (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL,
    invitation_id UUID NOT NULL,
    token_generation_id UUID NOT NULL,
    idempotency_key TEXT NOT NULL UNIQUE CHECK (char_length(btrim(idempotency_key)) BETWEEN 1 AND 200),
    recipient_email TEXT NOT NULL CHECK (recipient_email = lower(btrim(recipient_email))),
    encrypted_token BYTEA NOT NULL,
    encryption_iv BYTEA NOT NULL CHECK (octet_length(encryption_iv) = 12),
    encryption_tag BYTEA NOT NULL CHECK (octet_length(encryption_tag) = 16),
    status TEXT NOT NULL CHECK (status IN ('PENDING', 'PUBLISHED', 'DELIVERED', 'FAILED')),
    publish_attempts INTEGER NOT NULL DEFAULT 0 CHECK (publish_attempts >= 0),
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    published_at TIMESTAMPTZ,
    delivered_at TIMESTAMPTZ,
    last_error_class TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    UNIQUE (organisation_id, id),
    FOREIGN KEY (organisation_id, invitation_id)
        REFERENCES access_invitations(organisation_id, id),
    FOREIGN KEY (organisation_id, token_generation_id)
        REFERENCES invitation_token_generations(organisation_id, id),
    CHECK (updated_at >= created_at),
    CHECK (last_error_class IS NULL OR last_error_class ~ '^[a-z][a-z0-9_.-]{0,99}$')
);

CREATE INDEX people_notification_outbox_dispatch_idx
    ON people_notification_outbox (status, next_attempt_at, created_at);

CREATE TABLE people_notification_delivery_attempts (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL,
    outbox_id UUID NOT NULL,
    attempt_number INTEGER NOT NULL CHECK (attempt_number > 0),
    status TEXT NOT NULL CHECK (status IN ('DELIVERED', 'RETRYABLE_FAILURE', 'PERMANENT_FAILURE', 'DUPLICATE')),
    provider_reference TEXT,
    error_class TEXT,
    attempted_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (outbox_id, attempt_number),
    FOREIGN KEY (organisation_id, outbox_id)
        REFERENCES people_notification_outbox(organisation_id, id),
    CHECK (provider_reference IS NULL OR char_length(btrim(provider_reference)) BETWEEN 1 AND 200),
    CHECK (error_class IS NULL OR error_class ~ '^[a-z][a-z0-9_.-]{0,99}$')
);

CREATE TABLE organisation_access_invariants (
    organisation_id UUID PRIMARY KEY REFERENCES organisations(id),
    last_administrator_protection_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    enabled_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (last_administrator_protection_enabled AND enabled_at IS NOT NULL)
        OR (NOT last_administrator_protection_enabled AND enabled_at IS NULL)
    )
);

INSERT INTO organisation_access_invariants (organisation_id)
SELECT id FROM organisations;

CREATE FUNCTION reject_people_append_only_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

CREATE TRIGGER invitation_events_append_only
BEFORE UPDATE OR DELETE ON invitation_events
FOR EACH ROW EXECUTE FUNCTION reject_people_append_only_mutation();

CREATE TRIGGER privileged_invitation_approvals_append_only
BEFORE UPDATE OR DELETE ON privileged_invitation_approvals
FOR EACH ROW EXECUTE FUNCTION reject_people_append_only_mutation();

CREATE TRIGGER people_notification_delivery_attempts_append_only
BEFORE UPDATE OR DELETE ON people_notification_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION reject_people_append_only_mutation();

CREATE FUNCTION validate_pending_invitation_proposal_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    target_invitation_id UUID;
    current_status TEXT;
BEGIN
    IF TG_TABLE_NAME = 'invitation_role_proposals' THEN
        target_invitation_id := COALESCE(NEW.invitation_id, OLD.invitation_id);
    ELSE
        SELECT invitation_id INTO target_invitation_id
        FROM invitation_role_proposals
        WHERE id = COALESCE(NEW.invitation_role_proposal_id, OLD.invitation_role_proposal_id);
    END IF;

    SELECT status INTO current_status
    FROM access_invitations
    WHERE id = target_invitation_id;

    IF current_status IS DISTINCT FROM 'DRAFT' THEN
        RAISE EXCEPTION 'invitation proposals are immutable after draft review';
    END IF;

    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER invitation_role_proposals_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON invitation_role_proposals
FOR EACH ROW EXECUTE FUNCTION validate_pending_invitation_proposal_mutation();

CREATE TRIGGER invitation_scope_proposals_draft_only
BEFORE INSERT OR UPDATE OR DELETE ON invitation_scope_proposals
FOR EACH ROW EXECUTE FUNCTION validate_pending_invitation_proposal_mutation();

CREATE FUNCTION validate_pending_access_separation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM principals
        WHERE id = NEW.principal_id
          AND status = 'active'
    ) THEN
        RAISE EXCEPTION 'active organisation membership requires an active principal';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER organisation_memberships_require_active_principal
BEFORE INSERT ON organisation_memberships
FOR EACH ROW EXECUTE FUNCTION validate_pending_access_separation();

CREATE FUNCTION validate_people_audit_target()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.resource_type = 'access_invitation' THEN
        IF NEW.organisation_id IS NULL
           OR NEW.resource_id IS NULL
           OR NOT EXISTS (
               SELECT 1 FROM access_invitations
               WHERE organisation_id = NEW.organisation_id
                 AND id = NEW.resource_id
           ) THEN
            RAISE EXCEPTION 'audit invitation resource does not belong to organisation';
        END IF;
    ELSIF NEW.resource_type = 'privileged_invitation_approval' THEN
        IF NEW.organisation_id IS NULL
           OR NEW.resource_id IS NULL
           OR NOT EXISTS (
               SELECT 1 FROM privileged_invitation_approvals
               WHERE organisation_id = NEW.organisation_id
                 AND id = NEW.resource_id
           ) THEN
            RAISE EXCEPTION 'audit invitation approval resource does not belong to organisation';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER system_audit_events_validate_people_target
BEFORE INSERT ON system_audit_events
FOR EACH ROW EXECUTE FUNCTION validate_people_audit_target();

CREATE FUNCTION reachable_system_administrator_count(target_organisation_id UUID)
RETURNS INTEGER
LANGUAGE SQL
STABLE
AS $$
    SELECT count(DISTINCT principal.id)::integer
    FROM principals AS principal
    JOIN organisation_memberships AS membership
      ON membership.principal_id = principal.id
     AND membership.organisation_id = target_organisation_id
     AND membership.status = 'active'
     AND membership.effective_from <= now()
     AND (membership.effective_to IS NULL OR membership.effective_to > now())
    JOIN role_assignments AS assignment
      ON assignment.organisation_id = membership.organisation_id
     AND assignment.organisation_membership_id = membership.id
     AND assignment.status = 'active'
     AND assignment.effective_from <= now()
     AND (assignment.effective_to IS NULL OR assignment.effective_to > now())
    JOIN role_definitions AS role_definition
      ON role_definition.organisation_id = assignment.organisation_id
     AND role_definition.id = assignment.role_definition_id
     AND role_definition.role_key = 'system_administrator'
     AND role_definition.status = 'active'
    JOIN assignment_scopes AS scope
      ON scope.organisation_id = assignment.organisation_id
     AND scope.role_assignment_id = assignment.id
     AND scope.scope_type = 'organisation'
     AND scope.effective_from <= now()
     AND (scope.effective_to IS NULL OR scope.effective_to > now())
    WHERE principal.status = 'active'
      AND EXISTS (
          SELECT 1 FROM external_identity_mappings AS mapping
          WHERE mapping.principal_id = principal.id
            AND mapping.status = 'active'
            AND mapping.provider_key LIKE 'microsoft_entra:%'
      )
      AND (
          SELECT count(*)
          FROM organisation_memberships AS current_membership
          WHERE current_membership.principal_id = principal.id
            AND current_membership.organisation_id = target_organisation_id
            AND current_membership.status = 'active'
            AND current_membership.effective_from <= now()
            AND (current_membership.effective_to IS NULL OR current_membership.effective_to > now())
      ) = 1
      AND NOT EXISTS (
          SELECT required.code
          FROM (VALUES
              ('principal.read'),
              ('principal.manage'),
              ('identity.mapping.manage'),
              ('assignment.read'),
              ('assignment.manage'),
              ('invitation.read'),
              ('invitation.manage'),
              ('access_history.read'),
              ('privileged_access.approve')
          ) AS required(code)
          WHERE NOT EXISTS (
              SELECT 1 FROM role_capabilities AS capability
              WHERE capability.role_definition_id = role_definition.id
                AND capability.capability_code = required.code
          )
      );
$$;

CREATE FUNCTION people_admin_guard_organisation_ids(record_data JSONB, table_name TEXT)
RETURNS SETOF UUID
LANGUAGE plpgsql
AS $$
DECLARE
    direct_organisation UUID;
    record_id UUID;
    target_principal_id UUID;
    role_definition_id UUID;
BEGIN
    IF record_data ? 'organisation_id' THEN
        direct_organisation := NULLIF(record_data ->> 'organisation_id', '')::UUID;
        IF direct_organisation IS NOT NULL THEN
            RETURN NEXT direct_organisation;
            RETURN;
        END IF;
    END IF;

    IF table_name = 'organisations' THEN
        record_id := (record_data ->> 'id')::UUID;
        RETURN NEXT record_id;
        RETURN;
    END IF;

    IF table_name = 'principals' THEN
        target_principal_id := (record_data ->> 'id')::UUID;
    ELSIF table_name = 'external_identity_mappings' THEN
        target_principal_id := (record_data ->> 'principal_id')::UUID;
    ELSIF table_name = 'role_capabilities' THEN
        role_definition_id := (record_data ->> 'role_definition_id')::UUID;
        RETURN QUERY
            SELECT organisation_id FROM role_definitions WHERE id = role_definition_id;
        RETURN;
    END IF;

    IF target_principal_id IS NOT NULL THEN
        RETURN QUERY
            SELECT DISTINCT organisation_id
            FROM organisation_memberships
            WHERE organisation_memberships.principal_id = target_principal_id;
    END IF;
END;
$$;

CREATE FUNCTION lock_people_admin_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    record_data JSONB;
    target_organisation UUID;
BEGIN
    record_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    FOR target_organisation IN
        SELECT DISTINCT organisation_id
        FROM people_admin_guard_organisation_ids(record_data, TG_TABLE_NAME) AS organisation_id
        ORDER BY organisation_id
    LOOP
        PERFORM pg_advisory_xact_lock(hashtextextended(target_organisation::TEXT, 20503));
    END LOOP;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE FUNCTION enforce_people_admin_guard()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    record_data JSONB;
    target_organisation UUID;
    reachable_count INTEGER;
    protection_enabled BOOLEAN;
BEGIN
    record_data := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
    FOR target_organisation IN
        SELECT DISTINCT organisation_id
        FROM people_admin_guard_organisation_ids(record_data, TG_TABLE_NAME) AS organisation_id
        ORDER BY organisation_id
    LOOP
        INSERT INTO organisation_access_invariants (organisation_id)
        VALUES (target_organisation)
        ON CONFLICT DO NOTHING;

        SELECT reachable_system_administrator_count(target_organisation)
        INTO reachable_count;

        SELECT last_administrator_protection_enabled
        INTO protection_enabled
        FROM organisation_access_invariants
        WHERE organisation_id = target_organisation
        FOR UPDATE;

        IF reachable_count > 0 AND NOT protection_enabled THEN
            UPDATE organisation_access_invariants
            SET last_administrator_protection_enabled = TRUE,
                enabled_at = now(),
                updated_at = now()
            WHERE organisation_id = target_organisation;
        ELSIF reachable_count = 0 AND protection_enabled THEN
            RAISE EXCEPTION 'mutation would remove the last reachable System Administrator';
        END IF;
    END LOOP;
    RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER organisations_lock_people_admin_guard
BEFORE UPDATE OR DELETE ON organisations
FOR EACH ROW EXECUTE FUNCTION lock_people_admin_guard();
CREATE CONSTRAINT TRIGGER organisations_enforce_people_admin_guard
AFTER UPDATE OR DELETE ON organisations
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_people_admin_guard();

CREATE TRIGGER principals_lock_people_admin_guard
BEFORE INSERT OR UPDATE OR DELETE ON principals
FOR EACH ROW EXECUTE FUNCTION lock_people_admin_guard();
CREATE CONSTRAINT TRIGGER principals_enforce_people_admin_guard
AFTER INSERT OR UPDATE OR DELETE ON principals
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_people_admin_guard();

CREATE TRIGGER mappings_lock_people_admin_guard
BEFORE INSERT OR UPDATE OR DELETE ON external_identity_mappings
FOR EACH ROW EXECUTE FUNCTION lock_people_admin_guard();
CREATE CONSTRAINT TRIGGER mappings_enforce_people_admin_guard
AFTER INSERT OR UPDATE OR DELETE ON external_identity_mappings
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_people_admin_guard();

CREATE TRIGGER memberships_lock_people_admin_guard
BEFORE INSERT OR UPDATE OR DELETE ON organisation_memberships
FOR EACH ROW EXECUTE FUNCTION lock_people_admin_guard();
CREATE CONSTRAINT TRIGGER memberships_enforce_people_admin_guard
AFTER INSERT OR UPDATE OR DELETE ON organisation_memberships
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_people_admin_guard();

CREATE TRIGGER assignments_lock_people_admin_guard
BEFORE INSERT OR UPDATE OR DELETE ON role_assignments
FOR EACH ROW EXECUTE FUNCTION lock_people_admin_guard();
CREATE CONSTRAINT TRIGGER assignments_enforce_people_admin_guard
AFTER INSERT OR UPDATE OR DELETE ON role_assignments
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_people_admin_guard();

CREATE TRIGGER scopes_lock_people_admin_guard
BEFORE INSERT OR UPDATE OR DELETE ON assignment_scopes
FOR EACH ROW EXECUTE FUNCTION lock_people_admin_guard();
CREATE CONSTRAINT TRIGGER scopes_enforce_people_admin_guard
AFTER INSERT OR UPDATE OR DELETE ON assignment_scopes
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_people_admin_guard();

CREATE TRIGGER definitions_lock_people_admin_guard
BEFORE INSERT OR UPDATE OR DELETE ON role_definitions
FOR EACH ROW EXECUTE FUNCTION lock_people_admin_guard();
CREATE CONSTRAINT TRIGGER definitions_enforce_people_admin_guard
AFTER INSERT OR UPDATE OR DELETE ON role_definitions
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_people_admin_guard();

CREATE TRIGGER capabilities_lock_people_admin_guard
BEFORE INSERT OR UPDATE OR DELETE ON role_capabilities
FOR EACH ROW EXECUTE FUNCTION lock_people_admin_guard();
CREATE CONSTRAINT TRIGGER capabilities_enforce_people_admin_guard
AFTER INSERT OR UPDATE OR DELETE ON role_capabilities
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION enforce_people_admin_guard();

UPDATE organisation_access_invariants AS invariant
SET last_administrator_protection_enabled = TRUE,
    enabled_at = now(),
    updated_at = now()
WHERE reachable_system_administrator_count(invariant.organisation_id) > 0;
