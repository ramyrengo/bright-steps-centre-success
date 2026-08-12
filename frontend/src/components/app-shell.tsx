"use client";

import Link from "next/link";
import { useMemo, useSyncExternalStore, type ReactNode } from "react";

import { useCentreSuccessAuthentication } from "../lib/centre-success-authentication";
import { AuthenticationGate } from "./authentication-gate";

/**
 * The Centre Success application frame.
 *
 * Navigation is role-aware, and the roles come from the backend: Daily Success
 * already returns the capability-derived workspace links for the signed-in
 * principal, and it caches them here for the session. A destination the
 * principal is not authorised for is never rendered, and nothing is inferred
 * from a role name in the browser. Until those links are known, the shell shows
 * only Daily Success, which every authenticated principal can reach.
 *
 * Frontend visibility is presentation only. Every destination reauthorises.
 */

export const NAVIGATION_SESSION_KEY = "centre-success.workspace-links";

export interface WorkspaceLink {
  label: string;
  route: string;
}

/** Persisted by Daily Success so the rest of the product can show the same nav. */
export function storeAuthorisedNavigation(
  links: readonly WorkspaceLink[],
  storage: Pick<Storage, "setItem"> | undefined = typeof window === "undefined"
    ? undefined
    : window.sessionStorage,
): void {
  storage?.setItem(NAVIGATION_SESSION_KEY, JSON.stringify(links));
}

export function readAuthorisedNavigation(
  storage: Pick<Storage, "getItem"> | undefined,
): WorkspaceLink[] {
  const raw = storage?.getItem(NAVIGATION_SESSION_KEY);
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) =>
      entry &&
      typeof entry === "object" &&
      typeof (entry as WorkspaceLink).label === "string" &&
      typeof (entry as WorkspaceLink).route === "string" &&
      (entry as WorkspaceLink).route.startsWith("/")
        ? [{ label: (entry as WorkspaceLink).label, route: (entry as WorkspaceLink).route }]
        : [],
    );
  } catch {
    return [];
  }
}

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
 * Wraps a page in the shared frame. `active` marks the current destination so
 * the location is obvious without a heavy treatment.
 */
const NO_LINKS: WorkspaceLink[] = [];
let cachedRaw: string | null = null;
let cachedLinks: WorkspaceLink[] = NO_LINKS;

function subscribeToNavigation(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Returns a stable reference so React can compare snapshots safely. */
function navigationSnapshot(): WorkspaceLink[] {
  const raw = window.sessionStorage.getItem(NAVIGATION_SESSION_KEY);
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedLinks = readAuthorisedNavigation(window.sessionStorage);
  }
  return cachedLinks;
}

function serverNavigationSnapshot(): WorkspaceLink[] {
  return NO_LINKS;
}

/**
 * Wraps a page in the shared frame. `active` marks the current destination so
 * the location is obvious without a heavy treatment.
 *
 * `links` overrides the session-derived navigation. Passing an empty array
 * renders no navigation at all, which is how a focused single-task screen
 * (completing a review, verifying remediation) keeps the reader in the task.
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
  const stored = useSyncExternalStore(
    subscribeToNavigation,
    navigationSnapshot,
    serverNavigationSnapshot,
  );
  const links = useMemo(
    () =>
      override ??
      (stored.some((link) => link.route === "/")
        ? stored
        : [{ label: "Daily Success", route: "/" }, ...stored]),
    [override, stored],
  );

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
