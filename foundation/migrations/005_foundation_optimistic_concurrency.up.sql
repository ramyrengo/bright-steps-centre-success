ALTER TABLE organisations
    ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0);

ALTER TABLE organisational_units
    ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0);

ALTER TABLE centres
    ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0);

ALTER TABLE centre_organisational_unit_memberships
    ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0),
    ADD CHECK (updated_at >= created_at);

ALTER TABLE principals
    ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0);

ALTER TABLE external_identity_mappings
    ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0);

ALTER TABLE organisation_memberships
    ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0);

ALTER TABLE role_definitions
    ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0);

ALTER TABLE role_assignments
    ADD COLUMN lock_version INTEGER NOT NULL DEFAULT 1 CHECK (lock_version > 0);
