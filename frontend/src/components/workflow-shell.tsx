"use client";

import type { ReactNode } from "react";

import { AppShell, BusinessWorkspaceGate } from "./app-shell";
import {
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PageHeader,
  StatusBadge,
  formatDate,
  type Tone,
} from "./design-system";

/**
 * Milestone 2B and People & Access workspace frame.
 *
 * This is now a thin adapter over the shared design system. Keeping the
 * original prop shape means the existing workspaces adopt the Bright Steps
 * Greenhouse language, the shared application shell and the shared state
 * primitives without any call site changing, and without touching a single
 * line of their business logic.
 *
 * Re-exported here so existing imports keep working from one place.
 */
export { BusinessWorkspaceGate, formatDate };

export function WorkflowShell({
  eyebrow,
  title,
  summary,
  workspaceLinks,
  children,
}: Readonly<{
  eyebrow: string;
  title: string;
  summary: string;
  /**
   * Omit to use the capability-derived navigation the backend authorised.
   * Pass an empty array on a focused single-task screen to hide navigation
   * entirely and keep the reader in the task.
   */
  workspaceLinks?: readonly { href: string; label: string }[];
  children: ReactNode;
}>) {
  const links = workspaceLinks?.map((link) => ({
    label: link.label,
    route: link.href,
  }));
  return (
    <AppShell links={links}>
      <PageHeader eyebrow={eyebrow} title={title} summary={summary} />
      {children}
    </AppShell>
  );
}

/**
 * Maps the three legacy workflow states onto the shared primitives. The
 * loading state keeps its `role="status"` announcement so assistive
 * technology hears the same message it always has.
 */
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
  if (kind === "loading") {
    return <LoadingSkeleton label={`${title}. ${message}`} />;
  }
  if (kind === "empty") {
    return <EmptyState title={title} message={message} />;
  }
  return <ErrorState title={title} message={message} onRetry={onRetry} />;
}

export function StatusPill({
  children,
  tone = "neutral",
}: Readonly<{ children: ReactNode; tone?: Tone }>) {
  return <StatusBadge tone={tone}>{children}</StatusBadge>;
}
