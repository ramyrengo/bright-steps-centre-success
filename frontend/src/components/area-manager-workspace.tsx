"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import type { quarterly_reviews } from "../lib/client.generated";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import { DataList, DataListRow, Section, StatusBadge } from "./design-system";
import { BusinessWorkspaceGate, formatDate, StatusPill, WorkflowShell, WorkflowState } from "./workflow-shell";

type Centre = quarterly_reviews.AuditCentreSummary;
type Preparation = quarterly_reviews.AuditPreparationResponse;
type Action = quarterly_reviews.CorrectiveActionSummary;

export function AreaManagerWorkspace() {
  const client = useAuthenticatedCentreSuccessClient();
  const router = useRouter();
  const [centres, setCentres] = useState<Centre[] | null>(null);
  const [queue, setQueue] = useState<Action[]>([]);
  const [preparation, setPreparation] = useState<Preparation | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let current = true;
    void Promise.all([
      client.foundation.listAssignedAuditCentres(),
      client.foundation.listCorrectiveActionVerificationQueue(),
    ]).then(
      ([centreResponse, queueResponse]) => {
        if (current) {
          setCentres(centreResponse.centres);
          setQueue(queueResponse.actions);
        }
      },
      () => current && setError(true),
    );
    return () => { current = false; };
  }, [attempt, client]);

  const prepare = useCallback(async (centreId: string) => {
    setWorking(true);
    setError(false);
    try {
      setPreparation(await client.foundation.getAuditPreparation(centreId));
    } catch {
      setError(true);
    } finally {
      setWorking(false);
    }
  }, [client]);

  const start = useCallback(async () => {
    if (!preparation) return;
    setWorking(true);
    try {
      const started = await client.foundation.startQuarterlyAudit({ centreId: preparation.centre.id });
      router.push(`/area-manager/centres/${preparation.centre.id}/audit/${started.auditId}`);
    } catch {
      setError(true);
      setWorking(false);
    }
  }, [client, preparation, router]);

  return (
    <BusinessWorkspaceGate>
      <WorkflowShell
        eyebrow="Area Manager"
        title="Quarterly centre reviews"
        summary="Prepare, complete and verify reviews for your currently assigned centres."
      >
        {error ? <WorkflowState kind="error" title="Reviews unavailable" message="Your authorised review workspace could not be loaded." onRetry={() => setAttempt((value) => value + 1)} /> : null}
        {!error && centres === null ? <WorkflowState kind="loading" title="Loading assigned centres" message="Checking your current centre portfolio…" /> : null}
        {!error && centres?.length === 0 ? <WorkflowState kind="empty" title="No assigned centres" message="No active centre assignments are available for quarterly review." /> : null}

        {preparation ? (
          <section className="workflow-card workflow-card--featured" aria-labelledby="preparation-title">
            <div>
              <p className="workflow-kicker">Visit preparation</p>
              <h2 id="preparation-title">{preparation.centre.name}</h2>
              <p>{preparation.activeTemplate.title} · version {preparation.activeTemplate.version}</p>
              {preparation.activeTemplate.synthetic ? <StatusPill tone="warning">Synthetic development content</StatusPill> : null}
              <p className="internal-audit-framing">BSA Internal Audit Score is an internal Bright Steps quality/compliance measure and is not an ACECQA assessment or NQS rating.</p>
            </div>
            <dl className="metric-grid">
              <div><dt>Previous BSA Internal Audit Score</dt><dd>{preparation.previousAudit?.score ?? "—"}{preparation.previousAudit?.score !== undefined ? "%" : ""}</dd></div>
              <div><dt>Open actions</dt><dd>{preparation.openCorrectiveActions}</dd></div>
              <div><dt>Previous review</dt><dd>{preparation.previousAudit ? formatDate(preparation.previousAudit.finalisedAt) : "First review"}</dd></div>
            </dl>
            <button className="workflow-button" type="button" disabled={working} onClick={() => void start()}>
              {working ? "Starting…" : "Start quarterly review"}
            </button>
          </section>
        ) : null}

        {centres && centres.length > 0 ? (
          <section aria-labelledby="assigned-centres-title">
            <div className="section-heading"><h2 id="assigned-centres-title">Assigned centres</h2><span>{centres.length} available</span></div>
            <p className="internal-audit-framing">Scores shown below are internal Bright Steps quality/compliance measures, not ACECQA assessments or NQS ratings.</p>
            <div className="card-grid">
              {centres.map((centre) => (
                <article className="card" key={centre.id}>
                  <h3>{centre.name}</h3>
                  <p>{centre.openCorrectiveActions} open corrective action{centre.openCorrectiveActions === 1 ? "" : "s"}</p>
                  <p>Previous BSA Internal Audit Score: {centre.previousScore === undefined ? "No previous review" : `${centre.previousScore}%`}</p>
                  <button className="button button--secondary" type="button" disabled={working} onClick={() => void prepare(centre.id)}>
                    Prepare visit<span className="visually-hidden"> at {centre.name}</span>
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : null}

        <Section
          title="Awaiting verification"
          description="Remediation your centres have submitted for independent review."
          count={`${queue.length} submitted`}
        >
          {centres !== null && queue.length === 0 ? (
            <WorkflowState kind="empty" title="Nothing awaiting verification" message="Submitted remediation will appear here." />
          ) : (
            <DataList label="Remediation awaiting verification">
              {queue.map((action) => (
                <DataListRow
                  key={action.id}
                  title={action.title}
                  headingLevel={3}
                  severity={action.severity === "CRITICAL" ? "critical" : "warning"}
                  badge={
                    <StatusBadge tone={action.severity === "CRITICAL" ? "critical" : "warning"}>
                      {action.severity}
                    </StatusBadge>
                  }
                  facts={[
                    { term: "Centre", value: action.centreName },
                    { term: "Submitted", value: action.submittedAt ? formatDate(action.submittedAt) : "Recently" },
                  ]}
                  action={
                    <Link className="button button--secondary" href={`/area-manager/verification/${action.id}`}>
                      Review evidence
                      <span className="visually-hidden"> — {action.title}</span>
                    </Link>
                  }
                />
              ))}
            </DataList>
          )}
        </Section>
      </WorkflowShell>
    </BusinessWorkspaceGate>
  );
}
