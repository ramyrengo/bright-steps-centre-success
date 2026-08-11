# AI Architecture

## Purpose

The AI Centre Success Assistant helps authorised users find trusted information, understand priorities, draft routine content, and prepare next steps. It is an assistive layer over governed application services and knowledge—not an authority, database superuser, or autonomous decision-maker.

No AI provider, model, package, embedding store, or production use is approved in Milestone 0.

## Approved-direction use cases

Subject to later privacy, security, and product approval, the assistant may:

- answer questions from approved, current source material with citations and verification state;
- explain why a daily item, warning, audit flag, or Centre Health factor appears;
- summarise records the user can already access;
- draft a corrective action, QIP improvement, coaching goal, budget commentary, or audit preparation list for human review;
- identify missing information or evidence against an approved checklist;
- compare finalised internal audits using the approved comparison map;
- help navigate the product and suggest the correct governed workflow; and
- translate complex organisational guidance into plain language without changing its meaning.

## Prohibited or out-of-scope uses

The assistant must not:

- invent, determine, or provide definitive interpretations of legislation or ACECQA requirements;
- state that a centre is legally compliant or assign an official NQS rating;
- automatically finalise audits, attest, approve evidence, close high-risk actions, publish QIPs, change permissions, approve budgets, or notify regulators;
- diagnose wellbeing, infer mental health, assess child/family risk from unapproved data, or make employment/disciplinary recommendations;
- retrieve raw individual wellbeing responses or identified support requests through ordinary assistant use;
- expose data outside the user’s organisation, assignment, centre, classification, or purpose;
- browse unrestricted external sources and mix them into regulated guidance without source review;
- train on Bright Steps content unless an explicit approved contract and decision permits it; or
- treat generated output as an audit record until an authorised user accepts it through the normal workflow.

## Architecture overview

1. **Request gateway:** an authenticated Encore endpoint receives the user request, intended task, active organisation, and client context.
2. **Policy gate:** the backend checks `ai.use`, tenant/scope, data classification, feature entitlement, and use-case policy.
3. **Intent and risk classification:** deterministic rules identify knowledge question, record summary, drafting, or unsupported/high-risk request.
4. **Authorised retrieval:** application services return only permitted records; the knowledge index applies source, tenant, centre, classification, effective-date, and verification filters before semantic/keyword retrieval.
5. **Prompt assembly:** a server-owned template adds task instructions, safe context, source excerpts, current date, and tool contracts. Untrusted content is clearly delimited.
6. **Model call:** a provider adapter uses approved region, retention, security, and model configuration.
7. **Grounding checks:** validate citations, source versions, unsupported claims, output format, and policy requirements.
8. **Response:** return answer/draft with citations, uncertainty, source freshness, and required human action.
9. **Audit/evaluation:** record safe metadata, sources, model/config, tool decisions, feedback, and acceptance/rejection without unnecessarily retaining sensitive prompts.

The model never has direct PostgreSQL, Object Storage, Encore Cloud, secret, or broad API credentials.

## Knowledge architecture

### Source tiers

1. **Verified external:** approved ACECQA/jurisdictional or other authoritative versions.
2. **Approved Bright Steps:** policy, procedure, templates, playbooks, and financial definitions.
3. **Centre-specific:** authorised QIP, finalised audit, active actions, evidence metadata, and local documents.
4. **Working/user content:** drafts and conversation content, clearly labelled and never promoted to authoritative knowledge automatically.

Each source/chunk retains organisation/centre scope, classification, owner, version, effective dates, verification state, source location, checksum, and supersession/deletion state.

Only approved active source versions answer authoritative questions. Superseded sources can support historical questions when explicitly requested and labelled.

### Retrieval controls

- Apply permission filters before retrieval and again before response assembly.
- Do not retrieve a high-level summary as a way around restricted underlying data.
- Prefer exact source/version matches and hybrid keyword/semantic search.
- Require citations to source and location for compliance/financial/policy claims.
- If approved sources conflict, are stale, or do not answer, disclose the limitation and route to an authorised owner.
- Remove or invalidate chunks when access, source status, retention, or classification changes.

The vector/search technology is an open decision. It may begin with PostgreSQL-compatible retrieval if it meets security and quality needs; no external vector service is assumed.

