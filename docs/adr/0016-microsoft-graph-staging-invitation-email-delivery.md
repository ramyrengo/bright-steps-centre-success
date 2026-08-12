# ADR-0016: Microsoft Graph staging invitation email delivery

## Status

Accepted architecture. **IMPLEMENTED — ACCEPTANCE REMEDIATION IN PROGRESS.** Operational enablement remains blocked until targeted independent re-review passes, the Product Owner configures the new secret in the exact Encore `staging` environment, and deployment is approved. This decision does not approve Production.

## Context

People & Access already commits invitation generations and AES-256-GCM delivery ciphertext to PostgreSQL, publishes a stable outbox identifier through Encore Pub/Sub, and invokes a provider-neutral adapter. The deterministic development adapter proved the workflow but deliberately sent no email.

The Product Owner has separately proven least-privilege Microsoft Graph application access for the existing Centre Success API app registration in tenant `27026100-3522-48b5-8e95-80230afc4127`. Exchange Application RBAC grants `Application Mail.Send` only for `centresuccess@brightstepsacademy.com.au`. The token deliberately has no broad Entra `Mail.Send` application role: sending from the approved mailbox returned `202 Accepted`, while sending from another mailbox returned `403 Forbidden`.

## Decision

- Preserve the existing invitation transaction → encrypted PostgreSQL outbox → Encore Pub/Sub → provider adapter flow. No invitation API calls Graph directly.
- Select delivery from trusted Encore runtime metadata: local or test → deterministic no-network adapter; exact `cloud = encore`, `name = staging`, `type = development` → Microsoft Graph; every other cloud/environment, including ephemeral previews and Production → disabled.
- Reuse `EntraTenantId` and `EntraApiClientId`. Add exactly one credential, `MicrosoftGraphClientSecret`, as an Encore secret scoped only to the exact `staging` environment. No SPA or API credential is written to source, logs, browser state, PostgreSQL, audit events, or email content.
- Acquire an app-only access token from the exact tenant `/oauth2/v2.0/token` endpoint with `client_credentials` and `https://graph.microsoft.com/.default`. Cache it in process until shortly before expiry and singleflight concurrent refresh. A send `401` invalidates the cache, fetches one fresh token, and retries send exactly once; a second `401` is terminal. Failed refresh never poisons future refresh. No role claim is required or inferred.
- Send only `POST https://graph.microsoft.com/v1.0/users/centresuccess@brightstepsacademy.com.au/sendMail`. The sender address and display name `Bright Steps Centre Success` are code-owned constants, not request fields or environment configuration.
- Send only the current invitation recipient, branded staging content, the `InvitationPublicBaseUrl` acceptance link, the separate opaque invitation code, expiry, Microsoft sign-in guidance, and reply/support information. Include no role, scope, permission, child/staff data, token claim, or Microsoft object identifier. Set `saveToSentItems = false` because the invitation code is a live bearer credential. Do not send `message.from`; sender authority comes only from the fixed `/users/centresuccess@brightstepsacademy.com.au/sendMail` endpoint. Keep fixed `replyTo`.
- Treat only HTTP `202` as accepted, storing the non-sensitive marker `microsoft-graph:accepted`. After the single 401 refresh path, authentication failure is terminal. A send `403`, `429`, `5xx`, network interruption, and timeout (which may be ambiguous after submission) are retryable; other `4xx` are terminal. Invalidate the token cache on `403`. Honour only a valid non-negative `Retry-After`, clamped to ten minutes.
- Commit a durable provider-attempt reservation before Graph is reachable. The reservation ledger is numbered contiguously and database-capped at attempts 1–3 per outbox/invitation generation. A reserved slot remains consumed after process failure, transaction rollback, result-commit failure, timeout or an accepted-but-lost response. Stale `RESERVED` work is reconciled as `AMBIGUOUS`; a failed revalidation before Graph is recorded as `NOT_SENT_AFTER_REVALIDATION`. No reservation means no Graph request.
- Attempts one and two may reschedule a retryable provider failure. A third reservation is the final possible provider call; once its result is retryable or its stale state is reconciled, the outbox records `delivery_attempts_exhausted` and terminal `FAILED`. Only explicit administrator resend may rotate to a new generation with a separate three-slot ledger. Delay and reservation count are independently bounded.
- Use durable dispatch leases for at-least-once Pub/Sub publication. `PENDING` or stale `PUBLISHED` work is claimed before publish; publish-failure reconciliation is compare-and-set against that lease and cannot overwrite a worker's later `PENDING`, `FAILED` or `DELIVERED` result. The periodic dispatcher reclaims expired `PUBLISHED` leases, including crashes before publish and ambiguous publish completion.
- Preserve outbox idempotency, current-generation checks and terminal replay protection. Graph `sendMail` provides no provider-side idempotency key, so a lost/timeout response can result in a duplicate email within the three-reservation cap; support and monitoring must understand that bounded residual risk. Three reservations limit exposure but do not provide exactly-once mail.

## Explicit exclusions

This decision does not approve Graph for authentication, business authorisation, employee provisioning, directory or group lookup, guest/member classification, HR sync, calendar, Teams, SharePoint, mailbox reads, inbound mail, attachments, or general notification delivery. It adds no Microsoft Graph SDK and no Entra portal `Mail.Send` application permission. The already proven Exchange mailbox-scoped RBAC model must not be broadened.

## Consequences and operations

The new secret is required only in exact staging. Its existence never enables Production. Missing/invalid credentials, mailbox-scope denial, rate limiting, provider outage, ambiguous timeout, and attempt exhaustion remain visible only through safe outbox status/error classes; raw Graph bodies and credentials are discarded. Local and deterministic tests use injected HTTP transports and make no Graph call.

The worker first commits the provider-attempt reservation without calling Graph. It then opens a new transaction, locks and revalidates the invitation/current generation/expiry/reservation, and holds the invitation row lock through the bounded Graph token/send operation and result reconciliation. This ensures resend/cancel and current-generation delivery have one deterministic order while a result rollback cannot erase the consumed provider slot. The lock/external-HTTP trade-off is accepted for current staging/pilot volume. Future scale may separate claim/call/reverify further, but it must preserve durable pre-call reservation, the three-slot cap, cancellation, resend, expiry, current-generation and duplicate-delivery safety.

Resend checks `expires_at <= trusted now` under the invitation lock. An elapsed `SENT` invitation is materialised as `EXPIRED`, its current token generation becomes `EXPIRED`, and no replacement generation or outbox row is created. Migration 019 adds only provider-reservation and dispatch-lease infrastructure; it does not create another invitation source of truth.

Non-blocking follow-ups are permanently-failed ciphertext retention, HTML/plain-text multipart content, and generalising the GUID validator. They do not expand this remediation.

Before staging deployment, an operator must configure `MicrosoftGraphClientSecret` with `encore secret set --env staging MicrosoftGraphClientSecret`, verify the sender mailbox and Exchange scope remain unchanged, deploy through the normal reviewed pipeline, and issue a newly approved test invitation. The already delivered planner invitation must not be reused or resent as part of this implementation task.
