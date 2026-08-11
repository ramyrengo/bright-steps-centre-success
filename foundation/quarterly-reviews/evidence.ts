import { createHash, randomUUID } from "node:crypto";
import { appMeta, type EnvironmentMeta } from "encore.dev";
import { Bucket } from "encore.dev/storage/objects";
import { recordAuditEvent, recordAuditEventWithExecutor } from "../audit/events";
import { centreSuccessDB } from "../db";
import type {
  CompleteEvidenceUploadResponse,
  GetEvidenceAccessResponse,
  RequestEvidenceUploadRequest,
  RequestEvidenceUploadResponse,
} from "./contracts";
import { loadEvidenceTarget } from "./queries";
import { QuarterlyReviewError, optionalTrimmedText } from "./types";

export const quarterlyReviewEvidence = new Bucket("quarterly-review-evidence", {
  public: false,
  versioned: true,
});

const UPLOAD_TTL_SECONDS = 5 * 60;
const DOWNLOAD_TTL_SECONDS = 2 * 60;
const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024;
const MEDIA_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

function isExactLocalDevelopment(
  environment: Pick<EnvironmentMeta, "cloud" | "name" | "type">,
): boolean {
  return (
    environment.cloud === "local" &&
    environment.name === "local" &&
    environment.type === "development"
  );
}

function safeFilename(value: string): string {
  const filename = optionalTrimmedText(value, "filename", 255)!;
  if (/[/\\\u0000-\u001f]/.test(filename)) {
    throw new QuarterlyReviewError("invalid_input", "filename is invalid");
  }
  return filename;
}

