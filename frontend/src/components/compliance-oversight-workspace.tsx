"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { quarterly_reviews } from "../lib/client.generated";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import { BusinessWorkspaceGate, StatusPill, WorkflowShell, WorkflowState } from "./workflow-shell";

export function ComplianceOversightWorkspace() {
  const client = useAuthenticatedCentreSuccessClient();
  const [oversight, setOversight] = useState<quarterly_reviews.ComplianceOversightResponse | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void client.foundation.getComplianceOversight().then(
      (value) => current && setOversight(value),
      () => current && setError(true),
    );
    return () => { current = false; };
  }, [attempt, client]);

  const metrics = oversight ? [
    ["Completed", oversight.counts.completed],
    ["In progress", oversight.counts.inProgress],
    ["Outstanding", oversight.counts.outstanding],
    ["Below internal threshold", oversight.counts.centresBelowInternalThreshold],
    ["Critical findings", oversight.counts.criticalFindings],
    ["High findings", oversight.counts.highFindings],
    ["Open corrective actions", oversight.counts.openCorrectiveActions],
    ["Overdue actions", oversight.counts.overdueCorrectiveActions],
    ["Awaiting verification", oversight.counts.awaitingVerification],
  ] as const : [];

  return <BusinessWorkspaceGate><WorkflowShell eyebrow="Compliance Manager" title="Quarterly review oversight" summary="Organisation-level internal review status and unresolved operational risk.">
    <p className="internal-audit-framing">BSA Internal Audit Score is an internal Bright Steps quality/compliance measure and is not an ACECQA assessment or NQS rating.</p>
    {error ? <WorkflowState kind="error" title="Oversight unavailable" message="The compliance status could not be loaded or is outside your organisation scope." onRetry={() => { setError(false); setAttempt((value) => value + 1); }} /> : null}
    {!error && !oversight ? <WorkflowState kind="loading" title="Loading compliance status" message="Calculating the latest authorised organisation view…" /> : null}
    {oversight ? <><section className="metric-grid metric-grid--oversight" aria-label="Quarterly review metrics">{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</section>{oversight.centres.length === 0 ? <WorkflowState kind="empty" title="No centres available" message="No authorised centre review records are available." /> : <section aria-labelledby="centre-status-title"><div className="section-heading"><h2 id="centre-status-title">Centre status</h2><span>{oversight.centres.length} centres</span></div><div className="card-grid">{oversight.centres.map((centre) => <article className="workflow-card" key={centre.centreId}><div className="section-heading"><h3>{centre.centreName}</h3>{centre.riskStatus ? <StatusPill tone={centre.riskStatus === "CRITICAL" ? "critical" : "neutral"}>{centre.riskStatus}</StatusPill> : null}</div><p>BSA Internal Audit Score: {centre.latestScore ?? "Not completed"}{centre.latestScore !== undefined ? "%" : ""}</p><p>{centre.openActions} open · {centre.overdueActions} overdue</p>{centre.latestAuditId ? <Link className="workflow-link-button" href={`/area-manager/centres/${centre.centreId}/audit/${centre.latestAuditId}`}>View audit</Link> : null}</article>)}</div></section>}</> : null}
  </WorkflowShell></BusinessWorkspaceGate>;
}
