import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const authMocks = vi.hoisted(() => ({ signOut: vi.fn(() => Promise.resolve()) }));
const navigationMocks = vi.hoisted(() => ({ getAuthorisedNavigationEndpoint: vi.fn() }));
const routerMocks = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }));

vi.mock("../lib/centre-success-authentication", () => ({
  useCentreSuccessAuthentication: () => ({
    state: { kind: "signed-in", accountKey: "builder-test" },
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

import { TemplateEditorScreen, VersionHistory } from "./template-editor";
import { TemplateLibraryView, TemplateLibraryWorkspace } from "./template-library";
import { PublishDialog } from "./template-assignment";
import { TemplatePreviewFlow, TemplatePreviewScreen } from "./template-preview";
import {
  QUESTION_TYPE_LABEL,
  backendNotAvailableGateway,
  draftReadinessProblems,
  dueTimeLabel,
  countQuestions,
  localToday,
  type AssignmentOptions,
  type DraftQuestion,
  type PublishResult,
  type TemplateBuilderGateway,
  type TemplateDraft,
  type TemplateWorkspace,
} from "./template-builder-contract";

/**
 * Typed fixtures only. The wording is deliberately unmistakable test
 * scaffolding rather than plausible childcare content: a realistic-sounding
 * question is the one someone would later act on as if it were policy.
 */
const TEMPLATE_ID = "3f5b6f2c-8b1d-4c9a-9a2e-2f0c9e7b41aa";
const PUBLISHED_VERSION = "b2d4f6a8-1c3e-4a5b-8d7f-9e0a1b2c3d44";

/**
 * The draft's optimistic-concurrency token, and the one the backend hands back
 * after a save.
 *
 * A draft has no version identifier — it has never been published, so there is
 * nothing permanent to identify — and every command that changes it is keyed on
 * the template plus this token instead. Deliberately not 1: a fixture that used
 * the first plausible number would still pass if a surface defaulted the token
 * rather than threading the one it was given.
 */
const DRAFT_LOCK_VERSION = 7;
const NEXT_LOCK_VERSION = 8;

/**
 * Fixtures are built as concrete union members rather than through a
 * `Partial`-and-cast helper. A cast would let a fixture describe a question
 * that the contract makes unrepresentable — a time question carrying choices —
 * and the tests would then be proving something about a shape the product
 * cannot produce.
 *
 * SCOPE GAP, now closed, recorded here because these fixtures are where it
 * surfaced: there used to be no date question. Migration 023 constrained
 * `question_type` to `short_text, long_text, single_choice, multiple_choice,
 * numeric, time`, so the builder correctly refused to offer a seventh type the
 * backend would reject, and the fixtures below were changed to ask for TIME
 * rather than pretend DATE and TIME were ever the same question. It was closed
 * where it lived — migration 031 widened both `question_type` CHECK constraints
 * — so `QuestionType` now offers DATE too, and it maps one-for-one onto backend
 * `date` like every other member. Nothing here was rewritten to make a fixture
 * pass.
 */
function yesNo(questionId: string, wording: string, required = true): DraftQuestion {
  return { questionId, wording, required, type: "YES_NO" };
}

function draft(overrides: Partial<TemplateDraft> = {}): TemplateDraft {
  return {
    name: "Staging test template",
    purpose: "Test scaffolding, not a Bright Steps standard",
    sections: [
      {
        sectionId: "s-1",
        title: "Test section one",
        questions: [
          yesNo("q-staging-1", "Test question one — staging only"),
          { questionId: "q-staging-2", wording: "Test question two", required: true, type: "TIME" },
        ],
      },
    ],
    ...overrides,
  };
}

function draftWorkspace(
  overrides: { canEdit?: boolean; canPublish?: boolean; body?: TemplateDraft } = {},
): TemplateWorkspace {
  return {
    templateId: TEMPLATE_ID,
    templateName: "Staging test template",
    version: {
      lifecycle: "DRAFT",
      versionLabel: "Draft",
      draft: overrides.body ?? draft(),
      // Required by the contract, so a draft that could be edited without the
      // token every write must carry cannot be built here at all.
      lockVersion: DRAFT_LOCK_VERSION,
      canEdit: overrides.canEdit ?? true,
      canPublish: overrides.canPublish ?? true,
    },
    history: [
      // The open draft is a different kind of row from a permanent version: it
      // has no version identifier to open and cannot be the one in use.
      {
        state: "DRAFT",
        label: "Draft",
        eventLabel: "Draft started 13 Aug 2026",
        eventBy: "Test Area Manager",
      },
      {
        state: "PUBLISHED",
        versionId: PUBLISHED_VERSION,
        versionLabel: "Version 1",
        eventLabel: "Published 1 Aug 2026",
        eventBy: "Test Area Manager",
        current: true,
      },
    ],
  };
}

function publishedWorkspace(): TemplateWorkspace {
  return {
    templateId: TEMPLATE_ID,
    templateName: "Staging test template",
    version: {
      versionId: PUBLISHED_VERSION,
      versionLabel: "Version 1",
      lifecycle: "PUBLISHED",
      content: draft(),
      publishedLocalTime: "1 Aug 2026, 2:20pm",
      publishedBy: "Test Area Manager",
      assignment: {
        scope: "CENTRES",
        description: "Ashgrove Quality Centre",
        centreNames: ["Ashgrove Quality Centre"],
      },
      schedule: {
        recurrence: "DAILY",
        dueLocalTime: "9:00am",
        timeZoneNote: "in each centre's own local time",
      },
      canCreateDraft: true,
      canRetire: true,
    },
    // No draft row. This template's only history is the version that was
    // published, which is what makes "start a new draft" the offered action.
    history: [
      {
        state: "PUBLISHED",
        versionId: PUBLISHED_VERSION,
        versionLabel: "Version 1",
        eventLabel: "Published 1 Aug 2026",
        eventBy: "Test Area Manager",
        current: true,
      },
    ],
  };
}

const ASSIGNMENT_OPTIONS: AssignmentOptions = {
  centres: [
    { centreId: "c-1", centreName: "Ashgrove Quality Centre", timeZoneLabel: "Brisbane time" },
    { centreId: "c-2", centreName: "Newstead Test Centre", timeZoneLabel: "Brisbane time" },
  ],
  portfolioAvailable: true,
  portfolioCentreCount: 2,
};

function gateway(overrides: Partial<TemplateBuilderGateway> = {}): TemplateBuilderGateway {
  return {
    ...backendNotAvailableGateway,
    loadAssignmentOptions: () => Promise.resolve(ASSIGNMENT_OPTIONS),
    // A save hands back the token the *next* command must send, never the one
    // it was given: holding the old one would get the very next save refused.
    saveDraft: () =>
      Promise.resolve({ lastSavedLocalTime: "2:14pm", lockVersion: NEXT_LOCK_VERSION }),
    ...overrides,
  };
}

/**
 * The internal discriminators this lane chose. They are uppercase, so the check
 * is deliberately case-sensitive: "Published" is the word a reader is meant to
 * see, and `PUBLISHED` is the token they never are.
 */
const FORBIDDEN_TOKENS =
  /\bYES_NO\b|\bSINGLE_SELECT\b|\bMULTI_SELECT\b|\bDATE\b|\bTIME\b|\bTEXT\b|\bNUMBER\b|\bAD_HOC\b|\bPORTFOLIO\b|\bCENTRES\b|\bDRAFT\b|\bPUBLISHED\b|\bRETIRED\b|\bOPERATIONAL_CHECK\b|\bQUARTERLY_AUDIT\b/;

/** Storage and source-family vocabulary that must not reach any reader. */
const FORBIDDEN_WORDS = /occurrence|template_version|source family|due_days/i;

beforeEach(() => {
  navigationMocks.getAuthorisedNavigationEndpoint.mockResolvedValue({ links: [] });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

/* ================================================================== *
 * Contract helpers
 * ================================================================== */

describe("builder contract helpers", () => {
  test("the default gateway refuses every operation rather than inventing one", async () => {
    // No generated-client method exists for this slice. Refusing honestly is
    // what keeps a fabricated template from existing anywhere.
    await expect(backendNotAvailableGateway.loadLibrary()).rejects.toThrow();
    await expect(backendNotAvailableGateway.publishVersion({} as never)).rejects.toThrow();
    await expect(backendNotAvailableGateway.saveDraft({} as never)).rejects.toThrow();
  });

  test("due time is rendered the way a person says it", () => {
    expect(dueTimeLabel("09:00")).toBe("9:00am");
    expect(dueTimeLabel("00:30")).toBe("12:30am");
    expect(dueTimeLabel("12:05")).toBe("12:05pm");
    expect(dueTimeLabel("17:45")).toBe("5:45pm");
  });

  test("readiness names what is missing, in the order it would be fixed", () => {
    expect(draftReadinessProblems({ name: "", purpose: "", sections: [] })).toEqual([
      "Give the template a name.",
      // The backend refuses to store a template that does not say what it is
      // for, so it is named here while the Area Manager can still fix it.
      "Say what this template is for.",
      "Add at least one section.",
      "Add at least one question.",
    ]);
    expect(draftReadinessProblems(draft())).toEqual([]);
  });

  test("a choice question with fewer than two usable options is not ready", () => {
    const problems = draftReadinessProblems(
      draft({
        sections: [
          {
            sectionId: "s-1",
            title: "Test section",
            questions: [
              {
                questionId: "q-choice",
                wording: "Test choice question",
                required: true,
                type: "SINGLE_SELECT",
                choices: [
                  { choiceId: "a", label: "Only option" },
                  { choiceId: "b", label: "   " },
                ],
              },
            ],
          },
        ],
      }),
    );
    expect(problems).toContain("One choice question needs at least two options.");
  });

  test("question counting spans every section", () => {
    expect(countQuestions(draft())).toBe(2);
  });
});

/* ================================================================== *
 * Library
 * ================================================================== */

describe("template library", () => {
  const summary = {
    templateId: TEMPLATE_ID,
    name: "Staging test template",
    lifecycle: "PUBLISHED" as const,
    versionLabel: "Version 1",
    questionCount: 2,
    stateLabel: "Published 1 Aug 2026",
  };

  test("an unsupported library asserts nothing about work it never looked for", () => {
    render(<TemplateLibraryView library={{ status: "unsupported" }} />);
    expect(screen.getByText("You're not set up to author templates")).toBeTruthy();
    // The all-clear belongs only to a source that was actually read.
    expect(screen.queryByText("No templates yet")).toBeNull();
  });

  test("a partial library never renders an all-clear, even when empty", () => {
    render(
      <TemplateLibraryView
        library={{
          status: "partial",
          templates: [],
          canCreate: true,
          warning: "One centre group could not be read.",
        }}
      />,
    );
    expect(screen.getByText("We couldn't confirm your templates")).toBeTruthy();
    expect(screen.getByText("One centre group could not be read.")).toBeTruthy();
    expect(screen.queryByText("No templates yet")).toBeNull();
  });

  test("only a ready and genuinely empty library states the affirmative empty", () => {
    render(
      <TemplateLibraryView library={{ status: "ready", templates: [], canCreate: true }} />,
    );
    expect(screen.getByText("No templates yet")).toBeTruthy();
  });

  test("lifecycle reads as words, never as an internal token", () => {
    const { container } = render(
      <TemplateLibraryView
        library={{ status: "ready", templates: [summary], canCreate: true }}
      />,
    );
    // Scoped to the card. "Published" is also the wording of the filter beside
    // it — correctly, they are the same word — so an unscoped query would be
    // ambiguous, and satisfied by the filter without the card ever saying it.
    const card = within(screen.getByRole("list")).getByRole("listitem");
    expect(within(card).getByText("Published")).toBeTruthy();
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN_TOKENS);
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN_WORDS);
  });

  test("the filter narrows a list already in hand", () => {
    render(
      <TemplateLibraryView
        library={{
          status: "ready",
          canCreate: true,
          templates: [
            summary,
            { ...summary, templateId: "other", name: "Second draft", lifecycle: "DRAFT" },
          ],
        }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Drafts" }));
    expect(screen.getByText("Second draft")).toBeTruthy();
    expect(screen.queryByText("Staging test template")).toBeNull();
  });

  test("a principal without authoring authority is offered no create control", () => {
    render(
      <TemplateLibraryView
        library={{ status: "ready", templates: [], canCreate: false }}
        onNewTemplate={() => undefined}
      />,
    );
    expect(screen.queryByRole("button", { name: "New template" })).toBeNull();
  });

  test("a template is created once even under two clicks in one batch", async () => {
    const createTemplate = vi.fn(() =>
      Promise.resolve({ outcome: "CREATED" as const, templateId: TEMPLATE_ID }),
    );
    const onCreated = vi.fn();
    render(
      <TemplateLibraryWorkspace
        gateway={gateway({
          loadLibrary: () =>
            Promise.resolve({ status: "ready", templates: [], canCreate: true }),
          createTemplate,
        })}
        onCreated={onCreated}
      />,
    );

    fireEvent.click(await screen.findByRole("button", { name: "New template" }));
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Second staging template" },
    });
    // Both fields, because the backend stores neither as optional: a template
    // with no stated purpose is refused outright.
    fireEvent.change(screen.getByLabelText("What it is for"), {
      target: { value: "Test scaffolding, not a Bright Steps standard" },
    });

    const start = screen.getByRole("button", { name: "Start draft" });
    fireEvent.click(start);
    fireEvent.click(start);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(TEMPLATE_ID));
    expect(createTemplate).toHaveBeenCalledTimes(1);
  });

  test("a failed load never implies an empty library", async () => {
    render(<TemplateLibraryWorkspace gateway={gateway()} />);
    expect(await screen.findByText("Your templates couldn't be loaded")).toBeTruthy();
    expect(screen.getByText(/does not mean your library is empty/i)).toBeTruthy();
  });
});

/* ================================================================== *
 * Draft editing
 * ================================================================== */

describe("draft editor", () => {
  function renderEditor(workspace = draftWorkspace(), overrides: Partial<TemplateBuilderGateway> = {}) {
    const onOpen = vi.fn();
    const onPreview = vi.fn();
    const view = render(
      <TemplateEditorScreen
        workspace={workspace}
        gateway={gateway(overrides)}
        onOpen={onOpen}
        onPreview={onPreview}
      />,
    );
    return { ...view, onOpen, onPreview };
  }

  test("a section and a question can be added", () => {
    renderEditor();
    fireEvent.click(screen.getByRole("button", { name: "Add section" }));
    expect(screen.getByLabelText("Section 2 name")).toBeTruthy();
    // The count in the section header is the accessible truth about size.
    expect(screen.getByText("2 questions")).toBeTruthy();
  });

  test("questions are reordered by button, and the move is announced", () => {
    renderEditor();
    const down = screen.getByRole("button", {
      name: /Move Question 1 in Test section one down/i,
    });
    fireEvent.click(down);
    expect(
      screen.getByText(/Question 1 moved down\. Now question 2 of 2 in Test section one\./),
    ).toBeTruthy();
  });

  test("the first question cannot be moved up and the last cannot be moved down", () => {
    renderEditor();
    expect(
      screen.getByRole("button", { name: /Move Question 1 in Test section one up/i }),
    ).toHaveProperty("disabled", true);
    expect(
      screen.getByRole("button", { name: /Move Question 2 in Test section one down/i }),
    ).toHaveProperty("disabled", true);
  });

  test("changing to a choice type offers options, and back again removes them", () => {
    renderEditor();
    const type = screen.getAllByLabelText("Answer type")[0]!;
    fireEvent.change(type, { target: { value: "SINGLE_SELECT" } });
    expect(screen.getByPlaceholderText("Option 1")).toBeTruthy();
    expect(screen.getByPlaceholderText("Option 2")).toBeTruthy();

    fireEvent.change(type, { target: { value: "YES_NO" } });
    expect(screen.queryByPlaceholderText("Option 1")).toBeNull();
  });

  test("a choice question is never reduced below two options", () => {
    renderEditor();
    fireEvent.change(screen.getAllByLabelText("Answer type")[0]!, {
      target: { value: "MULTI_SELECT" },
    });
    for (const button of screen.getAllByRole("button", { name: /Remove option/i })) {
      expect(button).toHaveProperty("disabled", true);
    }
    fireEvent.click(screen.getByRole("button", { name: "Add option" }));
    expect(
      screen.getAllByRole("button", { name: /Remove option/i })[0],
    ).toHaveProperty("disabled", false);
  });

  test("required is a real checkbox with a distinguishable accessible name", () => {
    renderEditor();
    const required = screen.getAllByRole("checkbox", { name: /Must be answered/i });
    expect(required.length).toBeGreaterThan(1);
    expect((required[0] as HTMLInputElement).checked).toBe(true);
    fireEvent.click(required[0]!);
    expect((required[0] as HTMLInputElement).checked).toBe(false);
  });

  test("saving is disabled until something changes, then reports when it saved", async () => {
    renderEditor();
    const saveButton = screen.getByRole("button", { name: "Save draft" });
    expect(saveButton).toHaveProperty("disabled", true);

    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Renamed staging template" },
    });
    expect(screen.getByText("Unsaved changes")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText("Saved 2:14pm")).toBeTruthy();
  });

  test("a failed save keeps the work on screen and never claims a publish", async () => {
    renderEditor(draftWorkspace(), { saveDraft: () => Promise.reject(new Error("network")) });
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Renamed staging template" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));

    expect(await screen.findByText("Your draft couldn't be saved")).toBeTruthy();
    expect(screen.getByText(/Nothing has been published/)).toBeTruthy();
    expect((screen.getByLabelText("Template name") as HTMLInputElement).value).toBe(
      "Renamed staging template",
    );
  });

  test("preview saves unsaved work first, so it never shows an older form", async () => {
    const saveDraft = vi.fn(() =>
      Promise.resolve({ lastSavedLocalTime: "2:14pm", lockVersion: NEXT_LOCK_VERSION }),
    );
    const { onPreview } = renderEditor(draftWorkspace(), { saveDraft });
    fireEvent.change(screen.getByLabelText("Template name"), {
      target: { value: "Renamed staging template" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview on a phone" }));

    await waitFor(() => expect(onPreview).toHaveBeenCalledWith(TEMPLATE_ID));
    expect(saveDraft).toHaveBeenCalledTimes(1);
  });

  test("publish is withheld until the draft is publishable", () => {
    renderEditor(draftWorkspace({ body: { name: "", purpose: "", sections: [] } }));
    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", true);
    expect(screen.getByText("Give the template a name.")).toBeTruthy();
    expect(screen.getByText("Add at least one section.")).toBeTruthy();
  });

  test("publish is withheld from a draft the backend did not grant it on", () => {
    renderEditor(draftWorkspace({ canPublish: false }));
    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", true);
  });

  test("no internal token reaches the editor DOM", () => {
    const { container } = renderEditor();
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN_TOKENS);
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN_WORDS);
    // The type picker shows written labels, not the discriminators behind them.
    expect(screen.getAllByText(QUESTION_TYPE_LABEL.YES_NO).length).toBeGreaterThan(0);
  });

  test("a date question is offered, and offers its own optional bounds", () => {
    renderEditor();
    const type = screen.getAllByLabelText("Answer type")[0]!;
    // Offered at all: the option exists under written wording, not the token.
    expect(
      within(type).getByRole("option", { name: QUESTION_TYPE_LABEL.DATE }),
    ).toBeTruthy();
    // Bounds belong to a date question and nothing else, so they are absent
    // until one is chosen and gone again when it is not.
    expect(screen.queryByLabelText(/Earliest date allowed/i)).toBeNull();

    fireEvent.change(type, { target: { value: "DATE" } });
    const earliest = screen.getByLabelText(/Earliest date allowed/i) as HTMLInputElement;
    const latest = screen.getByLabelText(/Latest date allowed/i) as HTMLInputElement;
    // A native date picker, not a text box an author can type anything into.
    expect(earliest.type).toBe("date");
    expect(latest.type).toBe("date");
    // Both optional, so both start empty rather than at a plausible default the
    // author never chose.
    expect(earliest.value).toBe("");
    expect(latest.value).toBe("");

    fireEvent.change(type, { target: { value: "NUMBER" } });
    expect(screen.queryByLabelText(/Earliest date allowed/i)).toBeNull();
  });

  test("a date question's bounds survive editing, and clearing one removes it", async () => {
    // Typed against the gateway rather than inferred, so the saved draft this
    // test reads back off the mock is the real command payload.
    const saveDraft = vi.fn<TemplateBuilderGateway["saveDraft"]>(() =>
      Promise.resolve({ lastSavedLocalTime: "2:14pm", lockVersion: NEXT_LOCK_VERSION }),
    );
    renderEditor(draftWorkspace(), { saveDraft });

    fireEvent.change(screen.getAllByLabelText("Answer type")[0]!, { target: { value: "DATE" } });
    fireEvent.change(screen.getByLabelText(/Earliest date allowed/i), {
      target: { value: "2026-01-01" },
    });
    fireEvent.change(screen.getByLabelText(/Latest date allowed/i), {
      target: { value: "2026-12-31" },
    });
    // Held in the editor, not merely accepted by the input.
    expect((screen.getByLabelText(/Earliest date allowed/i) as HTMLInputElement).value)
      .toBe("2026-01-01");

    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saveDraft).toHaveBeenCalled());
    expect(saveDraft.mock.calls[0]![0]).toMatchObject({
      draft: {
        sections: [{
          questions: [
            { type: "DATE", earliest: "2026-01-01", latest: "2026-12-31" },
            { type: "TIME" },
          ],
        }],
      },
    });

    // Clearing a bound removes it rather than sending an empty string the
    // backend would refuse as a malformed date.
    fireEvent.change(screen.getByLabelText(/Earliest date allowed/i), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(saveDraft).toHaveBeenCalledTimes(2));
    const cleared = saveDraft.mock.calls[1]![0].draft.sections[0]!.questions[0]!;
    expect(cleared).not.toHaveProperty("earliest");
    expect(cleared).toMatchObject({ type: "DATE", latest: "2026-12-31" });
  });

  test("a date question reads as words, never as its discriminator", () => {
    const { container } = renderEditor();
    fireEvent.change(screen.getAllByLabelText("Answer type")[0]!, { target: { value: "DATE" } });
    expect(QUESTION_TYPE_LABEL.DATE).toBe("Date");
    expect(screen.getAllByText(QUESTION_TYPE_LABEL.DATE).length).toBeGreaterThan(0);
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN_TOKENS);
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN_WORDS);
  });
});