export async function requestEvidenceUpload(input: {
  organisationId: string;
  centreId: string;
  actorPrincipalId: string;
  request: RequestEvidenceUploadRequest;
}): Promise<RequestEvidenceUploadResponse> {
  if (!MEDIA_TYPES.has(input.request.mediaType)) {
    throw new QuarterlyReviewError("invalid_input", "evidence media type is not permitted");
  }
  const filename = safeFilename(input.request.filename);
  const evidenceId = randomUUID();
  const objectKey = `${input.organisationId}/${input.centreId}/${evidenceId}`;
  const transaction = await centreSuccessDB.begin();
  try {
    await transaction.exec`SET TRANSACTION ISOLATION LEVEL SERIALIZABLE`;
    if (input.request.targetType === "AUDIT_RESPONSE") {
      const target = await transaction.queryRow<{ id: string }>`
        SELECT response.id
        FROM audit_responses AS response
        JOIN audit_runs AS run
          ON run.organisation_id = response.organisation_id
         AND run.id = response.audit_run_id
        WHERE response.organisation_id = ${input.organisationId}
          AND response.id = ${input.request.targetId}
          AND run.centre_id = ${input.centreId}
          AND run.status IN ('DRAFT', 'IN_PROGRESS')
      `;
      if (!target) throw new QuarterlyReviewError("not_found", "evidence target is not available");
    } else {
      const target = await transaction.queryRow<{ id: string }>`
        SELECT id FROM corrective_actions
        WHERE organisation_id = ${input.organisationId}
          AND id = ${input.request.targetId}
          AND centre_id = ${input.centreId}
          AND status IN ('OPEN', 'IN_PROGRESS', 'MORE_INFORMATION_REQUIRED', 'REJECTED')
      `;
      if (!target) throw new QuarterlyReviewError("not_found", "evidence target is not available");
    }
    await transaction.exec`
      INSERT INTO evidence_items (
        id, organisation_id, centre_id, object_key, original_filename,
        media_type, classification, purpose, upload_status, scan_status,
        availability_status, uploaded_by_principal_id
      ) VALUES (
        ${evidenceId}, ${input.organisationId}, ${input.centreId}, ${objectKey},
        ${filename}, ${input.request.mediaType}, 'CONFIDENTIAL_AUDIT_EVIDENCE',
        ${input.request.targetType === "AUDIT_RESPONSE" ? "AUDIT_RESPONSE" : "CORRECTIVE_ACTION_REMEDIATION"},
        'PENDING', 'not_scanned', 'PENDING', ${input.actorPrincipalId}
      )
    `;
    if (input.request.targetType === "AUDIT_RESPONSE") {
      await transaction.exec`
        INSERT INTO audit_response_evidence (
          organisation_id, audit_response_id, evidence_item_id,
          linked_by_principal_id, linked_at
        ) VALUES (
          ${input.organisationId}, ${input.request.targetId}, ${evidenceId},
          ${input.actorPrincipalId}, now()
        )
      `;
    } else {
      await transaction.exec`
        INSERT INTO corrective_action_evidence (
          organisation_id, corrective_action_id, evidence_item_id,
          linked_by_principal_id, linked_at
        ) VALUES (
          ${input.organisationId}, ${input.request.targetId}, ${evidenceId},
          ${input.actorPrincipalId}, now()
        )
      `;
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  try {
    const signed = await quarterlyReviewEvidence.signedUploadUrl(objectKey, {
      ttl: UPLOAD_TTL_SECONDS,
    });
    return {
      evidenceId,
      uploadUrl: signed.url,
      expiresInSeconds: UPLOAD_TTL_SECONDS,
    };
  } catch (error) {
    await centreSuccessDB.exec`
      UPDATE evidence_items
      SET upload_status = 'FAILED', availability_status = 'RESTRICTED',
          updated_at = now(), lock_version = lock_version + 1
      WHERE organisation_id = ${input.organisationId} AND id = ${evidenceId}
    `;
    throw error;
  }
}

export async function completeEvidenceUpload(input: {
  organisationId: string;
  centreId: string;
  evidenceId: string;
  actorPrincipalId: string;
  environment?: Pick<EnvironmentMeta, "cloud" | "name" | "type">;
}): Promise<CompleteEvidenceUploadResponse> {
  const target = await loadEvidenceTarget(input.organisationId, input.evidenceId);
  if (target.centreId !== input.centreId || target.uploaderPrincipalId !== input.actorPrincipalId) {
    throw new QuarterlyReviewError("access_denied", "evidence is not available");
  }
  let attrs;
  let contents: Buffer;
  try {
    attrs = await quarterlyReviewEvidence.attrs(target.objectKey);
    if (attrs.size < 1 || attrs.size > MAX_EVIDENCE_BYTES) {
      throw new QuarterlyReviewError("invalid_input", "evidence file size is not permitted");
    }
    contents = await quarterlyReviewEvidence.download(target.objectKey);
  } catch (error) {
    if (error instanceof QuarterlyReviewError) throw error;
    throw new QuarterlyReviewError("evidence_unavailable", "uploaded evidence was not found");
  }
  const metadata = await centreSuccessDB.queryRow<{ media_type: string }>`
    SELECT media_type FROM evidence_items
    WHERE organisation_id = ${input.organisationId} AND id = ${input.evidenceId}
  `;
  if (!metadata || !MEDIA_TYPES.has(metadata.media_type)) {
    throw new QuarterlyReviewError("invalid_input", "evidence media type is not permitted");
  }
  if (attrs.contentType && attrs.contentType !== metadata.media_type) {
    throw new QuarterlyReviewError("invalid_input", "uploaded evidence type does not match");
  }

  const environment = input.environment ?? appMeta().environment;
  const local = isExactLocalDevelopment(environment);
  const availability = local ? "AVAILABLE_LOCAL_UNSCANNED" : "RESTRICTED";
  const checksum = createHash("sha256").update(contents).digest("hex");
  const transaction = await centreSuccessDB.begin();
  let persistedAvailability = availability;
  try {
    const updated = await transaction.queryRow<{
      availability_status: string;
    }>`
      UPDATE evidence_items
      SET object_version = ${attrs.version ?? null}, byte_size = ${attrs.size},
          checksum = ${checksum}, upload_status = 'UPLOADED', scan_status = 'not_scanned',
          availability_status = ${availability}, uploaded_at = now(), updated_at = now(),
          lock_version = lock_version + 1
      WHERE organisation_id = ${input.organisationId} AND id = ${input.evidenceId}
        AND uploaded_by_principal_id = ${input.actorPrincipalId}
        AND upload_status = 'PENDING'
      RETURNING availability_status
    `;
    if (updated) {
      await recordAuditEventWithExecutor(transaction, {
        organisationId: input.organisationId,
        actorPrincipalId: input.actorPrincipalId,
        action: "evidence.upload_completed",
        resourceType: "evidence_item",
        resourceId: input.evidenceId,
        scopeType: "centre",
        scopeId: input.centreId,
        context: { scanStatus: "not_scanned", localDevelopment: local },
      });
    } else {
      const existing = await transaction.queryRow<{
        upload_status: string;
        scan_status: string;
        availability_status: string;
      }>`
        SELECT upload_status, scan_status, availability_status
        FROM evidence_items
        WHERE organisation_id = ${input.organisationId}
          AND id = ${input.evidenceId}
          AND uploaded_by_principal_id = ${input.actorPrincipalId}
      `;
      if (!existing || existing.upload_status !== "UPLOADED" || existing.scan_status !== "not_scanned") {
        throw new QuarterlyReviewError("invalid_state", "evidence upload cannot be completed");
      }
      persistedAvailability = existing.availability_status;
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
  return {
    evidenceId: input.evidenceId,
    scanStatus: "not_scanned",
    availabilityStatus: persistedAvailability,
    ...(persistedAvailability === "AVAILABLE_LOCAL_UNSCANNED"
      ? { warning: "Local development evidence has not been security scanned." }
      : { warning: "Evidence is restricted until an approved scan marks it clean." }),
  };
}

export async function getEvidenceAccess(input: {
  organisationId: string;
  centreId: string;
  evidenceId: string;
  actorPrincipalId: string;
  environment?: Pick<EnvironmentMeta, "cloud" | "name" | "type">;
}): Promise<GetEvidenceAccessResponse> {
  const target = await loadEvidenceTarget(input.organisationId, input.evidenceId);
  if (target.centreId !== input.centreId) {
    throw new QuarterlyReviewError("access_denied", "evidence is not available");
  }
  const local = isExactLocalDevelopment(input.environment ?? appMeta().environment);
  const localUnscanned =
    local &&
    target.scanStatus === "not_scanned" &&
    target.availabilityStatus === "AVAILABLE_LOCAL_UNSCANNED";
  const scanned =
    target.scanStatus === "clean" && target.availabilityStatus === "AVAILABLE";
  if (!localUnscanned && !scanned) {
    throw new QuarterlyReviewError("evidence_unavailable", "evidence is restricted");
  }
  const signed = await quarterlyReviewEvidence.signedDownloadUrl(target.objectKey, {
    ttl: DOWNLOAD_TTL_SECONDS,
  });
  await recordAuditEvent({
    organisationId: input.organisationId,
    actorPrincipalId: input.actorPrincipalId,
    action: "evidence.access_issued",
    resourceType: "evidence_item",
    resourceId: input.evidenceId,
    scopeType: "centre",
    scopeId: input.centreId,
    context: { localUnscanned },
  });
  return {
    downloadUrl: signed.url,
    expiresInSeconds: DOWNLOAD_TTL_SECONDS,
    scanStatus: localUnscanned ? "not_scanned" : "clean",
    ...(localUnscanned
      ? { warning: "Local development evidence has not been security scanned." }
      : {}),
  };
}
