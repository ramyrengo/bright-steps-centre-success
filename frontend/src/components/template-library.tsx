"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import { AppShell } from "./app-shell";
import {
  Dialog,
  EmptyState,
  ErrorState,
  Notice,
  PageHeader,
  SegmentedControl,
  StatusBadge,
} from "./design-system";
import {
  LIFECYCLE_LABEL,
  TEMPLATE_ROOT,
  lifecycleTone,
  templateRoute,
  type TemplateBuilderGateway,
  type TemplateLibrary,
  type TemplateLifecycle,
  type TemplateSummary,
} from "./template-builder-contract";
import { useTemplateBuilderGateway } from "./template-builder-gateway";

/**
 * The Area Manager template library.
 *
 * It answers one question — "which of my templates am I working on, and which
 * are live?" — and offers exactly one lead action, starting a new one.
 *
 * The unknown-is-never-zero rule applies here as it does on every other Centre
 * Success surface, and it matters: an Area Manager who is shown "no published
 * templates" when the library merely could not be read may go and build a
 * second copy of something that already runs in their centres.
 */

type LifecycleFilter = "ALL" | TemplateLifecycle;

const FILTERS: readonly { value: LifecycleFilter; label: string }[] = [
  { value: "ALL", label: "All" },
  { value: "DRAFT", label: "Drafts" },
  { value: "PUBLISHED", label: "Published" },
  { value: "RETIRED", label: "Retired" },
];

export function TemplateCard({ template }: Readonly<{ template: TemplateSummary }>) {
  const draft = template.lifecycle === "DRAFT";
  return (
    <li className="template-card" data-lifecycle={template.lifecycle}>
      <div className="template-card__head">
        <h3 className="template-card__title">{template.name}</h3>
        <StatusBadge tone={lifecycleTone(template.lifecycle)}>
          {LIFECYCLE_LABEL[template.lifecycle]}
        </StatusBadge>
      </div>
      {template.purpose ? <p className="template-card__purpose">{template.purpose}</p> : null}
      <p className="template-card__meta">
        {template.versionLabel}
        {/* A count the listing did not carry is left out. Printing "0
            questions" for a template that has some would be a claim about its
            content that this screen never established. */}
        {template.questionCount === undefined
          ? ""
          : ` · ${template.questionCount} question${template.questionCount === 1 ? "" : "s"}`}
        {" · "}
        {template.stateLabel}
      </p>
      {template.assignmentDescription || template.scheduleDescription ? (
        <dl className="template-card__facts">
          {template.assignmentDescription ? (
            <div>
              <dt>Runs at</dt>
              <dd>{template.assignmentDescription}</dd>
            </div>
          ) : null}
          {template.scheduleDescription ? (
            <div>
              <dt>Schedule</dt>
              <dd>{template.scheduleDescription}</dd>
            </div>
          ) : null}
        </dl>
      ) : null}
      <Link
        className={`button ${draft ? "button--accent" : "button--secondary"}`}
        href={templateRoute(template.templateId)}
      >
        {draft ? "Continue draft" : "Open"}
        <span className="visually-hidden"> — {template.name}</span>
      </Link>
    </li>
  );
}

/**
 * The new-template dialog.
 *
 * A template is created with a name and what it is for, and nothing else. Both
 * are asked for because the backend stores neither as optional: a template with
 * no stated purpose is refused outright, so offering the field as optional here
 * would be offering a draft that cannot be created. Everything that carries
 * operational consequence — questions, assignment, schedule — is still decided
 * in the editor, where it can be previewed before it is published.
 */
