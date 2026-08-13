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
type Coverage = centre_quality.QualityCentreCoverage;

const SESSION_KEY = "centre-success.quality-view";

/**
 * Stable, unique selector value. `kind` alone is not enough: a principal
 * responsible for several centres holds several `centre` views, and keying on
 * the kind would make them indistinguishable in the control.
 */
function viewKey(view: centre_quality.CentreQualityView): string {
  return `${view.kind}:${view.centreId ?? ""}`;
}

export function focusTone(focus: centre_quality.CentreQualityFocus) {
  return {
    NEEDS_SUPPORT: "critical" as const,
    MONITOR: "warning" as const,
    INFORMATION_INCOMPLETE: "informational" as const,
    STEADY: "positive" as const,
    AWAITING_FIRST_REVIEW: "neutral" as const,
  }[focus];
}

export function focusLabel(focus: centre_quality.CentreQualityFocus): string {
  return {
    NEEDS_SUPPORT: "Needs support",
    MONITOR: "Keep an eye on",
    INFORMATION_INCOMPLETE: "Information incomplete",
    STEADY: "Steady",
    AWAITING_FIRST_REVIEW: "No review yet",
  }[focus];
}

function formatList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}

/**
 * States plainly which sources did not contribute. Absence is never rendered
 * as a zero anywhere in Quality, so this note is what stands in its place.
 * It stays deliberately quiet: a source gap is not an emergency, but it does
 * change what the reader may safely conclude.
 */
export function CoverageNote({ coverage }: Readonly<{ coverage: Coverage }>) {
  const unavailable: string[] = [];
  const unauthorised: string[] = [];
  const record = (state: centre_quality.QualitySourceCoverage, label: string) => {
    if (state === "UNAVAILABLE") unavailable.push(label);
    else if (state === "NOT_AUTHORIZED") unauthorised.push(label);
  };
  record(coverage.quarterlyReviews, "internal reviews");
  record(coverage.correctiveActions, "corrective actions");
  record(coverage.uncoveredFindings, "review findings");
  if (unavailable.length === 0 && unauthorised.length === 0) return null;
  const clauses: string[] = [];
  if (unavailable.length > 0) {
    clauses.push(`${formatList(unavailable)} could not be checked`);
  }
  if (unauthorised.length > 0) {
    clauses.push(`${formatList(unauthorised)} are outside your access`);
  }
  return (
    <p className="quality-coverage-note">
      <span className="quality-coverage-note__label">Information incomplete</span>
      {` Some quality information couldn't be checked: ${clauses.join(", and ")}. Nothing below counts as zero for those sources.`}
    </p>
  );
}

/**
 * The review line shows only what the quarterly-review module recorded. When a
 * centre has no finalised review it says so instead of rendering a zero.
 */
