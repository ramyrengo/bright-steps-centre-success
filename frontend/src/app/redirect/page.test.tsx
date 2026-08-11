import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, test, vi } from "vitest";

const bridgeMocks = vi.hoisted(() => ({
  broadcastResponseToMainFrame: vi.fn(() => Promise.resolve()),
  msalProvider: vi.fn(({ children }: { children: ReactNode }) => children),
}));

vi.mock("@azure/msal-browser/redirect-bridge", () => ({
  broadcastResponseToMainFrame: bridgeMocks.broadcastResponseToMainFrame,
}));

vi.mock("@azure/msal-react", () => ({
  MsalProvider: bridgeMocks.msalProvider,
}));

import RedirectPage from "@/app/redirect/page";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

test("broadcasts the redirect response exactly once without an MSAL provider wrapper", async () => {
  render(<RedirectPage />);

  expect(
    screen.getByRole("status", { name: "" }).textContent,
  ).toContain("Completing secure sign-in");
  await waitFor(() =>
    expect(bridgeMocks.broadcastResponseToMainFrame).toHaveBeenCalledOnce(),
  );
  expect(bridgeMocks.msalProvider).not.toHaveBeenCalled();
});
