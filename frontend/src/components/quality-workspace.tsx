"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import type { centre_quality } from "../lib/client.generated";
import { ErrCode, isAPIError } from "../lib/client.generated";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import { AppShell } from "./app-shell";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  Metric,
  MetricRow,
  Notice,
  PageHeader,
  SegmentedControl,
  StatusBadge,
  Trend,
  formatScore,
} from "./design-system";

type Workspace = centre_quality.CentreQualityWorkspaceResponse;
type CentreCard = centre_quality.QualityCentreCard;
type ViewKind = centre_quality.CentreQualityViewKind;

const SESSION_KEY = "centre-success.quality-view";

function viewKey(view: centre_quality.CentreQualityView): string {
  return `${view.kind}:${view.centreId ?? ""}`;
}

export function focusTone(focus: centre_quality.CentreQualityFocus) {
  return {
    NEEDS_SUPPORT: "critical" as const,
    MONITOR: "warning" as const,
    STEADY: "positive" as const,
    AWAITING_FIRST_REVIEW: "neutral" as const,
  }[focus];
}

export function focusLabel(focus: centre_quality.CentreQualityFocus): string {
  return {
    NEEDS_SUPPORT: "Needs support",
    MONITOR: "Keep an eye on",
    STEADY: "Steady",
    AWAITING_FIRST_REVIEW: "No review yet",
  }[focus];
}

/**
 * The review line shows only what the quarterly-review module recorded. When a
 * centre has no finalised review it says so instead of rendering a zero.
 */
export function ReviewLine({ centre }: Readonly<{ centre: CentreCard }>) {
  if (!centre.latestReview) {
    return (
      <p className="quality-review-line">
        No finalised internal review has been recorded for this centre yet.
      </p>
    );
  }
  const { latestReview: review, comparison } = centre;
  return (
    <div className="quality-review-line">
      <span className="quality-review-line__score">
        {formatScore(review.overallScore)}
        {review.overallScore === undefined ? "" : <span aria-hidden="true">%</span>}
      </span>
      <span className="quality-review-line__quarter">
        {review.quarterLabel} internal review
        {review.performanceBandLabel ? ` · ${review.performanceBandLabel}` : ""}
      </span>
      {comparison.comparable && comparison.scoreDelta !== undefined ? (
        <Trend direction={comparison.trend}>
          {comparison.scoreDelta > 0 ? "+" : ""}
          {comparison.scoreDelta} vs {comparison.previous?.quarterLabel}
        </Trend>
      ) : (
        <span className="metric__note">
          {comparison.available
            ? "Not comparable with the previous quarter"
            : "No previous quarter to compare"}
        </span>
      )}
    </div>
  );
}

export function CentreQualityCard({ centre }: Readonly<{ centre: CentreCard }>) {
  const counts: readonly { term: string; value: number; attention: boolean }[] = [
    { term: "Critical open", value: centre.actions.critical, attention: centre.actions.critical > 0 },
    { term: "Overdue", value: centre.actions.overdue, attention: centre.actions.overdue > 0 },
    {
      term: "Awaiting verification",
      value: centre.actions.awaitingVerification,
      attention: false,
    },
    { term: "Open in total", value: centre.actions.total, attention: false },
  ];
  return (
    <li className="quality-centre-card" data-focus={centre.focus}>
      <div className="quality-centre-card__head">
        <h4>{centre.centreName}</h4>
        <StatusBadge tone={focusTone(centre.focus)}>{focusLabel(centre.focus)}</StatusBadge>
      </div>
      <p className="quality-centre-card__reason">{centre.focusReason}</p>
      {centre.latestReview ? <ReviewLine centre={centre} /> : null}
      <dl className="quality-counts">
        {counts.map((count) => (
          <div key={count.term} data-attention={count.attention ? "true" : undefined}>
            <dt>{count.term}</dt>
            <dd>{count.value}</dd>
          </div>
        ))}
        {centre.uncoveredCriticalFindings > 0 ? (
          <div data-attention="true">
            <dt>Critical findings without an action</dt>
            <dd>{centre.uncoveredCriticalFindings}</dd>
          </div>
        ) : null}
      </dl>
      <Link className="button button--secondary" href={centre.cta.route}>
        {centre.cta.label}
        <span className="visually-hidden"> for {centre.centreName}</span>
      </Link>
    </li>
  );
}

