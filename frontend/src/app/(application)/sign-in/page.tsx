"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { AuthenticationGate } from "@/components/authentication-gate";
import { useCentreSuccessAuthentication } from "@/lib/centre-success-authentication";

export default function SignInPage() {
  const router = useRouter();
  const { state } = useCentreSuccessAuthentication();

  useEffect(() => {
    if (state.kind === "signed-in") {
      router.replace("/");
    }
  }, [router, state.kind]);

  return <AuthenticationGate authenticatedState={{ kind: "loading" }} />;
}