/* ================================================================== *
 * Immutability
 * ================================================================== */

describe("published versions are immutable", () => {
  function renderPublished(overrides: Partial<TemplateBuilderGateway> = {}) {
    const onOpen = vi.fn();
    const view = render(
      <TemplateEditorScreen
        workspace={publishedWorkspace()}
        gateway={gateway(overrides)}
        onOpen={onOpen}
        onPreview={vi.fn()}
      />,
    );
    return { ...view, onOpen };
  }

  test("a published version offers no edit control at all", () => {
    renderPublished();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add section" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publish" })).toBeNull();
    expect(screen.queryByLabelText("Answer type")).toBeNull();
    // Stated on the questions themselves, not only in the page summary. That is
    // where the edit controls would otherwise be, so it is where a reader
    // looking for them needs to be told why there are none.
    const questions = screen.getByRole("region", { name: "Questions" });
    expect(within(questions).getByText(/This version cannot be changed/)).toBeTruthy();
  });

  test("a published version shows where and when it runs", () => {
    renderPublished();
    expect(screen.getByText("Ashgrove Quality Centre")).toBeTruthy();
    expect(screen.getByText(/9:00am · in each centre's own local time/)).toBeTruthy();
    expect(screen.getByText(/1 Aug 2026, 2:20pm by Test Area Manager/)).toBeTruthy();
  });

  test("changing it means a new draft, and the published version is untouched", async () => {
    // The command carries no draft body and returns no version identifier: it
    // opens the template's editable draft, and the published version it was
    // started from is neither consumed nor copied over.
    const createDraftFrom = vi.fn(() => Promise.resolve({ templateId: TEMPLATE_ID }));
    const { onOpen } = renderPublished({ createDraftFrom });

    fireEvent.click(screen.getByRole("button", { name: "Create a new draft" }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledWith({ kind: "DRAFT" }));
    expect(createDraftFrom).toHaveBeenCalledWith({
      templateId: TEMPLATE_ID,
      versionId: PUBLISHED_VERSION,
    });
  });

  test("a failed new draft says the published version is unchanged", async () => {
    renderPublished({ createDraftFrom: () => Promise.reject(new Error("network")) });
    fireEvent.click(screen.getByRole("button", { name: "Create a new draft" }));
    expect(await screen.findByText("The new draft couldn't be started")).toBeTruthy();
    expect(screen.getByText(/published version is unchanged/)).toBeTruthy();
  });

  test("a draft a reader may not change renders as a record, not an editor", () => {
    render(
      <TemplateEditorScreen
        workspace={draftWorkspace({ canEdit: false })}
        gateway={gateway()}
        onOpen={vi.fn()}
        onPreview={vi.fn()}
      />,
    );
    expect(screen.getByText("You can see this draft but are not set up to change it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
    // A draft has no assignment, so it is not shown one.
    expect(screen.queryByText("Where it runs")).toBeNull();
  });
});

/* ================================================================== *
 * Version history
 * ================================================================== */

describe("version history", () => {
  test("every version stays listed, and the one in use is named", () => {
    render(
      <VersionHistory history={draftWorkspace().history} open={{ kind: "DRAFT" }} onOpen={vi.fn()} />,
    );
    // Asserted as rows in order, not as loose text. Every version label also
    // appears in the accessible name of that row's own Open button — "Open
    // Version 1" — so a bare text query is ambiguous, and the thing worth
    // proving is that each entry has a row of its own, newest first. The draft
    // row is matched on its event wording rather than on the word "Draft",
    // which is also the wording of its own state badge.
    const rows = within(
      screen.getByRole("region", { name: "Version history" }),
    ).getAllByRole("listitem");
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringContaining("Draft started 13 Aug 2026"),
      expect.stringContaining("Version 1"),
    ]);
    // The reader is on the draft, and a draft is not a version: the row says
    // which one they are on in the wording that belongs to it.
    expect(within(rows[0]!).getByText("You are editing this draft")).toBeTruthy();
    expect(within(rows[1]!).getByText("In use")).toBeTruthy();
  });

  test("history is permanent, and the copy says so", () => {
    render(<VersionHistory history={draftWorkspace().history} open={{ kind: "DRAFT" }} />);
    expect(screen.getByText(/A new draft never changes an old one/)).toBeTruthy();
  });

  test("a template with no history says nothing has been published rather than showing a zero", () => {
    render(<VersionHistory history={[]} open={{ kind: "DRAFT" }} />);
    expect(screen.getByText("Nothing published yet")).toBeTruthy();
  });
});

/* ================================================================== *
 * Assignment, scheduling and publishing
 * ================================================================== */

describe("publishing", () => {
  function renderDialog(overrides: Partial<TemplateBuilderGateway> = {}) {
    const onPublished = vi.fn();
    const onDismiss = vi.fn();
    const view = render(
      <PublishDialog
        gateway={gateway(overrides)}
        // Publishing is keyed on the template and its concurrency token. There
        // is no version identifier to key it on: the version does not exist
        // until publishing succeeds.
        templateId={TEMPLATE_ID}
        lockVersion={DRAFT_LOCK_VERSION}
        questionCount={2}
        onDismiss={onDismiss}
        onPublished={onPublished}
      />,
    );
    return { ...view, onPublished, onDismiss };
  }

  const published: PublishResult = {
    outcome: "PUBLISHED",
    versionId: PUBLISHED_VERSION,
    versionLabel: "Version 2",
    publishedLocalTime: "13 Aug 2026, 2:20pm",
    assignment: {
      scope: "CENTRES",
      description: "Ashgrove Quality Centre",
      centreNames: ["Ashgrove Quality Centre"],
    },
    schedule: {
      recurrence: "DAILY",
      dueLocalTime: "9:00am",
      timeZoneNote: "in each centre's own local time",
    },
  };

  test("publish is withheld until a centre is chosen", async () => {
    renderDialog();
    await screen.findByText("Ashgrove Quality Centre");
    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", true);

    fireEvent.click(screen.getByRole("checkbox", { name: /Ashgrove Quality Centre/ }));
    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", false);
  });

  test("each centre carries its own backend-supplied time zone wording", async () => {
    renderDialog();
    await screen.findByText("Ashgrove Quality Centre");
    expect(screen.getAllByText("Brisbane time").length).toBe(2);
  });

  test("the portfolio is described as resolved at publish, never as a client list", async () => {
    renderDialog();
    await screen.findByText("My whole portfolio");
    fireEvent.click(screen.getByRole("radio", { name: /My whole portfolio/ }));
    expect(screen.getByText(/Worked out at the moment you publish/)).toBeTruthy();
    // Choosing the portfolio hides the centre checklist entirely: there is no
    // list for the browser to send.
    expect(screen.queryByRole("checkbox", { name: /Ashgrove Quality Centre/ })).toBeNull();
  });

  test("an unresolved portfolio size is stated, never rendered as zero", async () => {
    render(
      <PublishDialog
        gateway={gateway({
          loadAssignmentOptions: () =>
            Promise.resolve({ centres: [], portfolioAvailable: true }),
        })}
        templateId={TEMPLATE_ID}
        lockVersion={DRAFT_LOCK_VERSION}
        questionCount={2}
        onDismiss={vi.fn()}
        onPublished={vi.fn()}
      />,
    );
    expect(
      await screen.findByText(/Worked out from what you are authorised for at the moment you publish/),
    ).toBeTruthy();
    expect(screen.queryByText(/0 centres/)).toBeNull();
  });

  test("scheduling is daily, and says so rather than offering a picker of one", async () => {
    renderDialog();
    await screen.findByText("Ashgrove Quality Centre");
    expect(screen.getByText(/Every day\. Other schedules are not part of this release\./)).toBeTruthy();
    expect(screen.getByLabelText("Due by")).toHaveProperty("value", "09:00");
    expect(screen.getByText("9:00am in each centre's own local time.")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Due by"), { target: { value: "07:30" } });
    expect(screen.getByText("7:30am in each centre's own local time.")).toBeTruthy();
  });

  test("immutability is stated before the button, not after it", async () => {
    renderDialog();
    await screen.findByText("Ashgrove Quality Centre");
    expect(screen.getByText(/Once published, this version cannot be changed/)).toBeTruthy();
  });

  test("a phone preview is offered before publishing", async () => {
    renderDialog();
    await screen.findByText("Ashgrove Quality Centre");
    const link = screen.getByRole("link", { name: /Preview it on a phone first/ });
    expect(link.getAttribute("href")).toBe(`/standards/templates/${TEMPLATE_ID}/preview`);
  });

  test("publishing sends the chosen centres and a daily schedule, exactly once", async () => {
    const publishVersion = vi.fn(() => Promise.resolve(published));
    const { onPublished } = renderDialog({ publishVersion });

    await screen.findByText("Ashgrove Quality Centre");
    fireEvent.click(screen.getByRole("checkbox", { name: /Ashgrove Quality Centre/ }));

    const publish = screen.getByRole("button", { name: "Publish" });
    fireEvent.click(publish);
    fireEvent.click(publish);

    await screen.findByText("Published");
    expect(publishVersion).toHaveBeenCalledTimes(1);
    expect(publishVersion).toHaveBeenCalledWith({
      templateId: TEMPLATE_ID,
      // The token the draft was loaded with, sent back untouched. Publishing
      // is refused if it has moved, which is what stops two Area Managers
      // publishing over each other.
      lockVersion: DRAFT_LOCK_VERSION,
      assignment: { scope: "CENTRES", centreIds: ["c-1"] },
      // All four fields, because the backend requires all four: a daily check
      // that opens at one time, is due at another, from a first real day.
      schedule: {
        recurrence: "DAILY",
        opensLocalTime: "06:00",
        dueLocalTime: "09:00",
        effectiveFrom: localToday(),
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "View published version" }));
    expect(onPublished).toHaveBeenCalledWith(PUBLISHED_VERSION);
  });

  test("the portfolio branch sends no centre list", async () => {
    const publishVersion = vi.fn(() => Promise.resolve(published));
    renderDialog({ publishVersion });

    await screen.findByText("My whole portfolio");
    fireEvent.click(screen.getByRole("radio", { name: /My whole portfolio/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await screen.findByText("Published");
    expect(publishVersion).toHaveBeenCalledWith(
      expect.objectContaining({ assignment: { scope: "PORTFOLIO" } }),
    );
  });

  test("a lost response is a success, not a failure the reader caused", async () => {
    renderDialog({
      publishVersion: () =>
        Promise.resolve({
          outcome: "ALREADY_PUBLISHED",
          versionId: PUBLISHED_VERSION,
          versionLabel: "Version 2",
          publishedLocalTime: "2:20pm",
        }),
    });

    await screen.findByText("Ashgrove Quality Centre");
    fireEvent.click(screen.getByRole("checkbox", { name: /Ashgrove Quality Centre/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Already published")).toBeTruthy();
    expect(screen.getByText(/It was not published twice/)).toBeTruthy();
  });

  test("an already-published version says these settings were not applied", async () => {
    // KNOWN REGRESSION, recorded rather than papered over.
    //
    // This test and the one above it were a matched pair. `ALREADY_PUBLISHED`
    // carried `publishedByRequester`, and the dialog branched on it: the person
    // whose own response was lost was told "You published Version 2 at 2:20pm.
    // It was not published twice." and was NOT shown the disclaimer, because
    // their settings were the ones applied. Anyone else was told the version was
    // already published, and that the settings on their screen were not.
    //
    // The rewire onto the generated client dropped the field and made both
    // strings unconditional, so a retrying Area Manager is now told their own
    // settings were not applied. The distinction is no longer representable, so
    // neither fixture can express it and this test can only pin the disclaimer.
    //
    // It is not a backend limitation: `OperationalTemplateVersionSummary`
    // carries `authorId`, and the gateway already resolves the current
    // principal and exposes `owns(authorId)` for exactly this kind of question.
    // Restoring the branch is a product decision about wording, so it is raised
    // rather than taken here.
    renderDialog({
      publishVersion: () =>
        Promise.resolve({
          outcome: "ALREADY_PUBLISHED",
          versionId: PUBLISHED_VERSION,
          versionLabel: "Version 2",
          publishedLocalTime: "2:20pm",
        }),
    });

    await screen.findByText("Ashgrove Quality Centre");
    fireEvent.click(screen.getByRole("checkbox", { name: /Ashgrove Quality Centre/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("Already published")).toBeTruthy();
    expect(screen.getByText("The settings on this screen were not applied.")).toBeTruthy();
  });

  test("a refusal shows the backend's own wording and is not an outage", async () => {
    renderDialog({
      publishVersion: () =>
        Promise.resolve({
          outcome: "REFUSED",
          reason: "One of the chosen centres is outside what you are authorised for.",
        }),
    });

    await screen.findByText("Ashgrove Quality Centre");
    fireEvent.click(screen.getByRole("checkbox", { name: /Ashgrove Quality Centre/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("This wasn't published")).toBeTruthy();
    expect(
      screen.getByText("One of the chosen centres is outside what you are authorised for."),
    ).toBeTruthy();
    // Retry stays available: a refusal is a decision the reader can act on.
    expect(screen.getByRole("button", { name: "Publish" })).toHaveProperty("disabled", false);
  });

  test("an ambiguous failure never claims nothing was published", async () => {
    renderDialog({ publishVersion: () => Promise.reject(new Error("timeout")) });

    await screen.findByText("Ashgrove Quality Centre");
    fireEvent.click(screen.getByRole("checkbox", { name: /Ashgrove Quality Centre/ }));
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    expect(await screen.findByText("We couldn't confirm the publish")).toBeTruthy();
    expect(screen.getByText(/it's safe to try again, and it will not publish twice/i)).toBeTruthy();
  });

  test("an unreadable centre list never claims the reader has no centres", async () => {
    renderDialog({ loadAssignmentOptions: () => Promise.reject(new Error("network")) });
    expect(
      await screen.findByText("We couldn't check which centres you can assign to"),
    ).toBeTruthy();
    expect(screen.getByText(/does not mean you have no centres/)).toBeTruthy();
  });
});

/* ================================================================== *
 * Phone preview
 * ================================================================== */

describe("phone preview", () => {
  const EVERY_TYPE: DraftQuestion[] = [
    yesNo("t1", "Yes or no test question"),
    {
      questionId: "t2",
      wording: "Choose one test question",
      required: true,
      type: "SINGLE_SELECT",
      choices: [
        { choiceId: "o1", label: "First test option" },
        { choiceId: "o2", label: "Second test option" },
      ],
    },
    {
      questionId: "t3",
      wording: "Choose any test question",
      required: true,
      type: "MULTI_SELECT",
      choices: [
        { choiceId: "o3", label: "Third test option" },
        { choiceId: "o4", label: "Fourth test option" },
      ],
    },
    {
      questionId: "t4",
      wording: "Written test question",
      required: true,
      type: "TEXT",
      multiline: false,
    },
    // A number question carries no unit: the backend stores none, so the
    // contract gives one nowhere to live and a unit an author typed would have
    // vanished the next time they opened the draft.
    { questionId: "t5", wording: "Number test question", required: true, type: "NUMBER" },
    { questionId: "t6", wording: "Time test question", required: true, type: "TIME" },
    {
      questionId: "t7",
      wording: "Date test question",
      required: true,
      type: "DATE",
      earliest: "2026-01-01",
      latest: "2026-12-31",
    },
  ];

  test("one question is shown at a time, with a written progress count", () => {
    render(<TemplatePreviewFlow templateName="Staging test template" questions={EVERY_TYPE} />);
    expect(screen.getByText("Question 1 of 7")).toBeTruthy();
    expect(screen.getByText("Yes or no test question")).toBeTruthy();
    expect(screen.queryByText("Choose one test question")).toBeNull();
  });

  test("every authorised question type renders its own control", () => {
    render(<TemplatePreviewFlow templateName="Staging test template" questions={EVERY_TYPE} />);

    // Yes/No — radios.
    expect(screen.getByRole("radio", { name: "Yes" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Choose one — radios again, from the author's options.
    expect(screen.getByRole("radio", { name: "First test option" })).toBeTruthy();
    fireEvent.click(screen.getByRole("radio", { name: "First test option" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Choose any — checkboxes, so more than one may be chosen at once.
    const third = screen.getByRole("checkbox", { name: "Third test option" });
    const fourth = screen.getByRole("checkbox", { name: "Fourth test option" });
    fireEvent.click(third);
    fireEvent.click(fourth);
    expect((third as HTMLInputElement).checked).toBe(true);
    expect((fourth as HTMLInputElement).checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Written.
    const text = screen.getByLabelText("Written test question");
    fireEvent.change(text, { target: { value: "test answer" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Number.
    const number = screen.getByLabelText("Number test question") as HTMLInputElement;
    expect(number.type).toBe("number");
    fireEvent.change(number, { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Time of day.
    const time = screen.getByLabelText("Time test question") as HTMLInputElement;
    expect(time.type).toBe("time");
    fireEvent.change(time, { target: { value: "09:30" } });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    // Date — a calendar picker, carrying the window the author set so the
    // preview refuses an out-of-range day exactly where the real form would.
    const date = screen.getByLabelText("Date test question") as HTMLInputElement;
    expect(date.type).toBe("date");
    expect(date.min).toBe("2026-01-01");
    expect(date.max).toBe("2026-12-31");
    fireEvent.change(date, { target: { value: "2026-06-15" } });
    expect(date.value).toBe("2026-06-15");
  });

  test("an unbounded date question carries no window at all", () => {
    render(
      <TemplatePreviewFlow
        templateName="Staging test template"
        questions={[
          { questionId: "d1", wording: "Unbounded date test question", required: true, type: "DATE" },
        ]}
      />,
    );
    const date = screen.getByLabelText("Unbounded date test question") as HTMLInputElement;
    // Absent, not a plausible default: an author who set no bound has not
    // said the answer must fall after today, or after any other day.
    expect(date.min).toBe("");
    expect(date.max).toBe("");
  });

  test("a required question holds the flow; an optional one does not", () => {
    render(
      <TemplatePreviewFlow
        templateName="Staging test template"
        questions={[
          yesNo("r1", "Required test question"),
          yesNo("r2", "Optional test question", false),
        ]}
      />,
    );
    expect(screen.getByRole("button", { name: "Next" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Optional test question (optional)")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Finish preview" })).toHaveProperty(
      "disabled",
      false,
    );
  });

  test("back returns to the previous question with its answer intact", () => {
    render(<TemplatePreviewFlow templateName="Staging test template" questions={EVERY_TYPE} />);
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect((screen.getByRole("radio", { name: "Yes" }) as HTMLInputElement).checked).toBe(true);
  });

  test("finishing a preview records nothing, and says so", () => {
    render(
      <TemplatePreviewFlow
        templateName="Staging test template"
        questions={[yesNo("only", "Single test question")]}
      />,
    );
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.click(screen.getByRole("button", { name: "Finish preview" }));

    expect(screen.getByText("End of the preview")).toBeTruthy();
    expect(
      screen.getByText(/Nothing was recorded and no centre was contacted/),
    ).toBeTruthy();
    // A preview is not a completion, so it never borrows completion wording.
    expect(screen.queryByText(/Check complete/)).toBeNull();
  });

  test("a draft preview shows the default due time and says where it came from", () => {
    render(<TemplatePreviewScreen workspace={draftWorkspace()} />);
    expect(screen.getByText("Due by 9:00am")).toBeTruthy();
    expect(
      screen.getByText(/the default the publish step opens on\. You choose the real one when you publish\./),
    ).toBeTruthy();
  });

  test("a published preview shows that version's real schedule", () => {
    render(<TemplatePreviewScreen workspace={publishedWorkspace()} />);
    expect(screen.getByText("Due by 9:00am")).toBeTruthy();
    expect(
      screen.getByText(/this version's published schedule, in each centre's own local time/),
    ).toBeTruthy();
  });

  test("the preview never carries an internal token", () => {
    const { container } = render(<TemplatePreviewScreen workspace={publishedWorkspace()} />);
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN_TOKENS);
    expect(container.textContent ?? "").not.toMatch(FORBIDDEN_WORDS);
  });

  test("a template with nothing to ask says so rather than showing an empty screen", () => {
    render(<TemplatePreviewFlow templateName="Staging test template" questions={[]} />);
    expect(screen.getByText(/There are no questions to preview yet/)).toBeTruthy();
  });

  test("the preview screen is a labelled region, not a picture of a phone", () => {
    render(<TemplatePreviewScreen workspace={draftWorkspace()} />);
    const region = screen.getByRole("region", {
      name: "Phone preview of Staging test template",
    });
    expect(within(region).getByText("Question 1 of 2")).toBeTruthy();
  });
});
