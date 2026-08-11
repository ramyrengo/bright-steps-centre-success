import { afterEach, describe, expect, test, vi } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { foundation } from "@/lib/client.generated";

const clientMocks = vi.hoisted(() => ({
  health: vi.fn(),
}));

vi.mock("@/lib/client.generated", () => ({
  Local: "http://localhost:4000",
  default: class MockClient {
    foundation = { health: clientMocks.health };
  },
}));

import Page from "./page";

afterEach(() => {
  cleanup();
  clientMocks.health.mockReset();
});

describe("foundation page", () => {
  test("renders an accessible loading state", () => {
    clientMocks.health.mockReturnValue(new Promise(() => undefined));

    render(<Page />);

    expect(screen.getByRole("main")).toBeDefined();
    expect(
      screen.getByRole("heading", { level: 1, name: "Centre Success" }),
    ).toBeDefined();
    const statusRegion = screen.getByRole("region", {
      name: "Foundation status",
    });
    expect(statusRegion).toBeDefined();
    expect(screen.getAllByText("Checking…", { exact: true })).toHaveLength(2);
    expect(screen.getByText("Milestone 1", { exact: true })).toBeDefined();

    const announcement = screen.getByRole("status");
    expect(announcement.textContent).toBe(
      "Checking the foundation backend and database.",
    );
    expect(announcement.className).toBe("visually-hidden");
    expect(announcement.parentElement?.getAttribute("aria-busy")).toBe("true");
    expect(statusRegion.querySelectorAll('[aria-hidden="true"]')).toHaveLength(3);
  });

  test("represents a successful backend and database check", async () => {
    const health = {
      status: "operational",
      milestone: "1",
      backend: "connected",
      database: "available",
      checkedAt: "2026-08-11T00:00:00.000Z",
    } satisfies foundation.FoundationHealthResponse;
    clientMocks.health.mockResolvedValue(health);

    render(<Page />);

    expect(await screen.findByText("Connected", { exact: true })).toBeDefined();
    expect(screen.getByText("Available", { exact: true })).toBeDefined();

    const announcement = screen.getByRole("status");
    expect(announcement.textContent).toBe(
      "Foundation backend connected and database available.",
    );
    expect(announcement.className).toBe("visually-hidden");
    expect(announcement.parentElement?.getAttribute("aria-busy")).toBe("false");
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });

  test("shows an accessible generic error without leaking internals", async () => {
    clientMocks.health.mockRejectedValue(
      new Error("synthetic internal connection details"),
    );

    render(<Page />);

    await waitFor(() => {
      expect(screen.getAllByText("Unavailable", { exact: true })).toHaveLength(2);
    });

    const announcement = screen.getByRole("status");
    expect(announcement.textContent).toBe(
      "The local foundation API could not be reached. Start Encore and refresh.",
    );
    expect(announcement.className).toBe("foundation-status__message");
    expect(announcement.parentElement?.getAttribute("aria-busy")).toBe("false");
    expect(
      within(screen.getByRole("region", { name: "Foundation status" })).queryByText(
        "synthetic internal connection details",
      ),
    ).toBeNull();
    expect(screen.getAllByRole("status")).toHaveLength(1);
  });
});
