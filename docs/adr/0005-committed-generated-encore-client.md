# ADR-0005: Committed generated Encore client

## Status

Accepted for Milestone 1.

## Context

The Next.js shell needs a typed contract with Encore. A handwritten duplicate
can drift, while requiring a running backend merely to check out or build the
frontend creates avoidable setup coupling.

## Decision

Generate the TypeScript client with Encore for the exposed `foundation`
service and commit the output. Regenerate it whenever an exposed API contract
changes, review the diff, and verify regeneration in CI. Do not hand-edit the
generated file or duplicate response contracts in frontend code.

## Consequences

A checkout remains buildable and contract changes are reviewable. The generated
file increases repository size and must stay synchronized; CI fails when
regeneration produces a tracked diff.
