# Ensen-flow

A lightweight workflow orchestration engine.

## Development Baseline

This repository is in the Phase 1 baseline stage. The current package exposes a
minimal TypeScript scaffold plus the initial standalone workflow definition
schema, append-only JSONL workflow run state helpers, a local sequential runner,
neutral audit JSONL events, a bounded local schedule trigger evaluator, and a
bounded local webhook intake helper, and a bounded local file connector
skeleton for fixture read/write actions. It also exposes a local audit and
evidence metadata export skeleton for JSONL run state. It does not implement
production evidence archives, compliance bundles, customer data exports,
executor connectors, Ensen-loop integration, ERPNext behavior, or Pharma/GxP
workflow packs yet.

Use the same commands locally that CI runs:

```sh
npm ci
npm run build
npm test
```

CI runs on pull requests and pushes to `main`, installing dependencies with
`npm ci` before running the build and test commands.

## Phase 1 Boundary

This baseline is intentionally independent from Ensen-loop. Runtime workflow
features and Ensen-loop integration points belong to later Phase 1 issues.

Ensen-flow follows the repo-local short form of the Ensen development charter in
`docs/mission.md`. Before implementing a change, preserve the charter:
protocol over shared implementation, bounded execution, evidence before
authority, and no premature compliance claims.

## Documentation

- `docs/mission.md`: Ensen-flow mission and development charter short form.
- `docs/workflow-definition.md`: Phase 1 workflow definition schema boundary.
- `docs/connector-capability-matrix.md`: Phase 4 connector capability matrix
  covering schedule, webhook, HTTP notification, local file, and executor
  connector surfaces, including fake/local-only support and deferred boundaries.
- `docs/file-connector.md`: local file connector safe-root boundary,
  idempotency behavior, cleanup ownership, and non-goals.
- `docs/x-gate2-loop-flow-smoke-runbook.md`: local X-Gate 2 loop-flow smoke
  runbook, expected artifacts, failure classification, and non-production
  boundaries.
- `docs/x-gate3-flow-caller-boundary-runbook.md`: Flow-owned X-Gate 3 caller
  boundary, Loop local fake lane command shape, stdout contract, failure
  routing, focused Flow smoke coverage, local cleanup limits, and
  non-production limits.
- `docs/controlled-pilot-rollback-recovery-runbook.md`: controlled pilot
  rollback and recovery choices for retry, re-run, abandon, manual repair,
  JSONL state recovery, approval/retry/idempotency recovery, notification
  misfire and webhook replay handling, and cleanup boundaries that preserve
  audit/evidence history.
- `docs/x-gate3-track-a-flow-closure.md`: Flow-side X-Gate 3 Track A closure
  review with completed issue/PR evidence, Flow commit snapshot, Protocol
  `v0.3.0` release evidence, verification commands, and remaining non-Flow
  blockers.
- `docs/loop-flow-protocol-v0.2.0-connection-smoke.md`: pre-Phase 5
  Protocol v0.2.0 Loop-Flow connection smoke, capability checks, focused
  commands, and failure routing.
- `protocol-snapshots/ensen-protocol/v0.3.0/README.md`: copied Protocol
  v0.3.0 operational evidence profile snapshot for X-Gate 3 Track A artifact
  hygiene, with the source release tag and release URL recorded locally.
- `protocol-snapshots/ensen-protocol/v0.4.0/README.md`: copied Protocol
  v0.4.0 Track B evidence boundary snapshot for customer / regulated
  classification and approval/draft-only semantics, with the source release tag
  and release URL recorded locally.

## Workflow Definition Schema

The initial standalone workflow definition schema is documented in
`docs/workflow-definition.md` under the "Workflow Definition Schema" section.
It validates versioned workflow definitions, stable workflow and step IDs,
trigger shape, dependencies, retry policy, neutral actions, and idempotency key
semantics without contacting Ensen-loop or external executor connectors.

Schedule triggers are a local definition and test helper boundary only. A
workflow may declare `trigger.type: "schedule"` with a five-field UTC cron shape
using `*` or numeric values, and callers may deterministically evaluate one
candidate scheduled instant with `evaluateScheduleTrigger`. The helper derives a
stable run ID and JSONL state path from the scheduled instant, so repeating the
same evaluation returns the existing terminal run instead of creating an
unexpected duplicate. Ensen-flow does not run a background scheduler daemon, cron
service integration, cloud scheduler, external calendar integration, or
production time-zone policy.

Webhook triggers are also local intake boundaries only. A workflow may declare
`trigger.type: "webhook"` with a stable local path, and callers may pass a
placeholder-only `flow.webhook.input.v1` fixture to `consumeWebhookInput`. The
helper validates bounded metadata, rejects credential-shaped or forwarded
boundary headers, derives an idempotent run state path from `requestId`, and
records `trigger.type: "webhook"` in JSONL run state. It does not start an HTTP
server, expose a public endpoint, validate production signatures, store raw
secrets, or trust client-supplied identity/proxy headers.

