"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { useCentreSuccessAuthentication } from "../lib/centre-success-authentication";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import { AuthenticationGate } from "./authentication-gate";

/**
 * The Centre Success application frame.
 *
 * Navigation is capability-derived and comes from the backend on every page
 * load, through the authenticated read-only `/navigation` projection. Browser
 * storage is deliberately not consulted: an earlier version cached the links
 * in `sessionStorage`, which made client storage the effective authority for
 * which destinations rendered, because any syntactically valid path written
 * there would appear in the bar.
 *
 * Until the backend answers, the shell shows only Daily Success, which every
 * authenticated principal can reach. Frontend visibility is presentation only
 * and every destination reauthorises server-side regardless.
 */

export interface WorkspaceLink {
  label: string;
  route: string;
}

const DAILY_SUCCESS_LINK: WorkspaceLink = { label: "Daily Success", route: "/" };
/** Safe baseline while navigation is unknown, denied, or unavailable. */
const BASELINE_LINKS: readonly WorkspaceLink[] = [DAILY_SUCCESS_LINK];

export function BusinessWorkspaceGate({ children }: Readonly<{ children: ReactNode }>) {
  const { state } = useCentreSuccessAuthentication();
  if (state.kind !== "signed-in") {
    return <AuthenticationGate authenticatedState={{ kind: "loading" }} />;
  }
  return children;
}

export function AppBar({
  links,
  active,
}: Readonly<{ links: readonly WorkspaceLink[]; active?: string }>) {
  const { signOut } = useCentreSuccessAuthentication();
  return (
    <header className="app-bar">
      <div className="app-bar__inner">
        <Link className="app-bar__brand" href="/">
          Bright Steps
          <span>Centre Success</span>
        </Link>
        {links.length ? (
          <nav className="app-nav" aria-label="Centre Success workspaces">
            {links.map((link) => (
              <Link
                key={link.route}
                href={link.route}
                {...(active === link.route ? { "aria-current": "page" as const } : {})}
              >
                {link.label}
              </Link>
            ))}
          </nav>
        ) : null}
        <div className="app-bar__account">
          <button className="app-bar__sign-out" type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </div>
      </div>
    </header>
  );
}

/**
 * Loads the capability-derived destinations for the signed-in principal.
 *
 * Navigation is presentation, so a denial or an outage is never surfaced as an
 * error: the bar simply falls back to the Daily Success baseline. Showing
 * fewer links than a principal holds is a cosmetic loss; showing one they do
 * not hold would be a defect.
 */
function useAuthorisedNavigation(enabled: boolean): readonly WorkspaceLink[] {
  const client = useAuthenticatedCentreSuccessClient();
  const [links, setLinks] = useState<readonly WorkspaceLink[]>(BASELINE_LINKS);

  useEffect(() => {
    if (!enabled) return;
    let current = true;
    void client.foundation.getAuthorisedNavigationEndpoint().then(
      (value) => {
        if (!current) return;
        const backend = value.links.filter((link) => link.route !== DAILY_SUCCESS_LINK.route);
        setLinks([DAILY_SUCCESS_LINK, ...backend]);
      },
      () => {
        if (!current) return;
        setLinks(BASELINE_LINKS);
      },
    );
    return () => {
      current = false;
    };
  }, [client, enabled]);

  return links;
}

/**
 * Wraps a page in the shared frame. `active` marks the current destination so
 * the location is obvious without a heavy treatment.
 *
 * `links` overrides the backend-derived navigation. Passing an empty array
 * renders no navigation at all, which is how a focused single-task screen
 * (completing a review, verifying remediation) keeps the reader in the task,
 * and it also skips the navigation request entirely.
 */
export function AppShell({
  active,
  links: override,
  children,
}: Readonly<{
  active?: string;
  links?: readonly WorkspaceLink[];
  children: ReactNode;
}>) {
  const authorised = useAuthorisedNavigation(override === undefined);
  const links = useMemo(() => override ?? authorised, [override, authorised]);

  return (
    <div className="app-shell">
      <a className="skip-link" href="#centre-success-main">Skip to main content</a>
      <AppBar links={links} active={active} />
      <main className="app-main" id="centre-success-main">
        {children}
      </main>
    </div>
  );
}