export function NewTemplateDialog({
  onDismiss,
  onCreate,
}: Readonly<{
  onDismiss: () => void;
  onCreate: (input: { name: string; purpose: string }) => Promise<void>;
}>) {
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [phase, setPhase] = useState<
    { kind: "editing" } | { kind: "creating" } | { kind: "refused"; reason: string } | { kind: "error" }
  >({ kind: "editing" });
  const ready = name.trim().length > 0 && purpose.trim().length > 0;
  const creating = phase.kind === "creating";

  const submit = useCallback(() => {
    if (!ready || creating) return;
    setPhase({ kind: "creating" });
    void onCreate({ name: name.trim(), purpose: purpose.trim() }).catch(
      (error: unknown) => {
        // A refusal carries the backend's own wording and is not an outage:
        // "you are not set up to start a template" and "the service is down"
        // lead a reader to completely different next steps.
        const reason = error instanceof Error ? error.message.trim() : "";
        setPhase(
          error instanceof TemplateCreationRefused && reason
            ? { kind: "refused", reason }
            : { kind: "error" },
        );
      },
    );
  }, [creating, name, onCreate, purpose, ready]);

  const submitOnEnter = (event: { key: string; preventDefault: () => void }) => {
    if (event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  return (
    <Dialog
      eyebrow="Template library"
      title="Start a new template"
      onDismiss={onDismiss}
      footer={
        <>
          <button className="button button--secondary" type="button" onClick={onDismiss}>
            Cancel
          </button>
          <button
            className="button button--accent"
            type="button"
            onClick={submit}
            disabled={!ready || creating}
          >
            {creating ? "Starting…" : "Start draft"}
          </button>
        </>
      }
    >
      <label>
        Template name
        <input
          data-autofocus
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={submitOnEnter}
        />
      </label>
      <label>
        What it is for
        <input
          type="text"
          value={purpose}
          placeholder="One line, in your own words"
          onChange={(event) => setPurpose(event.target.value)}
          onKeyDown={submitOnEnter}
        />
      </label>
      <p className="template-dialog__hint">
        It starts as a draft. Nothing runs in a centre until you publish it.
      </p>
      {phase.kind === "refused" ? (
        <div className="workflow-dialog__error" role="alert">
          <strong>This draft wasn&apos;t started</strong>
          <p>{phase.reason}</p>
        </div>
      ) : null}
      {phase.kind === "error" ? (
        <div className="workflow-dialog__error" role="alert">
          <strong>The draft couldn&apos;t be started</strong>
          <p>Nothing has been created. Please try again shortly.</p>
        </div>
      ) : null}
    </Dialog>
  );
}

/**
 * A refusal on the create path, carried as an error because that is the one
 * channel the dialog's submit already has.
 */
export class TemplateCreationRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "TemplateCreationRefused";
  }
}

export function TemplateLibraryView({
  library,
  onNewTemplate,
}: Readonly<{ library: TemplateLibrary; onNewTemplate?: () => void }>) {
  const [filter, setFilter] = useState<LifecycleFilter>("ALL");

  if (library.status === "unsupported") {
    return (
      <>
        {/* No eyebrow and no summary here: the headline is the module name, and
            the standing summary would claim "your templates" to a principal who
            has none and no authority to author any. */}
        <PageHeader title="Templates" />
        <EmptyState
          title="You're not set up to author templates"
          message="Your account is connected, but no centre currently gives you template authoring. Technical administration alone does not grant this."
        />
      </>
    );
  }

  const partial = library.status === "partial";
  const templates = library.templates;
  // Deliberately not memoised: it sits below an early return, where a hook
  // cannot go, and filtering a library-sized list costs nothing.
  const shown =
    filter === "ALL" ? templates : templates.filter((item) => item.lifecycle === filter);
  const drafts = templates.filter((item) => item.lifecycle === "DRAFT").length;

  const title = partial
    ? "Some templates couldn't be confirmed"
    : drafts === 0
      ? "Your templates"
      : drafts === 1
        ? "One draft is waiting"
        : `${drafts} drafts are waiting`;

  return (
    <>
      <PageHeader
        eyebrow="Centre Standards"
        title={title}
        summary="Reusable checks you write once and run in the centres you look after."
        actions={
          library.canCreate && onNewTemplate ? (
            <button className="button button--accent" type="button" onClick={onNewTemplate}>
              New template
            </button>
          ) : undefined
        }
      />

      {partial ? (
        <Notice title="Some templates couldn't be confirmed.">{library.warning}</Notice>
      ) : null}

      {templates.length > 0 ? (
        <>
          <div className="builder-toolbar">
            <SegmentedControl
              label="Filter templates by state"
              options={FILTERS}
              value={filter}
              onChange={setFilter}
            />
            <p className="builder-toolbar__count" role="status">
              {shown.length} of {templates.length} shown
            </p>
          </div>
          {shown.length > 0 ? (
            <ul className="template-list" role="list">
              {shown.map((template) => (
                <TemplateCard key={template.templateId} template={template} />
              ))}
            </ul>
          ) : (
            // Safe to state affirmatively: this filters a list already in hand,
            // so it is a fact about the filter and not a claim about the source.
            <EmptyState
              title={
                filter === "ALL"
                  ? "No templates match"
                  : `No ${LIFECYCLE_LABEL[filter].toLowerCase()} templates`
              }
              message="Nothing in your library is in this state right now. Change the filter to see the rest."
            />
          )}
        </>
      ) : partial ? (
        // Never the affirmative empty state: nothing was established.
        <EmptyState
          title="We couldn't confirm your templates"
          message="No template could be confirmed for you right now. This does not mean your library is empty — please try again shortly."
        />
      ) : (
        <EmptyState
          title="No templates yet"
          message="Templates you write appear here. Start one, add your questions, preview it on a phone, then publish it to your centres."
          mark="+"
        />
      )}
    </>
  );
}