export function ReviewLine({ centre }: Readonly<{ centre: CentreCard }>) {
  if (centre.coverage.quarterlyReviews !== "AVAILABLE") {
    return (
      <p className="quality-review-line">
        {centre.coverage.quarterlyReviews === "NOT_AUTHORIZED"
          ? "Internal review information is outside your access for this centre."
          : "Internal review information could not be checked, so no review is shown."}
      </p>
    );
  }
  if (!centre.latestReview) {
    return (
      <p className="quality-review-line">
        No finalised internal review has been recorded for this centre yet.
      </p>
    );
  }
  const { latestReview: review } = centre;
  const comparison = centre.comparison;
  if (!comparison) {
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
      </div>
    );
  }
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
  const actions = centre.actions;
  const counts: readonly { term: string; value: number; attention: boolean }[] = actions
    ? [
        { term: "Critical open", value: actions.critical, attention: actions.critical > 0 },
        { term: "Overdue", value: actions.overdue, attention: actions.overdue > 0 },
        {
          term: "Awaiting verification",
          value: actions.awaitingVerification,
          attention: false,
        },
        { term: "Open in total", value: actions.total, attention: false },
      ]
    : [];
  const uncovered = centre.uncoveredCriticalFindings ?? 0;
  return (
    <li className="quality-centre-card" data-focus={centre.focus}>
      <div className="quality-centre-card__head">
        <h4>{centre.centreName}</h4>
        <StatusBadge tone={focusTone(centre.focus)}>{focusLabel(centre.focus)}</StatusBadge>
      </div>
      <p className="quality-centre-card__reason">{centre.focusReason}</p>
      {centre.latestReview ? <ReviewLine centre={centre} /> : null}
      <CoverageNote coverage={centre.coverage} />
      {counts.length > 0 || uncovered > 0 ? (
        <dl className="quality-counts">
          {counts.map((count) => (
            <div key={count.term} data-attention={count.attention ? "true" : undefined}>
              <dt>{count.term}</dt>
              <dd>{count.value}</dd>
            </div>
          ))}
          {uncovered > 0 ? (
            <div data-attention="true">
              <dt>Critical findings without an action</dt>
              <dd>{uncovered}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <Link className="button button--secondary" href={centre.cta.route}>
        {centre.cta.label}
        <span className="visually-hidden"> for {centre.centreName}</span>
      </Link>
    </li>
  );
}

type CollectionScope = "portfolio" | "organisation";

/**
 * The heading must never assert an all-clear from incomplete information, so
 * a portfolio holding unchecked centres says what it actually knows. Summed
 * totals are rendered only when the backend supplied them, which it does only
 * when every contributing centre reported.
 */
function CollectionHero({
  response,
  scope,
}: Readonly<{ response: Workspace; scope: CollectionScope }>) {
  const { summary } = response;
  const needsSupport = summary.needsSupportCount;
  const incomplete = summary.informationIncompleteCount;
  const organisation = scope === "organisation";

  const headline =
    needsSupport === 0
      ? incomplete > 0
        ? "No centre is showing critical or overdue work in the information available"
        : "No centre is currently showing critical or overdue work"
      : needsSupport === 1
        ? organisation
          ? "One centre is showing critical or overdue work"
          : "One centre could use your support this week"
        : organisation
          ? `${needsSupport} centres are showing critical or overdue work`
          : `${needsSupport} centres could use your support this week`;

  return (
    <section className="quality-hero" aria-labelledby="quality-hero-title">
      <h2 id="quality-hero-title">{headline}</h2>
      <p>
        {organisation
          ? "Grouped by the kind of support a centre needs, from the internal reviews and corrective actions each centre in the organisation already owns."
          : "Grouped by the kind of support a centre needs, from the internal reviews and corrective actions those centres already own."}
      </p>
      <dl className="quality-hero__figures">
        <div data-emphasis={needsSupport > 0 ? "true" : undefined}>
          <dt>Needs support</dt>
          <dd>{needsSupport}</dd>
        </div>
        {incomplete > 0 ? (
          <div>
            <dt>Information incomplete</dt>
            <dd>{incomplete}</dd>
          </div>
        ) : null}
        <div>
          <dt>Critical open</dt>
          <dd>{summary.openCriticalCount ?? "Not checked"}</dd>
        </div>
        <div>
          <dt>Overdue</dt>
          <dd>{summary.overdueCount ?? "Not checked"}</dd>
        </div>
        {incomplete > 0 ? null : (
          <div>
            <dt>Awaiting verification</dt>
            <dd>{summary.awaitingVerificationCount ?? "Not checked"}</dd>
          </div>
        )}
      </dl>
      {summary.coverage === "partial" ? (
        <p className="quality-hero__note">
          Totals are shown only where every centre reported. Where a source could not be
          checked, no total is stated rather than one that would understate the picture.
        </p>
      ) : null}
    </section>
  );
}

function CentreSummary({ centre }: Readonly<{ centre: CentreCard }>) {
  const actions = centre.actions;
  return (
    <section className="quality-hero" aria-labelledby="quality-centre-hero">
      <h2 id="quality-centre-hero">{centre.focusReason}</h2>
      <p>
        Everything below comes from your centre&apos;s internal reviews and corrective
        actions. Nothing here is a regulatory rating.
      </p>
      <CoverageNote coverage={centre.coverage} />
      <dl className="quality-hero__figures">
        <div data-emphasis={(actions?.yourAction ?? 0) > 0 ? "true" : undefined}>
          <dt>Needs you</dt>
          <dd>{actions ? actions.yourAction : "Not checked"}</dd>
        </div>
        <div>
          <dt>Critical open</dt>
          <dd>{actions ? actions.critical : "Not checked"}</dd>
        </div>
        <div>
          <dt>Waiting on others</dt>
          <dd>{actions ? actions.waiting : "Not checked"}</dd>
        </div>
        <div>
          <dt>Completed in 30 days</dt>
          <dd>{centre.completedLast30Days ?? "Not checked"}</dd>
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
  const isOrganisation = active?.kind === "organisation";
  const centre = isCentre ? response.centres[0] : undefined;
  const businessDate = response.centres[0]?.localDate;

  // An organisation-wide compliance view is not a personal portfolio. Saying
  // "your centres" there would imply the reader owns every centre they can see.
  const title = isCentre
    ? (active?.centreName ?? "Centre quality")
    : isOrganisation
      ? "Centre quality across the organisation"
      : "Centre quality across your portfolio";
  const summary = isCentre
    ? "Where your centre stands on internal review and corrective action, and what needs you next."
    : isOrganisation
      ? "Organisation-wide quality and compliance oversight, across every centre you are authorised to see."
      : "Where your centres stand, and which of them could use support first.";

  return (
    <>
      <PageHeader
        eyebrow="Quality & Performance"
        title={title}
        summary={summary}
        meta={
          <>
            {businessDate ? <span>As at {businessDate}</span> : null}
            <StatusBadge tone="informational">Bright Steps internal review</StatusBadge>
          </>
        }
        actions={
          response.availableViews.length > 1 ? (
            <SegmentedControl<string>
              label="Choose a quality view"
              value={active ? viewKey(active) : undefined}
              options={response.availableViews.map((view) => ({
                value: viewKey(view),
                label: view.kind === "centre" ? (view.centreName ?? "My centre") : view.label,
              }))}
              onChange={(key) => {
                const next = response.availableViews.find(
                  (view) => viewKey(view) === key,
                );
                if (next) onChooseView(next);
              }}
            />
          ) : undefined
        }
      />

      {response.status === "partial" ? (
        <Notice title="Some quality information couldn't be checked.">
          {response.authorisationHealth.warning ??
            "Where a source could not be checked, nothing is reported as zero. Treat the figures below as a partial picture."}
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
                  value={centre.strengthsCount ?? "—"}
                  unavailable={centre.strengthsCount === undefined}
                  note="Captured during internal review"
                />
                <Metric
                  label="Open actions"
                  value={centre.actions?.total ?? "—"}
                  unavailable={centre.actions === undefined}
                  emphasis={(centre.actions?.total ?? 0) > 0}
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
          <CollectionHero
            response={response}
            scope={isOrganisation ? "organisation" : "portfolio"}
          />
          {response.centres.length === 0 ? (
            <EmptyState
              title={
                isOrganisation
                  ? "No centres are currently visible in this organisation view"
                  : "No centres are currently in your portfolio"
              }
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
