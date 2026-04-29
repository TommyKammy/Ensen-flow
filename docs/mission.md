# Ensen-flow Mission

This document is the Ensen-flow repo-local short form of the Ensen development charter.

## North Star

Ensen turns agentic and automated work into bounded, explainable, and auditable execution.

Ensen-flow orchestrates lightweight explainable workflows.

## Product Role

Ensen-flow is a lightweight workflow orchestration engine for developer, operator, and regulated-process-adjacent workflows. It exists to make workflow definitions, run state, retries, approvals, and audit trails readable and maintainable without becoming a giant black-box workflow platform.

Ensen-flow may later call Ensen-loop as one external executor connector, but Ensen-loop is optional. Ensen-flow must remain useful for standalone local/manual workflows and future connector families without importing Ensen-loop runtime implementation.

## Charter Principles

- Protocol over shared implementation.
- Bounded execution over uncontrolled automation.
- Evidence before authority.
- Human control points are product features.
- Explainability over magic.
- Validation-ready over premature compliance claims.

## What This Repository Owns

- Standalone workflow definition schema and examples.
- Workflow run state and replayable lifecycle records.
- Local sequential workflow execution for bounded workflow steps.
- Neutral audit event output that can later map to EIP AuditEvent.
- Connector interfaces and capability boundaries, once those phases begin.
- Documentation that keeps workflow behavior explainable to operators and reviewers.

## Boundaries

This repository must not become:

- an Ensen-loop runtime;
- a shared runtime library for other Ensen products;
- a generic black-box automation platform;
- an ERPNext-specific workflow engine;
- a Pharma/GxP workflow pack;
- a product that claims Part 11, Annex 11, or GxP compliance by default.

Ensen-flow must not import implementation code from Ensen-loop, Ensen-protocol, Ensen-flow for Pharma, ERPNext adapters, or other Ensen repositories. Shared behavior belongs in public protocol artifacts, schemas, fixtures, compatibility notes, and documented connector contracts.

## Phase 1 Commitments

Phase 1 should prove the standalone workflow core:

- workflow definitions are versioned and schema-validated;
- trigger shape, retry policy, idempotency semantics, and neutral actions are explicit;
- workflow run state is durable and readable;
- simple local/manual workflows run without Ensen-loop or external services;
- neutral audit events are produced without claiming EIP conformance;
- real external connectors and Ensen-loop executor integration stay out of Phase 1.

## Change Expectations

Before implementing a change, preserve the Ensen development charter: protocol over shared implementation, bounded execution, evidence before authority, and no premature compliance claims.

For meaningful changes, include:

- the Ensen-flow goal the change supports;
- whether product boundaries are preserved;
- how the change keeps workflows explainable and bounded;
- what evidence, state, or audit behavior is added or preserved;
- verification commands and relevant fixture/schema checks;
- clear non-goals for connector, Ensen-loop, ERPNext, or Pharma/GxP behavior that belongs outside the change.

## Verification Baseline

Use repo-relative commands in durable documentation:

```sh
npm ci
npm run build
npm test
```
