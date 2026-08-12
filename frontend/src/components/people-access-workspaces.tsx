"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type FormEvent,
} from "react";

import {
  ErrCode,
  isAPIError,
  type people_access,
} from "../lib/client.generated";
import { useCentreSuccessAuthentication } from "../lib/centre-success-authentication";
import { useAuthenticatedCentreSuccessClient } from "../lib/centre-success-client";
import {
  BusinessWorkspaceGate,
  formatDate,
  StatusPill,
  WorkflowShell,
  WorkflowState,
} from "./workflow-shell";

type PeopleResponse = people_access.PeopleListResponse;
type Person = people_access.PersonSummary;
type Invitation = people_access.InvitationSummary;
type Options = people_access.PeopleAccessOptionsResponse;

function statusTone(status: string): "neutral" | "positive" | "warning" | "critical" {
  if (status === "active" || status === "ACTIVATED") return "positive";
  if (["revoked", "CANCELLED", "EXPIRED", "ADMINISTRATOR_REVIEW"].includes(status)) return "critical";
  if (["suspended", "AWAITING_PRIVILEGED_APPROVAL", "SENT"].includes(status)) return "warning";
  return "neutral";
}

function humaniseStatus(status: string): string {
  return status
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^./, (letter) => letter.toUpperCase());
}

function errorReason(error: unknown): string | undefined {
  if (!isAPIError(error) || typeof error.details !== "object" || error.details === null) {
    return undefined;
  }
  const reason = Reflect.get(error.details, "reason");
  return typeof reason === "string" ? reason : undefined;
}

export function peopleAccessFailureMessage(error: unknown): string {
  const reason = errorReason(error);
  if (reason === "last_administrator") {
    return "This change can't be completed because the organisation must retain at least one active System Administrator.";
  }
  if (reason === "version_conflict" || (isAPIError(error) && error.code === ErrCode.Aborted)) {
    return "This access record changed while you were editing it. Refresh and review the latest access before trying again.";
  }
  if (reason === "privileged_approval_required" || reason === "independent_approval_required") {
    return "This change requires approval from another authorised System Administrator.";
  }
  if (isAPIError(error) && (error.code === ErrCode.PermissionDenied || error.code === ErrCode.Unauthenticated)) {
    return "Your current Centre Success access does not allow this change.";
  }
  return "The change could not be completed. Refresh and try again.";
}

function namedInvitationScope(scope: people_access.InvitationScopeSummary): string {
  if (scope.scopeType === "organisation") return `Organisation · ${scope.displayName}`;
  if (scope.scopeType === "organisational_unit") return `Organisational unit · ${scope.displayName}`;
  return `Centre · ${scope.displayName}`;
}

function ConfirmationDialog({
  title,
  description,
  targetName,
  reasonLabel,
  confirmLabel,
  reason,
  error,
  working,
  destructive = false,
  onReason,
  onCancel,
  onConfirm,
}: Readonly<{
  title: string;
  description: string;
  targetName: string;
  reasonLabel: string;
  confirmLabel: string;
  reason: string;
  error?: string;
  working: boolean;
  destructive?: boolean;
  onReason: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}>) {
  const titleId = useId();
  const errorId = useId();
  return (
    <div className="workflow-dialog-backdrop">
      <section aria-describedby={error ? errorId : undefined} aria-labelledby={titleId} aria-modal="true" className="workflow-dialog workflow-stack" role="dialog">
        <div>
          <p className="foundation-eyebrow">Confirm access change</p>
          <h2 id={titleId}>{title}</h2>
          <p><strong>{targetName}</strong></p>
          <p>{description}</p>
        </div>
        <label>{reasonLabel}<textarea autoFocus maxLength={500} onChange={(event) => onReason(event.target.value)} rows={4} value={reason} /></label>
        {error ? <div className="workflow-dialog__error" id={errorId} role="alert"><strong>Action not completed.</strong><p>{error}</p></div> : null}
        <div className="people-actions">
          <button className="workflow-button workflow-button--secondary" disabled={working} onClick={onCancel} type="button">Go back</button>
          <button className={`workflow-button${destructive ? " workflow-button--danger" : ""}`} disabled={working || !reason.trim()} onClick={onConfirm} type="button">{working ? "Applying…" : confirmLabel}</button>
        </div>
      </section>
    </div>
  );
}

