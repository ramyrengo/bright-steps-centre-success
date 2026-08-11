CREATE TABLE organisations (
    id UUID PRIMARY KEY,
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    default_timezone TEXT NOT NULL CHECK (char_length(btrim(default_timezone)) BETWEEN 1 AND 100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (updated_at >= created_at),
    UNIQUE (id, status)
);

CREATE TABLE organisational_units (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    parent_id UUID,
    kind TEXT NOT NULL CHECK (kind IN ('state', 'region', 'centre_group')),
    code TEXT NOT NULL CHECK (char_length(btrim(code)) BETWEEN 1 AND 50),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, code),
    FOREIGN KEY (organisation_id, parent_id)
        REFERENCES organisational_units(organisation_id, id),
    CHECK (parent_id IS NULL OR parent_id <> id),
    CHECK (effective_to IS NULL OR effective_to > effective_from),
    CHECK (updated_at >= created_at)
);

CREATE TABLE centres (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    code TEXT NOT NULL CHECK (char_length(btrim(code)) BETWEEN 1 AND 50),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
    jurisdiction_code TEXT NOT NULL CHECK (char_length(btrim(jurisdiction_code)) BETWEEN 1 AND 20),
    timezone TEXT NOT NULL CHECK (char_length(btrim(timezone)) BETWEEN 1 AND 100),
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, code),
    CHECK (updated_at >= created_at)
);

CREATE TABLE centre_organisational_unit_memberships (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    centre_id UUID NOT NULL,
    organisational_unit_id UUID NOT NULL,
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    FOREIGN KEY (organisation_id, organisational_unit_id)
        REFERENCES organisational_units(organisation_id, id),
    CHECK (effective_to IS NULL OR effective_to > effective_from)
);

CREATE INDEX centre_unit_memberships_centre_idx
    ON centre_organisational_unit_memberships (organisation_id, centre_id, effective_from);

CREATE INDEX centre_unit_memberships_unit_idx
    ON centre_organisational_unit_memberships (organisation_id, organisational_unit_id, effective_from);

CREATE TABLE principals (
    id UUID PRIMARY KEY,
    display_name TEXT NOT NULL CHECK (char_length(btrim(display_name)) BETWEEN 1 AND 200),
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (updated_at >= created_at)
);

CREATE TABLE external_identity_mappings (
    id UUID PRIMARY KEY,
    principal_id UUID NOT NULL REFERENCES principals(id),
    provider_key TEXT NOT NULL CHECK (char_length(btrim(provider_key)) BETWEEN 1 AND 100),
    provider_subject TEXT NOT NULL CHECK (char_length(btrim(provider_subject)) BETWEEN 1 AND 500),
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    last_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (provider_key, provider_subject),
    CHECK (updated_at >= created_at)
);

CREATE INDEX external_identity_principal_idx
    ON external_identity_mappings (principal_id, status);

CREATE TABLE organisation_memberships (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    principal_id UUID NOT NULL REFERENCES principals(id),
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    CHECK (effective_to IS NULL OR effective_to > effective_from),
    CHECK (updated_at >= created_at)
);

CREATE INDEX organisation_memberships_principal_idx
    ON organisation_memberships (principal_id, organisation_id, status);

CREATE TABLE capabilities (
    code TEXT PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 300),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO capabilities (code, description) VALUES
    ('organisation.read', 'View organisation structure within an authorised scope.'),
    ('centre.read', 'View a centre basic operational profile within an authorised scope.'),
    ('centre.manage', 'Manage a centre basic operational profile within an authorised scope.'),
    ('principal.read', 'View internal principals within an authorised scope.'),
    ('identity.mapping.manage', 'Manage future external identity to internal principal mappings.'),
    ('principal.manage', 'Manage internal Centre Success principals.'),
    ('assignment.read', 'View role and scope assignments within an authorised scope.'),
    ('assignment.manage', 'Manage role and scope assignments within an authorised scope.'),
    ('system.configure', 'Manage approved application-level configuration.'),
    ('system.health.read', 'Inspect system-level operational health.'),
    ('budget.summary.read', 'Recognise permission to read future budget summaries within an authorised scope.');

