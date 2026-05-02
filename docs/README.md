# Ensen-flow Docs

This directory contains repo-local design and operator-facing documentation for Ensen-flow.

Start here:

- [Mission](./mission.md): the Ensen-flow short-form development charter.
- [Workflow Definition Schema](./workflow-definition.md): the Phase 1 standalone workflow definition boundary and validation shape.
- [Connector Capability Matrix](./connector-capability-matrix.md): Phase 4 trigger and connector capability status across schedule, webhook, HTTP notification, local file, and executor surfaces.
- Webhook intake boundary: see the webhook section in [Workflow Definition Schema](./workflow-definition.md), the placeholder fixture in `fixtures/webhook-inputs/local-demo.valid.json`, and focused coverage via `npm test -- test/webhook-intake-boundary.test.ts`.
- [HTTP Notification Connector Skeleton](./http-notification-connector.md): local fake notification connector behavior, unsupported capability behavior, safe fixture expectations, and non-goals for real outbound HTTP integration.
- [Local File Connector Skeleton](./file-connector.md): bounded fixture file read/write behavior, safe root requirements, idempotency behavior, cleanup ownership, and non-goals for unrestricted filesystem automation.
- [X-Gate 2 Loop-Flow Smoke Runbook](./x-gate2-loop-flow-smoke-runbook.md): local smoke commands, artifacts, failure routing, and non-production boundaries.
- [X-Gate 3 Flow Caller Boundary Runbook](./x-gate3-flow-caller-boundary-runbook.md): Flow-owned caller boundary for Loop local fake lane smoke input, stdout output, artifacts, and failure routing.
- Focused Flow X-Gate 3 smoke coverage: `npm test -- test/x-gate3-flow-smoke.test.ts`.
- [Ensen-protocol v0.2.0 Snapshot](../protocol-snapshots/ensen-protocol/v0.2.0/README.md): active copied protocol schemas, conformance fixtures, capability variant examples, and contract docs for pre-Phase 5 connector tests.

Ensen-flow documentation should preserve the product boundary: lightweight explainable workflow orchestration, no shared runtime dependency with Ensen-loop, and no premature Pharma/GxP compliance claims.
