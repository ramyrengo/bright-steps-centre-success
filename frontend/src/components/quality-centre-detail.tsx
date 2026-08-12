"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { centre_quality } from "../lib/client.generated";
import { ErrCode, isAPIError } from "../lib/client.generated";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import { AppShell } from "./app-shell";
import {
  Breadcrumb,
  DataList,
  DataListRow,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Metric,
  MetricRow,
  Notice,
  PageHeader,
  Section,
  StatusBadge,
  formatScore,
} from "./design-system";
import { ReviewLine, focusLabel, focusTone } from "./quality-workspace";

type Detail = centre_quality.CentreQualityDetailResponse;
type OpenAction = centre_quality.QualityActionListItem;

export function dueLabel(action: OpenAction): string {
  return {
    OVERDUE: "Overdue",
    TODAY: "Due today",
    TOMORROW: "Due tomorrow",
    DUE_SOON: `Due ${action.dueLocalDate}`,
    LATER: `Due ${action.dueLocalDate}`,
  }[action.dueBucket];
}

export function responsibilityLabel(value: OpenAction["responsibility"]): string {
  return {
    YOU_NEED_TO_ACT: "You need to act",
    CENTRE_NEEDS_TO_ACT: "Your centre needs to act",
    WAITING_ON_SOMEONE_ELSE: "Waiting on someone else",
    FOR_YOUR_AWARENESS: "For your awareness",
  }[value];
}

export function actionSeverity(action: OpenAction): "critical" | "warning" | "neutral" {
  if (action.severity === "CRITICAL" || action.dueBucket === "OVERDUE") return "critical";
  if (action.severity === "HIGH" || action.dueBucket === "TODAY") return "warning";
  return "neutral";
}

/** Splits open work by who has to move next, which is the question leaders ask. */
export function groupActions(actions: readonly OpenAction[]) {
  return {
    yours: actions.filter((action) => action.responsibility === "YOU_NEED_TO_ACT"),
    centre: actions.filter((action) => action.responsibility === "CENTRE_NEEDS_TO_ACT"),
    waiting: actions.filter(
      (action) =>
        action.responsibility === "WAITING_ON_SOMEONE_ELSE" ||
        action.responsibility === "FOR_YOUR_AWARENESS",
    ),
  };
}

function ActionGroup({
  title,
  description,
  actions,
}: Readonly<{ title: string; description: string; actions: readonly OpenAction[] }>) {
  if (actions.length === 0) return null;
  return (
    <Section
      title={title}
      description={description}
      count={`${actions.length} action${actions.length === 1 ? "" : "s"}`}
      headingLevel={3}
    >
      <DataList label={title}>
        {actions.map((action) => (
          <DataListRow
            key={action.correctiveActionId}
            title={action.title}
            severity={actionSeverity(action)}
            badge={
              <StatusBadge
                tone={
                  action.severity === "CRITICAL"
                    ? "critical"
                    : action.dueBucket === "OVERDUE"
                      ? "critical"
                      : action.severity === "HIGH"
                        ? "warning"
                        : "neutral"
                }
              >
                {action.severity === "CRITICAL" ? "Critical" : action.statusLabel}
              </StatusBadge>
            }
            facts={[
              { term: "When", value: dueLabel(action) },
              { term: "State", value: action.statusLabel },
              { term: "Owner", value: responsibilityLabel(action.responsibility) },
            ]}
            action={
              <Link className="button button--secondary" href={action.cta.route}>
                {action.cta.label}
                <span className="visually-hidden"> — {action.title}</span>
              </Link>
            }
          />
        ))}
      </DataList>
    </Section>
  );
}

