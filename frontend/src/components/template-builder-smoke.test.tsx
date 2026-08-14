import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ signOut: vi.fn(() => Promise.resolve()) }));
const navigationMocks = vi.hoisted(() => ({ getAuthorisedNavigationEndpoint: vi.fn() }));
const routerMocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

vi.mock("../lib/centre-success-authentication", () => ({
  useCentreSuccessAuthentication: () => ({
    state: { kind: "signed-in", accountKey: "builder-smoke" },
    signOut: authMocks.signOut,
  }),
}));
vi.mock("../lib/centre-success-client", () => ({
  useAuthenticatedCentreSuccessClient: () => ({
    foundation: {
      getAuthorisedNavigationEndpoint: navigationMocks.getAuthorisedNavigationEndpoint,
    },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => routerMocks }));

import { TemplateEditor } from "./template-editor";
import { TemplateLibraryWorkspace } from "./template-library";
import { TemplatePreview } from "./template-preview";
import {
  countQuestions,
  dueTimeLabel,
  type AssignmentOptions,
  type AssignmentSummary,
  type CreateDraftResult,
  type PublishResult,
  type RetireResult,
  type SaveDraftResult,
  type TemplateBuilderGateway,
  type TemplateDraft,
  type TemplateLibrary,
  type TemplateSummary,
  type TemplateVersion,
  type TemplateWorkspace,
  type VersionHistoryEntry,
} from "./template-builder-contract";

/**
 * End-to-end smoke test: create → edit → preview → publish → immutable history.
 *
 * It drives the real route components through one in-memory gateway that
 * behaves the way the backend is asked to behave in
 * `docs/TEMPLATE_BUILDER_FRONTEND_CONTRACT.md` — including the two rules that
 * are easy to get wrong: a published version is immutable, and publishing the
 * same version twice returns `ALREADY_PUBLISHED` rather than publishing twice.
 *
 * There is no browser-driver framework in this repository, so "end to end" here
 * means every builder surface in one run against one consistent store, not a
 * real browser. That is stated plainly rather than implied.
 */

/* ------------------------------------------------------------------ *
 * An in-memory backend that enforces the contract's own rules
 * ------------------------------------------------------------------ */

interface StoredVersion {
  versionId: string;
  versionLabel: string;
  ordinal: number;
  lifecycle: "DRAFT" | "PUBLISHED" | "RETIRED";
  body: TemplateDraft;
  publishedLocalTime?: string;
  assignmentDescription?: string;
  scheduleDueLocalTime?: string;
}

const TIME_ZONE_NOTE = "in each centre's own local time";

const OPTIONS: AssignmentOptions = {
  centres: [
    { centreId: "c-1", centreName: "Ashgrove Quality Centre", timeZoneLabel: "Brisbane time" },
    { centreId: "c-2", centreName: "Newstead Test Centre", timeZoneLabel: "Brisbane time" },
  ],
  portfolioAvailable: true,
  portfolioCentreCount: 2,
};

function createStore() {
  const versions = new Map<string, StoredVersion>();
  let templateId: string | undefined;
  let templateName = "";
  let counter = 0;
  const publishCalls: unknown[] = [];

  function nextVersion(body: TemplateDraft, ordinal: number): StoredVersion {
    counter += 1;
    return {
      versionId: `version-${counter}`,
      versionLabel: `Version ${ordinal}`,
      ordinal,
      lifecycle: "DRAFT",
      body,
    };
  }

  function ordered(): StoredVersion[] {
    return [...versions.values()].sort((a, b) => b.ordinal - a.ordinal);
  }

  function history(): VersionHistoryEntry[] {
    return ordered().map((version) => ({
      versionId: version.versionId,
      versionLabel: version.versionLabel,
      lifecycle: version.lifecycle,
      eventLabel:
        version.lifecycle === "DRAFT"
          ? "Draft started 13 Aug 2026"
          : `Published ${version.publishedLocalTime}`,
      eventBy: "Test Area Manager",
      current: version.lifecycle === "PUBLISHED",
    }));
  }

  function present(version: StoredVersion): TemplateVersion {
    if (version.lifecycle === "DRAFT") {
      return {
        versionId: version.versionId,
        versionLabel: version.versionLabel,
        lifecycle: "DRAFT",
        draft: version.body,
        canEdit: true,
        canPublish: true,
      };
    }
    // A published version carries no draft and no edit authority at all: the
    // store cannot hand the UI something it could edit by mistake.
    return {
      versionId: version.versionId,
      versionLabel: version.versionLabel,
      lifecycle: "PUBLISHED",
      content: version.body,
      publishedLocalTime: version.publishedLocalTime ?? "",
      publishedBy: "Test Area Manager",
      assignment: {
        scope: "CENTRES",
        description: version.assignmentDescription ?? "",
        centreNames: [version.assignmentDescription ?? ""],
      },
      schedule: {
        recurrence: "DAILY",
        dueLocalTime: version.scheduleDueLocalTime ?? "",
        timeZoneNote: TIME_ZONE_NOTE,
      },
      canCreateDraft: true,
      canRetire: true,
    };
  }

  function workspaceFor(version: StoredVersion): TemplateWorkspace {
    return {
      templateId: templateId!,
      templateName,
      version: present(version),
      history: history(),
    };
  }

  /** The version a bare template route opens on: the draft if one exists. */
  function currentVersion(): StoredVersion {
    return ordered().find((version) => version.lifecycle === "DRAFT") ?? ordered()[0]!;
  }

  function summary(): TemplateSummary {
    const version = currentVersion();
    return {
      templateId: templateId!,
      name: templateName,
      lifecycle: version.lifecycle,
      versionLabel: version.versionLabel,
      questionCount: countQuestions(version.body),
      stateLabel:
        version.lifecycle === "DRAFT"
          ? "Draft started 13 Aug 2026"
          : `Published ${version.publishedLocalTime}`,
      ...(version.assignmentDescription
        ? { assignmentDescription: version.assignmentDescription }
        : {}),
      ...(version.scheduleDueLocalTime
        ? { scheduleDescription: `Every day by ${version.scheduleDueLocalTime}` }
        : {}),
    };
  }

  const gateway: TemplateBuilderGateway = {
    loadLibrary: (): Promise<TemplateLibrary> =>
      Promise.resolve({
        status: "ready",
        templates: templateId ? [summary()] : [],
        canCreate: true,
      }),

    createTemplate: ({ name }): Promise<CreateDraftResult> => {
      templateId = "template-1";
      templateName = name;
      const version = nextVersion({ name, sections: [] }, 1);
      versions.set(version.versionId, version);
      return Promise.resolve({ templateId, versionId: version.versionId });
    },

    loadTemplate: () => Promise.resolve(workspaceFor(currentVersion())),

    loadVersion: (versionId) => {
      const version = versions.get(versionId);
      return version
        ? Promise.resolve(workspaceFor(version))
        : Promise.reject(new Error("unknown version"));
    },

    saveDraft: ({ versionId, draft }): Promise<SaveDraftResult> => {
      const version = versions.get(versionId);
      if (!version) return Promise.reject(new Error("unknown version"));
      // The rule the whole slice turns on. A published version is immutable,
      // so the store refuses rather than trusting the UI to have hidden the
      // control.
      if (version.lifecycle !== "DRAFT") {
        return Promise.reject(new Error("a published version cannot be changed"));
      }
      version.body = draft;
      templateName = draft.name;
      return Promise.resolve({ lastSavedLocalTime: "2:14pm" });
    },

    loadAssignmentOptions: () => Promise.resolve(OPTIONS),

    publishVersion: (input): Promise<PublishResult> => {
      publishCalls.push(input);
      const version = versions.get(input.versionId);
      if (!version) return Promise.reject(new Error("unknown version"));

      if (version.lifecycle !== "DRAFT") {
        // The response-loss case: the version already went live, so a retry is
        // a success, not a second publish.
        return Promise.resolve({
          outcome: "ALREADY_PUBLISHED",
          versionId: version.versionId,
          versionLabel: version.versionLabel,
          publishedLocalTime: version.publishedLocalTime ?? "",
          publishedByRequester: true,
        });
      }

      const description =
        input.assignment.scope === "PORTFOLIO"
          ? "Every centre in your portfolio"
          : input.assignment.centreIds
              .map((id) => OPTIONS.centres.find((centre) => centre.centreId === id)?.centreName)
              .filter(Boolean)
              .join(", ");

      // The portfolio branch carries no centre list back either: the count is
      // the backend's, and there is nowhere for a client list to travel.
      const assignment: AssignmentSummary =
        input.assignment.scope === "PORTFOLIO"
          ? { scope: "PORTFOLIO", description, centreCount: OPTIONS.portfolioCentreCount }
          : { scope: "CENTRES", description, centreNames: [description] };

      version.lifecycle = "PUBLISHED";
      version.publishedLocalTime = "13 Aug 2026, 2:20pm";
      version.assignmentDescription = description;
      version.scheduleDueLocalTime = dueTimeLabel(input.schedule.dueTime);

      return Promise.resolve({
        outcome: "PUBLISHED",
        versionId: version.versionId,
        versionLabel: version.versionLabel,
        publishedLocalTime: version.publishedLocalTime,
        assignment,
        schedule: {
          recurrence: "DAILY",
          dueLocalTime: version.scheduleDueLocalTime,
          timeZoneNote: TIME_ZONE_NOTE,
        },
      });
    },

    createDraftFrom: ({ versionId }): Promise<CreateDraftResult> => {
      const source = versions.get(versionId);
      if (!source) return Promise.reject(new Error("unknown version"));
      // A copy. The source version is never touched, which is what keeps the
      // lineage of anything already recorded against it stable.
      const copy = nextVersion(
        JSON.parse(JSON.stringify(source.body)) as TemplateDraft,
        source.ordinal + 1,
      );
      versions.set(copy.versionId, copy);
      return Promise.resolve({ templateId: templateId!, versionId: copy.versionId });
    },

    retireVersion: (): Promise<RetireResult> =>
      Promise.resolve({ retiredLocalTime: "13 Aug 2026, 4:00pm" }),
  };

  return { gateway, publishCalls, versions, currentVersion };
}

beforeEach(() => {
  navigationMocks.getAuthorisedNavigationEndpoint.mockResolvedValue({ links: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ------------------------------------------------------------------ *
 * The path
 * ------------------------------------------------------------------ */

describe("create → publish → preview", () => {
  test("an Area Manager builds, previews, publishes, and cannot then change it", async () => {
    const store = createStore();
    const { gateway } = store;

    /* --- 1. An empty library invites the first template ------------- */

    const library = render(<TemplateLibraryWorkspace gateway={gateway} />);
    expect(await screen.findByText("No templates yet")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "New template" }));
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Staging test template" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Start draft" }));

    await waitFor(() =>
      expect(routerMocks.push).toHaveBeenCalledWith("/standards/templates/template-1"),
    );
    library.unmount();

    /* --- 2. The draft opens as an editor ---------------------------- */

    const editor = render(<TemplateEditor templateId="template-1" gateway={gateway} />);
    await screen.findByRole("button", { name: "Add section" });

    // A brand-new template cannot be published, and says why.
    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Add at least one section.")).toBeTruthy();

    /* --- 3. A section, two questions, one of them a choice ---------- */

    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    fireEvent.change(screen.getByLabelText("Section 1 name"), {
      target: { value: "Test section one" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Add question/ }));
    fireEvent.change(screen.getByLabelText("Question 1"), {
      target: { value: "Test question one — staging only" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Add question/ }));
    fireEvent.change(screen.getByLabelText("Question 2"), {
      target: { value: "Test question two — staging only" },
    });
    fireEvent.change(screen.getAllByLabelText("Answer type")[1]!, {
      target: { value: "SINGLE_SELECT" },
    });
    fireEvent.change(screen.getByPlaceholderText("Option 1"), {
      target: { value: "First test option" },
    });
    fireEvent.change(screen.getByPlaceholderText("Option 2"), {
      target: { value: "Second test option" },
    });

    // Optional, so the preview can prove a non-required question does not
    // hold the flow.
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Must be answered/i })[1]!);

    /* --- 4. Reordering is by button and is announced ---------------- */

    fireEvent.click(
      screen.getByRole("button", { name: /Move Question 2 in Test section one up/i }),
    );
    expect(
      screen.getByText(/Question 2 moved up\. Now question 1 of 2 in Test section one\./),
    ).toBeTruthy();

    /* --- 5. Saving, and then previewing what was saved -------------- */

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Saved 2:14pm")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Preview on a phone" }));
    await waitFor(() =>
      expect(routerMocks.push).toHaveBeenCalledWith("/standards/templates/template-1/preview"),
    );

    const saved = store.currentVersion();
    expect(saved.body.sections[0]!.questions.map((item) => item.wording)).toEqual([
      "Test question two — staging only",
      "Test question one — staging only",
    ]);
    editor.unmount();

    /* --- 6. The preview walks the educator flow and records nothing -- */

    const preview = render(<TemplatePreview templateId="template-1" gateway={gateway} />);
    expect(await screen.findByText("Question 1 of 2")).toBeTruthy();

    // The reordered question really is first.
    expect(screen.getByText("Test question two — staging only (optional)")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "First test option" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Question 2 of 2")).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish preview" }));

    expect(screen.getByText("End of the preview")).toBeTruthy();
    expect(screen.getByText(/Nothing was recorded and no centre was contacted/)).toBeTruthy();
    // A preview publishes nothing: the version is still a draft.
    expect(store.currentVersion().lifecycle).toBe("DRAFT");
    preview.unmount();

    /* --- 7. Publishing to one authorised centre --------------------- */

    const publishing = render(<TemplateEditor templateId="template-1" gateway={gateway} />);
    await screen.findByRole("button", { name: "Publish" });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await screen.findByText("Ashgrove Quality Centre");
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /Ashgrove Quality Centre/ }));
    fireEvent.change(within(dialog).getByLabelText("Due by"), { target: { value: "07:30" } });
    // Scoped to the dialog: the editor's own Publish button is still behind it,
    // and an unscoped query would be ambiguous rather than wrong-but-passing.
    fireEvent.click(within(dialog).getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Published")).toBeTruthy();
    expect(screen.getByText(/can no longer be changed/)).toBeTruthy();
    expect(store.publishCalls).toHaveLength(1);
    expect(store.publishCalls[0]).toMatchObject({
      assignment: { scope: "CENTRES", centreIds: ["c-1"] },
      schedule: { recurrence: "DAILY", dueTime: "07:30" },
    });

    /* --- 8. The published version is a record, not an editor -------- */

    fireEvent.click(screen.getByRole("button", { name: "View published version" }));

    // Scoped to the questions: the page summary says the same thing, and the
    // assertion that matters is that immutability is stated where the edit
    // controls used to be.
    const record = await screen.findByRole("region", { name: "Questions" });
    expect(within(record).getByText(/This version cannot be changed/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add section" })).toBeNull();
    expect(screen.queryByLabelText("Answer type")).toBeNull();
    expect(screen.getByText("Ashgrove Quality Centre")).toBeTruthy();
    expect(screen.getByText(/7:30am · in each centre's own local time/)).toBeTruthy();

    /* --- 9. Changing it means a new draft; version 1 stays put ------ */

    fireEvent.click(screen.getByRole("button", { name: "Create a new draft" }));
    await screen.findByRole("button", { name: "Save draft" });

    // The label appears in both the page heading and the history row.
    expect(screen.getAllByText("Version 2").length).toBeGreaterThan(0);
    // The published version is still there, still published, still in use.
    // Read as rows: every label also appears in that row's own Open button
    // ("Open Version 1"), so loose text would be ambiguous here.
    const rows = within(
      screen.getByRole("region", { name: "Version history" }),
    ).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Version 2"),
      expect.stringContaining("Version 1"),
    ]);
    expect(within(rows[1]!).getByText("In use")).toBeTruthy();
    expect([...store.versions.values()].filter((v) => v.lifecycle === "PUBLISHED")).toHaveLength(1);

    publishing.unmount();
  });

  test("publishing the same version twice does not publish it twice", async () => {
    const store = createStore();
    const { gateway } = store;

    await gateway.createTemplate({ name: "Staging test template" });
    const versionId = store.currentVersion().versionId;
    await gateway.saveDraft({
      versionId,
      draft: {
        name: "Staging test template",
        sections: [
          {
            sectionId: "s-1",
            title: "Test section one",
            questions: [
              {
                questionId: "q-1",
                wording: "Test question one",
                required: true,
                type: "YES_NO",
              },
            ],
          },
        ],
      },
    });

    const first = await gateway.publishVersion({
      versionId,
      assignment: { scope: "CENTRES", centreIds: ["c-1"] },
      schedule: { recurrence: "DAILY", dueTime: "09:00" },
    });
    expect(first.outcome).toBe("PUBLISHED");

    // The retry an Area Manager makes when the first response is lost.
    const second = await gateway.publishVersion({
      versionId,
      assignment: { scope: "CENTRES", centreIds: ["c-1"] },
      schedule: { recurrence: "DAILY", dueTime: "09:00" },
    });
    expect(second.outcome).toBe("ALREADY_PUBLISHED");
    expect([...store.versions.values()].filter((v) => v.lifecycle === "PUBLISHED")).toHaveLength(1);
  });

  test("a published version refuses a save even if one is somehow attempted", async () => {
    const store = createStore();
    const { gateway } = store;

    await gateway.createTemplate({ name: "Staging test template" });
    const versionId = store.currentVersion().versionId;
    await gateway.publishVersion({
      versionId,
      assignment: { scope: "PORTFOLIO" },
      schedule: { recurrence: "DAILY", dueTime: "09:00" },
    });

    await expect(
      gateway.saveDraft({ versionId, draft: { name: "Rewritten", sections: [] } }),
    ).rejects.toThrow(/cannot be changed/);
  });
});