function PortfolioHero({ response }: Readonly<{ response: Workspace }>) {
  const { summary } = response;
  if (summary.coverage === "partial") {
    return (
      <section className="quality-hero" aria-labelledby="quality-hero-title">
        <h2 id="quality-hero-title">Portfolio quality</h2>
        <p>
          Some centres could not be checked, so no portfolio total is shown rather than
          a total that would understate the picture.
        </p>
      </section>
    );
  }
  const needsSupport = summary.needsSupportCount ?? 0;
  return (
    <section className="quality-hero" aria-labelledby="quality-hero-title">
      <h2 id="quality-hero-title">
        {needsSupport === 0
          ? "No centre is currently showing critical or overdue work"
          : needsSupport === 1
            ? "One centre could use your support this week"
            : `${needsSupport} centres could use your support this week`}
      </h2>
      <p>
        Grouped by the kind of support a centre needs, from the internal reviews and
        corrective actions those centres already own.
      </p>
      <dl className="quality-hero__figures">
        <div data-emphasis={needsSupport > 0 ? "true" : undefined}>
          <dt>Needs support</dt>
          <dd>{needsSupport}</dd>
        </div>
        <div>
          <dt>Critical open</dt>
          <dd>{summary.openCriticalCount ?? 0}</dd>
        </div>
        <div>
          <dt>Overdue</dt>
          <dd>{summary.overdueCount ?? 0}</dd>
        </div>
        <div>
          <dt>Awaiting verification</dt>
          <dd>{summary.awaitingVerificationCount ?? 0}</dd>
        </div>
      </dl>
    </section>
  );
}

function CentreSummary({ centre }: Readonly<{ centre: CentreCard }>) {
  return (
    <section className="quality-hero" aria-labelledby="quality-centre-hero">
      <h2 id="quality-centre-hero">{centre.focusReason}</h2>
      <p>
        Everything below comes from your centre&apos;s internal reviews and corrective
        actions. Nothing here is a regulatory rating.
      </p>
      <dl className="quality-hero__figures">
        <div data-emphasis={centre.actions.yourAction > 0 ? "true" : undefined}>
          <dt>Needs you</dt>
          <dd>{centre.actions.yourAction}</dd>
        </div>
        <div>
          <dt>Critical open</dt>
          <dd>{centre.actions.critical}</dd>
        </div>
        <div>
          <dt>Waiting on others</dt>
          <dd>{centre.actions.waiting}</dd>
        </div>
        <div>
          <dt>Completed in 30 days</dt>
          <dd>{centre.completedLast30Days}</dd>
        </div>
      </dl>
    </section>
  );
}