CREATE TABLE role_definitions (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    role_key TEXT NOT NULL CHECK (role_key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
    description TEXT NOT NULL DEFAULT '',
    version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    UNIQUE (organisation_id, role_key, version),
    CHECK (updated_at >= created_at)
);

CREATE TABLE role_capabilities (
    role_definition_id UUID NOT NULL REFERENCES role_definitions(id),
    capability_code TEXT NOT NULL REFERENCES capabilities(code),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_definition_id, capability_code)
);

CREATE TABLE role_assignments (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    organisation_membership_id UUID NOT NULL,
    role_definition_id UUID NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    effective_from TIMESTAMPTZ NOT NULL DEFAULT now(),
    effective_to TIMESTAMPTZ,
    granted_by_principal_id UUID REFERENCES principals(id),
    reason TEXT NOT NULL DEFAULT '',
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (organisation_id, id),
    FOREIGN KEY (organisation_id, organisation_membership_id)
        REFERENCES organisation_memberships(organisation_id, id),
    FOREIGN KEY (organisation_id, role_definition_id)
        REFERENCES role_definitions(organisation_id, id),
    CHECK (effective_to IS NULL OR effective_to > effective_from),
    CHECK (updated_at >= created_at)
);

CREATE INDEX role_assignments_membership_idx
    ON role_assignments (organisation_id, organisation_membership_id, status);

CREATE TABLE assignment_scopes (
    id UUID PRIMARY KEY,
    organisation_id UUID NOT NULL REFERENCES organisations(id),
    role_assignment_id UUID NOT NULL,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('organisation', 'organisational_unit', 'centre')),
    organisational_unit_id UUID,
    centre_id UUID,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (organisation_id, role_assignment_id)
        REFERENCES role_assignments(organisation_id, id),
    FOREIGN KEY (organisation_id, organisational_unit_id)
        REFERENCES organisational_units(organisation_id, id),
    FOREIGN KEY (organisation_id, centre_id)
        REFERENCES centres(organisation_id, id),
    CHECK (
        (scope_type = 'organisation' AND organisational_unit_id IS NULL AND centre_id IS NULL)
        OR (scope_type = 'organisational_unit' AND organisational_unit_id IS NOT NULL AND centre_id IS NULL)
        OR (scope_type = 'centre' AND organisational_unit_id IS NULL AND centre_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX assignment_scopes_organisation_unique
    ON assignment_scopes (role_assignment_id)
    WHERE scope_type = 'organisation';

CREATE UNIQUE INDEX assignment_scopes_unit_unique
    ON assignment_scopes (role_assignment_id, organisational_unit_id)
    WHERE scope_type = 'organisational_unit';

CREATE UNIQUE INDEX assignment_scopes_centre_unique
    ON assignment_scopes (role_assignment_id, centre_id)
    WHERE scope_type = 'centre';

CREATE TABLE system_audit_events (
    id UUID PRIMARY KEY,
    organisation_id UUID REFERENCES organisations(id),
    actor_principal_id UUID REFERENCES principals(id),
    action TEXT NOT NULL CHECK (action ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    resource_type TEXT NOT NULL CHECK (resource_type ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    resource_id UUID,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('system', 'organisation', 'organisational_unit', 'centre', 'principal')),
    scope_id UUID,
    context JSONB NOT NULL DEFAULT '{}'::jsonb,
    correlation_id TEXT,
    occurred_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(context) = 'object'),
    CHECK (
        (scope_type = 'system' AND scope_id IS NULL)
        OR (scope_type <> 'system' AND scope_id IS NOT NULL)
    )
);

CREATE INDEX system_audit_events_org_time_idx
    ON system_audit_events (organisation_id, occurred_at DESC);

CREATE INDEX system_audit_events_actor_time_idx
    ON system_audit_events (actor_principal_id, occurred_at DESC);

CREATE INDEX system_audit_events_resource_idx
    ON system_audit_events (resource_type, resource_id, occurred_at DESC);
