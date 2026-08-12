"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { daily_success } from "../lib/client.generated";
import { ErrCode, isAPIError } from "../lib/client.generated";
import { useCentreSuccessAuthentication } from "../lib/centre-success-authentication";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import { StatusPill } from "./workflow-shell";

type Response = daily_success.DailySuccessResponse;
type Perspective = daily_success.DailySuccessPerspective;

const SESSION_KEY = "centre-success.daily-perspective";

function selectionKey(perspective: Perspective): string {
  return `${perspective.kind}:${perspective.centreId ?? ""}`;
}

export function readSessionPerspective(
  available: readonly Perspective[],
  storage: Pick<Storage, "getItem"> | undefined,
): Perspective | undefined {
  if (!storage) return undefined;
  const stored = storage.getItem(SESSION_KEY);
  return available.find((perspective) => selectionKey(perspective) === stored);
}

function responsibilityLabel(value: daily_success.DailyResponsibility): string {
  return {
    YOU_NEED_TO_ACT: "You need to act",
    YOUR_CENTRE_NEEDS_TO_ACT: "Your centre needs to act",
    WAITING_ON_SOMEONE_ELSE: "Waiting on someone else",
    FOR_YOUR_AWARENESS: "For your awareness",
  }[value];
}

function dueLabel(due: daily_success.DailyDueInformation | undefined): string | undefined {
  if (!due) return undefined;
  return {
    OVERDUE: "Overdue",
    TODAY: "Due today",
    TOMORROW: "Due tomorrow",
    DUE_SOON: `Due ${due.localDate}`,
    LATER: `Due ${due.localDate}`,
  }[due.bucket];
}