function FocusGroups({ response }: Readonly<{ response: Workspace }>) {
  const byId = new Map(response.centres.map((centre) => [centre.centreId, centre] as const));
  return (
    <>
      {response.focusGroups.map((group) => {
        const centres = group.centreIds.flatMap((id) => {
          const centre = byId.get(id);
          return centre ? [centre] : [];
        });
        return (
          <section
            className="quality-group"
            key={group.focus}
            aria-labelledby={`quality-group-${group.focus}`}
          >
            <div className="quality-group__header">
              <h3 id={`quality-group-${group.focus}`}>
                {group.label}
                <span className="section__count">
                  {centres.length} centre{centres.length === 1 ? "" : "s"}
                </span>
              </h3>
              <p>{group.description}</p>
            </div>
            <ul className="quality-centre-grid" role="list">
              {centres.map((centre) => (
                <CentreQualityCard centre={centre} key={centre.centreId} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

export function QualityWorkspaceView({
  response,
  onChooseView,
}: Readonly<{
  response: Workspace;
  onChooseView: (view: centre_quality.CentreQualityView) => void;
}>) {
  const active = response.activeView;
  const isCentre = active?.kind === "centre";
  const centre = isCentre ? response.centres[0] : undefined;
  const businessDate = response.centres[0]?.localDate;
  return (
    <>
      <PageHeader
        eyebrow="Quality & Performance"
        title={isCentre ? (active?.centreName ?? "Centre quality") : "Centre quality across your portfolio"}
        summary={
          isCentre
            ? "Where your centre stands on internal review and corrective action, and what needs you next."
            : "Where your centres stand, and which of them could use support first."
        }
        meta={
          <>
            {businessDate ? <span>As at {businessDate}</span> : null}
            <StatusBadge tone="informational">Bright Steps internal review</StatusBadge>
          </>
        }
        actions={
          response.availableViews.length > 1 ? (
            <SegmentedControl<ViewKind>
              label="Choose a quality view"
              value={active?.kind}
              options={response.availableViews.map((view) => ({
                value: view.kind,
                label: view.kind === "centre" ? (view.centreName ?? "My centre") : view.label,
              }))}
              onChange={(kind) => {
                const next = response.availableViews.find((view) => view.kind === kind);
                if (next) onChooseView(next);
              }}
            />
          ) : undefined
        }
      />

      {response.status === "partial" ? (
        <Notice title="Some quality facts could not be checked. ">
          {response.authorisationHealth.warning ?? response.warning ?? ""}
        </Notice>
      ) : null}

      {isCentre && centre ? (
        <>
          <CentreSummary centre={centre} />
          <section className="section" aria-labelledby="quality-centre-standing">
            <div className="section__header">
              <div>
                <h2 id="quality-centre-standing">Current standing</h2>
                <p>The most recent finalised internal review, and how it compares.</p>
              </div>
            </div>
            <div className="card">
              <ReviewLine centre={centre} />
              <MetricRow>
                <Metric
                  label="Critical findings"
                  value={centre.latestReview?.criticalFindingCount ?? "—"}
                  unavailable={!centre.latestReview}
                />
                <Metric
                  label="High findings"
                  value={centre.latestReview?.highFindingCount ?? "—"}
                  unavailable={!centre.latestReview}
                />
                <Metric
                  label="Positive practice"
                  value={centre.strengthsCount}
                  note="Captured during internal review"
                />
                <Metric
                  label="Open actions"
                  value={centre.actions.total}
                  emphasis={centre.actions.total > 0}
                />
              </MetricRow>
              <Link className="button button--accent" href={centre.cta.route}>
                Open the full centre view
              </Link>
            </div>
          </section>
        </>
      ) : (
        <>
          <PortfolioHero response={response} />
          {response.centres.length === 0 ? (
            <EmptyState
              title="No centres are currently in your portfolio"
              message="Centres appear here as soon as an active assignment gives you access to their internal reviews or corrective actions."
            />
          ) : (
            <FocusGroups response={response} />
          )}
        </>
      )}
    </>
  );
}

function ViewChooser({
  response,
  onChooseView,
}: Readonly<{
  response: Workspace;
  onChooseView: (view: centre_quality.CentreQualityView) => void;
}>) {
  return (
    <>
      <PageHeader
        eyebrow="Quality & Performance"
        title="Choose your quality view"
        summary="You hold more than one authorised view. Each is rechecked against your current Centre Success access."
      />
      <div className="card-grid card-grid--two">
        {response.availableViews.map((view) => (
          <button
            className="workspace-links-button card"
            key={viewKey(view)}
            type="button"
            onClick={() => onChooseView(view)}
            style={{ textAlign: "left", cursor: "pointer" }}
          >
            <span className="card__title">{view.label}</span>
            <span className="card__body">
              {view.kind === "centre"
                ? "Your centre's internal review standing and corrective work."
                : view.kind === "portfolio"
                  ? "The centres you support, grouped by the help they need."
                  : "Organisation-wide quality and compliance oversight."}
            </span>
          </button>
        ))}
      </div>
    </>
  );
}

export function QualityWorkspace() {
  const client = useAuthenticatedCentreSuccessClient();
  const [request, setRequest] = useState<centre_quality.CentreQualityWorkspaceRequest>({});
  const [response, setResponse] = useState<Workspace>();
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [announcement, setAnnouncement] = useState("Checking centre quality.");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void client.foundation.getCentreQualityWorkspace(request).then(
      (value) => {
        if (!current) return;
        if (value.status === "selection_required" && typeof window !== "undefined") {
          const stored = window.sessionStorage.getItem(SESSION_KEY);
          const match = value.availableViews.find((view) => viewKey(view) === stored);
          if (match) {
            setRequest({
              view: match.kind,
              ...(match.centreId ? { centreId: match.centreId } : {}),
            });
            return;
          }
        }
        setResponse(value);
        setState("ready");
        setAnnouncement(
          value.status === "partial"
            ? "Some quality facts could not be checked. Centre quality is partially available."
            : "Centre quality is ready.",
        );
      },
      (error: unknown) => {
        if (!current) return;
        if (request.view && isAPIError(error) && error.code === ErrCode.PermissionDenied) {
          window.sessionStorage.removeItem(SESSION_KEY);
          setRequest({});
          setState("loading");
          setAnnouncement("Your previous quality view is no longer available.");
          return;
        }
        const next =
          isAPIError(error) &&
          [ErrCode.PermissionDenied, ErrCode.Unauthenticated].includes(error.code)
            ? "denied"
            : "error";
        setState(next);
        setAnnouncement(
          next === "denied"
            ? "Centre quality access is unavailable."
            : "Centre quality could not be checked.",
        );
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, client, request]);

  const chooseView = useCallback((view: centre_quality.CentreQualityView) => {
    window.sessionStorage.setItem(SESSION_KEY, viewKey(view));
    setState("loading");
    setAnnouncement("Checking centre quality.");
    setRequest({ view: view.kind, ...(view.centreId ? { centreId: view.centreId } : {}) });
  }, []);

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
    content = <LoadingSkeleton label="Checking centre quality." rows={4} />;
  } else if (state === "denied") {
    content = (
      <ErrorState
        title="Centre quality is unavailable"
        message="You do not currently have an authorised Quality & Performance view."
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
  } else if (response.status === "unsupported") {
    content = (
      <EmptyState
        title="No quality view is assigned to you"
        message="Your account is connected, but none of the approved Quality & Performance views is currently assigned. Technical administration alone does not grant this view."
      />
    );
  } else if (response.status === "selection_required") {
    content = <ViewChooser response={response} onChooseView={chooseView} />;
  } else {
    content = <QualityWorkspaceView response={response} onChooseView={chooseView} />;
  }

  return (
    <AppShell active="/quality">
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {content}
    </AppShell>
  );
}
