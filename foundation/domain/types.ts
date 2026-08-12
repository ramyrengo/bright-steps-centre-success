export type EntityStatus = "active" | "inactive";

export type OrganisationalUnitKind = "state" | "region" | "centre_group";

export interface Organisation {
  id: string;
  name: string;
  status: EntityStatus;
  defaultTimezone: string;
  createdAt: Date;
  updatedAt: Date;
  lockVersion: number;
}

export interface OrganisationalUnit {
  id: string;
  organisationId: string;
  parentId: string | null;
  kind: OrganisationalUnitKind;
  code: string;
  name: string;
  status: EntityStatus;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  createdAt: Date;
  updatedAt: Date;
  lockVersion: number;
}

export interface Centre {
  id: string;
  organisationId: string;
  code: string;
  name: string;
  jurisdictionCode: string;
  timezone: string;
  status: EntityStatus;
  createdAt: Date;
  updatedAt: Date;
  lockVersion: number;
}

export type PrincipalStatus = "pending" | "active" | "suspended" | "revoked";

export interface Principal {
  id: string;
  displayName: string;
  status: PrincipalStatus;
  createdAt: Date;
  updatedAt: Date;
  lockVersion: number;
}