export function QualityCentreDetailView({ response }: Readonly<{ response: Detail }>) {
  const { centre } = response;
  const groups = groupActions(response.openActions);
  return (
    <>
      <Breadcrumb
        trail={[
          { label: "Daily Success", href: "/" },
          { label: "Quality & Performance", href: "/quality" },
          { label: centre.centreName },
        ]}
      />
      <PageHeader
        eyebrow="Centre quality"
        title={centre.centreName}
        summary={centre.focusReason}
        meta={
          <>
            <StatusBadge tone={focusTone(centre.focus)}>{focusLabel(centre.focus)}</StatusBadge>
            <span>As at {centre.localDate}</span>
            <span>{centre.timezone}</span>
          </>
        }
      />

      {response.status === "partial" ? (
        <Notice title="Some quality facts could not be checked. ">
          {response.warning ?? ""}
        </Notice>
      ) : null}

      <section className="card card--feature" aria-labelledby="quality-standing">
        <h2 id="quality-standing" className="card__title">Current standing</h2>
        <ReviewLine centre={centre} />
        <MetricRow>
          <Metric
            label="Needs you"
            value={centre.actions.yourAction}
            emphasis={centre.actions.yourAction > 0}
          />
          <Metric label="Critical open" value={centre.actions.critical} />
          <Metric label="Overdue" value={centre.actions.overdue} />
          <Metric label="Completed in 30 days" value={centre.completedLast30Days} />
        </MetricRow>
        {response.canAcknowledgeReview && response.reviewHistory[0] ? (
          <Link
            className="button button--accent"
            href={`/centre/reviews/${response.reviewHistory[0].auditRunId}`}
          >
            Review and acknowledge {response.reviewHistory[0].quarterLabel}
          </Link>
        ) : null}
      </section>

      {response.uncoveredFindings.length ? (
        <Section
          title="Critical findings without an active action"
          description="These internal review findings have no corrective action covering them right now."
          count={`${response.uncoveredFindings.length}`}
        >
          <DataList label="Critical findings without an active action">
            {response.uncoveredFindings.map((finding) => (
              <DataListRow
                key={finding.findingId}
                title={finding.headline}
                severity="critical"
                badge={<StatusBadge tone="critical">Critical</StatusBadge>}
                facts={[{ term: "From", value: `${finding.quarterLabel} internal review` }]}
              />
            ))}
          </DataList>
        </Section>
      ) : null}

      <div className="quality-detail-grid">
        <div>
          {response.openActions.length === 0 ? (
            <Section title="Corrective actions" description="Open work for this centre.">
              <EmptyState
                title="No open corrective actions"
                message="Nothing is currently outstanding from this centre's internal reviews."
                mark="✓"
              />
            </Section>
          ) : (
            <>
              <ActionGroup
                title="Needs you"
                description="Work you are currently authorised to move forward."
                actions={groups.yours}
              />
              <ActionGroup
                title="Needs the centre"
                description="Open work owned by the centre team."
                actions={groups.centre}
              />
              <ActionGroup
                title="Waiting on someone else"
                description="Submitted work that another person must verify or progress."
                actions={groups.waiting}
              />
            </>
          )}
        </div>

        <div>
          <Section
            title="Strengths captured at review"
            description="Positive practice recorded during internal review."
            headingLevel={3}
          >
            {response.strengths.length === 0 ? (
              <EmptyState
                title="No positive practice recorded yet"
                message="Positive practice appears here once an internal review captures it."
              />
            ) : (
              <ul className="quality-strengths card" role="list">
                {response.strengths.map((strength) => (
                  <li key={strength.positiveObservationId}>
                    {strength.description}
                    <span className="quality-strengths__quarter">{strength.quarterLabel}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Recently completed"
            description="Closed in the last 30 days."
            headingLevel={3}
          >
            {response.completedActions.length === 0 ? (
              <EmptyState
                title="Nothing closed in the last 30 days"
                message="Completed corrective actions appear here as the centre closes them."
              />
            ) : (
              <ul className="timeline card" role="list">
                {response.completedActions.map((action) => (
                  <li key={action.correctiveActionId}>
                    <span>{action.title}</span>
                    <span className="timeline__when">Closed {action.closedLocalDate}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Internal review history"
            description="Finalised reviews only. Bright Steps internal method, not a regulatory rating."
            headingLevel={3}
          >
            {response.reviewHistory.length === 0 ? (
              <EmptyState
                title="No finalised internal review yet"
                message="This centre's quality history begins once its first internal review is finalised."
              />
            ) : (
              <ul className="quality-history card" role="list">
                {response.reviewHistory.map((review) => (
                  <li key={review.auditRunId}>
                    <span className="quality-history__quarter">{review.quarterLabel}</span>
                    <span className="quality-history__score">
                      {formatScore(review.overallScore)}
                      {review.overallScore === undefined ? "" : "%"}
                    </span>
                    <span className="metric__note">
                      {review.criticalFindingCount} critical · {review.positivePracticeCount} positive
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </>
  );
}

export function QualityCentreDetail({ centreId }: Readonly<{ centreId: string }>) {
  const client = useAuthenticatedCentreSuccessClient();
  const [response, setResponse] = useState<Detail>();
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void client.foundation.getCentreQualityDetail(centreId).then(
      (value) => {
        if (!current) return;
        setResponse(value);
        setState("ready");
      },
      (error: unknown) => {
        if (!current) return;
        setState(
          isAPIError(error) &&
            [ErrCode.PermissionDenied, ErrCode.Unauthenticated, ErrCode.NotFound].includes(
              error.code,
            )
            ? "denied"
            : "error",
        );
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, centreId, client]);

  const retry = useCallback(() => {
    setState("loading");
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (state === "loading") return;
    document.querySelector<HTMLElement>("[data-page-focus]")?.focus();
  }, [response, state]);

  let content;
  if (state === "loading") {
    content = <LoadingSkeleton label="Checking centre quality." rows={5} />;
  } else if (state === "denied") {
    content = (
      <ErrorState
        title="This centre is not available to you"
        message="You do not currently have authorised access to this centre's quality information."
      />
    );
  } else if (state === "error" || !response) {
    content = (
      <ErrorState
        title="Centre quality could not be checked"
        message="No result has been assumed. Nothing here should be read as an all-clear."
        onRetry={retry}
      />
    );
  } else {
    content = <QualityCentreDetailView response={response} />;
  }

  return (
    <AppShell active="/quality">
      {content}
    </AppShell>
  );
}