## Tool architecture

Tools are narrow Encore application commands/queries with typed inputs and outputs. Categories:

- **Read tools:** list permitted tasks, retrieve a QIP item, explain a score factor, fetch approved guidance.
- **Draft tools:** create a user-visible proposal object without changing authoritative workflow state.
- **Consequential tools:** not available to the model in MVP. A user must invoke and approve the normal application command after reviewing a draft.

Every tool reauthorises the current user and resource; model-selected IDs carry no trust. Tool calls use idempotency keys where relevant and produce audit/correlation metadata.

## Compliance-answer pattern

A compliance-related answer must include:

- a direct, cautious response scoped to the question;
- citations to approved source versions;
- jurisdiction/applicability and effective-date caveats;
- distinction between external source, Bright Steps policy, and assistant synthesis;
- verification status/access date; and
- escalation to the Compliance Manager when interpretation or legal advice is needed.

If no approved source supports the answer, the assistant abstains. It must not fill gaps from general model knowledge.

## Prompt-injection and untrusted content

Evidence, documents, web pages, imports, and user notes are data, not instructions. Controls include:

- server-owned system instructions and allow-listed tools;
- strict separation/delimiting of retrieved text;
- no tool selection or permission change based on retrieved instructions;
- URL and attachment handling through approved ingestion, not arbitrary model browsing;
- output encoding and no executable HTML/Markdown side effects;
- detection/evaluation of common injection and exfiltration attempts; and
- minimal context and redaction before provider calls.

## Privacy and data handling

- Complete a privacy and AI impact assessment for each use case.
- Do not send secrets, credentials, raw child evidence, individual wellbeing responses, restricted coaching notes, or unnecessary personal/financial details.
- Define provider region, subprocessors, retention, abuse monitoring, encryption, deletion, and training terms.
- Conversation retention is use-case specific and visible to users.
- Deleted/superseded sources are removed from indexes and caches under an auditable process.
- Next.js must call the Encore assistant API; provider keys never reach the browser.

## Human review and action provenance

Generated content is labelled `AI-assisted draft` with model/config version and source citations. Saving requires the authorised user to review/edit and explicitly accept it. The resulting business audit event distinguishes generated suggestion, human edits, and final accountable actor. Rejection/feedback improves evaluation but does not silently retrain production behaviour.

## Evaluation and release gates

Build a versioned evaluation set with authorised synthetic/de-identified examples for:

- citation accuracy and source/version correctness;
- groundedness and unsupported-claim rate;
- correct abstention and escalation;
- cross-organisation, cross-centre, classification, and wellbeing isolation;
- prompt-injection and data-exfiltration resistance;
- drafting usefulness without unsafe state change;
- Australian English/plain-language quality;
- latency, availability, and cost; and
- regressions across model/prompt/retrieval changes.

Compliance and permission test failures are release blockers. Model or prompt changes use staged rollout, evaluation comparison, rollback, and owner approval.

## Observability

Record request category, actor/organisation safe identifiers, policy result, retrieved source IDs/versions, tool names/results (redacted), model/config, token/cost/latency, refusal, citations, and user acceptance/feedback. Do not place full sensitive prompts or responses in ordinary logs/traces. Alert on unusual extraction patterns, high denial rates, citation failures, cost spikes, and repeated injection attempts.

## Encore alignment

- Encore APIs/auth handlers provide the protected assistant boundary once authentication is approved.
- PostgreSQL holds source metadata, runs, citations, feedback, and governed conversation records.
- Private Object Storage holds approved documents where permitted.
- Pub/Sub handles ingestion/index refresh and evaluation jobs with idempotency.
- Cron performs source-review/index reconciliation and retention tasks.
- Encore secrets hold provider credentials.
- Traces, structured logs, and metrics support operational visibility without becoming the audit ledger.

These are future architecture choices; no capability is to be implemented before Milestone approval.

## Open decisions

- Approved AI use cases and whether any enter MVP.
- Model/provider, region, retention/training terms, and fallback.
- Search/vector technology and document parsing.
- Source licensing and allowed excerpts.
- Conversation retention and user controls.
- Compliance-owner review workflow and evaluation thresholds.
- Cost limits, rate limits, and model-change authority.
