# ADR-0023: Operational template `time` question type

## Status

Deferred. The Product Owner has not decided whether a `time` question type is
within the Area Manager Template & Form Builder boundary. Per this directory's
`README.md`, a deferred record is as binding as an accepted one while it stands.

This record raises a question about ADR-0020. It does not rewrite it.

## Context

ADR-0020 authorises the builder's initial question types as Yes/No, single
select, multi-select, text, number and date. `docs/MVP_BUILD_PLAN.md` repeats
that list. Neither names a `time` question.

The implemented schema does not match that list. Migration
`023_area_manager_template_builder.up.sql` constrains `question_type` to
`short_text, long_text, single_choice, multiple_choice, numeric, time`, on
`operational_template_draft_questions` and again on `audit_template_items`. The
two lists differ in both directions:

- **`date` is authorised and was absent.** That is not this record's subject. It
  is a plain implementation gap against ADR-0020, being closed forward by
  migration `031_operational_template_date_question.up.sql`.
- **`time` is present and no accepted record authorises it.**

`docs/TEMPLATE_BUILDER_FRONTEND_CONTRACT.md:172` records where it came from: the
coordinator's work order named `short_text`, `long_text` and `time` instead of
the ADR's list. Short and long text were reconciled into one `TEXT` question with
a `multiline` flag, which keeps the authoring choice inside the authorised
"text" type. `time` was not reconciled. The same document at line 178 declines to
build it — "there is **no** `time` question type, because ADR-0020 does not
authorise one" — and puts due-time configuration on the schedule, where the ADR
puts it. The backend built it anyway, and the frontend contract later followed
the backend.

ADR-0020 does speak to time, but about the schedule rather than the answer:
authorised schedules are daily, weekly, monthly, quarterly and ad-hoc, the slice
includes due-time/configuration, and the decision "does not invent additional
recurrence types or due-date semantics." A time *answer recorded by an educator*
is a different fact from a *due time on a schedule*. Only the second is granted.

**What exists today.** `time` is implemented end to end — both CHECK
constraints, `contracts.ts`, `questionFromRow` and its two siblings in
`service.ts`, an `optionalTime` validator, and on the frontend the contract,
gateway, question editor and phone preview — and is exercised by fixtures in
`validation.unit.test.ts` and `operational-templates.integration.test.ts`. It has
no seed data and no authored template content behind it. ADR-0020 explicitly
records no implementation acceptance, deployment, or production data use for this
slice. Nothing a centre has answered depends on `time` today.

**One thing not to misread.** Migration 031 re-enumerates `time` while widening
both constraints for `date`. That is correct for a forward-only rewrite — it must
preserve what it found — but it means a second and fresher schema artifact now
asserts `time`. It is mechanical preservation, not ratification.

## Decision

Defer the `time` question type to the Product Owner. While this record stands:

- Do not treat the presence of `time` in the schema, in migration 031, or in
  either contract as authorisation. It reached the schema through a work order,
  not through ADR-0020.
- Do not remove `time` either. Withdrawing an implemented type is a schema and
  contract change needing the same authority as adding one, and the tests that
  pin the constraint enumeration move with it.
- Do not extend `time`: no further answer configuration, no answer/remediation
  rule keyed to it, and no schedule or occurrence behaviour derived from a time
  *answer*.
- Do not carry `time` into an acceptance claim, a release-boundary scope
  statement, or a production deployment as though ADR-0020 covered it.

The `date` work is unaffected and continues. `date` is authorised; its absence
was the gap.

## What would unblock this

A Product Owner ruling on one of:

1. **Ratify it.** A time question is in scope. This needs a new accepted record
   amending the authorised type list, and a statement of how a time answer
   relates to the schedule's due time — the two are easy to confuse on screen,
   and an educator seeing both wants to know which one binds.
2. **Withdraw it.** The work order exceeded the authorisation. This needs a
   forward-only migration narrowing both constraints, removal from the backend
   and frontend contracts, and fixture changes. Cheapest now; see Consequences.
3. **Hold it unreachable.** Keep the stored type but stop offering it in the
   builder's answer-type picker until a later slice decides. This must say
   explicitly that an existing `time` row stays readable, so no draft breaks.

One question would help settle it: did an Area Manager ever ask to record a time
answer, or was the work order's `time` a transcription of the schedule's due
time?

## Consequences

Deciding now is materially cheaper than deciding later. With no authored content
behind it, withdrawal is a schema narrowing and a fixture edit. That stops being
true once a centre answers a published template carrying a time question: under
ADR-0020 published versions are immutable and remain in version history, so a
later withdrawal must keep reading answers it can no longer author.

The cost of deferring is that the builder's authorised type list and its
implemented type list disagree, and every scope reading of this slice has to
carry the discrepancy as a footnote.
