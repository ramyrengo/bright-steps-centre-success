"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import type { quarterly_reviews } from "../lib/client.generated";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import { Metric, MetricRow, Section, StatusBadge } from "./design-system";
import { BusinessWorkspaceGate, WorkflowShell, WorkflowState } from "./workflow-shell";

/**
 * Marks at most one tile in a row as the lead, choosing the first candidate
 * that actually has something to report. A row with nothing outstanding has
 * no lead tile at all, which is the honest result.
 */
function withLead(
  entries: readonly (readonly [string, number])[],
  candidates: readonly string[],
): { label: string; value: number; lead: boolean }[] {
  const lead = candidates.find((candidate) =>
    entries.some(([label, value]) => label === candidate && value > 0),
  );
  return entries.map(([label, value]) => ({ label, value, lead: label === lead }));
}

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

  // Two grouped rows with a stated question each, rather than one
  // undifferentiated wall of nine equally weighted tiles. At most ONE lead
  // tile per row: emphasising several at once dilutes all of them.
  const progress = oversight ? withLead([
    ["Completed", oversight.counts.completed],
    ["In progress", oversight.counts.inProgress],
    ["Outstanding", oversight.counts.outstanding],
    ["Below internal threshold", oversight.counts.centresBelowInternalThreshold],
  ], ["Outstanding", "Below internal threshold"]) : [];
  const risk = oversight ? withLead([
    ["Critical findings", oversight.counts.criticalFindings],
    ["High findings", oversight.counts.highFindings],
    ["Open corrective actions", oversight.counts.openCorrectiveActions],
    ["Overdue actions", oversight.counts.overdueCorrectiveActions],
    ["Awaiting verification", oversight.counts.awaitingVerification],
  ], ["Critical findings", "Overdue actions"]) : [];

  return (
    <BusinessWorkspaceGate>
      <WorkflowShell
        eyebrow="Compliance Manager"
        title="Quarterly review oversight"
        summary="Organisation-level internal review status and unresolved operational risk."
      >
        <p className="internal-audit-framing">
          BSA Internal Audit Score is an internal Bright Steps quality/compliance measure
          and is not an ACECQA assessment or NQS rating.
        </p>

        {error ? (
          <WorkflowState
            kind="error"
            title="Oversight unavailable"
            message="The compliance status could not be loaded or is outside your organisation scope."
            onRetry={() => { setError(false); setAttempt((value) => value + 1); }}
          />
        ) : null}
        {!error && !oversight ? (
          <WorkflowState
            kind="loading"
            title="Loading compliance status"
            message="Calculating the latest authorised organisation view…"
          />
        ) : null}

        {oversight ? (
          <>
            <Section title="Where reviews stand" description="Progress across authorised centres this quarter.">
              <MetricRow>
                {progress.map((metric) => (
                  <Metric key={metric.label} label={metric.label} value={metric.value} emphasis={metric.lead} />
                ))}
              </MetricRow>
            </Section>

            <Section title="Unresolved risk" description="Findings and corrective work still open across the organisation.">
              <MetricRow>
                {risk.map((metric) => (
                  <Metric key={metric.label} label={metric.label} value={metric.value} emphasis={metric.lead} />
                ))}
              </MetricRow>
            </Section>

            {oversight.centres.length === 0 ? (
              <WorkflowState
                kind="empty"
                title="No centres available"
                message="No authorised centre review records are available."
              />
            ) : (
              <Section
                title="Centre status"
                description="Each centre's most recent internal review result and open corrective work."
                count={`${oversight.centres.length} centre${oversight.centres.length === 1 ? "" : "s"}`}
              >
                <ul className="quality-centre-grid" role="list">
                  {oversight.centres.map((centre) => (
                    <li
                      className="quality-centre-card"
                      data-focus={centre.riskStatus === "CRITICAL" ? "NEEDS_SUPPORT" : undefined}
                      key={centre.centreId}
                    >
                      <div className="quality-centre-card__head">
                        <h3>{centre.centreName}</h3>
                        {centre.riskStatus ? (
                          <StatusBadge tone={centre.riskStatus === "CRITICAL" ? "critical" : "neutral"}>
                            {centre.riskStatus}
                          </StatusBadge>
                        ) : null}
                      </div>
                      <p className="quality-centre-card__reason">
                        {`BSA Internal Audit Score: ${centre.latestScore === undefined ? "Not completed" : `${centre.latestScore}%`}`}
                      </p>
                      <dl className="quality-counts">
                        <div data-attention={centre.openActions > 0 ? "true" : undefined}>
                          <dt>Open</dt><dd>{centre.openActions}</dd>
                        </div>
                        <div data-attention={centre.overdueActions > 0 ? "true" : undefined}>
                          <dt>Overdue</dt><dd>{centre.overdueActions}</dd>
                        </div>
                      </dl>
                      {centre.latestAuditId ? (
                        <Link
                          className="button button--secondary"
                          href={`/area-manager/centres/${centre.centreId}/audit/${centre.latestAuditId}`}
                        >
                          View audit
                          <span className="visually-hidden"> for {centre.centreName}</span>
                        </Link>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </Section>
            )}
          </>
        ) : null}
      </WorkflowShell>
    </BusinessWorkspaceGate>
  );
}