export function PeopleAccessWorkspace() {
  const client = useAuthenticatedCentreSuccessClient();
  const [data, setData] = useState<PeopleResponse | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    void client.foundation.listPeople().then(
      (response) => current && setData(response),
      () => current && setError(true),
    );
    return () => { current = false; };
  }, [attempt, client]);

  const filtered = useMemo(() => {
    if (!data) return null;
    const needle = query.trim().toLowerCase();
    if (!needle) return data;
    return {
      people: data.people.filter((person) =>
        `${person.displayName} ${person.status} ${person.assignments.map((item) => item.roleName).join(" ")}`.toLowerCase().includes(needle)),
      invitations: data.invitations.filter((invitation) =>
        `${invitation.displayName} ${invitation.intendedEmail} ${invitation.status}`.toLowerCase().includes(needle)),
    };
  }, [data, query]);

  return (
    <BusinessWorkspaceGate>
      <WorkflowShell
        eyebrow="Administration"
        title="People & Access"
        summary="Invite people, review Centre Success access and manage independent role assignments. Microsoft identity and Centre Success permissions remain separate."
      >
        <div className="people-toolbar">
          <label>
            <span>Search people and invitations</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" />
          </label>
          <Link className="workflow-link-button" href="/admin/people/invite">Invite user</Link>
        </div>
        {error ? <WorkflowState kind="error" title="People & Access unavailable" message="Your authorised organisation view could not be loaded." onRetry={() => { setError(false); setAttempt((value) => value + 1); }} /> : null}
        {!error && filtered === null ? <WorkflowState kind="loading" title="Loading People & Access" message="Checking current PostgreSQL permissions and access records…" /> : null}
        {filtered ? (
          <>
            <section aria-labelledby="people-title">
              <div className="section-heading"><h2 id="people-title">People</h2><span>{filtered.people.length} shown</span></div>
              {filtered.people.length === 0 ? <WorkflowState kind="empty" title="No people found" message="Try another search or invite a person." /> : null}
              <div className="card-grid">
                {filtered.people.map((person) => (
                  <article className="workflow-card" key={person.principalId}>
                    <StatusPill tone={statusTone(person.status)}>{humaniseStatus(person.status)}</StatusPill>
                    <h3>{person.displayName}</h3>
                    <dl className="people-facts">
                      <div><dt>Microsoft identity</dt><dd>{person.microsoftIdentity === "connected" ? "Connected" : "Not connected"}</dd></div>
                      <div><dt>Centre Success access</dt><dd>{person.assignments.length} active assignment{person.assignments.length === 1 ? "" : "s"}</dd></div>
                    </dl>
                    <Link className="workflow-link" href={`/admin/people/${person.principalId}`}>View person</Link>
                  </article>
                ))}
              </div>
            </section>
            <section aria-labelledby="invitations-title">
              <div className="section-heading"><h2 id="invitations-title">Invitations</h2><span>{filtered.invitations.length} shown</span></div>
              {filtered.invitations.length === 0 ? <WorkflowState kind="empty" title="No invitations found" message="New invitation drafts and delivery states will appear here." /> : null}
              <div className="card-grid">
                {filtered.invitations.map((invitation) => (
                  <article className="workflow-card" key={invitation.id}>
                    <StatusPill tone={statusTone(invitation.status)}>{humaniseStatus(invitation.status)}</StatusPill>
                    <h3>{invitation.displayName}</h3>
                    <p>{invitation.intendedEmail}</p>
                    <p>{invitation.privilegeClass === "STANDARD" ? "Standard activation" : "Independent approval required"}</p>
                    <Link className="workflow-link" href={`/admin/people/invitations/${invitation.id}`}>Review invitation</Link>
                  </article>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </WorkflowShell>
    </BusinessWorkspaceGate>
  );
}

function assignmentFromSelection(
  role: Options["roles"][number],
  selectedCentres: string[],
  flexibleScopeType: "organisation" | "organisational_unit" | "centre" = "centre",
  organisationalUnitId = "",
): people_access.ProposedAssignment {
  if (role.scopeMode === "organisation" || (role.scopeMode === "flexible" && flexibleScopeType === "organisation")) {
    return { roleKey: role.roleKey, scopes: [{ scopeType: "organisation" }] };
  }
  if (role.scopeMode === "flexible" && flexibleScopeType === "organisational_unit") {
    return { roleKey: role.roleKey, scopes: [{ scopeType: "organisational_unit", organisationalUnitId }] };
  }
  return {
    roleKey: role.roleKey,
    scopes: selectedCentres.map((centreId) => ({ scopeType: "centre" as const, centreId })),
  };
}

export function InvitePersonWorkspace() {
  const client = useAuthenticatedCentreSuccessClient();
  const router = useRouter();
  const [options, setOptions] = useState<Options | null>(null);
  const [roleKey, setRoleKey] = useState("");
  const [selectedCentres, setSelectedCentres] = useState<string[]>([]);
  const [flexibleScopeType, setFlexibleScopeType] = useState<"organisation" | "organisational_unit" | "centre">("organisation");
  const [organisationalUnitId, setOrganisationalUnitId] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  useEffect(() => {
    let current = true;
    void client.foundation.getPeopleOptions().then(
      (response) => {
        if (!current) return;
        setOptions(response);
        setRoleKey(response.roles[0]?.roleKey ?? "");
      },
      () => current && setError("Invitation options are unavailable."),
    );
    return () => { current = false; };
  }, [client]);

  const role = options?.roles.find((item) => item.roleKey === roleKey);
  const submit = useCallback(async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!role) return;
    setWorking(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const invitation = await client.foundation.createInvitation({
        email: String(form.get("email") ?? ""),
        displayName: String(form.get("displayName") ?? ""),
        reason: String(form.get("reason") ?? ""),
        assignments: [assignmentFromSelection(role, selectedCentres, flexibleScopeType, organisationalUnitId)],
      });
      router.push(`/admin/people/invitations/${invitation.id}`);
    } catch {
      setError("The invitation draft could not be created. Check the reviewed role and scope.");
      setWorking(false);
    }
  }, [client, flexibleScopeType, organisationalUnitId, role, router, selectedCentres]);

  const flexibleSelectionMissing = role?.scopeMode === "flexible" && (
    flexibleScopeType === "centre" ? selectedCentres.length === 0
      : flexibleScopeType === "organisational_unit" ? !organisationalUnitId
        : false
  );

  return (
    <BusinessWorkspaceGate>
      <WorkflowShell eyebrow="People & Access" title="Invite user" summary="Create a reviewed pending package. No Centre Success membership or access exists until verified activation.">
        {!options && !error ? <WorkflowState kind="loading" title="Loading invitation options" message="Loading active canonical roles and valid scope choices…" /> : null}
        {error ? <p className="workflow-notice" role="alert">{error}</p> : null}
        {options && role ? (
          <form className="people-form workflow-card workflow-card--detail" onSubmit={submit}>
            <label>Employee name<input name="displayName" required maxLength={200} /></label>
            <label>Delivery and correlation email<input name="email" type="email" required autoComplete="email" /></label>
            <label>Canonical role<select value={roleKey} onChange={(event) => { setRoleKey(event.target.value); setSelectedCentres([]); setOrganisationalUnitId(""); setFlexibleScopeType("organisation"); }}>
              {options.roles.map((item) => <option value={item.roleKey} key={item.roleKey}>{item.name}</option>)}
            </select></label>
            {role.scopeMode === "flexible" ? (
              <fieldset>
                <legend>Select explicit scope</legend>
                <label>Scope type<select value={flexibleScopeType} onChange={(event) => { setFlexibleScopeType(event.target.value as typeof flexibleScopeType); setSelectedCentres([]); setOrganisationalUnitId(""); }}>
                  <option value="organisation">Whole organisation</option>
                  <option value="organisational_unit">Organisational unit</option>
                  <option value="centre">Explicit centres</option>
                </select></label>
                {flexibleScopeType === "organisational_unit" ? <label>Organisational unit<select value={organisationalUnitId} onChange={(event) => setOrganisationalUnitId(event.target.value)} required><option value="">Select a unit</option>{options.organisationalUnits.map((unit) => <option value={unit.id} key={unit.id}>{unit.name} · {unit.kind}</option>)}</select></label> : null}
                {flexibleScopeType === "centre" ? <div className="people-checklist">{options.centres.map((centre) => <label key={centre.id}><input type="checkbox" checked={selectedCentres.includes(centre.id)} onChange={(event) => setSelectedCentres((current) => event.target.checked ? [...current, centre.id] : current.filter((id) => id !== centre.id))} />{centre.name}</label>)}</div> : null}
                {flexibleScopeType === "organisation" ? <p className="workflow-notice">This package uses explicit organisation scope and requires independent approval.</p> : null}
              </fieldset>
            ) : role.scopeMode !== "organisation" ? (
              <fieldset>
                <legend>{role.scopeMode === "single_centre" ? "Select one centre" : "Select explicit centres"}</legend>
                <div className="people-checklist">
                  {options.centres.map((centre) => (
                    <label key={centre.id}><input
                      type={role.scopeMode === "single_centre" ? "radio" : "checkbox"}
                      name="centre"
                      checked={selectedCentres.includes(centre.id)}
                      onChange={(event) => setSelectedCentres((current) =>
                        role.scopeMode === "single_centre"
                          ? (event.target.checked ? [centre.id] : [])
                          : event.target.checked ? [...current, centre.id] : current.filter((id) => id !== centre.id))}
                    />{centre.name}</label>
                  ))}
                </div>
              </fieldset>
            ) : <p className="workflow-notice">This role uses explicit organisation scope.</p>}
            <label>Business reason<textarea name="reason" required maxLength={500} rows={4} /></label>
            <aside className="workflow-notice" aria-label="Activation review">
              <strong>{role.approval === "standard" ? "Standard package" : "Privileged or review package"}</strong>
              <p>{role.approval === "standard" ? "Verified acceptance may activate this reviewed package." : "A different current System Administrator must approve this exact package before activation."}</p>
            </aside>
            <button className="workflow-button" disabled={working || (role.scopeMode !== "organisation" && role.scopeMode !== "flexible" && selectedCentres.length === 0) || flexibleSelectionMissing} type="submit">
              {working ? "Creating draft…" : "Review invitation draft"}
            </button>
          </form>
        ) : null}
      </WorkflowShell>
    </BusinessWorkspaceGate>
  );
}

export function InvitationReviewWorkspace({ invitationId }: Readonly<{ invitationId: string }>) {
  const client = useAuthenticatedCentreSuccessClient();
  const packageTitleId = useId();
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [approvalReason, setApprovalReason] = useState("");
  const [cancellationRequested, setCancellationRequested] = useState(false);
  const [cancellationReason, setCancellationReason] = useState("");
  const [cancellationError, setCancellationError] = useState("");

  const load = useCallback(() => {
    void client.foundation.getInvitation(invitationId).then(
      (response) => { setInvitation(response); setError(""); },
      (failure) => setError(peopleAccessFailureMessage(failure)),
    );
  }, [client, invitationId]);
  useEffect(load, [load]);

  const mutate = useCallback(async (action: "send" | "resend" | "approve") => {
    if (!invitation) return;
    setWorking(true);
    setCancellationError("");
    try {
      const request = {
        lockVersion: invitation.lockVersion,
        ...(action === "approve" ? { reason: approvalReason } : {}),
      };
      const updated = action === "send"
        ? await client.foundation.sendInvitation(invitationId, request)
        : action === "resend"
          ? await client.foundation.resendInvitation(invitationId, request)
          : await client.foundation.approveInvitation(invitationId, request);
      setInvitation(updated);
      setApprovalReason("");
    } catch (failure) {
      setError(peopleAccessFailureMessage(failure));
    } finally {
      setWorking(false);
    }
  }, [approvalReason, client, invitation, invitationId]);

  const confirmCancellation = useCallback(async () => {
    if (!invitation) return;
    setWorking(true);
    setError("");
    try {
      const updated = await client.foundation.cancelInvitationEndpoint(invitationId, {
        lockVersion: invitation.lockVersion,
        reason: cancellationReason,
      });
      setInvitation(updated);
      setCancellationRequested(false);
      setCancellationReason("");
      setCancellationError("");
    } catch (failure) {
      setCancellationError(peopleAccessFailureMessage(failure));
    } finally {
      setWorking(false);
    }
  }, [cancellationReason, client, invitation, invitationId]);

  return (
    <BusinessWorkspaceGate>
      <WorkflowShell eyebrow="People & Access" title="Invitation review" summary="Review delivery, identity correlation and approval without exposing invitation secrets or Microsoft claims.">
        {error ? <WorkflowState kind="error" title="Invitation action unavailable" message={error} onRetry={() => { setError(""); load(); }} /> : null}
        {!invitation && !error ? <WorkflowState kind="loading" title="Loading invitation" message="Checking current state and reviewed package…" /> : null}
        {invitation ? (
          <article className="workflow-card workflow-card--detail workflow-stack">
            <div><StatusPill tone={statusTone(invitation.status)}>{humaniseStatus(invitation.status)}</StatusPill><h2>{invitation.displayName}</h2><p>{invitation.intendedEmail}</p></div>
            <dl className="people-facts">
              <div><dt>Organisation</dt><dd>{invitation.organisationName}</dd></div>
              <div><dt>Requested by</dt><dd>{invitation.requestedByName}</dd></div>
              <div><dt>Package classification</dt><dd>{humaniseStatus(invitation.privilegeClass)}</dd></div>
              <div><dt>Microsoft identity</dt><dd>{invitation.status === "ACTIVATED" ? "Connected" : invitation.status === "AWAITING_PRIVILEGED_APPROVAL" ? "Verified, awaiting approval" : "Not connected"}</dd></div>
              <div><dt>Centre Success access</dt><dd>{invitation.status === "ACTIVATED" ? "Activated" : "No active access"}</dd></div>
              <div><dt>Expiry</dt><dd>{invitation.expiresAt ? formatDate(invitation.expiresAt) : "Not sent"}</dd></div>
            </dl>
            <section aria-labelledby={packageTitleId}>
              <h3 id={packageTitleId}>Reviewed access package · version {invitation.packageVersion}</h3>
              <p><strong>Request reason:</strong> {invitation.requestReason}</p>
              <div className="invitation-package-list">
                {invitation.assignments.map((assignment, index) => (
                  <article className="invitation-package" key={`${assignment.roleKey}-${index}`}>
                    <h4>{assignment.roleName} · role version {assignment.roleVersion}</h4>
                    <p>{humaniseStatus(assignment.privilegeClass)} access</p>
                    <dl className="people-facts">
                      <div><dt>Effective from</dt><dd>{formatDate(assignment.effectiveFrom)}</dd></div>
                      <div><dt>Effective to</dt><dd>{assignment.effectiveTo ? formatDate(assignment.effectiveTo) : "No scheduled end"}</dd></div>
                    </dl>
                    <ul className="scope-summary">{assignment.scopes.map((scope) => <li key={`${scope.scopeType}-${"centreId" in scope ? scope.centreId : "organisationalUnitId" in scope ? scope.organisationalUnitId : scope.displayName}`}>{namedInvitationScope(scope)}</li>)}</ul>
                  </article>
                ))}
              </div>
            </section>
            {invitation.status === "ADMINISTRATOR_REVIEW" ? <p className="workflow-notice" role="status">Identity correlation needs administrator review. No access was activated.</p> : null}
            {invitation.status === "AWAITING_PRIVILEGED_APPROVAL" ? <p className="workflow-notice" role="status">A different current System Administrator must approve this exact package.</p> : null}
            {invitation.status === "AWAITING_PRIVILEGED_APPROVAL" ? <label>Approval reason<textarea maxLength={500} value={approvalReason} onChange={(event) => setApprovalReason(event.target.value)} rows={3} /></label> : null}
            {invitation.status === "EXPIRED" ? <aside className="workflow-notice"><strong>This invitation expired and cannot be resent.</strong><p>Create a new invitation so the access package, expiry and correlation code are reviewed again.</p><Link className="workflow-link" href="/admin/people/invite">Create new invitation</Link></aside> : null}
            <div className="people-actions">
              {invitation.status === "DRAFT" ? <button className="workflow-button" disabled={working} onClick={() => void mutate("send")} type="button">Send invitation</button> : null}
              {["SENT", "ADMINISTRATOR_REVIEW"].includes(invitation.status) ? <button className="workflow-button workflow-button--secondary" disabled={working} onClick={() => void mutate("resend")} type="button">Rotate and resend</button> : null}
              {invitation.status === "AWAITING_PRIVILEGED_APPROVAL" ? <button className="workflow-button" disabled={working || !approvalReason.trim()} onClick={() => void mutate("approve")} type="button">Approve exact package</button> : null}
              {!["ACTIVATED", "CANCELLED", "EXPIRED"].includes(invitation.status) ? <button className="workflow-button workflow-button--danger" disabled={working} onClick={() => { setCancellationError(""); setCancellationRequested(true); }} type="button">Cancel invitation</button> : null}
            </div>
          </article>
        ) : null}
        {cancellationRequested && invitation ? <ConfirmationDialog
          title="Cancel invitation?"
          description="Cancellation takes effect immediately and makes the current invitation code unusable. This does not create Centre Success access."
          targetName={invitation.displayName}
          reasonLabel="Cancellation reason"
          confirmLabel="Cancel invitation"
          reason={cancellationReason}
          error={cancellationError}
          working={working}
          destructive
          onReason={setCancellationReason}
          onCancel={() => { setCancellationRequested(false); setCancellationReason(""); setCancellationError(""); }}
          onConfirm={() => void confirmCancellation()}
        /> : null}
      </WorkflowShell>
    </BusinessWorkspaceGate>
  );
}

export function PersonWorkspace({ principalId }: Readonly<{ principalId: string }>) {
  const client = useAuthenticatedCentreSuccessClient();
  const [person, setPerson] = useState<Person | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    void client.foundation.getPerson(principalId).then(
      (response) => current && setPerson(response.person),
      () => current && setError(true),
    );
    return () => { current = false; };
  }, [client, principalId]);
  return (
    <BusinessWorkspaceGate>
      <WorkflowShell eyebrow="People & Access" title={person?.displayName ?? "Person"} summary="Microsoft identity connection and Centre Success access are shown separately.">
        {error ? <WorkflowState kind="error" title="Person unavailable" message="This person is not available in your current organisation scope." /> : null}
        {!person && !error ? <WorkflowState kind="loading" title="Loading person" message="Checking current principal and assignment state…" /> : null}
        {person ? <article className="workflow-card workflow-card--detail"><StatusPill tone={statusTone(person.status)}>{humaniseStatus(person.status)}</StatusPill><dl className="people-facts"><div><dt>Microsoft identity</dt><dd>{person.microsoftIdentity === "connected" ? "Connected" : "Not connected"}</dd></div><div><dt>Centre Success access</dt><dd>{person.assignments.length} active assignment{person.assignments.length === 1 ? "" : "s"}</dd></div></dl><div className="people-actions"><Link className="workflow-link-button" href={`/admin/people/${person.principalId}/access`}>Manage access</Link><Link className="workflow-link-button workflow-link-button--secondary" href={`/admin/people/${person.principalId}/history`}>View history</Link></div></article> : null}
      </WorkflowShell>
    </BusinessWorkspaceGate>
  );
}

