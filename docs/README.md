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
- [Controlled Pilot Rollback and Recovery Runbook](./controlled-pilot-rollback-recovery-runbook.md): Track A / Flow Phase 5 operator choices for retry, re-run, abandon, manual repair, JSONL state recovery, notification misfire, webhook replay handling, Loop connector failure routing, and cleanup boundaries that preserve audit/evidence history.
- [Customer Workflow Rollback and Evidence Retention Runbook](./customer-workflow-rollback-evidence-retention-runbook.md): Track B operator choices for retry, re-run, abandon, manual repair, revoke, and supersede in customer workflow contexts, including retained evidence, deleted local artifact limits, notification recovery, draft artifact recovery, and workflow state recovery.
- [X-Gate 3 Track A Flow Closure Review](./x-gate3-track-a-flow-closure.md): Flow-side closure evidence for #82-#88, #96-#97, #101-#103, Protocol `v0.3.0`, verification commands, and remaining non-Flow blockers.
- [Loop-Flow Protocol v0.2.0 Connection Smoke](./loop-flow-protocol-v0.2.0-connection-smoke.md): pre-Phase 5 local/fake/dry-run smoke, capability variant checks, focused commands, and `protocol-gap` / `loop-gap` / `flow-gap` routing.
- [Ensen-protocol v0.2.0 Snapshot](../protocol-snapshots/ensen-protocol/v0.2.0/README.md): active copied protocol schemas, conformance fixtures, capability variant examples, and contract docs for pre-Phase 5 connector tests.
- [Ensen-protocol v0.3.0 Operational Evidence Profile Snapshot](../protocol-snapshots/ensen-protocol/v0.3.0/README.md): copied operational evidence profile docs and public fixture-safe example for X-Gate 3 Track A artifact hygiene. Profile doc: `../protocol-snapshots/ensen-protocol/v0.3.0/docs/integration/operational-evidence-profile.md`.
- [Ensen-protocol v0.4.0 Track B Evidence Boundary Snapshot](../protocol-snapshots/ensen-protocol/v0.4.0/README.md): copied Track B customer / regulated classification and approval/draft-only evidence semantics. Classification guide: `../protocol-snapshots/ensen-protocol/v0.4.0/docs/data-classification.md`. Customer / regulated profile: `../protocol-snapshots/ensen-protocol/v0.4.0/docs/integration/customer-regulated-data-classification-profile.md`. Approval and draft-only profile: `../protocol-snapshots/ensen-protocol/v0.4.0/docs/integration/approval-and-draft-evidence-semantics.md`.
- Customer workflow allowlist: see the Track B section in [README](../README.md) for the Flow-owned `metadata.customerWorkflowAllowlist` boundary. It records fake, read-only, draft-only, and live-write-back vocabulary as policy metadata only; live ERPNext behavior and live write-back remain blocked.

Ensen-flow documentation should preserve the product boundary: lightweight explainable workflow orchestration, no shared runtime dependency with Ensen-loop, and no premature Pharma/GxP compliance claims.
