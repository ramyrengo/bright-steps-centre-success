# ADR-0009: Break-glass and support impersonation

## Status

Deferred. Not approved for Milestone 1.

## Context

Operating a live system eventually raises requests to view what a user sees, to
recover an account, or to act during an incident. `docs/PERMISSIONS.md` states
that break-glass, if approved, requires strong re-authentication, a recorded
reason, an incident reference, minimal duration, immediate alerting to data and
security owners, enhanced logging, and retrospective review — and that it is
never a support convenience.

An exceptional-access path is the most direct way to defeat the tenant and scope
isolation the foundation exists to enforce, and it depends on authentication
that does not yet exist.

## Decision

Defer break-glass and support impersonation entirely. Milestone 1 provides no
impersonation, no support view-as, no elevated technical read of business
content, and no administrative bypass of the authorisation interface.

System Administrator holds principal, identity-mapping, assignment, and
configuration capabilities and deliberately holds no business-content
capability. That separation is the current answer to "how does an administrator
help a user": they administer access, they do not read the content.

## What would unblock this

- The identity provider, re-authentication, and step-up model from ADR-0002.
- An approved policy naming who may invoke exceptional access, on what basis,
  for how long, and who reviews it afterwards.
- Alerting and enhanced audit that a reviewer actually monitors, since an
  unreviewed break-glass log provides accountability in name only.
- A privacy assessment for the sensitive classes in `docs/PERMISSIONS.md`,
  particularly individual wellbeing data, which is excluded from every role by
  default.

## Consequences

Some support scenarios will be harder before this is decided, and that is the
intended trade. Deferring it keeps the invariant that every allow path is a
complete, attributable, scoped grant, with no privileged path that skips the
policy. Any future implementation is a new record, not an amendment to this one.
