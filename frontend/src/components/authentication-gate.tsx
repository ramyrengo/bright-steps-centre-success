"use client";

import Link from "next/link";

import { FoundationStatusCard } from "@/components/foundation-status-card";
import { useCentreSuccessAuthentication } from "@/lib/centre-success-authentication";

export type AuthenticatedApplicationState =
  | { kind: "loading" }
  | { kind: "ready"; displayName?: string }
  | { kind: "not-provisioned" }
  | { kind: "denied" }
  | { kind: "unavailable" };

export interface AuthenticationGateProps {
  authenticatedState: AuthenticatedApplicationState;
  onRetry?: () => void;
}

function BrandHeading({ title }: Readonly<{ title: string }>) {
  return (
    <header className="auth-heading">
      <p className="foundation-eyebrow">Bright Steps</p>
      <h1 className="auth-title">{title}</h1>
    </header>
  );
}

function LoadingState({ message }: Readonly<{ message: string }>) {
  return (
    <main className="foundation-shell">
      <section className="auth-panel" aria-labelledby="auth-loading-title">
        <header className="auth-heading">
          <p className="foundation-eyebrow">Bright Steps</p>
          <h1 id="auth-loading-title" className="auth-title">
            Centre Success
          </h1>
        </header>
        <p className="auth-state-message" role="status" aria-live="polite">
          {message}
        </p>
      </section>
    </main>
  );
}

function SignedOutState({
  accountSelectionRequired,
  onSignIn,
}: Readonly<{
  accountSelectionRequired?: boolean;
  onSignIn: () => Promise<void>;
}>) {
  return (
    <main className="foundation-shell">
      <section className="auth-panel" aria-labelledby="signed-out-title">
        <header className="auth-heading">
          <p className="foundation-eyebrow">Bright Steps</p>
          <h1 id="signed-out-title" className="auth-title">
            Centre Success
          </h1>
          <p className="auth-summary">
            {accountSelectionRequired
              ? "Choose your approved Bright Steps company account to continue."
              : "Sign in with your approved Bright Steps company account to continue."}
          </p>
        </header>
        <button
          className="auth-button"
          type="button"
          onClick={() => void onSignIn()}
        >
          {accountSelectionRequired ? "Choose account" : "Sign in"}
        </button>
      </section>
    </main>
  );
}

function AccessMessage({
  title,
  message,
  onRetry,
  onSignOut,
}: Readonly<{
  title: string;
  message: string;
  onRetry?: () => void;
  onSignOut: () => Promise<void>;
}>) {
  return (
    <main className="foundation-shell">
      <section className="auth-panel" aria-labelledby="access-state-title">
        <BrandHeading title="Centre Success" />
        <div className="auth-access-state">
          <h2 id="access-state-title" className="auth-state-title">
            {title}
          </h2>
          <p className="auth-state-message">{message}</p>
          {onRetry ? (
            <button
              className="auth-button auth-button--secondary"
              type="button"
              onClick={onRetry}
            >
              Try again
            </button>
          ) : null}
        </div>
        <button
          className="auth-text-button"
          type="button"
          onClick={() => void onSignOut()}
        >
          Sign out
        </button>
      </section>
    </main>
  );
}

function ReadyState({
  displayName,
  onSignOut,
}: Readonly<{
  displayName?: string;
  onSignOut: () => Promise<void>;
}>) {
  return (
    <main className="foundation-shell">
      <section className="foundation-panel" aria-labelledby="welcome-title">
        <div className="auth-toolbar">
          <p className="foundation-eyebrow">Bright Steps · Centre Success</p>
          <button
            className="auth-text-button"
            type="button"
            onClick={() => void onSignOut()}
          >
            Sign out
          </button>
        </div>

        <header className="foundation-header">
          <h1 id="welcome-title" className="foundation-title">
            Welcome{displayName ? `, ${displayName}` : ""}
          </h1>
          <p className="foundation-summary">
            Your secure Centre Success foundation is ready.
          </p>
        </header>

        <section className="foundation-status" aria-labelledby="access-title">
          <h2 id="access-title" className="visually-hidden">
            Application connection status
          </h2>
          <div className="foundation-status__grid foundation-status__grid--auth">
            <FoundationStatusCard label="Authentication" status="Connected" />
            <FoundationStatusCard label="Centre Success" status="Ready" />
          </div>
        </section>

        <nav className="workspace-links" aria-label="Choose a Centre Success workspace">
          <Link href="/area-manager"><strong>Area Manager</strong><span>Quarterly reviews and verification</span></Link>
          <Link href="/centre"><strong>Centre Director</strong><span>Review follow-ups and remediation</span></Link>
          <Link href="/compliance"><strong>Compliance Manager</strong><span>Organisation oversight</span></Link>
        </nav>
      </section>
    </main>
  );
}

export function AuthenticationGate({
  authenticatedState,
  onRetry,
}: AuthenticationGateProps) {
  const { state, signIn, signOut } = useCentreSuccessAuthentication();

  if (state.kind === "loading") {
    return <LoadingState message="Checking your secure session…" />;
  }

  if (state.kind === "signed-out") {
    return <SignedOutState onSignIn={signIn} />;
  }

  if (state.kind === "account-selection-required") {
    return (
      <SignedOutState accountSelectionRequired onSignIn={signIn} />
    );
  }

  if (state.kind === "unavailable") {
    return <LoadingState message="Secure sign-in is temporarily unavailable." />;
  }

  switch (authenticatedState.kind) {
    case "loading":
      return <LoadingState message="Checking your Centre Success access…" />;
    case "not-provisioned":
      return (
        <AccessMessage
          title="Account not provisioned"
          message="Your sign-in is valid, but this account is not connected to Centre Success. Contact an administrator for access."
          onSignOut={signOut}
        />
      );
    case "denied":
      return (
        <AccessMessage
          title="Access denied"
          message="You do not currently have permission to access Centre Success."
          onSignOut={signOut}
        />
      );
    case "unavailable":
      return (
        <AccessMessage
          title="Centre Success is temporarily unavailable"
          message="The application service could not be reached. Please try again."
          onRetry={onRetry}
          onSignOut={signOut}
        />
      );
    case "ready":
      return (
        <ReadyState
          displayName={authenticatedState.displayName}
          onSignOut={signOut}
        />
      );
  }
}