## Workflow Run JSONL State

Workflow run state can be persisted locally with append-only JSONL records via
`createWorkflowRun`, `appendWorkflowRunEvent`, and `readWorkflowRunState`.
The model records trigger context, idempotency metadata, step attempts, retry
metadata, timestamps, and explicit terminal states while remaining independent
from Ensen-loop and external connector contracts.

Recovery uses the same Flow-owned JSONL boundary. `inspectWorkflowRunRecovery`
classifies an existing state file as `recoverable`, `terminal`,
`approval-required`, `blocked`, `corrupt`, or `manual-repair-needed` without
mutating the file, and returns an explainable diagnostic instead of trusting
connector-specific authority. `runWorkflow` can continue a projected
non-terminal local run only when completed steps and retryable attempts make the
next step unambiguous; active or contradictory attempt state fails closed for
operator review. `stopWorkflowRunRecovery` performs an explicit safe stop by
appending a `canceled` terminal event, never by deleting or rewriting prior run
evidence.

Approval recovery is also Flow-owned and human-controlled. Executor outcomes
such as `approval-required`, `blocked`, and `needs-review` are recorded as
neutral step recovery decisions instead of being inferred from Loop state,
connector names, or notification delivery. `approval-required` and
`manual-repair-needed` runs stay non-terminal until an operator chooses retry,
re-run, abandon, or repair; `blocked` records a failed terminal run with the
blocking decision preserved. Retryable technical failures keep using retry
metadata and idempotency keys, while changed replay input fails closed before
new state or audit records are appended. These records are audit-friendly local
recovery facts, not compliance evidence.

## Neutral Audit JSONL Events

The local runner can also write append-only JSONL audit events when callers pass
an `auditPath` to `runWorkflow`. These records use an internal neutral event
shape for workflow start, step start, step completion, step failure, retry
scheduling, and workflow completion or failure. Each record includes a stable
event ID, timestamp, actor and source context, workflow and run references, and
step references where applicable.

The built CLI can export public-safe audit and evidence metadata from local run
state after `npm run build`:

```sh
node dist/cli.js export-audit-evidence <state-jsonl-path> [audit-jsonl-path] [--output <export-json-path>]
```

The export intentionally separates `publicSafe` metadata from
`localConfidentialReferences`. Public-safe fields summarize run status, trigger
type, step attempts, neutral audit event summaries, and any public-safe
`eip.evidence-bundle-ref.v1` references found in step result metadata. Trigger
context, idempotency key values, raw local state paths, raw audit paths,
workstation-local evidence paths, secrets, customer data, production evidence
locations, and local confidential reference values are not exported into the
public-safe section. The export boundary uses the copied Protocol v0.4.0
operational evidence and Track B classification vocabulary for public data
classification, bounded producer metadata, retention hints, checksum presence,
and confidential reference policy facts without claiming production evidence
readiness or regulated workflow execution. Track B evidence references must
carry an explicit `dataClassification` before entering public-safe output;
missing values are omitted as unclassified references, and unknown values fail
closed before an export artifact is written. `file_uri` evidence references are
omitted from public-safe exports until Flow adopts a deliberately public mapping;
portable relative `local_path` references remain exportable only when they are
explicitly classified as `public`. Internal, customer-confidential, regulated,
confidential, and restricted evidence references stay out of the public-safe
export surface.

Workflow artifact hygiene is fail-closed at the local JSONL boundary and at
public export boundaries. Raw secrets, token-shaped strings, private key blocks,
session cookie strings, and workstation-local absolute paths are rejected before
new run state or notification artifacts are written. Public audit/evidence
exports omit unsafe evidence references and report only the failing category in
diagnostics; the matched value stays out of public-safe output. The
`localConfidentialReferences` section is the placeholder boundary for local-only
state, audit, and export file references until a later Protocol evidence profile
defines a formal mapping.

Track B customer workflow intake is guarded by a Flow-owned allowlist policy in
workflow metadata. When trigger context includes `customerWorkflow`, the local
runner requires an explicit `metadata.customerWorkflowAllowlist` match for the
customer workflow reference, execution mode, and any ERPNext site, object type,
or endpoint reference before it writes run state, audit events, or step
artifacts. The policy is metadata only: it records fake, read-only, draft-only,
and live-write-back mode vocabulary so Flow can reject unsafe input
explainably, but this repository still does not implement ERPNext connector
calls, customer data fixtures, production regulated workflow execution, or live
write-back. `live-write-back` remains fail-closed even if listed in policy
metadata. Allowlist-miss diagnostics report only the failing boundary category
and mode; customer identifiers, endpoint details, and regulated-looking values
are redacted from public artifacts.