/** Reserves the shape of the template cards rather than a generic bar stack. */
export function TemplateListSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">Opening your templates.</span>
      <ul className="template-list" aria-hidden="true">
        {[0, 1, 2].map((index) => (
          <li className="template-card template-card--skeleton" key={index}>
            <span className="skeleton__bar skeleton__bar--title" />
            <span className="skeleton__bar skeleton__bar--wide" />
            <span className="skeleton__bar skeleton__bar--short" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function TemplateLibraryWorkspace({
  gateway,
  onCreated,
}: Readonly<{
  gateway?: TemplateBuilderGateway;
  /** Overrides where a new draft opens. Present so the create path can be
   *  exercised without a router. */
  onCreated?: (templateId: string) => void;
}>) {
  const router = useRouter();
  // The real transport unless a caller supplies one. The hook runs
  // unconditionally, as it must, and building a gateway touches no endpoint.
  const liveGateway = useTemplateBuilderGateway();
  const active = gateway ?? liveGateway;
  const [library, setLibrary] = useState<TemplateLibrary>();
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [attempt, setAttempt] = useState(0);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [announcement, setAnnouncement] = useState("Opening your templates.");
  const created = useRef(false);

  useEffect(() => {
    let current = true;
    void active.loadLibrary().then(
      (value) => {
        if (!current) return;
        setLibrary(value);
        setState("ready");
        setAnnouncement(
          value.status === "partial"
            ? "Some templates couldn't be confirmed."
            : "Your templates are ready.",
        );
      },
      () => {
        if (!current) return;
        setState("error");
        setAnnouncement("Your templates could not be loaded.");
      },
    );
    return () => {
      current = false;
    };
  }, [active, attempt]);

  const retry = useCallback(() => {
    setState("loading");
    // Put the live region back to the loading wording: left saying "could not
    // be loaded", a second identical failure changes no text and announces
    // nothing at all.
    setAnnouncement("Opening your templates.");
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    if (state === "loading") return;
    document.querySelector<HTMLElement>("[data-page-focus]")?.focus();
  }, [library, state]);

  const create = useCallback(
    async (input: { name: string; purpose: string }) => {
      // A synchronous latch. Two clicks dispatched in one batch would each see
      // the pre-render state and create two templates.
      if (created.current) return;
      created.current = true;
      try {
        const result = await active.createTemplate(input);
        if (result.outcome === "REFUSED") {
          // Nothing was created, so the latch is released and the dialog says
          // why in the backend's own words rather than as an outage.
          created.current = false;
          throw new TemplateCreationRefused(result.reason);
        }
        setDialogOpen(false);
        if (onCreated) onCreated(result.templateId);
        else router.push(templateRoute(result.templateId));
      } catch (error) {
        created.current = false;
        throw error;
      }
    },
    [active, onCreated, router],
  );

  let content;
  if (state === "loading") {
    content = <TemplateListSkeleton />;
  } else if (state === "error" || !library) {
    content = (
      <ErrorState
        title="Your templates couldn't be loaded"
        message="Nothing has been assumed and nothing has changed. This does not mean your library is empty."
        onRetry={retry}
      />
    );
  } else {
    content = (
      <TemplateLibraryView library={library} onNewTemplate={() => setDialogOpen(true)} />
    );
  }

  return (
    <AppShell active={TEMPLATE_ROOT}>
      <p className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </p>
      {content}
      {dialogOpen ? (
        <NewTemplateDialog onDismiss={() => setDialogOpen(false)} onCreate={create} />
      ) : null}
    </AppShell>
  );
}