function businessTimeLabel(response: Response): string {
  const activeCentreId = response.activePerspective?.centreId;
  const businessDate = response.businessDates.find(
    (context) => context.scope === "centre" && context.id === activeCentreId,
  ) ?? response.businessDates.find((context) => context.scope === "organisation");
  if (!businessDate) return "time unavailable";
  return new Intl.DateTimeFormat("en-AU", {
    timeZone: businessDate.timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(response.asOf));
}

function tone(item: daily_success.DailySuccessItem) {
  if (item.riskLevel === "CRITICAL") return "critical" as const;
  if (item.attentionBand === "URGENT" || item.attentionBand === "TODAY") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function DailyItemCard({ item }: Readonly<{ item: daily_success.DailySuccessItem }>) {
  return (
    <li className="daily-card" data-band={item.attentionBand}>
      <div className="daily-card__meta">
        <StatusPill tone={tone(item)}>
          {item.riskLevel === "CRITICAL" ? "CRITICAL" : item.attentionBand}
        </StatusPill>
        <span>{responsibilityLabel(item.responsibility)}</span>
      </div>
      <h3>{item.headline}</h3>
      {item.centreName ? <p className="daily-card__centre">{item.centreName}</p> : null}
      <p>{item.summary}</p>
      <dl className="daily-card__why">
        <div><dt>Why</dt><dd>{item.whyShown.label}</dd></div>
        {dueLabel(item.due) ? <div><dt>When</dt><dd>{dueLabel(item.due)}</dd></div> : null}
      </dl>
      <Link className="workflow-button daily-card__cta" href={item.cta.route}>
        {item.cta.label}
      </Link>
    </li>
  );
}

function PerspectiveChooser({
  available,
  onChoose,
}: Readonly<{
  available: Perspective[];
  onChoose: (perspective: Perspective) => void;
}>) {
  return (
    <section className="daily-state" aria-labelledby="daily-perspective-title">
      <h1 id="daily-perspective-title" data-daily-focus tabIndex={-1}>Choose your Daily Success view</h1>
      <p>Each view is rechecked against your current Centre Success access.</p>
      <div className="daily-perspective-list">
        {available.map((perspective) => (
          <button
            key={selectionKey(perspective)}
            type="button"
            onClick={() => onChoose(perspective)}
          >
            {perspective.label}
          </button>
        ))}
      </div>
    </section>
  );
}

function DailyHeader({
  displayName,
  response,
  onChoose,
}: Readonly<{
  displayName: string;
  response: Response;
  onChoose: (perspective: Perspective) => void;
}>) {
  const { signOut } = useCentreSuccessAuthentication();
  return (
    <>
      <header className="daily-topbar">
        <Link href="/" className="workflow-brand">Bright Steps · Centre Success</Link>
        <nav aria-label="Authorised Centre Success workspaces">
          {response.workspaceLinks.map((link) => <Link key={link.route} href={link.route}>{link.label}</Link>)}
        </nav>
        <button className="auth-text-button" type="button" onClick={() => void signOut()}>Sign out</button>
      </header>
      <header className="daily-heading">
        <p className="foundation-eyebrow">Daily Success</p>
        <h1 data-daily-focus tabIndex={-1}>Good morning, {displayName}</h1>
        <p>{response.activePerspective?.label ?? "Your authorised priorities"} · as at {businessTimeLabel(response)}</p>
        {response.availablePerspectives.length > 1 ? (
          <details className="daily-switcher">
            <summary>Change view</summary>
            <div className="daily-perspective-list">
              {response.availablePerspectives.map((perspective) => (
                <button key={selectionKey(perspective)} type="button" onClick={() => onChoose(perspective)}>
                  {perspective.label}
                </button>
              ))}
            </div>
          </details>
        ) : null}
      </header>
    </>
  );
}

function PerspectiveSummary({ response }: Readonly<{ response: Response }>) {
  const kind = response.activePerspective?.kind;
  if (kind === "centre") {
    return <section className="daily-perspective-summary" aria-labelledby="daily-centre-summary"><h2 id="daily-centre-summary">Your centre priorities</h2><p>Start with the highest authorised work for your centre.</p></section>;
  }
  if (kind === "portfolio") {
    return <section className="daily-perspective-summary" aria-labelledby="daily-portfolio-summary"><h2 id="daily-portfolio-summary">Portfolio priorities</h2><p>Focus on centres and verification work needing Area Manager attention.</p></section>;
  }
  if (kind === "compliance") {
    const active = response.aggregateCounts.active ?? 0;
    return <section className="daily-perspective-summary" aria-labelledby="daily-compliance-summary"><h2 id="daily-compliance-summary">Compliance exceptions</h2><p>{response.aggregateCounts.coverage === "partial" ? "Exception totals are not fully checked." : `${active} authorised exception${active === 1 ? "" : "s"} currently visible.`}</p></section>;
  }
  const active = response.aggregateCounts.active ?? 0;
  return <section className="daily-perspective-summary" aria-labelledby="daily-administration-summary"><h2 id="daily-administration-summary">People &amp; Access attention</h2><p>{response.aggregateCounts.coverage === "partial" ? "People & Access attention is not fully checked." : `${active} eligible approval or administrator-review item${active === 1 ? "" : "s"} currently needs attention.`}</p></section>;
}

function DailyReady({
  displayName,
  response,
  onChoose,
}: Readonly<{
  displayName: string;
  response: Response;
  onChoose: (perspective: Perspective) => void;
}>) {
  const sections = response.sections.filter((section) =>
    section.key !== "ON_TRACK" && section.items.length > 0,
  );
  return (
    <main className="daily-shell">
      <DailyHeader displayName={displayName} response={response} onChoose={onChoose} />
      {response.status === "partial" ? (
        <p className="daily-warning" role="alert">{response.warning ?? "Some priorities could not be checked."}</p>
      ) : null}
      <PerspectiveSummary response={response} />

      {response.activePerspective?.kind === "portfolio" && response.attentionCentres.length ? (
        <section className="daily-section" aria-labelledby="attention-centres-title">
          <h2 id="attention-centres-title">Centres needing attention</h2>
          <ul className="daily-centre-grid">
            {response.attentionCentres.map((centre) => (
              <li className="daily-centre-card" key={centre.centreId}>
                <StatusPill tone={centre.criticalCount ? "critical" : "warning"}>{centre.attentionBand}</StatusPill>
                <h3>{centre.centreName}</h3>
                <p>{centre.headline}</p>
                {centre.coverage === "partial" ? (
                  <p className="daily-centre-card__coverage">Critical, overdue and due-today counts: not fully checked</p>
                ) : (
                  <p>{centre.criticalCount} critical · {centre.overdueCount} overdue · {centre.dueTodayCount} due today</p>
                )}
                <Link className="workflow-link daily-centre-card__cta" href={centre.cta.route}>{centre.cta.label}</Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {response.activePerspective?.kind === "portfolio" && response.verificationItems.length ? (
        <section className="daily-section daily-section--verification" aria-labelledby="daily-verification-title">
          <h2 id="daily-verification-title">VERIFY TODAY</h2>
          <p>Independent verification work you are currently authorised to complete.</p>
          <ul className="daily-list">
            {response.verificationItems.map((item) => <DailyItemCard key={`verification:${item.id}`} item={item} />)}
          </ul>
        </section>
      ) : null}

      {sections.length ? sections.map((section) => (
        <section className={`daily-section${section.key === "DO_FIRST" ? " daily-section--primary" : ""}`} aria-labelledby={`daily-${section.key}`} key={section.key}>
          {section.key === "DO_FIRST" ? <p className="daily-section__kicker">Highest priority</p> : null}
          <h2 id={`daily-${section.key}`}>{section.label}</h2>
          <ul className="daily-list">{section.items.map((item) => <DailyItemCard key={item.id} item={item} />)}</ul>
        </section>
      )) : response.status === "ready" ? (
        <section className="daily-state" aria-labelledby="daily-clear-title">
          <h2 id="daily-clear-title">On track</h2>
          <p>No active priorities need attention in this view right now.</p>
        </section>
      ) : (
        <section className="daily-state" aria-labelledby="daily-partial-title">
          <h2 id="daily-partial-title">Priorities partially available</h2>
          <p>No active priorities were returned by the sources that could be checked.</p>
        </section>
      )}

      {response.status === "ready" && response.positiveContext ? (
        <section className="daily-positive" aria-labelledby="daily-positive-title">
          <h2 id="daily-positive-title">Positive progress</h2>
          <p>{response.positiveContext.completedTodayCount} completed today</p>
          {response.positiveContext.onTrackCentreCount !== undefined ? <p>{response.positiveContext.onTrackCentreCount} centres on track</p> : null}
          {response.positiveContext.recentTitles.length ? <ul>{response.positiveContext.recentTitles.map((title) => <li key={title}>{title}</li>)}</ul> : null}
        </section>
      ) : null}
    </main>
  );
}

export function DailySuccessHome({ displayName }: Readonly<{ displayName: string }>) {
  const client = useAuthenticatedCentreSuccessClient();
  const { signOut } = useCentreSuccessAuthentication();
  const [request, setRequest] = useState<daily_success.DailySuccessRequest>({});
  const [response, setResponse] = useState<Response>();
  const [state, setState] = useState<"loading" | "ready" | "denied" | "error">("loading");
  const [announcement, setAnnouncement] = useState("Checking today's authorised priorities.");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void client.foundation.getDailySuccess(request).then(
      (value) => {
        if (!current) return;
        const stored = value.status === "selection_required"
          ? readSessionPerspective(value.availablePerspectives, window.sessionStorage)
          : undefined;
        if (stored) {
          setRequest({ perspective: stored.kind, ...(stored.centreId ? { centreId: stored.centreId } : {}) });
          return;
        }
        setResponse(value);
        setState("ready");
        setAnnouncement(value.status === "partial"
          ? "Some priorities could not be checked. Daily Success is partially available."
          : "Daily Success priorities are ready.");
      },
      (error: unknown) => {
        if (!current) return;
        if (
          request.perspective &&
          isAPIError(error) &&
          error.code === ErrCode.PermissionDenied
        ) {
          window.sessionStorage.removeItem(SESSION_KEY);
          setRequest({});
          setState("loading");
          setAnnouncement("Your previous Daily Success view is no longer available. Checking your current views.");
          return;
        }
        const nextState = isAPIError(error) && [ErrCode.PermissionDenied, ErrCode.Unauthenticated].includes(error.code) ? "denied" : "error";
        setState(nextState);
        setAnnouncement(nextState === "denied" ? "Daily Success access is unavailable." : "Daily Success could not be checked.");
      },
    );
    return () => { current = false; };
  }, [attempt, client, request]);

  const choose = useCallback((perspective: Perspective) => {
    window.sessionStorage.setItem(SESSION_KEY, selectionKey(perspective));
    setState("loading");
    setAnnouncement("Checking today's authorised priorities.");
    setRequest({ perspective: perspective.kind, ...(perspective.centreId ? { centreId: perspective.centreId } : {}) });
  }, []);
  const retry = useCallback(() => {
    setState("loading");
    setAnnouncement("Checking today's authorised priorities.");
    setAttempt((value) => value + 1);
  }, []);
  const shellClass = useMemo(() => "daily-shell daily-shell--state", []);

  useEffect(() => {
    if (state === "loading") return;
    const heading = document.querySelector<HTMLElement>("[data-daily-focus]");
    heading?.focus();
  }, [response, state]);

  let content;
  if (state === "loading") {
    content = <main className={shellClass} aria-busy="true"><section className="daily-state"><h1>Daily Success</h1><p>Checking today&apos;s authorised priorities…</p></section></main>;
  } else if (state === "denied") {
    content = <main className={shellClass}><section className="daily-state"><h1 data-daily-focus tabIndex={-1}>Daily Success unavailable</h1><p>You do not currently have access to this Daily Success view.</p><button type="button" onClick={() => void signOut()}>Sign out</button></section></main>;
  } else if (state === "error" || !response) {
    content = <main className={shellClass}><section className="daily-state"><h1 data-daily-focus tabIndex={-1}>Daily Success is temporarily unavailable</h1><p>Today&apos;s priorities could not be checked. No on-track result has been assumed.</p><button type="button" onClick={retry}>Try again</button></section></main>;
  } else if (response.status === "selection_required") {
    content = <main className={shellClass}><PerspectiveChooser available={response.availablePerspectives} onChoose={choose} /></main>;
  } else if (response.status === "unsupported") {
    content = (
      <main className={shellClass}>
        <section className="daily-state"><h1 data-daily-focus tabIndex={-1}>No Daily Success perspective available</h1><p>Your account is connected, but none of the approved Daily Success perspectives is currently assigned.</p>{response.workspaceLinks.length ? <nav aria-label="Authorised workspaces">{response.workspaceLinks.map((link) => <Link key={link.route} href={link.route}>{link.label}</Link>)}</nav> : null}<button type="button" onClick={() => void signOut()}>Sign out</button></section>
      </main>
    );
  } else {
    content = <DailyReady displayName={displayName} response={response} onChoose={choose} />;
  }
  return <><p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">{announcement}</p>{content}</>;
}
