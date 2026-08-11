"use client";

import { broadcastResponseToMainFrame } from "@azure/msal-browser/redirect-bridge";
import { useEffect } from "react";

export default function RedirectPage() {
  useEffect(() => {
    void broadcastResponseToMainFrame().catch(() => undefined);
  }, []);

  return (
    <main className="foundation-shell">
      <p className="auth-state-message" role="status" aria-live="polite">
        Completing secure sign-in…
      </p>
    </main>
  );
}
