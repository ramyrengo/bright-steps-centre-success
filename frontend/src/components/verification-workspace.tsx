"use client";

import { useCallback, useEffect, useState } from "react";

import type { quarterly_reviews } from "../lib/client.generated";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import { BusinessWorkspaceGate, formatDate, StatusPill, WorkflowShell, WorkflowState } from "./workflow-shell";

export function VerificationWorkspace({ actionId }: Readonly<{ actionId: string }>) {
  const client = useAuthenticatedCentreSuccessClient();
  const [action, setAction] = useState<quarterly_reviews.CorrectiveActionDetail | null>(null);
  const [error, setError] = useState(false);
  const [working, setWorking] = useState(false);
  const [reason, setReason] = useState("");
  const [evidenceLinks, setEvidenceLinks] = useState<Record<string, string>>({});
  const [evidenceWarning, setEvidenceWarning] = useState("");

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

  async function verify() {
    if (!action) return;
    setWorking(true);
    try {
      await client.foundation.verifyAndCloseCorrectiveAction(action.id, { lockVersion: action.lockVersion, verificationNote: "Evidence reviewed through Centre Success." });
      await load();
    } catch { setError(true); }
    finally { setWorking(false); }
  }

  async function returnForInformation() {
    if (!action || !reason.trim()) return;
    setWorking(true);
    try {
      await client.foundation.returnCorrectiveAction(action.id, { lockVersion: action.lockVersion, reason: reason.trim(), disposition: "MORE_INFORMATION_REQUIRED" });
      await load();
    } catch { setError(true); }
    finally { setWorking(false); }
  }

  async function prepareEvidenceAccess(evidenceId: string) {
    setWorking(true);
    setEvidenceWarning("");
    try {
      const access = await client.foundation.getEvidenceAccess(evidenceId);
      setEvidenceLinks((links) => ({ ...links, [evidenceId]: access.downloadUrl }));
      if (access.scanStatus === "not_scanned") {
        setEvidenceWarning("Local development evidence is not security scanned.");
      }
    } catch {
      setEvidenceWarning("Evidence access is unavailable or outside your authorised scope.");
    } finally {
      setWorking(false);
    }
  }

  return <BusinessWorkspaceGate><WorkflowShell eyebrow="Area Manager" title="Remediation verification" summary="Review submitted evidence independently, then close or return the action with clear guidance.">
    {error ? <WorkflowState kind="error" title="Action unavailable" message="The action could not be loaded or is outside your authorised scope." onRetry={() => void load()} /> : null}
    {!error && !action ? <WorkflowState kind="loading" title="Loading submitted remediation" message="Retrieving the complete action history and evidence…" /> : null}
    {action ? <article className="workflow-card workflow-card--detail">
      <div className="section-heading"><div><p className="workflow-kicker">{action.centreName}</p><h2>{action.title}</h2></div><StatusPill tone={action.severity === "CRITICAL" ? "critical" : "warning"}>{action.severity}</StatusPill></div>
      <p><strong>Submitted:</strong> {action.submittedAt ? formatDate(action.submittedAt) : "Not submitted"}</p>
      <p><strong>Finding:</strong> {action.finding.description}</p>
      <p><strong>Required remediation:</strong> {action.requiredRemediation}</p>
      <section aria-labelledby="evidence-title"><h3 id="evidence-title">Evidence</h3>{action.evidence.length ? <ul className="evidence-list">{action.evidence.map((item) => <li key={item.id}><span>{item.filename}<small>{item.scanStatus === "not_scanned" ? "Not security scanned" : "Scanned"}</small></span>{evidenceLinks[item.id] ? <a className="workflow-link" href={evidenceLinks[item.id]} target="_blank" rel="noreferrer">Open evidence</a> : <button className="workflow-button workflow-button--secondary" type="button" disabled={working} onClick={() => void prepareEvidenceAccess(item.id)}>Review evidence</button>}</li>)}</ul> : <p>No file evidence attached.</p>}{evidenceWarning ? <p className="workflow-notice" role="status">{evidenceWarning}</p> : null}</section>
      <section aria-labelledby="history-title"><h3 id="history-title">Complete history</h3><ol className="timeline">{action.history.map((event, index) => <li key={`${event.eventType}-${index}`}><strong>{event.toStatus.replaceAll("_", " ")}</strong><span>{formatDate(event.occurredAt)}</span>{event.reason ? <p>{event.reason}</p> : null}</li>)}</ol></section>
      {action.status === "VERIFICATION_REQUIRED" ? <div className="verification-actions"><button className="workflow-button" type="button" disabled={working} onClick={() => void verify()}>Verify &amp; close</button><label>Return reason<textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} /></label><button className="workflow-button workflow-button--secondary" type="button" disabled={working || !reason.trim()} onClick={() => void returnForInformation()}>Return for more information</button></div> : <StatusPill tone={action.status === "CLOSED" ? "positive" : "neutral"}>{action.status.replaceAll("_", " ")}</StatusPill>}
    </article> : null}
  </WorkflowShell></BusinessWorkspaceGate>;
}
