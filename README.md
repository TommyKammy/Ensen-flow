# Ensen-flow

A lightweight workflow orchestration engine.

## Development Baseline

This repository is in the Phase 1 baseline stage. The current package exposes a
minimal TypeScript scaffold plus the initial standalone workflow definition
schema, append-only JSONL workflow run state helpers, a local sequential runner,
neutral audit JSONL events, a bounded local schedule trigger evaluator, and a
bounded local webhook intake helper, and a bounded local file connector
skeleton for fixture read/write actions. It
does not implement executor connectors, Ensen-loop integration, ERPNext
behavior, or Pharma/GxP workflow packs yet.

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
- `docs/loop-flow-protocol-v0.2.0-connection-smoke.md`: pre-Phase 5
  Protocol v0.2.0 Loop-Flow connection smoke, capability checks, focused
  commands, and failure routing.

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

## Neutral Audit JSONL Events

The local runner can also write append-only JSONL audit events when callers pass
an `auditPath` to `runWorkflow`. These records use an internal neutral event
shape for workflow start, step start, step completion, step failure, retry
scheduling, and workflow completion or failure. Each record includes a stable
event ID, timestamp, actor and source context, workflow and run references, and
step references where applicable.

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
