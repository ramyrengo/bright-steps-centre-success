import { randomUUID } from "node:crypto";
import { centreSuccessDB } from "../db";

export type AuditScopeType =
  | "system"
  | "organisation"
  | "organisational_unit"
  | "centre"
  | "principal";

type AuditContextValue = string | number | boolean | null;

interface RecordAuditEventBase {
  actorPrincipalId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  correlationId?: string;
  context?: Record<string, AuditContextValue>;
  occurredAt?: Date;
}

type AuditScope =
  | {
      scopeType: "system";
      organisationId?: never;
      scopeId?: never;
    }
  | {
      scopeType: Exclude<AuditScopeType, "system">;
      organisationId: string;
      scopeId: string;
    };

export type RecordAuditEventInput = RecordAuditEventBase & AuditScope;

export interface RecordedAuditEvent {
  id: string;
  occurredAt: Date;
}

const SAFE_EVENT_NAME = /^[a-z][a-z0-9_.-]{0,99}$/;
const CANONICAL_UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TENANT_FOUNDATION_RESOURCE_TYPES = new Set([
  "organisation",
  "organisational_unit",
  "centre",
  "principal",
  "organisation_membership",
  "role_definition",
  "role_assignment",
]);

function assertOptionalUuid(value: string | undefined, field: string): void {
  if (value !== undefined && !CANONICAL_UUID.test(value)) {
    throw new Error(`${field} must be a canonical UUID`);
  }
}

function assertScopeIntegrity(input: RecordAuditEventInput): void {
  if (input.scopeType === "system") {
    if (input.organisationId !== undefined || input.scopeId !== undefined) {
      throw new Error("system audit scope cannot include organisation or scope IDs");
    }

    if (TENANT_FOUNDATION_RESOURCE_TYPES.has(input.resourceType)) {
      throw new Error("system audit scope cannot claim a tenant resource");
    }

    return;
  }

  if (input.organisationId === undefined || input.scopeId === undefined) {
    throw new Error("tenant audit scope requires organisation and scope IDs");
  }

  assertOptionalUuid(input.organisationId, "audit organisation ID");
  assertOptionalUuid(input.scopeId, "audit scope ID");

  if (
    input.scopeType === "organisation" &&
    input.scopeId !== input.organisationId
  ) {
    throw new Error("organisation audit scope must identify its organisation");
  }
}

/**
 * Writes an immutable business/security audit event. Operational logs and
 * traces are intentionally separate from this durable record.
 *
 * Milestone 1 has no production caller by design. The milestone exposes no
 * protected business API and performs no material state change, so there is no
 * write path to attribute; the synthetic tests exercise the seam instead.
 *
 * The public health endpoint must not become that caller. `/foundation/health`
 * is unauthenticated, so recording a row per request would make an append-only
 * table an unauthenticated write-amplification target and would fill it with
 * routine liveness polling that carries no accountability value.
 *
 * The first real callers arrive with Milestone 2 write paths, where each
 * material state change, permission change, and evidence access is attributable
 * under an authenticated principal.
 */
export async function recordAuditEvent(
  input: RecordAuditEventInput,
): Promise<RecordedAuditEvent> {
  if (!SAFE_EVENT_NAME.test(input.action)) {
    throw new Error("audit action must use a safe canonical name");
  }

  if (!SAFE_EVENT_NAME.test(input.resourceType)) {
    throw new Error("audit resource type must use a safe canonical name");
  }

  assertScopeIntegrity(input);
  assertOptionalUuid(input.actorPrincipalId, "audit actor principal ID");
  assertOptionalUuid(input.resourceId, "audit resource ID");

  const id = randomUUID();
  const occurredAt = input.occurredAt ?? new Date();
  const context = input.context ?? {};

  await centreSuccessDB.exec`
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
    ) VALUES (
      ${id},
      ${input.organisationId ?? null},
      ${input.actorPrincipalId ?? null},
      ${input.action},
      ${input.resourceType},
      ${input.resourceId ?? null},
      ${input.scopeType},
      ${input.scopeId ?? null},
      ${context},
      ${input.correlationId ?? null},
      ${occurredAt}
    )
  `;

  return { id, occurredAt };
}
