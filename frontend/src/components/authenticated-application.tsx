"use client";

import { useCallback, useEffect, useState } from "react";

import {
  AuthenticationGate,
  type AuthenticatedApplicationState,
} from "@/components/authentication-gate";
import {
  ErrCode,
  isAPIError,
} from "@/lib/client.generated";
import {
  isAuthenticationFlowTransitionError,
  useCentreSuccessAuthentication,
} from "@/lib/centre-success-authentication";
import { useAuthenticatedCentreSuccessClient } from "@/lib/centre-success-client";

function errorReason(details: unknown): string | undefined {
  if (typeof details !== "object" || details === null) {
    return undefined;
  }

  const reason = Reflect.get(details, "reason");
  return typeof reason === "string" ? reason : undefined;
}

export function accessStateFromError(
  error: unknown,
): AuthenticatedApplicationState {
  if (isAuthenticationFlowTransitionError(error)) {
    return { kind: "loading" };
  }

  if (!isAPIError(error)) {
    return { kind: "unavailable" };
  }

  if (error.code === ErrCode.PermissionDenied) {
    return errorReason(error.details) === "account_not_provisioned"
      ? { kind: "not-provisioned" }
      : { kind: "denied" };
  }

  if (error.code === ErrCode.Unauthenticated) {
    return { kind: "denied" };
  }

  return { kind: "unavailable" };
}

function objectProperty(
  value: unknown,
  property: string,
): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }

  const propertyValue = Reflect.get(value, property);
  return typeof propertyValue === "object" && propertyValue !== null
    ? (propertyValue as Record<string, unknown>)
    : undefined;
}

export function accessStateFromResponse(
  response: unknown,
): AuthenticatedApplicationState {
  if (typeof response !== "object" || response === null) {
    return { kind: "unavailable" };
  }

  const provisioningStatus = Reflect.get(response, "provisioningStatus");
  if (provisioningStatus === "not_provisioned") {
    return { kind: "not-provisioned" };
  }

  if (provisioningStatus !== "provisioned") {
    return { kind: "unavailable" };
  }

  const principal = objectProperty(response, "principal");
  const principalId = principal?.id;
  const displayName = principal?.displayName;
  const activeOrganisation = objectProperty(response, "activeOrganisation");
  const activeOrganisationId = activeOrganisation?.id;
  const activeOrganisationName = activeOrganisation?.name;
  if (
    typeof principalId !== "string" ||
    !principalId.trim() ||
    typeof displayName !== "string" ||
    !displayName.trim() ||
    typeof activeOrganisationId !== "string" ||
    !activeOrganisationId.trim() ||
    typeof activeOrganisationName !== "string" ||
    !activeOrganisationName.trim()
  ) {
    return { kind: "unavailable" };
  }

  return {
    kind: "ready",
    displayName,
  };
}

function AuthenticatedAccess() {
  const client = useAuthenticatedCentreSuccessClient();
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<AuthenticatedApplicationState>({
    kind: "loading",
  });

  useEffect(() => {
    let isCurrent = true;

    void client.foundation.me().then(
      (response) => {
        if (isCurrent) {
          setState(accessStateFromResponse(response));
        }
      },
      (error: unknown) => {
        if (isCurrent) {
          setState(accessStateFromError(error));
        }
      },
    );

    return () => {
      isCurrent = false;
    };
  }, [attempt, client]);

  const retry = useCallback(() => {
    setState({ kind: "loading" });
    setAttempt((current) => current + 1);
  }, []);

  return <AuthenticationGate authenticatedState={state} onRetry={retry} />;
}

export function AuthenticatedApplication() {
  const { state } = useCentreSuccessAuthentication();

  if (state.kind !== "signed-in") {
    return <AuthenticationGate authenticatedState={{ kind: "loading" }} />;
  }

  return <AuthenticatedAccess key={state.accountKey} />;
}