export function PersonAccessWorkspace({ principalId }: Readonly<{ principalId: string }>) {
  const client = useAuthenticatedCentreSuccessClient();
  const [person, setPerson] = useState<Person | null>(null);
  const [options, setOptions] = useState<Options | null>(null);
  const [addRoleKey, setAddRoleKey] = useState("");
  const [addSelectedCentres, setAddSelectedCentres] = useState<string[]>([]);
  const [addReason, setAddReason] = useState("");
  const [portfolio, setPortfolio] = useState<null | {
    assignmentId: string;
    roleName: string;
    scopeMode: "multi_centre" | "single_centre";
    initialCentres: string[];
    selectedCentres: string[];
  }>(null);
  const [portfolioReason, setPortfolioReason] = useState("");
  const [portfolioError, setPortfolioError] = useState("");
  const [removal, setRemoval] = useState<null | { assignmentId: string; roleName: string }>(null);
  const [removalReason, setRemovalReason] = useState("");
  const [removalError, setRemovalError] = useState("");
  const [lifecycleAction, setLifecycleAction] = useState<null | "suspend" | "reactivate" | "revoke">(null);
  const [lifecycleReason, setLifecycleReason] = useState("");
  const [lifecycleError, setLifecycleError] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);

  const load = useCallback(() => {
    void Promise.all([client.foundation.getPersonAccess(principalId), client.foundation.getPeopleOptions()]).then(
      ([response, optionResponse]) => {
        setPerson(response.person);
        setOptions(optionResponse);
        setAddRoleKey((current) => current || optionResponse.roles.find((role) => role.approval === "standard")?.roleKey || "");
        setError("");
      },
      (failure) => setError(peopleAccessFailureMessage(failure)),
    );
  }, [client, principalId]);
  useEffect(load, [load]);

  const selectedRole = options?.roles.find((role) => role.roleKey === addRoleKey);
  const centreName = useCallback((centreId: string) => options?.centres.find((centre) => centre.id === centreId)?.name ?? "Centre no longer in current scope", [options]);
  const assignmentScopeNames = useCallback((assignment: Person["assignments"][number]) => assignment.scopes.map((scope) => {
    if (scope.scopeType === "centre") return `Centre · ${centreName(scope.centreId)}`;
    if (scope.scopeType === "organisational_unit") return `Organisational unit · ${options?.organisationalUnits.find((unit) => unit.id === scope.organisationalUnitId)?.name ?? "Unit no longer in current scope"}`;
    return "Whole organisation";
  }), [centreName, options]);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (!person || !selectedRole) return;
    setWorking(true);
    setError("");
    try {
      const response = await client.foundation.addPersonAssignment(principalId, {
        principalLockVersion: person.lockVersion,
        reason: addReason,
        assignment: assignmentFromSelection(selectedRole, addSelectedCentres),
      });
      setPerson(response.person);
      setAddReason("");
      setAddSelectedCentres([]);
    } catch (failure) { setError(peopleAccessFailureMessage(failure)); } finally { setWorking(false); }
  };

  const confirmRemoval = async () => {
    if (!person || !removal || !removalReason.trim()) return;
    setWorking(true);
    setRemovalError("");
    try {
      const response = await client.foundation.removePersonAssignment(principalId, removal.assignmentId, {
        principalLockVersion: person.lockVersion, reason: removalReason,
      });
      setPerson(response.person);
      setRemoval(null);
      setRemovalReason("");
      setRemovalError("");
    } catch (failure) { setRemovalError(peopleAccessFailureMessage(failure)); } finally { setWorking(false); }
  };

  const savePortfolio = async () => {
    if (!person || !portfolio || !portfolioReason.trim()) return;
    setWorking(true);
    setPortfolioError("");
    try {
      const response = await client.foundation.replacePersonAssignmentScope(principalId, portfolio.assignmentId, {
        principalLockVersion: person.lockVersion, reason: portfolioReason,
        replacementScopes: portfolio.selectedCentres.map((centreId) => ({ scopeType: "centre" as const, centreId })),
      });
      setPerson(response.person);
      setPortfolio(null);
      setPortfolioReason("");
      setPortfolioError("");
    } catch (failure) { setPortfolioError(peopleAccessFailureMessage(failure)); } finally { setWorking(false); }
  };

  const confirmLifecycle = async () => {
    if (!person || !lifecycleAction || !lifecycleReason.trim()) return;
    setWorking(true);
    setLifecycleError("");
    try {
      const request = { reason: lifecycleReason, lockVersion: person.lockVersion };
      if (lifecycleAction === "suspend") await client.foundation.suspendPerson(principalId, request);
      else if (lifecycleAction === "reactivate") await client.foundation.reactivatePerson(principalId, request);
      else await client.foundation.revokePerson(principalId, request);
      setLifecycleAction(null);
      setLifecycleReason("");
      setLifecycleError("");
      load();
    } catch (failure) { setLifecycleError(peopleAccessFailureMessage(failure)); } finally { setWorking(false); }
  };

  const portfolioUnchanged = portfolio ? [...portfolio.initialCentres].sort().join("|") === [...portfolio.selectedCentres].sort().join("|") : true;
  const portfolioSelectionInvalid = portfolio ? portfolio.selectedCentres.length === 0 || (portfolio.scopeMode === "single_centre" && portfolio.selectedCentres.length !== 1) : true;
  const addSelectionInvalid = selectedRole ? selectedRole.scopeMode !== "organisation" && addSelectedCentres.length === 0 : true;

  return (
    <BusinessWorkspaceGate>
      <WorkflowShell eyebrow="People & Access" title="Manage access" summary="Assignments remain independent. Changes are effective-dated and re-authorised from PostgreSQL on every request.">
        {error ? <WorkflowState kind="error" title="Access change unavailable" message={error} onRetry={() => { setError(""); load(); }} /> : null}
        {!person || !options ? (!error ? <WorkflowState kind="loading" title="Loading current access" message="Checking active assignments and valid scope options…" /> : null) : (
          <div className="workflow-stack">
            <article className="workflow-card">
              <div className="section-heading"><h2>{person.displayName}</h2><StatusPill tone={statusTone(person.status)}>{humaniseStatus(person.status)}</StatusPill></div>
              <ul className="summary-list">{person.assignments.map((assignment) => {
                const role = options.roles.find((candidate) => candidate.roleKey === assignment.roleKey);
                const centreOnly = assignment.scopes.every((scope) => scope.scopeType === "centre");
                return <li key={assignment.id}><span><strong>{assignment.roleName}</strong><small>{assignmentScopeNames(assignment).join(", ")}</small></span><span className="people-actions">
                  {centreOnly && (role?.scopeMode === "multi_centre" || role?.scopeMode === "single_centre") ? <button className="workflow-button workflow-button--secondary" disabled={working} onClick={() => { setPortfolioError(""); setPortfolio({ assignmentId: assignment.id, roleName: assignment.roleName, scopeMode: role.scopeMode as "multi_centre" | "single_centre", initialCentres: assignment.scopes.flatMap((scope) => scope.scopeType === "centre" ? [scope.centreId] : []), selectedCentres: assignment.scopes.flatMap((scope) => scope.scopeType === "centre" ? [scope.centreId] : []) }); }} type="button">Edit centre portfolio</button> : null}
                  <button className="workflow-button workflow-button--danger" disabled={working} onClick={() => { setRemovalError(""); setRemoval({ assignmentId: assignment.id, roleName: assignment.roleName }); }} type="button">End assignment</button>
                </span></li>;
              })}</ul>
            </article>
            <form className="people-form workflow-card" onSubmit={add}>
              <h2>Add independent assignment</h2>
              <label>Standard role<select value={addRoleKey} onChange={(event) => { setAddRoleKey(event.target.value); setAddSelectedCentres([]); }}>{options.roles.filter((role) => role.approval === "standard").map((role) => <option value={role.roleKey} key={role.roleKey}>{role.name}</option>)}</select></label>
              {selectedRole?.scopeMode !== "organisation" ? <fieldset><legend>{selectedRole?.scopeMode === "single_centre" ? "Select one centre" : "Select centre portfolio"}</legend><div className="people-checklist">{options.centres.map((centre) => <label key={centre.id}><input type={selectedRole?.scopeMode === "single_centre" ? "radio" : "checkbox"} name="new-assignment-centre" checked={addSelectedCentres.includes(centre.id)} onChange={(event) => setAddSelectedCentres((current) => selectedRole?.scopeMode === "single_centre" ? (event.target.checked ? [centre.id] : []) : event.target.checked ? [...current, centre.id] : current.filter((id) => id !== centre.id))} />{centre.name}</label>)}</div></fieldset> : <p className="workflow-notice">This role uses explicit organisation scope.</p>}
              <label>Assignment reason<textarea value={addReason} onChange={(event) => setAddReason(event.target.value)} maxLength={500} rows={3} /></label>
              <button className="workflow-button" disabled={working || !addReason.trim() || addSelectionInvalid} type="submit">Add assignment</button>
            </form>
            <article className="workflow-card"><h2>Lifecycle controls</h2><p>Each suspension, reactivation or permanent revocation requires a separate review and reason.</p><div className="people-actions">{person.status === "active" ? <button className="workflow-button workflow-button--secondary" disabled={working} onClick={() => { setLifecycleError(""); setLifecycleAction("suspend"); }} type="button">Suspend access</button> : null}{person.status === "suspended" ? <button className="workflow-button" disabled={working} onClick={() => { setLifecycleError(""); setLifecycleAction("reactivate"); }} type="button">Reactivate principal</button> : null}{person.status !== "revoked" ? <button className="workflow-button workflow-button--danger" disabled={working} onClick={() => { setLifecycleError(""); setLifecycleAction("revoke"); }} type="button">Revoke permanently</button> : <p>Revocation is terminal.</p>}</div></article>
          </div>
        )}
        {portfolio && person && options ? <div className="workflow-dialog-backdrop"><section aria-labelledby="portfolio-dialog-title" aria-modal="true" className="workflow-dialog workflow-stack" role="dialog">
          <div><p className="foundation-eyebrow">Review full portfolio</p><h2 id="portfolio-dialog-title">Edit centre portfolio</h2><p><strong>{person.displayName} · {portfolio.roleName}</strong></p><p>Select the complete resulting portfolio. Saving atomically replaces the existing centre set for this assignment.</p></div>
          <fieldset><legend>Authorised centres</legend><div className="people-checklist">{options.centres.map((centre) => <label key={centre.id}><input type={portfolio.scopeMode === "single_centre" ? "radio" : "checkbox"} name="portfolio-centre" checked={portfolio.selectedCentres.includes(centre.id)} onChange={(event) => setPortfolio((current) => current ? { ...current, selectedCentres: current.scopeMode === "single_centre" ? (event.target.checked ? [centre.id] : []) : event.target.checked ? [...current.selectedCentres, centre.id] : current.selectedCentres.filter((id) => id !== centre.id) } : current)} />{centre.name}</label>)}</div></fieldset>
          <aside className="workflow-notice" aria-label="Resulting portfolio"><strong>Resulting portfolio</strong><ul>{portfolio.selectedCentres.map((id) => <li key={id}>{centreName(id)}</li>)}</ul>{portfolio.selectedCentres.length === 0 ? <p>No centres selected.</p> : null}</aside>
          <label>Portfolio change reason<textarea autoFocus maxLength={500} onChange={(event) => setPortfolioReason(event.target.value)} rows={4} value={portfolioReason} /></label>
          {portfolioError ? <div className="workflow-dialog__error" role="alert"><strong>Action not completed.</strong><p>{portfolioError}</p></div> : null}
          <div className="people-actions"><button className="workflow-button workflow-button--secondary" disabled={working} onClick={() => { setPortfolio(null); setPortfolioReason(""); setPortfolioError(""); }} type="button">Go back</button><button className="workflow-button" disabled={working || !portfolioReason.trim() || portfolioUnchanged || portfolioSelectionInvalid} onClick={() => void savePortfolio()} type="button">{working ? "Saving…" : "Save full portfolio"}</button></div>
        </section></div> : null}
        {removal && person ? <ConfirmationDialog title="End assignment?" description="This ends the selected assignment immediately. Other independent assignments remain unchanged." targetName={`${person.displayName} · ${removal.roleName}`} reasonLabel="Assignment end reason" confirmLabel="End assignment" reason={removalReason} error={removalError} working={working} destructive onReason={setRemovalReason} onCancel={() => { setRemoval(null); setRemovalReason(""); setRemovalError(""); }} onConfirm={() => void confirmRemoval()} /> : null}
        {lifecycleAction && person ? <ConfirmationDialog
          title={lifecycleAction === "suspend" ? "Suspend access?" : lifecycleAction === "reactivate" ? "Reactivate access?" : "Revoke access permanently?"}
          description={lifecycleAction === "suspend" ? "Suspension takes effect immediately and denies Centre Success access until an authorised reactivation." : lifecycleAction === "reactivate" ? "Reactivation restores access from the person's current effective assignments and scopes." : "Revocation is terminal and takes effect immediately. This principal cannot be reactivated."}
          targetName={person.displayName}
          reasonLabel={lifecycleAction === "suspend" ? "Suspension reason" : lifecycleAction === "reactivate" ? "Reactivation reason" : "Revocation reason"}
          confirmLabel={lifecycleAction === "suspend" ? "Suspend access" : lifecycleAction === "reactivate" ? "Reactivate access" : "Revoke permanently"}
          reason={lifecycleReason}
          error={lifecycleError}
          working={working}
          destructive={lifecycleAction !== "reactivate"}
          onReason={setLifecycleReason}
          onCancel={() => { setLifecycleAction(null); setLifecycleReason(""); setLifecycleError(""); }}
          onConfirm={() => void confirmLifecycle()}
        /> : null}
      </WorkflowShell>
    </BusinessWorkspaceGate>
  );
}

