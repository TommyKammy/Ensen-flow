# AGENTS.md

## Ensen Development Charter

Before implementing a change, preserve the Ensen development charter: protocol over shared implementation, bounded execution, evidence before authority, and no premature compliance claims.

## Repository Boundary

Ensen-flow is the lightweight explainable workflow orchestration engine in the Ensen product family. Agent work in this repository must keep Ensen-flow usable without Ensen-loop, Ensen-flow for Pharma, ERPNext, or any external executor service.

Do not import implementation code from Ensen-loop, Ensen-protocol, Ensen-flow for Pharma, ERPNext adapters, or other Ensen repositories. Cross-product cooperation must happen through public protocol artifacts, schemas, fixtures, compatibility notes, and documented connector boundaries.

## Product Direction

Keep Ensen-flow small, readable, and auditable. It should orchestrate lightweight workflows without becoming a giant black-box workflow platform.

Workflow steps should stay bounded, explainable, retry-aware, and audit-friendly. Human control points, approval states, evidence, and stop/retry behavior are product features, not friction to remove.

## Current Phase

Phase 1 establishes the standalone workflow core: workflow definitions, JSONL run state, a local sequential runner, and neutral audit events. Real external connectors, Ensen-loop executor integration, ERPNext behavior, Pharma/GxP workflow packs, and compliance claims belong to later phases or separate repositories.

## Local Verification

Use the repo-owned commands:

```sh
npm ci
npm run build
npm test
```
