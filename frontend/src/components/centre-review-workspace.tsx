"use client";

import { useCallback, useEffect, useState } from "react";

import type { quarterly_reviews } from "../lib/client.generated";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import { BusinessWorkspaceGate, StatusPill, WorkflowShell, WorkflowState } from "./workflow-shell";

export function CentreReviewWorkspace({ auditId }: Readonly<{ auditId: string }>) {
  const client = useAuthenticatedCentreSuccessClient();
  const [audit, setAudit] = useState<quarterly_reviews.QuarterlyAuditView>();
  const [error, setError] = useState(false);
  const [working, setWorking] = useState(false);
  const [notice, setNotice] = useState("");
  const [attempt, setAttempt] = useState(0);

  const load = useCallback(async () => {
    setAudit(await client.foundation.getQuarterlyAudit(auditId));
  }, [auditId, client]);

  useEffect(() => {
    let current = true;
    void client.foundation.getQuarterlyAudit(auditId).then(
      (value) => {
        if (current) {
          setAudit(value);
          setError(false);
        }
      },
      () => { if (current) setError(true); },
    );
    return () => { current = false; };
  }, [attempt, auditId, client]);

  async function acknowledge() {
    setWorking(true);
    setNotice("");
    try {
      await client.foundation.acknowledgeQuarterlyAudit(auditId, {});
      setAudit((current) => current ? { ...current, acknowledged: true } : current);
      setNotice("Review acknowledged.");
      try {
        await load();
      } catch {
        setNotice("Review acknowledged. Latest review details could not be refreshed.");
      }
    } catch {
      setNotice("The review could not be acknowledged. Reload and check your access.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <BusinessWorkspaceGate>
      <WorkflowShell eyebrow="Centre Director · BSA internal review" title={audit?.centre.name ?? "Quarterly review"} summary="Review the finalised internal result and continue follow-up in the owning workflow." workspaceLinks={[]}>
        {error ? <WorkflowState kind="error" title="Review unavailable" message="This review could not be loaded or is outside your authorised centre scope." onRetry={() => setAttempt((value) => value + 1)} /> : null}
        {!error && !audit ? <WorkflowState kind="loading" title="Loading review" message="Retrieving the authorised review…" /> : null}
        {audit ? (
          <div className="workflow-stack">
            <section className="workflow-card workflow-card--featured">
              <p className="workflow-kicker">BSA Internal Audit Score</p>
              <p className="centre-review-score" aria-label={`BSA Internal Audit Score ${audit.score ?? "not available"}${audit.score !== undefined ? " percent" : ""}`}>{audit.score ?? "—"}{audit.score !== undefined ? "%" : ""}</p>
              <p className="internal-audit-framing">This is an internal Bright Steps quality/compliance measure and is not an ACECQA assessment or NQS rating.</p>
              <StatusPill tone={audit.riskStatus === "CRITICAL" ? "critical" : "neutral"}>{audit.riskStatus ?? audit.status}</StatusPill>
            </section>
            <section className="workflow-card" aria-labelledby="centre-review-sections">
              <h2 id="centre-review-sections">Section results</h2>
              <ul className="summary-list">{audit.sections.map((section) => <li key={section.id}><span>{section.title}</span><strong>{section.score ?? "—"}{section.score !== undefined ? "%" : ""}</strong></li>)}</ul>
            </section>
            {notice ? <p className="workflow-notice" role="status">{notice}</p> : null}
            {!audit.acknowledged ? <button className="workflow-button" type="button" disabled={working || audit.status !== "FINALISED"} onClick={() => void acknowledge()}>{working ? "Acknowledging…" : "Acknowledge review"}</button> : null}
          </div>
        ) : null}
      </WorkflowShell>
    </BusinessWorkspaceGate>
  );
}
