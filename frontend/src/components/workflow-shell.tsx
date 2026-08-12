"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";

import { AuthenticationGate } from "./authentication-gate";
import { useCentreSuccessAuthentication } from "../lib/centre-success-authentication";

export function BusinessWorkspaceGate({ children }: Readonly<{ children: ReactNode }>) {
  const { state } = useCentreSuccessAuthentication();
  if (state.kind !== "signed-in") {
    return <AuthenticationGate authenticatedState={{ kind: "loading" }} />;
  }
  return children;
}

export function WorkflowShell({
  eyebrow,
  title,
  summary,
  children,
}: Readonly<{
  eyebrow: string;
  title: string;
  summary: string;
  children: ReactNode;
}>) {
  const { signOut } = useCentreSuccessAuthentication();
  return (
    <main className="workflow-shell">
      <header className="workflow-topbar">
        <Link className="workflow-brand" href="/">Bright Steps · Centre Success</Link>
        <nav aria-label="Centre Success workspaces" className="workflow-nav">
          <Link href="/area-manager">Area Manager</Link>
          <Link href="/centre">Centre</Link>
          <Link href="/compliance">Compliance</Link>
          <Link href="/admin/people">People &amp; Access</Link>
        </nav>
        <button className="auth-text-button" type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </header>
      <section className="workflow-page">
        <header className="workflow-heading">
          <p className="foundation-eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{summary}</p>
        </header>
        {children}
      </section>
    </main>
  );
}

export function WorkflowState({
  kind,
  title,
  message,
  onRetry,
}: Readonly<{
  kind: "loading" | "empty" | "error";
  title: string;
  message: string;
  onRetry?: () => void;
}>) {
  const titleId = useId();
  return (
    <section
      className={`workflow-state workflow-state--${kind}`}
      aria-labelledby={titleId}
      {...(kind === "loading" ? { role: "status", "aria-live": "polite" as const } : {})}
    >
      <h2 id={titleId}>{title}</h2>
      <p>{message}</p>
      {onRetry ? (
        <button className="workflow-button workflow-button--secondary" type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </section>
  );
}

export function StatusPill({ children, tone = "neutral" }: Readonly<{
  children: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "critical";
}>) {
  return <span className="status-pill" data-tone={tone}>{children}</span>;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en-AU", { dateStyle: "medium" }).format(new Date(value));
}