export function PersonHistoryWorkspace({ principalId }: Readonly<{ principalId: string }>) {
  const client = useAuthenticatedCentreSuccessClient();
  const [history, setHistory] = useState<people_access.AccessHistoryResponse | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    let current = true;
    void client.foundation.getPersonHistory(principalId).then(
      (response) => current && setHistory(response),
      () => current && setError(true),
    );
    return () => { current = false; };
  }, [client, principalId]);
  return (
    <BusinessWorkspaceGate>
      <WorkflowShell eyebrow="People & Access" title="Access history" summary="Append-only material access changes with safe attribution and no tokens or Microsoft object identifiers.">
        {error ? <WorkflowState kind="error" title="History unavailable" message="History is not available in your current organisation scope." /> : null}
        {!history && !error ? <WorkflowState kind="loading" title="Loading access history" message="Reading append-only audit events…" /> : null}
        {history ? <ol className="timeline workflow-card">{history.events.map((event) => <li key={event.id}><span><strong>{event.action.replaceAll("_", " ")}</strong><small>{formatDate(event.occurredAt)}</small></span><span>{event.actorDisplayName ?? "System workflow"}</span><p>{event.reasonRecorded ? "A reason was recorded." : "No reason field applies."}</p></li>)}</ol> : null}
      </WorkflowShell>
    </BusinessWorkspaceGate>
  );
}

