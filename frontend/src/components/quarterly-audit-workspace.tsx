"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

import type { quarterly_reviews } from "../lib/client.generated";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import { BusinessWorkspaceGate, StatusPill, WorkflowShell, WorkflowState } from "./workflow-shell";

const OUTCOME_LABELS: Record<quarterly_reviews.AuditOutcome, string> = {
  COMPLIANT: "Compliant",
  PARTIALLY_COMPLIANT: "Partially compliant",
  NON_COMPLIANT: "Non-compliant",
  NOT_APPLICABLE: "Not applicable",
  NOT_OBSERVED: "Not observed",
  IMMEDIATE_ACTION_REQUIRED: "Immediate action required",
  POSITIVE_PRACTICE: "Positive practice",
};

export function QuarterlyAuditWorkspace({ auditId }: Readonly<{ auditId: string }>) {
  const client = useAuthenticatedCentreSuccessClient();
  const [audit, setAudit] = useState<quarterly_reviews.QuarterlyAuditView | null>(null);
  const [sectionIndex, setSectionIndex] = useState(0);
  const [error, setError] = useState(false);
  const [workingItem, setWorkingItem] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setError(false);
    try {
      setAudit(await client.foundation.getQuarterlyAudit(auditId));
    } catch {
      setError(true);
    }
  }, [auditId, client]);

  useEffect(() => {
    let current = true;
    void client.foundation.getQuarterlyAudit(auditId).then(
      (value) => { if (current) { setAudit(value); setError(false); } },
      () => current && setError(true),
    );
    return () => { current = false; };
  }, [attempt, auditId, client]);

  const section = audit?.sections[sectionIndex];
  const completedPercent = useMemo(() => audit
    ? Math.round((audit.progress.answered / Math.max(audit.progress.total, 1)) * 100)
    : 0, [audit]);
  const findings = useMemo(() => audit?.sections.flatMap((auditSection) =>
    auditSection.items.flatMap((item) => item.finding ? [{ ...item.finding, wording: item.wording }] : []),
  ) ?? [], [audit]);

  async function saveItem(item: quarterly_reviews.AuditItemView, form: FormData) {
    if (!audit) return;
    const outcome = String(form.get("outcome")) as quarterly_reviews.AuditOutcome;
    const comment = String(form.get("comment") ?? "").trim();
    const responseCorrectionReason = String(
      form.get("responseCorrectionReason") ?? "",
    ).trim();
    const selectedOwnerPrincipalId = String(form.get("owner") ?? "").trim();
    setWorkingItem(item.id);
    setNotice("");
    try {
      const saved = await client.foundation.saveQuarterlyAuditResponse(audit.id, item.id, {
        outcome,
        ...(comment ? { comment } : {}),
        ...(responseCorrectionReason ? { responseCorrectionReason } : {}),
        ...(selectedOwnerPrincipalId ? { selectedOwnerPrincipalId } : {}),
        ...(item.response ? { responseLockVersion: item.response.lockVersion } : {}),
      });
      setNotice(saved.ownerResolutionRequired
        ? "Saved. Select an authorised action owner before finalisation."
        : saved.immediateActionCreated
          ? "Saved. The immediate corrective action is visible now."
          : "Response saved.");
      await load();
    } catch {
      setError(true);
    } finally {
      setWorkingItem(null);
    }
  }

  async function uploadEvidence(item: quarterly_reviews.AuditItemView, file: File) {
    if (!item.response) {
      setNotice("Save the response before adding evidence.");
      return;
    }
    setWorkingItem(item.id);
    try {
      const upload = await client.foundation.requestEvidenceUpload({
        targetType: "AUDIT_RESPONSE",
        targetId: item.response.id,
        filename: file.name,
        mediaType: file.type as "image/jpeg" | "image/png" | "application/pdf",
      });
      const response = await fetch(upload.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error("upload failed");
      const completed = await client.foundation.completeEvidenceUpload(upload.evidenceId);
      setNotice(completed.warning ?? "Evidence uploaded.");
    } catch {
      setNotice("Evidence could not be uploaded. Try again.");
    } finally {
      setWorkingItem(null);
    }
  }

  async function transition(kind: "ready" | "finalise") {
    if (!audit) return;
    setWorkingItem("audit");
    try {
      if (kind === "ready") {
        await client.foundation.markQuarterlyAuditReady(audit.id, { lockVersion: audit.lockVersion });
      } else {
        await client.foundation.finaliseQuarterlyAudit(audit.id, { lockVersion: audit.lockVersion });
      }
      await load();
    } catch {
      setNotice(kind === "ready"
        ? "Complete every item and resolve action owners before review."
        : "The review could not be finalised. Reload and check its status.");
    } finally {
      setWorkingItem(null);
    }
  }

  return (
    <BusinessWorkspaceGate>
      <WorkflowShell eyebrow="Area Manager · BSA internal review" title={audit?.centre.name ?? "Quarterly review"} summary="Complete one section at a time. Responses save independently so you can resume the visit.">
        {error ? <WorkflowState kind="error" title="Review unavailable" message="This review could not be loaded or is outside your authorised centre scope." onRetry={() => setAttempt((value) => value + 1)} /> : null}
        {!error && !audit ? <WorkflowState kind="loading" title="Loading quarterly review" message="Retrieving the pinned review version…" /> : null}
        {audit ? (
          <>
            <section className="audit-progress" aria-label="Audit progress">
              <div><StatusPill tone={audit.status === "FINALISED" ? "positive" : "neutral"}>{audit.status.replaceAll("_", " ")}</StatusPill><span>{audit.progress.answered} of {audit.progress.total} answered</span></div>
              <progress max="100" value={completedPercent}>{completedPercent}%</progress>
              <p>{audit.template.title} · version {audit.template.version}{audit.template.synthetic ? " · synthetic development content" : ""}</p>
            </section>
            {notice ? <p className="workflow-notice" role="status">{notice}</p> : null}

            {audit.status === "FINALISED" ? (
              <div className="workflow-stack">
                <section className="workflow-card workflow-card--featured" aria-labelledby="summary-title">
                  <p className="workflow-kicker">BSA Internal Audit Score</p>
                  <h2 id="summary-title">{audit.score ?? "—"}{audit.score !== undefined ? "%" : ""}</h2>
                  <p className="internal-audit-framing">This is an internal Bright Steps quality/compliance measure and is not an ACECQA assessment or NQS rating.</p>
                  <StatusPill tone={audit.riskStatus === "CRITICAL" ? "critical" : "neutral"}>Risk: {audit.riskStatus ?? "Not calculated"}</StatusPill>
                  {audit.previousComparison ? <p>Previous {audit.previousComparison.score ?? "—"}% · change {audit.previousComparison.difference !== undefined && audit.previousComparison.difference >= 0 ? "+" : ""}{audit.previousComparison.difference ?? "—"}%</p> : <p>First completed quarterly review.</p>}
                  <dl className="metric-grid" aria-label="Review outcome counts">
                    <div><dt>Critical findings</dt><dd>{findings.filter((finding) => finding.status === "OPEN" && finding.severity === "CRITICAL").length}</dd></div>
                    <div><dt>High findings</dt><dd>{findings.filter((finding) => finding.status === "OPEN" && finding.severity === "HIGH").length}</dd></div>
                    <div><dt>Active actions</dt><dd>{findings.filter((finding) => finding.status === "OPEN" && finding.actionId).length}</dd></div>
                    <div><dt>Positive practices</dt><dd>{audit.positivePractices.length}</dd></div>
                  </dl>
                </section>
                <section className="workflow-card" aria-labelledby="section-scores-title">
                  <h2 id="section-scores-title">Section scores</h2>
                  <ul className="summary-list">{audit.sections.map((auditSection) => <li key={auditSection.id}><span>{auditSection.title}</span><strong>{auditSection.score ?? "—"}{auditSection.score !== undefined ? "%" : ""}</strong></li>)}</ul>
                </section>
                <section className="workflow-card" aria-labelledby="findings-title">
                  <h2 id="findings-title">Findings and actions</h2>
                  {findings.length ? <ul className="summary-list">{findings.map((finding) => <li key={finding.id}><span><strong>{finding.wording}</strong><small>{finding.severity} · {finding.status.toLowerCase()} · occurrence {finding.repeatCount}</small></span>{finding.status === "OPEN" && finding.actionId ? <Link className="workflow-link" href={`/area-manager/verification/${finding.actionId}`}>Review action</Link> : <span>{finding.status === "WITHDRAWN" ? "Historical response correction" : "Finding recorded"}</span>}</li>)}</ul> : <p>No findings were created.</p>}
                </section>
                <section className="workflow-card" aria-labelledby="positive-title">
                  <h2 id="positive-title">Positive practice</h2>
                  {audit.positivePractices.length ? <ul>{audit.positivePractices.map((practice) => <li key={practice.id}>{practice.description}</li>)}</ul> : <p>No positive practices recorded.</p>}
                </section>
              </div>
            ) : section ? (
              <section aria-labelledby="section-title">
                <div className="section-switcher">
                  <button className="workflow-button workflow-button--secondary" type="button" disabled={sectionIndex === 0} onClick={() => setSectionIndex((value) => value - 1)}>Previous section</button>
                  <div><span>Section {sectionIndex + 1} of {audit.sections.length}</span><h2 id="section-title">{section.title}</h2></div>
                  <button className="workflow-button workflow-button--secondary" type="button" disabled={sectionIndex === audit.sections.length - 1} onClick={() => setSectionIndex((value) => value + 1)}>Next section</button>
                </div>
                <div className="audit-items">
                  {section.items.map((item, itemIndex) => (
                    <form className="audit-item" key={item.id} action={(form) => void saveItem(item, form)}>
                      <div className="audit-item__heading"><span>{itemIndex + 1}</span><div><h3>{item.wording}</h3>{item.instructions ? <p>{item.instructions}</p> : null}</div>{item.critical ? <StatusPill tone="critical">Critical</StatusPill> : null}</div>
                      <label>Outcome<select name="outcome" required defaultValue={item.response?.outcome ?? ""}><option value="" disabled>Select outcome</option>{item.allowedOutcomes.map((outcome) => <option key={outcome} value={outcome}>{OUTCOME_LABELS[outcome]}</option>)}</select></label>
                      <label>Comment or reason<textarea name="comment" rows={3} defaultValue={item.response?.comment ?? ""} placeholder="Add concise context when it helps the follow-up." /></label>
                      {item.finding?.status === "OPEN" ? <label>Response correction reason<textarea name="responseCorrectionReason" rows={2} placeholder="Required if this change means the active finding/action is no longer needed." /></label> : null}
                      {audit.ownerCandidates.length > 1 ? <label>Corrective action owner<select name="owner" defaultValue={item.response?.selectedOwnerPrincipalId ?? ""}><option value="">Select when an action is created</option>{audit.ownerCandidates.map((owner) => <option key={owner.principalId} value={owner.principalId}>{owner.displayName}</option>)}</select></label> : null}
                      <div className="audit-item__actions">
                        <button className="workflow-button" type="submit" disabled={workingItem === item.id}>{workingItem === item.id ? "Saving…" : item.response ? "Update response" : "Save response"}</button>
                        <label className="file-button">Add evidence<input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadEvidence(item, file); }} /></label>
                      </div>
                      {item.finding ? <p className="finding-callout"><strong>{item.finding.severity} finding</strong> · {item.finding.status.toLowerCase()} · occurrence {item.finding.repeatCount}{item.finding.actionId ? " · corrective action recorded" : ""}</p> : null}
                    </form>
                  ))}
                </div>
              </section>
            ) : null}

            {audit.status !== "FINALISED" ? <div className="sticky-action-bar"><span>{audit.progress.answered === audit.progress.total ? "All responses recorded" : `${audit.progress.total - audit.progress.answered} remaining`}</span>{audit.status === "READY_FOR_REVIEW" ? <button className="workflow-button" type="button" disabled={workingItem === "audit"} onClick={() => void transition("finalise")}>Finalise review</button> : <button className="workflow-button" type="button" disabled={workingItem === "audit"} onClick={() => void transition("ready")}>Submit for final review</button>}</div> : null}
          </>
        ) : null}
      </WorkflowShell>
    </BusinessWorkspaceGate>
  );
}
