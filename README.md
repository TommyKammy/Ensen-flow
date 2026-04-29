# Ensen-flow

A lightweight workflow orchestration engine.

## Development Baseline

This repository is in the Phase 1 baseline stage. The current package exposes a
minimal TypeScript scaffold for future workflow-core implementation work, but it
does not implement workflow schema, state, runner, or audit behavior yet.

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
`docs/workflow-definition.md`. It validates versioned workflow definitions,
stable workflow and step IDs, trigger shape, dependencies, retry policy, neutral
actions, and idempotency key semantics without contacting Ensen-loop or external
executor connectors.