export function InvitationAcceptanceWorkspace() {
  const { state, signIn } = useCentreSuccessAuthentication();
  const client = useAuthenticatedCentreSuccessClient();
  const [code, setCode] = useState("");
  const [outcome, setOutcome] = useState<people_access.AcceptInvitationResponse | null>(null);
  const [error, setError] = useState<"expired" | "cancelled" | "review" | "unavailable" | null>(null);
  const [working, setWorking] = useState(false);

  const accept = async (event: FormEvent) => {
    event.preventDefault();
    setWorking(true);
    setError(null);
    try {
      const response = await client.foundation.acceptInvitation({ invitationToken: code.trim() });
      setOutcome(response);
      setCode("");
    } catch (failure) {
      const reason = typeof failure === "object" && failure !== null && "details" in failure
        ? Reflect.get(Reflect.get(failure, "details") ?? {}, "reason")
        : undefined;
      setError(reason === "invitation_expired" ? "expired" : reason === "invitation_cancelled" || reason === "invitation_superseded" || reason === "invitation_replayed" ? "cancelled" : reason === "identity_review_required" ? "review" : "unavailable");
    } finally { setWorking(false); }
  };

  return (
    <main className="foundation-shell">
      <section className="auth-panel people-accept" aria-labelledby="invitation-accept-title">
        <p className="foundation-eyebrow">Bright Steps · Centre Success</p>
        <h1 className="auth-title" id="invitation-accept-title">Accept invitation</h1>
        <p className="auth-summary">Microsoft verifies who you are. Centre Success activates only the reviewed Centre Success access package.</p>
        {state.kind === "loading" ? <p role="status">Preparing secure Microsoft sign-in…</p> : null}
        {state.kind === "signed-out" || state.kind === "account-selection-required" ? <button className="auth-button" onClick={() => void signIn()} type="button">Sign in with Bright Steps Microsoft</button> : null}
        {state.kind === "unavailable" ? <p className="workflow-notice" role="alert">Microsoft sign-in is temporarily unavailable.</p> : null}
        {state.kind === "signed-in" && !outcome ? <form className="people-form" onSubmit={accept}><label>Invitation code<input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" required /></label><p>The code is sent in the invitation message and is submitted securely in the request body.</p><button className="auth-button" disabled={working || !code.trim()} type="submit">{working ? "Verifying…" : "Verify and continue"}</button></form> : null}
        {outcome?.outcome === "activated" ? <div className="auth-access-state" role="status"><h2>Centre Success access ready</h2><p>Your reviewed access package is active. Return to Centre Success to continue.</p><Link className="workflow-link-button" href="/">Open Centre Success</Link></div> : null}
        {outcome?.outcome === "awaiting_approval" ? <div className="auth-access-state" role="status"><h2>Awaiting independent approval</h2><p>Your Microsoft identity was verified. No Centre Success access is active until another current System Administrator approves the exact package.</p></div> : null}
        {outcome?.outcome === "administrator_review" || error === "review" ? <div className="auth-access-state" role="status"><h2>Administrator review required</h2><p>Your identity could not be safely correlated. No Centre Success access was activated.</p></div> : null}
        {error === "expired" ? <div className="auth-access-state" role="alert"><h2>Invitation expired</h2><p>Ask a System Administrator to create a new invitation. Expired invitations cannot be resent.</p></div> : null}
        {error === "cancelled" ? <div className="auth-access-state" role="alert"><h2>Invitation unavailable</h2><p>This invitation was cancelled, replaced or already used.</p></div> : null}
        {error === "unavailable" ? <div className="auth-access-state" role="alert"><h2>Invitation could not be verified</h2><p>Check the code and try again, or contact a System Administrator.</p></div> : null}
      </section>
    </main>
  );
}
