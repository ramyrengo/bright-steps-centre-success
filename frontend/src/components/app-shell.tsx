"use client";

import Link from "next/link";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { useCentreSuccessAuthentication } from "../lib/centre-success-authentication";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import { AuthenticationGate } from "./authentication-gate";
import { Dialog } from "./design-system";

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

/**
 * Unsaved-work protection for the shell's own leave paths.
 *
 * `beforeunload` only covers a real page unload. The focused single-task shell
 * still offers the brand link and sign out, both of which discard unsaved work
 * through client-side navigation without the browser ever asking. A screen
 * holding answers registers a blocker here, and the shell asks before it acts.
 *
 * This is deliberately not a router framework: it guards the two leave paths
 * the shell itself owns, and nothing else.
 */
type LeaveBlocker = () => boolean;

/**
 * A held departure. Navigation is resolved by rendering a real link in the
 * confirmation rather than pushing through a router, which keeps the shell
 * free of router coupling and leaves the browser to do the navigating.
 */
export type PendingLeave =
  | { kind: "navigate"; href: string }
  | { kind: "run"; run: () => void };

interface UnsavedWorkApi {
  register: (blocker: LeaveBlocker | null) => void;
}

const UnsavedWorkContext = createContext<UnsavedWorkApi | null>(null);

/** Registers a predicate that reports whether leaving would discard work. */
export function useBlockLeaveWhen(shouldBlock: boolean): void {
  const api = useContext(UnsavedWorkContext);

  // The blocker closes over `shouldBlock` directly and is re-registered whenever
  // it changes.
  //
  // An earlier version kept one stable closure reading through a ref, to avoid
  // re-registering on every keystroke. That made the guard lag its own state by
  // an effect flush: a check that had just been completed could still block sign
  // out, because the ref still said "blocked" when the click landed. It passed
  // locally, where the effect won the race, and failed on slower CI hardware —
  // which is the worst shape for this bug, since the surface it protects is a
  // confirmation dialog a user sees only when something has gone wrong.
  //
  // Re-registering is a single function assignment. Correctness is worth more
  // than avoiding it.
  useEffect(() => {
    if (!api) return;
    api.register(() => shouldBlock);
    return () => api.register(null);
  }, [api, shouldBlock]);
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
  onLeave,
}: Readonly<{
  links: readonly WorkspaceLink[];
  active?: string;
  /** Returns true when the shell has taken responsibility for the departure. */
  onLeave?: (pending: PendingLeave) => boolean;
}>) {
  const { signOut } = useCentreSuccessAuthentication();
  return (
    <header className="app-bar">
      <div className="app-bar__inner">
        <Link
          className="app-bar__brand"
          href="/"
          onClick={(event) => {
            if (onLeave?.({ kind: "navigate", href: "/" })) event.preventDefault();
          }}
        >
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
          <button
            className="app-bar__sign-out"
            type="button"
            onClick={(event) => {
              if (onLeave?.({ kind: "run", run: () => void signOut() })) {
                event.preventDefault();
                return;
              }
              void signOut();
            }}
          >
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

  const blocker = useRef<LeaveBlocker | null>(null);
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);
  const unsavedWork = useMemo<UnsavedWorkApi>(
    () => ({ register: (next) => { blocker.current = next; } }),
    [],
  );

  const onLeave = useCallback((pending: PendingLeave) => {
    if (!blocker.current?.()) return false;
    setPendingLeave(pending);
    return true;
  }, []);

  return (
    <UnsavedWorkContext.Provider value={unsavedWork}>
      <div className="app-shell">
        <a className="skip-link" href="#centre-success-main">Skip to main content</a>
        <AppBar links={links} active={active} onLeave={onLeave} />
        <main className="app-main" id="centre-success-main">
          {children}
        </main>
        {pendingLeave ? (
          <Dialog
            title="Leave this check?"
            onDismiss={() => setPendingLeave(null)}
            footer={
              <>
                <button
                  className="button button--secondary"
                  type="button"
                  data-autofocus
                  onClick={() => setPendingLeave(null)}
                >
                  Stay on this check
                </button>
                {pendingLeave.kind === "navigate" ? (
                  <Link className="button" href={pendingLeave.href}>
                    Leave anyway
                  </Link>
                ) : (
                  <button
                    className="button"
                    type="button"
                    onClick={() => {
                      const { run } = pendingLeave;
                      setPendingLeave(null);
                      run();
                    }}
                  >
                    Leave anyway
                  </button>
                )}
              </>
            }
          >
            <p>
              You have answers on this check that have not been submitted. They will be
              lost if you leave now.
            </p>
          </Dialog>
        ) : null}
      </div>
    </UnsavedWorkContext.Provider>
  );
}
