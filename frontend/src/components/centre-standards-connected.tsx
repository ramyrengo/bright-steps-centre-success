"use client";

import { useMemo } from "react";

import { useAuthenticatedCentreSuccessClient } from "@/lib/centre-success-client";

import { CentreStandardsCheck } from "./centre-standards-check";
import { createCentreStandardsGateway } from "./centre-standards-gateway";
import { CentreStandardsWorkspace } from "./centre-standards-workspace";

/**
 * Binds the Centre Standards screens to the real backend.
 *
 * The screens take their gateway as a prop and default to one that refuses, so
 * they can be rendered and tested without a backend or an authentication
 * provider. That default is kept: it is what every existing test relies on, and
 * a screen that refuses honestly is the right behaviour for a caller that has
 * not supplied a source. Connecting is therefore additive — these wrappers hold
 * the hook, and the screens stay pure.
 *
 * The gateway is memoised because both screens list it as an effect dependency.
 * A fresh object per render would reload the workspace forever.
 */
function useCentreStandardsGateway() {
  const client = useAuthenticatedCentreSuccessClient();
  return useMemo(() => createCentreStandardsGateway(client.foundation), [client]);
}

export function ConnectedCentreStandardsWorkspace() {
  const gateway = useCentreStandardsGateway();
  return <CentreStandardsWorkspace gateway={gateway} />;
}

export function ConnectedCentreStandardsCheck({
  occurrenceId,
}: Readonly<{ occurrenceId: string }>) {
  const gateway = useCentreStandardsGateway();
  return <CentreStandardsCheck occurrenceId={occurrenceId} gateway={gateway} />;
}
