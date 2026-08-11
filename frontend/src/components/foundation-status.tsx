"use client";

import { useEffect, useState } from "react";
import { FoundationStatusCard } from "@/components/foundation-status-card";
import Client, {
  Local,
  type foundation,
} from "@/lib/client.generated";

type HealthState =
  | { kind: "loading" }
  | { kind: "ready"; health: foundation.FoundationHealthResponse }
  | { kind: "error" };

export function FoundationStatus() {
  const [state, setState] = useState<HealthState>({ kind: "loading" });

  useEffect(() => {
    let isCurrent = true;
    const apiBaseUrl = process.env.NEXT_PUBLIC_ENCORE_API_URL ?? Local;
    const client = new Client(apiBaseUrl);

    void client.foundation.health().then(
      (health) => {
        if (isCurrent) {
          setState({ kind: "ready", health });
        }
      },
      () => {
        if (isCurrent) {
          setState({ kind: "error" });
        }
      },
    );

    return () => {
      isCurrent = false;
    };
  }, []);

  const isReady = state.kind === "ready";
  const isError = state.kind === "error";
  const operationalTone = isError
    ? "negative"
    : isReady
      ? "positive"
      : "informational";

  const statusAnnouncement = isError
    ? "The local foundation API could not be reached. Start Encore and refresh."
    : isReady
      ? "Foundation backend connected and database available."
      : "Checking the foundation backend and database.";

  return (
    <div aria-busy={state.kind === "loading"}>
      <div className="foundation-status__grid">
        <FoundationStatusCard
          label="Backend"
          status={isReady ? "Connected" : isError ? "Unavailable" : "Checking…"}
          tone={operationalTone}
        />
        <FoundationStatusCard
          label="Database"
          status={isReady ? "Available" : isError ? "Unavailable" : "Checking…"}
          tone={operationalTone}
        />
        <FoundationStatusCard
          label="Application"
          status={`Milestone ${isReady ? state.health.milestone : "1"}`}
          tone="informational"
        />
      </div>
      <p
        className={isError ? "foundation-status__message" : "visually-hidden"}
        role="status"
      >
        {statusAnnouncement}
      </p>
    </div>
  );
}
