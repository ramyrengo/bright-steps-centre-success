CREATE TABLE canonical_role_templates (
    role_key TEXT NOT NULL CHECK (role_key ~ '^[a-z][a-z0-9_.-]{0,99}$'),
    version INTEGER NOT NULL CHECK (version > 0),
    name TEXT NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 150),
    description TEXT NOT NULL CHECK (char_length(btrim(description)) BETWEEN 1 AND 500),
    status TEXT NOT NULL CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_key, version)
);

CREATE UNIQUE INDEX canonical_role_templates_one_active_version
    ON canonical_role_templates (role_key)
    WHERE status = 'active';

CREATE TABLE canonical_role_template_capabilities (
    role_key TEXT NOT NULL,
    role_version INTEGER NOT NULL,
    capability_code TEXT NOT NULL REFERENCES capabilities(code),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (role_key, role_version, capability_code),
    FOREIGN KEY (role_key, role_version)
        REFERENCES canonical_role_templates(role_key, version)
);

INSERT INTO canonical_role_templates (
    role_key,
    version,
    name,
    description,
    status
) VALUES
    ('educator', 1, 'Educator', 'Foundation centre-read baseline for an explicitly assigned centre.', 'active'),
    ('assistant_director', 1, 'Assistant Director', 'Foundation centre-read baseline without implied Centre Director management.', 'active'),
    ('centre_director', 1, 'Centre Director', 'Foundation centre read and management for explicitly assigned centres.', 'active'),
    ('area_manager', 1, 'Area Manager', 'Foundation centre read for an effective assigned portfolio.', 'active'),
    ('compliance_manager', 1, 'Compliance Manager', 'Foundation organisation and centre read for an assigned organisation.', 'active'),
    ('operations_leadership', 1, 'Operations Leadership', 'Foundation organisation, centre, and assignment read within explicit business scope.', 'active'),
    ('finance', 1, 'Finance', 'Foundation organisation, centre, and synthetic budget-summary read within explicit scope.', 'active'),
    ('executive', 1, 'Executive', 'Foundation strategic organisation and centre read within explicit scope.', 'active'),
    ('system_administrator', 1, 'System Administrator', 'Foundation technical administration without implicit business-content access.', 'active');

INSERT INTO canonical_role_template_capabilities (
    role_key,
    role_version,
    capability_code
) VALUES
    ('educator', 1, 'centre.read'),
    ('assistant_director', 1, 'centre.read'),
    ('centre_director', 1, 'centre.read'),
    ('centre_director', 1, 'centre.manage'),
    ('area_manager', 1, 'centre.read'),
    ('compliance_manager', 1, 'organisation.read'),
    ('compliance_manager', 1, 'centre.read'),
    ('operations_leadership', 1, 'organisation.read'),
    ('operations_leadership', 1, 'centre.read'),
    ('operations_leadership', 1, 'assignment.read'),
    ('finance', 1, 'organisation.read'),
    ('finance', 1, 'centre.read'),
    ('finance', 1, 'budget.summary.read'),
    ('executive', 1, 'organisation.read'),
    ('executive', 1, 'centre.read'),
    ('system_administrator', 1, 'principal.read'),
    ('system_administrator', 1, 'principal.manage'),
    ('system_administrator', 1, 'identity.mapping.manage'),
    ('system_administrator', 1, 'assignment.read'),
    ('system_administrator', 1, 'assignment.manage'),
    ('system_administrator', 1, 'system.configure'),
    ('system_administrator', 1, 'system.health.read');

ALTER TABLE role_definitions
    ADD COLUMN source_template_key TEXT,
    ADD COLUMN source_template_version INTEGER,
    ADD CONSTRAINT role_definitions_template_pair_check
        CHECK (
            (source_template_key IS NULL AND source_template_version IS NULL)
            OR (source_template_key IS NOT NULL AND source_template_version IS NOT NULL)
        ),
    ADD CONSTRAINT role_definitions_template_fk
        FOREIGN KEY (source_template_key, source_template_version)
        REFERENCES canonical_role_templates(role_key, version);

CREATE UNIQUE INDEX role_definitions_template_version_unique
    ON role_definitions (organisation_id, source_template_key, version)
    WHERE source_template_key IS NOT NULL;

CREATE UNIQUE INDEX role_definitions_one_active_role_key
    ON role_definitions (organisation_id, role_key)
    WHERE status = 'active';

CREATE FUNCTION provision_canonical_role_definitions(target_organisation_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
    template canonical_role_templates%ROWTYPE;
    role_definition_id UUID;
    existing_template_key TEXT;
    existing_template_version INTEGER;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM organisations
        WHERE id = target_organisation_id
    ) THEN
        RAISE EXCEPTION 'cannot provision roles for an unknown organisation';
    END IF;

    FOR template IN
        SELECT *
        FROM canonical_role_templates
        WHERE status = 'active'
        ORDER BY role_key
    LOOP
        SELECT
            id,
            source_template_key,
            source_template_version
        INTO
            role_definition_id,
            existing_template_key,
            existing_template_version
        FROM role_definitions
        WHERE organisation_id = target_organisation_id
          AND role_key = template.role_key
          AND version = template.version;

        IF role_definition_id IS NULL THEN
            role_definition_id := gen_random_uuid();

            INSERT INTO role_definitions (
                id,
                organisation_id,
                role_key,
                name,
                description,
                version,
                status,
                source_template_key,
                source_template_version
            ) VALUES (
                role_definition_id,
                target_organisation_id,
                template.role_key,
                template.name,
                template.description,
                template.version,
                'active',
                template.role_key,
                template.version
            );
        ELSIF existing_template_key IS DISTINCT FROM template.role_key
           OR existing_template_version IS DISTINCT FROM template.version THEN
            RAISE EXCEPTION
                'existing role definition conflicts with canonical template %',
                template.role_key;
        END IF;

        INSERT INTO role_capabilities (
            role_definition_id,
            capability_code
        )
        SELECT
            role_definition_id,
            template_capability.capability_code
        FROM canonical_role_template_capabilities AS template_capability
        WHERE template_capability.role_key = template.role_key
          AND template_capability.role_version = template.version
        ON CONFLICT DO NOTHING;
    END LOOP;
END;
$$;

SELECT provision_canonical_role_definitions(id)
FROM organisations;

CREATE FUNCTION provision_canonical_roles_for_new_organisation()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    PERFORM provision_canonical_role_definitions(NEW.id);
    RETURN NEW;
END;
$$;

CREATE TRIGGER organisations_provision_canonical_roles
AFTER INSERT ON organisations
FOR EACH ROW
EXECUTE FUNCTION provision_canonical_roles_for_new_organisation();
