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
  localToday,
  type AssignResult,
  type AssignmentOptions,
  type AssignmentSelection,
  type AssignmentSummary,
  type CreateDraftResult,
  type CreateTemplateResult,
  type PublishResult,
  type RetireResult,
  type SaveDraftResult,
  type ScheduleSelection,
  type ScheduleSummary,
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

/**
 * A version as the store keeps it: permanent, and never written to again.
 *
 * There is no draft member here, because a draft is not a version. It has never
 * been published, so there is nothing permanent to identify: the store holds one
 * persistent draft per template alongside however many versions have been
 * published from it, which is what the backend does.
 */
interface PublishedVersionRecord {
  versionId: string;
  versionLabel: string;
  ordinal: number;
  /** Snapshotted at publish. No later edit to the draft can reach it. */
  content: TemplateDraft;
  publishedLocalTime: string;
  assignment: AssignmentSummary;
  schedule: ScheduleSummary;
}

const TIME_ZONE_NOTE = "in each centre's own local time";
const TEMPLATE_ID = "template-1";
const SAVED_AT = "2:14pm";
const PUBLISHED_AT = "13 Aug 2026, 2:20pm";

const OPTIONS: AssignmentOptions = {
  centres: [
    { centreId: "c-1", centreName: "Ashgrove Quality Centre", timeZoneLabel: "Brisbane time" },
    { centreId: "c-2", centreName: "Newstead Test Centre", timeZoneLabel: "Brisbane time" },
  ],
  portfolioAvailable: true,
  portfolioCentreCount: 2,
};

/** The whole of what the builder can produce: daily, opening before it is due. */
const SCHEDULE: ScheduleSelection = {
  recurrence: "DAILY",
  opensLocalTime: "06:00",
  dueLocalTime: "09:00",
  effectiveFrom: localToday(),
};

/** A draft with something in it, for the paths that do not go through the UI. */
const ONE_QUESTION: TemplateDraft = {
  name: "Staging test template",
  purpose: "Test scaffolding, not a Bright Steps standard",
  sections: [
    {
      sectionId: "s-1",
      title: "Test section one",
      questions: [
        { questionId: "q-1", wording: "Test question one", required: true, type: "YES_NO" },
      ],
    },
  ],
};

/** How an assignment reads once it is published and immutable. */
function summariseAssignment(selection: AssignmentSelection): AssignmentSummary {
  if (selection.scope === "PORTFOLIO") {
    // No centre list travels back either: the size is the backend's, and the
    // browser never supplied one for the store to echo.
    return {
      scope: "PORTFOLIO",
      description: "Every centre in your portfolio",
      ...(OPTIONS.portfolioCentreCount === undefined
        ? {}
        : { centreCount: OPTIONS.portfolioCentreCount }),
    };
  }
  const names = selection.centreIds
    .map((id) => OPTIONS.centres.find((centre) => centre.centreId === id)?.centreName)
    .filter((name): name is string => Boolean(name));
  return { scope: "CENTRES", description: names.join(", "), centreNames: names };
}

function summariseSchedule(selection: ScheduleSelection): ScheduleSummary {
  return {
    recurrence: selection.recurrence,
    dueLocalTime: dueTimeLabel(selection.dueLocalTime),
    opensLocalTime: dueTimeLabel(selection.opensLocalTime),
    timeZoneNote: TIME_ZONE_NOTE,
  };
}

