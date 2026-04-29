# Ensen-flow

A lightweight workflow orchestration engine.

## Development Baseline

This repository is in the Phase 1 baseline stage. The current package exposes a
minimal TypeScript scaffold plus the initial standalone workflow definition
schema and append-only JSONL workflow run state helpers. It does not implement a
runner, executor connector, or audit behavior yet.

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

## Workflow Definition Schema

The initial standalone workflow definition schema is documented in
`docs/workflow-definition.md` under the "Workflow Definition Schema" section.
It validates versioned workflow definitions, stable workflow and step IDs,
trigger shape, dependencies, retry policy, neutral actions, and idempotency key
semantics without contacting Ensen-loop or external executor connectors.

## Workflow Run JSONL State

Workflow run state can be persisted locally with append-only JSONL records via
`createWorkflowRun`, `appendWorkflowRunEvent`, and `readWorkflowRunState`.
The model records trigger context, idempotency metadata, step attempts, retry
metadata, timestamps, and explicit terminal states while remaining independent
from Ensen-loop and external connector contracts.

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
