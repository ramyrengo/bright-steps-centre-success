"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell, useBlockLeaveWhen } from "./app-shell";
import {
  Breadcrumb,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  Section,
  StatusBadge,
} from "./design-system";
import {
  OrderControls,
  QuestionEditor,
  QuestionRecord,
  newQuestion,
  newSectionId,
} from "./template-question-editor";
import { PublishDialog } from "./template-assignment";
import {
  LIFECYCLE_LABEL,
  TEMPLATE_ROOT,
  backendNotAvailableGateway,
  canEditVersion,
  countQuestions,
  draftReadinessProblems,
  lifecycleTone,
  templatePreviewRoute,
  versionContent,
  type DraftQuestion,
  type DraftSection,
  type TemplateBuilderGateway,
  type TemplateDraft,
  type TemplateVersion,
  type TemplateWorkspace,
  type VersionHistoryEntry,
} from "./template-builder-contract";

/**
 * The template editor.
 *
 * One surface serves the whole lifecycle, because which surface an Area Manager
 * gets is decided by what the version turns out to be, not by which link they
 * followed. A draft they may change is an editor; a published version is a
 * record with a "start a new draft" affordance and no edit control anywhere on
 * it. That is carried by the contract's shape — a published version has no
 * `draft` and no `canEdit` — so an edit control on an immutable version is not
 * something this file has to remember to suppress.
 */

/* ------------------------------------------------------------------ *
 * Draft editing
 * ------------------------------------------------------------------ */

function move<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction;
  if (target < 0 || target >= items.length) return [...items];
  const next = [...items];
  const [item] = next.splice(index, 1);
  next.splice(target, 0, item!);
  return next;
}

export function SectionEditor({
  section,
  position,
  total,
  onChange,
  onMove,
  onRemove,
  announce,
}: Readonly<{
  section: DraftSection;
  position: number;
  total: number;
  onChange: (next: DraftSection) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
  announce: (message: string) => void;
}>) {
  const label = section.title.trim() || `Section ${position + 1}`;

  const setQuestions = useCallback(
    (questions: DraftQuestion[]) => onChange({ ...section, questions }),
    [onChange, section],
  );

  return (
    <li className="builder-section">
      <div className="builder-section__head">
        <OrderControls
          label={`section, ${label}`}
          position={position}
          total={total}
          onMove={onMove}
        />
        <label className="builder-field builder-section__title">
          <span className="builder-field__label">Section {position + 1} name</span>
          <input
            type="text"
            value={section.title}
            placeholder="e.g. Outdoor area"
            onChange={(event) => onChange({ ...section, title: event.target.value })}
          />
        </label>
        <button className="builder-remove" type="button" onClick={onRemove}>
          Remove
          <span className="visually-hidden"> section, {label}</span>
        </button>
      </div>

      {section.questions.length > 0 ? (
        <ol className="builder-question-list" role="list">
          {section.questions.map((question, index) => (
            <QuestionEditor
              key={question.questionId}
              question={question}
              position={index}
              total={section.questions.length}
              sectionTitle={label}
              onChange={(next) =>
                setQuestions(
                  section.questions.map((item) =>
                    item.questionId === question.questionId ? next : item,
                  ),
                )
              }
              onMove={(direction) => {
                setQuestions(move(section.questions, index, direction));
                announce(
                  `Question ${index + 1} moved ${direction === -1 ? "up" : "down"}. Now question ${
                    index + 1 + direction
                  } of ${section.questions.length} in ${label}.`,
                );
              }}
              onRemove={() => {
                setQuestions(
                  section.questions.filter((item) => item.questionId !== question.questionId),
                );
                announce(`Question ${index + 1} removed from ${label}.`);
              }}
            />
          ))}
        </ol>
      ) : (
        <p className="builder-section__empty">
          No questions in this section yet.
        </p>
      )}

      <button
        className="button button--secondary"
        type="button"
        onClick={() => {
          setQuestions([...section.questions, newQuestion()]);
          announce(`Question ${section.questions.length + 1} added to ${label}.`);
        }}
      >
        Add question
        <span className="visually-hidden"> to {label}</span>
      </button>
    </li>
  );
}