function createStore() {
  let created = false;
  let templateName = "";
  let draftBody: TemplateDraft = { name: "", purpose: "", sections: [] };
  /**
   * The template's optimistic-concurrency token.
   *
   * Every command that changes the template — save, publish, retire — sends the
   * current one back and moves it on. A command still holding a token that has
   * been used is refused rather than applied a second time, which is the whole
   * mechanism behind two Area Managers not overwriting each other.
   */
  let lockVersion = 0;
  let lastSavedLocalTime: string | undefined;
  const published: PublishedVersionRecord[] = [];
  const publishCalls: unknown[] = [];

  function history(): VersionHistoryEntry[] {
    return [
      // The open draft is a row of its own kind: no version identifier to open,
      // and it can never be the one a centre is being asked.
      {
        state: "DRAFT",
        label: "Draft",
        eventLabel: lastSavedLocalTime
          ? `Last changed ${lastSavedLocalTime}`
          : "Draft started 13 Aug 2026",
        eventBy: "Test Area Manager",
      },
      ...[...published].reverse().map(
        (version): VersionHistoryEntry => ({
          state: "PUBLISHED",
          versionId: version.versionId,
          versionLabel: version.versionLabel,
          eventLabel: `Published ${version.publishedLocalTime}`,
          eventBy: "Test Area Manager",
          // The newest published version is the one in operational use.
          current: version.ordinal === published.length,
        }),
      ),
    ];
  }

  /** The draft, carrying the token every command that changes it must send. */
  function draftState(): TemplateVersion {
    return {
      lifecycle: "DRAFT",
      versionLabel: "Draft",
      draft: draftBody,
      lockVersion,
      canEdit: true,
      canPublish: true,
      ...(lastSavedLocalTime ? { lastSavedLocalTime } : {}),
    };
  }

  /**
   * A published version carries no draft, no edit authority and no lock token,
   * so the store cannot hand the UI something it could write to by mistake.
   */
  function publishedState(version: PublishedVersionRecord): TemplateVersion {
    return {
      versionId: version.versionId,
      versionLabel: version.versionLabel,
      lifecycle: "PUBLISHED",
      content: version.content,
      publishedLocalTime: version.publishedLocalTime,
      publishedBy: "Test Area Manager",
      assignment: version.assignment,
      schedule: version.schedule,
      canCreateDraft: true,
      canRetire: true,
    };
  }

  function workspaceFor(version: TemplateVersion): TemplateWorkspace {
    return {
      templateId: TEMPLATE_ID,
      templateName,
      version,
      lockVersion,
      history: history(),
    };
  }

  function newest(): PublishedVersionRecord | undefined {
    return published[published.length - 1];
  }

  function summary(): TemplateSummary {
    const live = newest();
    return {
      templateId: TEMPLATE_ID,
      name: templateName,
      purpose: draftBody.purpose,
      lifecycle: live ? "PUBLISHED" : "DRAFT",
      versionLabel: live ? live.versionLabel : "Draft",
      questionCount: countQuestions(live ? live.content : draftBody),
      stateLabel: live
        ? `Published ${live.publishedLocalTime}`
        : "Draft started 13 Aug 2026",
      ...(live
        ? {
            assignmentDescription: live.assignment.description,
            scheduleDescription: `Every day by ${live.schedule.dueLocalTime}`,
          }
        : {}),
    };
  }

  /** Setting where and when an already-published version runs. */
  const assign = ({
    versionId,
    assignment,
    schedule,
  }: {
    templateId: string;
    versionId: string;
    assignment: AssignmentSelection;
    schedule: ScheduleSelection;
  }): Promise<AssignResult> => {
    const version = published.find((item) => item.versionId === versionId);
    if (!version) {
      return Promise.resolve({
        outcome: "REFUSED",
        reason: "That version could not be found.",
      });
    }
    version.assignment = summariseAssignment(assignment);
    version.schedule = summariseSchedule(schedule);
    return Promise.resolve({
      outcome: "ASSIGNED",
      assignment: version.assignment,
      schedule: version.schedule,
    });
  };

  const gateway: TemplateBuilderGateway = {
    loadLibrary: (): Promise<TemplateLibrary> =>
      Promise.resolve({
        status: "ready",
        templates: created ? [summary()] : [],
        canCreate: true,
      }),

    createTemplate: ({ name, purpose }): Promise<CreateTemplateResult> => {
      created = true;
      templateName = name;
      // A template is created with the one persistent draft it keeps for the
      // whole of its life.
      draftBody = { name, purpose, sections: [] };
      lockVersion = 1;
      return Promise.resolve({ outcome: "CREATED", templateId: TEMPLATE_ID });
    },

    loadTemplate: () => Promise.resolve(workspaceFor(draftState())),

    loadVersion: ({ versionId }) => {
      const version = published.find((item) => item.versionId === versionId);
      return version
        ? Promise.resolve(workspaceFor(publishedState(version)))
        : Promise.reject(new Error("unknown version"));
    },

    saveDraft: ({ lockVersion: token, draft }): Promise<SaveDraftResult> => {
      // The rule the whole slice turns on, applied the way the backend applies
      // it: a token that has been superseded — by another save, or by the
      // publish that snapshotted this draft — is refused rather than written
      // over whoever moved it.
      if (token !== lockVersion) {
        return Promise.reject(new Error("this draft has changed since you opened it"));
      }
      draftBody = draft;
      templateName = draft.name;
      lockVersion += 1;
      lastSavedLocalTime = SAVED_AT;
      return Promise.resolve({ lastSavedLocalTime: SAVED_AT, lockVersion });
    },

    loadAssignmentOptions: () => Promise.resolve(OPTIONS),

    publishVersion: (input): Promise<PublishResult> => {
      publishCalls.push(input);

      if (input.lockVersion !== lockVersion) {
        const live = newest();
        if (live) {
          // The response-loss case: the draft was already snapshotted into a
          // version, so the retry is a success rather than a second publish.
          return Promise.resolve({
            outcome: "ALREADY_PUBLISHED",
            versionId: live.versionId,
            versionLabel: live.versionLabel,
            publishedLocalTime: live.publishedLocalTime,
          });
        }
        return Promise.resolve({
          outcome: "REFUSED",
          reason: "This draft has changed since you opened it.",
        });
      }

      const ordinal = published.length + 1;
      const version: PublishedVersionRecord = {
        versionId: `version-${ordinal}`,
        versionLabel: `Version ${ordinal}`,
        ordinal,
        // A snapshot, not a hand-over. The draft survives publication and is
        // edited on towards the next version, so the content here is deep
        // copied out of reach of anything typed after this moment.
        content: JSON.parse(JSON.stringify(draftBody)) as TemplateDraft,
        publishedLocalTime: PUBLISHED_AT,
        assignment: summariseAssignment(input.assignment),
        schedule: summariseSchedule(input.schedule),
      };
      published.push(version);
      lockVersion += 1;

      return Promise.resolve({
        outcome: "PUBLISHED",
        versionId: version.versionId,
        versionLabel: version.versionLabel,
        publishedLocalTime: version.publishedLocalTime,
        assignment: version.assignment,
        schedule: version.schedule,
      });
    },

    assignPublishedVersion: assign,

    createDraftFrom: (): Promise<CreateDraftResult> =>
      // Creates nothing, despite the name: the template's persistent draft is
      // already there, and the version the reader clicked is deliberately not
      // copied over it — a draft that has moved on is somebody's real work.
      Promise.resolve({ templateId: TEMPLATE_ID }),

    retireTemplate: ({ lockVersion: token }): Promise<RetireResult> => {
      if (token !== lockVersion) {
        return Promise.reject(new Error("this template has changed since you opened it"));
      }
      lockVersion += 1;
      return Promise.resolve({ lockVersion });
    },
  };

  return {
    gateway,
    publishCalls,
    draft: () => draftBody,
    publishedVersions: () => [...published],
    lockVersion: () => lockVersion,
  };
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
    // Both fields: the backend refuses a template that does not say what it is
    // for, so a draft started without one could never be stored.
    fireEvent.change(screen.getByLabelText("What it is for"), {
      target: { value: "Test scaffolding, not a Bright Steps standard" },
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

    const saved = store.draft();
    expect(saved.sections[0]!.questions.map((item) => item.wording)).toEqual([
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
    // A preview publishes nothing: no version exists yet at all.
    expect(store.publishedVersions()).toHaveLength(0);
    preview.unmount();

    /* --- 7. Publishing to one authorised centre --------------------- */

    const publishing = render(<TemplateEditor templateId="template-1" gateway={gateway} />);
    await screen.findByRole("button", { name: "Publish" });
    // The token the editor was just handed. Publishing has to send exactly this
    // back: it is what the backend refuses a stale publish on, and there is no
    // version identifier to key the command on because the version does not
    // exist until the publish succeeds.
    const tokenAtPublish = store.lockVersion();
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
      templateId: "template-1",
      lockVersion: tokenAtPublish,
      assignment: { scope: "CENTRES", centreIds: ["c-1"] },
      schedule: {
        recurrence: "DAILY",
        opensLocalTime: "06:00",
        dueLocalTime: "07:30",
        effectiveFrom: localToday(),
      },
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

    /* --- 9. Changing it means the open draft; version 1 stays put --- */

    // One template holds one open draft at a time. This template's draft
    // survived its own publication, so the record offers to open that draft
    // rather than to create a second one the backend would refuse — and the
    // published version is not copied over it on the way in.
    expect(screen.queryByRole("button", { name: "Create a new draft" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Open the draft" }));
    await screen.findByRole("button", { name: "Save draft" });

    // No Version 2 is minted. "Create a new draft" opens the template's one
    // persistent draft; it neither copies the published version over it nor
    // creates a version number nobody has published.
    expect(screen.queryByText("Version 2")).toBeNull();
    // The published version is still there, still published, still in use.
    // Read as rows: every version label also appears in that row's own Open
    // button ("Open Version 1"), so loose text would be ambiguous here. The
    // draft row is matched on its event wording rather than on the word
    // "Draft", which is also the wording of its own state badge.
    const rows = within(
      screen.getByRole("region", { name: "Version history" }),
    ).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Last changed 2:14pm"),
      expect.stringContaining("Version 1"),
    ]);
    expect(within(rows[1]!).getByText("In use")).toBeTruthy();
    expect(store.publishedVersions()).toHaveLength(1);
    // "Version 1 stays put" stated about the version itself, not just its row:
    // it still holds exactly the questions that were published, in the order
    // they were published in.
    expect(
      store.publishedVersions()[0]!.content.sections[0]!.questions.map((item) => item.wording),
    ).toEqual(["Test question two — staging only", "Test question one — staging only"]);

    publishing.unmount();
  });

  test("publishing the same draft twice does not publish it twice", async () => {
    const store = createStore();
    const { gateway } = store;

    await gateway.createTemplate({
      name: "Staging test template",
      purpose: "Test scaffolding, not a Bright Steps standard",
    });
    await gateway.saveDraft({
      templateId: TEMPLATE_ID,
      lockVersion: store.lockVersion(),
      draft: ONE_QUESTION,
    });

    // The token the Area Manager's screen is holding when they press publish.
    const tokenAtPublish = store.lockVersion();
    const first = await gateway.publishVersion({
      templateId: TEMPLATE_ID,
      lockVersion: tokenAtPublish,
      assignment: { scope: "CENTRES", centreIds: ["c-1"] },
      schedule: SCHEDULE,
    });
    expect(first.outcome).toBe("PUBLISHED");

    // The retry an Area Manager makes when the first response is lost. The
    // screen is still holding the token from before the publish, which is what
    // makes the second call recognisable as a retry of a request that already
    // committed rather than as a second publish.
    const second = await gateway.publishVersion({
      templateId: TEMPLATE_ID,
      lockVersion: tokenAtPublish,
      assignment: { scope: "CENTRES", centreIds: ["c-1"] },
      schedule: SCHEDULE,
    });
    expect(second.outcome).toBe("ALREADY_PUBLISHED");
    expect(store.publishedVersions()).toHaveLength(1);
  });

  test("a published version cannot be written over, and a stale save is refused", async () => {
    const store = createStore();
    const { gateway } = store;

    await gateway.createTemplate({
      name: "Staging test template",
      purpose: "Test scaffolding, not a Bright Steps standard",
    });
    await gateway.saveDraft({
      templateId: TEMPLATE_ID,
      lockVersion: store.lockVersion(),
      draft: ONE_QUESTION,
    });
    const tokenBeforePublish = store.lockVersion();
    await gateway.publishVersion({
      templateId: TEMPLATE_ID,
      lockVersion: tokenBeforePublish,
      assignment: { scope: "PORTFOLIO" },
      schedule: SCHEDULE,
    });

    // "Save the published version" is now unrepresentable rather than merely
    // refused: `saveDraft` carries no version identifier and only ever reaches
    // the one persistent draft. What is still expressible is the case that
    // matters — work typed against the pre-publish state must not land after it
    // — so that is what is proved here, together with the immutability the test
    // is named for.
    await expect(
      gateway.saveDraft({
        templateId: TEMPLATE_ID,
        lockVersion: tokenBeforePublish,
        draft: { name: "Rewritten", purpose: "Rewritten purpose", sections: [] },
      }),
    ).rejects.toThrow(/changed since you opened it/);

    const [live] = store.publishedVersions();
    expect(live!.content).toEqual(ONE_QUESTION);
  });
});