The local runner also enforces the copied Protocol v0.4.0 approval and
draft-only vocabulary at customer workflow step result boundaries. In
`read-only` mode, Flow accepts observation-only metadata that remains
`not-applied` and rejects draft-only, committed, approved, or externally applied
artifact claims. In `draft-only` mode, proposed artifacts must stay
`draft-only` and `not-applied` while their approval state is
`approval-required`, `rejected`, `revoked`, or `superseded`; a committed
artifact requires an explicit human approval reference and decision boundary.
Automatic quality decisions and live write-back claims fail closed before the
unsafe artifact body is persisted as a completed step result. These records are
operator-visible control states only, not final quality decisions, live ERPNext
write-back approval, electronic signatures, batch release records, validated
system evidence, or compliance claims.

This internal shape is intended to support a later mapping to EIP AuditEvent,
but it does not claim EIP conformance and does not import Ensen-protocol runtime
packages. Formal protocol mapping belongs to a later protocol or connector
integration phase.

## Ensen-protocol Snapshot

The active copied Ensen-protocol v0.2.0 schema, fixture, and contract-doc
snapshot for pre-Phase 5 connector work is
documented in
`protocol-snapshots/ensen-protocol/v0.2.0/README.md`. It is repo-owned fixture
and contract data, not a runtime package dependency or a pointer to a sibling
checkout.

Ensen-flow currently exposes an EIP version boundary for later connector tests:
protocol version `0.2.0`, release tag `v0.2.0`, and
`runtimeDependency: false`. Workflow definitions may declare
`protocolVersion: "0.2.0"` as an optional boundary marker. Unsupported EIP
major versions must fail closed until a future Ensen-flow connector boundary
explicitly supports them.

The older v0.1.0 snapshot remains in this repository as historical fixture data
for compatibility review only. New connector conformance and Phase 5 planning
should use the v0.2.0 snapshot boundary unless a test explicitly documents a
retained compatibility behavior.

The copied Ensen-protocol v0.3.0 operational evidence profile snapshot is
documented in `protocol-snapshots/ensen-protocol/v0.3.0/README.md`, with the
profile doc at
`protocol-snapshots/ensen-protocol/v0.3.0/docs/integration/operational-evidence-profile.md`
and the public fixture-safe example at
`protocol-snapshots/ensen-protocol/v0.3.0/fixtures/operational-evidence-profile/v1/valid/public-fixture-safe-profile.json`.
It records source release tag `v0.3.0` and release URL
`https://github.com/TommyKammy/Ensen-protocol/releases/tag/v0.3.0`. This
snapshot is a local contract reference for X-Gate 3 Track A evidence work; it
does not introduce a runtime dependency, production evidence archive, customer
data export, credential source, retention system, cleanup workflow, recovery
workflow, or compliance evidence claim.

Future Protocol profile updates should be adopted by adding a new versioned
snapshot directory from a tagged Ensen-protocol release, recording the release
tag and release URL in that directory's manifest, and updating this navigation
without pointing Flow runtime code or tests at a sibling checkout.

The copied Ensen-protocol v0.4.0 Track B evidence boundary snapshot is
documented in `protocol-snapshots/ensen-protocol/v0.4.0/README.md`, with the
classification guide at
`protocol-snapshots/ensen-protocol/v0.4.0/docs/data-classification.md`, the
customer / regulated profile at
`protocol-snapshots/ensen-protocol/v0.4.0/docs/integration/customer-regulated-data-classification-profile.md`,
the approval and draft-only profile at
`protocol-snapshots/ensen-protocol/v0.4.0/docs/integration/approval-and-draft-evidence-semantics.md`,
and public-safe examples under
`protocol-snapshots/ensen-protocol/v0.4.0/fixtures/`. It records source release
tag `v0.4.0`, release URL
`https://github.com/TommyKammy/Ensen-protocol/releases/tag/v0.4.0`, and target
commit `f6c3c5bee2574c8660f6954fe58a9e7625daad12`.

This v0.4.0 intake is protocol contract/reference data only. It does not add
ERPNext live connector behavior, production regulated workflow execution,
customer-data fixtures, credential handling, electronic signatures, batch
release, final disposition, a validated system, or compliance claims. Flow uses
the Track B classification values only at explicit evidence-boundary surfaces
such as public-safe audit/evidence export filtering.

## Local Sequential Runner

The Phase 1 local runner can execute a validated workflow definition through a
neutral in-process step handler and persist progress to the JSONL state layer.
It is intentionally independent from Ensen-loop and external executor
connectors.

Programmatic callers can use `runWorkflow`. The built CLI can run the canonical
manual fixture after `npm run build`:

```sh
node dist/cli.js run fixtures/workflow-definitions/simple-manual.valid.json <state-jsonl-path> '{"requestId":"manual-001"}'
```