/**
 * The editable body of a draft.
 *
 * `onDraftChange` is called on every keystroke and the parent owns the draft,
 * so unsaved work is one fact in one place — which is what the leave guard and
 * the save button both read.
 */
export function DraftEditor({
  draft,
  onDraftChange,
}: Readonly<{ draft: TemplateDraft; onDraftChange: (next: TemplateDraft) => void }>) {
  const [announcement, setAnnouncement] = useState("");
  const announce = useCallback((message: string) => setAnnouncement(message), []);

  const setSections = useCallback(
    (sections: DraftSection[]) => onDraftChange({ ...draft, sections }),
    [draft, onDraftChange],
  );

  return (
    <div className="builder">
      {/* Structural changes replace content in place with no visible transition,
          so each one is stated once for a reader who cannot see it happen. */}
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>

      <Section title="About this template" headingLevel={2}>
        <div className="builder-card">
          <label className="builder-field">
            <span className="builder-field__label">Template name</span>
            <input
              type="text"
              value={draft.name}
              onChange={(event) => onDraftChange({ ...draft, name: event.target.value })}
            />
          </label>
          <label className="builder-field">
            <span className="builder-field__label">What it is for (optional)</span>
            <input
              type="text"
              value={draft.purpose ?? ""}
              placeholder="One line, in your own words"
              onChange={(event) =>
                onDraftChange({ ...draft, purpose: event.target.value || undefined })
              }
            />
          </label>
        </div>
      </Section>

      <Section
        title="Sections and questions"
        description="Questions are asked in the order they appear here, one at a time."
        count={`${countQuestions(draft)} question${countQuestions(draft) === 1 ? "" : "s"}`}
        headingLevel={2}
      >
        {draft.sections.length > 0 ? (
          <ol className="builder-section-list" role="list">
            {draft.sections.map((section, index) => (
              <SectionEditor
                key={section.sectionId}
                section={section}
                position={index}
                total={draft.sections.length}
                announce={announce}
                onChange={(next) =>
                  setSections(
                    draft.sections.map((item) =>
                      item.sectionId === section.sectionId ? next : item,
                    ),
                  )
                }
                onMove={(direction) => {
                  setSections(move(draft.sections, index, direction));
                  announce(
                    `Section ${index + 1} moved ${direction === -1 ? "up" : "down"}. Now section ${
                      index + 1 + direction
                    } of ${draft.sections.length}.`,
                  );
                }}
                onRemove={() => {
                  setSections(
                    draft.sections.filter((item) => item.sectionId !== section.sectionId),
                  );
                  announce(`Section ${index + 1} removed.`);
                }}
              />
            ))}
          </ol>
        ) : (
          <EmptyState
            title="No sections yet"
            message="A section groups related questions — the outdoor area, the kitchen, the sign-in desk. Add the first one to start."
            mark="+"
          />
        )}

        <button
          className="button button--secondary"
          type="button"
          onClick={() => {
            setSections([
              ...draft.sections,
              { sectionId: newSectionId(), title: "", questions: [] },
            ]);
            announce(`Section ${draft.sections.length + 1} added.`);
          }}
        >
          Add section
        </button>
      </Section>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Immutable record
 * ------------------------------------------------------------------ */

/**
 * A version rendered read-only.
 *
 * It serves a published version, a retired one, and a draft the reader may see
 * but not change. Only the first two have somewhere to run and a time to be
 * due, so only they get the "Where it runs" panel — a draft would otherwise be
 * shown an assignment it does not have.
 */
export function VersionRecord({ version }: Readonly<{ version: TemplateVersion }>) {
  const content = versionContent(version);

  return (
    <>
      {version.lifecycle === "DRAFT" ? null : (
        <Section title="Where it runs" headingLevel={2}>
          <dl className="builder-facts">
            <div>
              <dt>Centres</dt>
              <dd>{version.assignment.description}</dd>
            </div>
            <div>
              <dt>Schedule</dt>
              <dd>
                {version.schedule.dueLocalTime} · {version.schedule.timeZoneNote}
              </dd>
            </div>
            <div>
              <dt>Published</dt>
              <dd>
                {version.publishedLocalTime} by {version.publishedBy}
              </dd>
            </div>
            {version.lifecycle === "RETIRED" ? (
              <div>
                <dt>Retired</dt>
                <dd>
                  {version.retiredLocalTime} by {version.retiredBy}
                </dd>
              </div>
            ) : null}
          </dl>
        </Section>
      )}

      <Section
        title="Questions"
        description={
          version.lifecycle === "DRAFT"
            ? "This draft has not been published, so no centre has been asked these questions yet."
            : "This version cannot be changed. Editing it would rewrite what centres have already been asked."
        }
        count={`${countQuestions(content)} question${countQuestions(content) === 1 ? "" : "s"}`}
        headingLevel={2}
      >
        {content.sections.map((section) => (
          <div className="record-section" key={section.sectionId}>
            <h3 className="record-section__title">{section.title}</h3>
            <ol className="question-record-list" role="list">
              {section.questions.map((question, index) => (
                <QuestionRecord key={question.questionId} question={question} position={index} />
              ))}
            </ol>
          </div>
        ))}
      </Section>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Version history
 * ------------------------------------------------------------------ */

/**
 * Every version this template has had.
 *
 * Published and retired entries are permanent: a later draft adds a row and
 * never rewrites one, so an Area Manager can always see what a centre was
 * actually asked in a given period. Retirement stops future use and changes
 * nothing that was already recorded, which the copy states rather than leaving
 * to inference.
 */
export function VersionHistory({
  history,
  currentVersionId,
  onOpen,
}: Readonly<{
  history: readonly VersionHistoryEntry[];
  currentVersionId: string;
  onOpen?: (versionId: string) => void;
}>) {
  if (history.length === 0) {
    return (
      <Section title="Version history" headingLevel={2}>
        <EmptyState
          title="Nothing published yet"
          message="Once you publish, every version stays here permanently — including this one."
        />
      </Section>
    );
  }

  return (
    <Section
      title="Version history"
      description="Published versions are permanent. A new draft never changes an old one."
      count={`${history.length} version${history.length === 1 ? "" : "s"}`}
      headingLevel={2}
    >
      <ol className="version-history" role="list">
        {history.map((entry) => (
          <li
            className="version-history__row"
            key={entry.versionId}
            data-lifecycle={entry.lifecycle}
            {...(entry.versionId === currentVersionId ? { "aria-current": "true" } : {})}
          >
            <div className="version-history__primary">
              <span className="version-history__label">{entry.versionLabel}</span>
              <StatusBadge tone={lifecycleTone(entry.lifecycle)}>
                {LIFECYCLE_LABEL[entry.lifecycle]}
              </StatusBadge>
              {entry.current ? (
                <span className="version-history__current">In use</span>
              ) : null}
            </div>
            <p className="version-history__event">
              {entry.eventLabel} by {entry.eventBy}
            </p>
            {entry.versionId === currentVersionId ? (
              <span className="version-history__here">You are viewing this version</span>
            ) : onOpen ? (
              <button
                className="button button--secondary"
                type="button"
                onClick={() => onOpen(entry.versionId)}
              >
                Open
                <span className="visually-hidden"> {entry.versionLabel}</span>
              </button>
            ) : null}
          </li>
        ))}
      </ol>
    </Section>
  );
}

/* ------------------------------------------------------------------ *
 * The screen
 * ------------------------------------------------------------------ */

type SavePhase =
  | { kind: "idle" }
  | { kind: "saving" }
  | { kind: "saved"; at: string }
  | { kind: "error" };

export function TemplateEditorScreen({
  workspace,
  gateway,
  onOpenVersion,
  onPreview,
}: Readonly<{
  workspace: TemplateWorkspace;
  gateway: TemplateBuilderGateway;
  onOpenVersion: (versionId: string) => void;
  onPreview: (templateId: string) => void;
}>) {
  const { version } = workspace;

  // The editable draft itself, or null. A boolean would not narrow the union,
  // and narrowing is the whole point: `editing.canPublish` only exists on a
  // draft, so an immutable version cannot reach a publish control by accident.
  const editing = version.lifecycle === "DRAFT" && version.canEdit ? version : null;

  const [draft, setDraft] = useState<TemplateDraft>(() => versionContent(version));
  const [dirty, setDirty] = useState(false);
  const [save, setSave] = useState<SavePhase>({ kind: "idle" });
  const [publishing, setPublishing] = useState(false);
  const [newDraft, setNewDraft] = useState<"idle" | "working" | "error">("idle");
  const saving = useRef(false);

  // A draft with answers typed into it is unsaved work the shell's own leave
  // paths would otherwise discard silently.
  useBlockLeaveWhen(dirty);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const change = useCallback((next: TemplateDraft) => {
    setDraft(next);
    setDirty(true);
    setSave({ kind: "idle" });
  }, []);

  const persist = useCallback(async (): Promise<boolean> => {
    if (saving.current) return false;
    saving.current = true;
    setSave({ kind: "saving" });
    try {
      const result = await gateway.saveDraft({ versionId: version.versionId, draft });
      setSave({ kind: "saved", at: result.lastSavedLocalTime });
      setDirty(false);
      return true;
    } catch {
      setSave({ kind: "error" });
      return false;
    } finally {
      saving.current = false;
    }
  }, [draft, gateway, version.versionId]);

  const preview = useCallback(async () => {
    // The preview reads what is saved, so unsaved work is saved first rather
    // than the reader being shown an older form and told it is their template.
    if (dirty && !(await persist())) return;
    onPreview(workspace.templateId);
  }, [dirty, onPreview, persist, workspace.templateId]);

  const startNewDraft = useCallback(async () => {
    if (newDraft === "working") return;
    setNewDraft("working");
    try {
      const result = await gateway.createDraftFrom({ versionId: version.versionId });
      onOpenVersion(result.versionId);
    } catch {
      setNewDraft("error");
    }
  }, [gateway, newDraft, onOpenVersion, version.versionId]);

  const problems = draftReadinessProblems(draft);

  return (
    <>
      <Breadcrumb
        trail={[
          { label: "Templates", href: TEMPLATE_ROOT },
          { label: workspace.templateName },
        ]}
      />

      <PageHeader
        eyebrow="Template"
        title={workspace.templateName}
        summary={
          editing
            ? "A draft. Nothing runs in a centre until you publish it."
            : version.lifecycle === "DRAFT"
              ? "A draft you can read but are not set up to change."
              : version.lifecycle === "PUBLISHED"
                ? "Published and in use. This version cannot be changed."
                : "Retired. It no longer runs, and what it recorded is unchanged."
        }
        meta={
          <>
            <StatusBadge tone={lifecycleTone(version.lifecycle)}>
              {LIFECYCLE_LABEL[version.lifecycle]}
            </StatusBadge>
            <span>{version.versionLabel}</span>
            {version.lifecycle === "DRAFT" && version.lastSavedLocalTime ? (
              <span>Saved {version.lastSavedLocalTime}</span>
            ) : null}
          </>
        }
      />

      {editing ? (
        <>
          <DraftEditor draft={draft} onDraftChange={change} />

          {problems.length > 0 ? (
            <section className="builder-readiness" aria-labelledby="builder-readiness-title">
              <h2 id="builder-readiness-title">Before you can publish</h2>
              <ul>
                {problems.map((problem) => (
                  <li key={problem}>{problem}</li>
                ))}
              </ul>
            </section>
          ) : null}

          {save.kind === "error" ? (
            <ErrorState
              title="Your draft couldn't be saved"
              message="Your changes are still on this screen. Nothing has been published. It's safe to try again."
              onRetry={() => void persist()}
            />
          ) : null}

          <div className="sticky-action-bar">
            <p className="builder-save-state" role="status" aria-live="polite">
              {save.kind === "saving"
                ? "Saving…"
                : save.kind === "saved"
                  ? `Saved ${save.at}`
                  : dirty
                    ? "Unsaved changes"
                    : ""}
            </p>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void persist()}
              disabled={!dirty || save.kind === "saving"}
            >
              Save draft
            </button>
            <button
              className="button button--secondary"
              type="button"
              onClick={() => void preview()}
              disabled={countQuestions(draft) === 0 || save.kind === "saving"}
            >
              Preview on a phone
            </button>
            <button
              className="button button--accent"
              type="button"
              onClick={() => setPublishing(true)}
              disabled={problems.length > 0 || !editing.canPublish}
            >
              Publish
            </button>
          </div>
        </>
      ) : (
        <>
          {version.lifecycle === "DRAFT" ? (
            <Notice title="You can see this draft but are not set up to change it." />
          ) : null}
          <VersionRecord version={version} />

          <div className="sticky-action-bar">
            <Link
              className="button button--secondary"
              href={templatePreviewRoute(workspace.templateId)}
            >
              Preview on a phone
            </Link>
            {version.lifecycle !== "DRAFT" && version.canCreateDraft ? (
              <button
                className="button button--accent"
                type="button"
                onClick={() => void startNewDraft()}
                disabled={newDraft === "working"}
              >
                {newDraft === "working" ? "Starting…" : "Create a new draft"}
              </button>
            ) : null}
          </div>

          {newDraft === "error" ? (
            <ErrorState
              title="The new draft couldn't be started"
              message="Nothing has been created and this published version is unchanged. Please try again shortly."
              onRetry={() => void startNewDraft()}
            />
          ) : null}
        </>
      )}

      <VersionHistory
        history={workspace.history}
        currentVersionId={version.versionId}
        onOpen={onOpenVersion}
      />

      {publishing && editing ? (
        <PublishDialog
          gateway={gateway}
          versionId={editing.versionId}
          templateId={workspace.templateId}
          questionCount={countQuestions(draft)}
          onDismiss={() => setPublishing(false)}
          onPublished={(versionId) => {
            setPublishing(false);
            setDirty(false);
            onOpenVersion(versionId);
          }}
        />
      ) : null}
    </>
  );
}

/** Reserves the shape of the editor rather than a generic bar stack. */
export function TemplateEditorSkeleton() {
  return (
    <div className="builder" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">Opening your template.</span>
      <div className="builder-skeleton" aria-hidden="true">
        <span className="skeleton__bar skeleton__bar--short" />
        <span className="skeleton__bar skeleton__bar--title" />
        <span className="builder-skeleton__block" />
        <span className="builder-skeleton__block" />
      </div>
    </div>
  );
}

export function TemplateEditor({
  templateId,
  gateway = backendNotAvailableGateway,
}: Readonly<{ templateId: string; gateway?: TemplateBuilderGateway }>) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<TemplateWorkspace>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [openVersionId, setOpenVersionId] = useState<string>();
  const [announcement, setAnnouncement] = useState("Opening your template.");

  useEffect(() => {
    let current = true;
    const load = openVersionId
      ? gateway.loadVersion(openVersionId)
      : gateway.loadTemplate(templateId);
    void load.then(
      (value) => {
        if (!current) return;
        setWorkspace(value);
        setState("ready");
        setAnnouncement(
          canEditVersion(value.version)
            ? "Your draft is ready to edit."
            : `${value.templateName} is open for reading.`,
        );
      },
      () => {
        if (!current) return;
        setState("error");
        setAnnouncement("This template could not be opened.");
      },
    );
    return () => {
      current = false;
    };
  }, [attempt, gateway, openVersionId, templateId]);

  useEffect(() => {
    if (state === "loading") return;
    document.querySelector<HTMLElement>("[data-page-focus]")?.focus();
  }, [state, workspace]);

  let content;
  if (state === "loading") {
    content = <TemplateEditorSkeleton />;
  } else if (state === "error" || !workspace) {
    content = (
      <ErrorState
        title="This template couldn't be opened"
        message="Nothing has been changed and nothing has been published. Please try again shortly."
        onRetry={() => {
          setState("loading");
          setAnnouncement("Opening your template.");
          setAttempt((value) => value + 1);
        }}
      />
    );
  } else {
    content = (
      <TemplateEditorScreen
        // The screen seeds its editable copy from the version it was given, so
        // opening a different version has to be a remount. Without the key the
        // seed would be ignored and an Area Manager opening version 2 from
        // history would be editing version 3's text under version 2's heading.
        key={workspace.version.versionId}
        workspace={workspace}
        gateway={gateway}
        onOpenVersion={(versionId) => {
          setState("loading");
          setAnnouncement("Opening your template.");
          setOpenVersionId(versionId);
        }}
        onPreview={(id) => router.push(templatePreviewRoute(id))}
      />
    );
  }

  return (
    <AppShell active={TEMPLATE_ROOT}>
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {content}
    </AppShell>
  );
}
