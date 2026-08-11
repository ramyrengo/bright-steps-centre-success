"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { quarterly_reviews } from "../lib/client.generated";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import { BusinessWorkspaceGate, formatDate, StatusPill, WorkflowShell, WorkflowState } from "./workflow-shell";

export function CentreActionsWorkspace() {
  const client = useAuthenticatedCentreSuccessClient();
  const [actions, setActions] = useState<quarterly_reviews.CorrectiveActionSummary[] | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void client.foundation.listMyCorrectiveActions().then(
      (response) => current && setActions(response.actions),
      () => current && setError(true),
    );
    return () => { current = false; };
  }, [attempt, client]);

  return <BusinessWorkspaceGate><WorkflowShell eyebrow="Centre Director" title="Quarterly review follow-ups" summary="Clear actions from your centre review, with the reason, next step and due date in one place.">
    <p className="internal-audit-framing">These follow-ups come from a BSA Internal Audit Score process. It is an internal Bright Steps quality/compliance measure and is not an ACECQA assessment or NQS rating.</p>
    {error ? <WorkflowState kind="error" title="Follow-ups unavailable" message="Your authorised centre actions could not be loaded." onRetry={() => { setError(false); setAttempt((value) => value + 1); }} /> : null}
    {!error && actions === null ? <WorkflowState kind="loading" title="Loading follow-ups" message="Checking actions assigned to your centre…" /> : null}
    {!error && actions?.length === 0 ? <WorkflowState kind="empty" title="No actions require attention" message="New quarterly review follow-ups will appear here." /> : null}
    {actions && actions.length > 0 ? <section aria-labelledby="actions-title"><div className="section-heading"><h2 id="actions-title">{actions.length} action{actions.length === 1 ? "" : "s"} require attention</h2><span>Supportive follow-up</span></div><div className="card-grid">{actions.map((action) => <article className="workflow-card" key={action.id}><StatusPill tone={action.severity === "CRITICAL" ? "critical" : action.severity === "HIGH" ? "warning" : "neutral"}>{action.severity}</StatusPill><h3>{action.title}</h3><p><strong>Why this matters:</strong> Area Manager quarterly review</p><p>Due {formatDate(action.dueAt)}</p><p>Status: {action.status.replaceAll("_", " ")}</p><Link className="workflow-link-button" href={`/centre/actions/${action.id}`}>{action.status === "OPEN" ? "Start action" : "Continue action"}</Link></article>)}</div></section> : null}
  </WorkflowShell></BusinessWorkspaceGate>;
}

export function CentreActionWorkspace({ actionId }: Readonly<{ actionId: string }>) {
  const client = useAuthenticatedCentreSuccessClient();
  const [action, setAction] = useState<quarterly_reviews.CorrectiveActionDetail | null>(null);
  const [error, setError] = useState(false);
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState("");
  const [warning, setWarning] = useState("");

  const load = useCallback(async () => {
    try { setAction(await client.foundation.getCorrectiveAction(actionId)); setError(false); }
    catch { setError(true); }
  }, [actionId, client]);
  useEffect(() => {
    let current = true;
    void client.foundation.getCorrectiveAction(actionId).then(
      (value) => { if (current) { setAction(value); setError(false); } },
      () => current && setError(true),
    );
    return () => { current = false; };
  }, [actionId, client]);

  async function start() {
    if (!action) return;
    setWorking(true);
    try { await client.foundation.startCorrectiveAction(action.id, { lockVersion: action.lockVersion }); await load(); }
    catch { setError(true); }
    finally { setWorking(false); }
  }

  async function addEvidence(file: File) {
    if (!action) return;
    setWorking(true);
    try {
      const upload = await client.foundation.requestEvidenceUpload({ targetType: "CORRECTIVE_ACTION", targetId: action.id, filename: file.name, mediaType: file.type as "image/jpeg" | "image/png" | "application/pdf" });
      const response = await fetch(upload.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      if (!response.ok) throw new Error("upload failed");
      const completed = await client.foundation.completeEvidenceUpload(upload.evidenceId);
      setWarning(completed.warning ?? "Evidence uploaded.");
      await load();
    } catch { setWarning("Evidence could not be uploaded. Try again."); }
    finally { setWorking(false); }
  }

  async function submit() {
    if (!action || !note.trim()) return;
    setWorking(true);
    try { await client.foundation.submitCorrectiveActionEvidence(action.id, { lockVersion: action.lockVersion, remediationNote: note.trim() }); await load(); }
    catch { setError(true); }
    finally { setWorking(false); }
  }

  async function acknowledge() {
    if (!action) return;
    setWorking(true);
    try { await client.foundation.acknowledgeQuarterlyAudit(action.finding.originatingAuditId, { comment: "Reviewed in Centre Success." }); setWarning("Quarterly review acknowledged."); await load(); }
    catch { setError(true); }
    finally { setWorking(false); }
  }

  return <BusinessWorkspaceGate><WorkflowShell eyebrow="Centre Director" title="Corrective action" summary="Complete the requested remediation once, attach evidence, and submit it for independent review.">
    <p className="internal-audit-framing">This action comes from an internal Bright Steps quality/compliance measure, not an ACECQA assessment or NQS rating.</p>
    {error ? <WorkflowState kind="error" title="Action unavailable" message="This action could not be loaded or is outside your centre assignment." onRetry={() => void load()} /> : null}
    {!error && !action ? <WorkflowState kind="loading" title="Loading action" message="Retrieving the finding, requirement and complete history…" /> : null}
    {action ? <article className="workflow-card workflow-card--detail"><div className="section-heading"><div><p className="workflow-kicker">{action.centreName}</p><h2>{action.title}</h2></div><StatusPill tone={action.severity === "CRITICAL" ? "critical" : "warning"}>{action.severity}</StatusPill></div><p><strong>Why this matters:</strong> {action.finding.description}</p><p><strong>What you need to do:</strong> {action.requiredRemediation}</p><p><strong>Evidence required:</strong> {action.evidenceRequirement}</p><p><strong>Due:</strong> {formatDate(action.dueAt)}</p>{warning ? <p className="workflow-notice" role="status">{warning}</p> : null}{action.status === "OPEN" || action.status === "MORE_INFORMATION_REQUIRED" || action.status === "REJECTED" ? <button className="workflow-button" type="button" disabled={working} onClick={() => void start()}>Start action</button> : null}{action.status === "IN_PROGRESS" ? <section className="remediation-form" aria-labelledby="remediation-title"><h3 id="remediation-title">Submit remediation</h3><label className="file-button">Add evidence<input type="file" accept="image/jpeg,image/png,application/pdf" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addEvidence(file); }} /></label>{action.evidence.map((item) => <p key={item.id}>{item.filename} · {item.scanStatus === "not_scanned" ? "not security scanned" : item.scanStatus}</p>)}<label>Remediation note<textarea rows={4} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Briefly explain what was completed." /></label><button className="workflow-button" type="button" disabled={working || !note.trim()} onClick={() => void submit()}>Submit for verification</button></section> : null}{action.status === "VERIFICATION_REQUIRED" ? <StatusPill tone="positive">Submitted for independent verification</StatusPill> : null}{action.finding.originatingAuditAcknowledged ? <StatusPill tone="positive">Final audit acknowledged</StatusPill> : action.finding.originatingAuditStatus === "FINALISED" ? <button className="workflow-button workflow-button--secondary" type="button" disabled={working} onClick={() => void acknowledge()}>Acknowledge final audit</button> : null}</article> : null}
  </WorkflowShell></BusinessWorkspaceGate>;
}
