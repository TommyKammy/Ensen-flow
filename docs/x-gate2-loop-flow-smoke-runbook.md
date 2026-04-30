# X-Gate 2 Loop-Flow Smoke Runbook

This runbook documents the local Flow-centered X-Gate 2 smoke path. It is a
test and dry-run proof only: it must not be used as evidence of production
integration, regulated workflow readiness, ERPNext readiness, or live Codex
automation.

## Scope

The smoke path proves that Ensen-flow can construct an EIP RunRequest for a
workflow step, hand it to a local Ensen-loop CLI-shaped boundary, consume the
aggregate stdout contract, classify failures, and persist local Flow JSONL run
state. The boundary stays local and explicit.

Out of scope:

- no real repository mutation;
- no real GitHub issue, pull request, or review mutation;
- no real Codex provider invocation;
- no raw secrets, customer data, or production credentials;
- no ERPNext live connector or external executor service;
- no regulated workflow or Pharma/GxP compliance claim.

## Inputs

- Ensen-flow checkout on this branch.
- Node.js matching `package.json`.
- Installed dependencies from `npm ci`.
- Built Flow CLI from `npm run build`.
- A local Ensen-loop dry-run command that accepts `x-gate2-smoke
  <run-request-json-file>` and writes one JSON aggregate to stdout.

Related coordination references:

- X-Gate 2 tracker: TommyKammy/Ensen-flow#35
- CLI-backed smoke issue: TommyKammy/Ensen-flow#37
- Real Loop aggregate smoke follow-up: TommyKammy/Ensen-flow#41
- Flow real Loop smoke metadata and blocked aggregate follow-up: TommyKammy/Ensen-flow#43
- Flow non-zero invalid smoke JSON classification follow-up: TommyKammy/Ensen-flow#45
- Loop dry-run output issue: TommyKammy/Ensen-loop#35
- Protocol smoke README: TommyKammy/Ensen-protocol#27
- Protocol gap template: TommyKammy/Ensen-protocol#28

## Commands

Install and build from the Ensen-flow repository root:

```sh
npm ci
npm run build
```

Run the focused local smoke and failure-classification test:

```sh
npm test -- test/cli-loop-executor-smoke.test.ts
```

Run the documentation contract for this runbook:

```sh
npm test -- test/x-gate2-smoke-runbook.test.ts
```

Run the generic Flow CLI baseline with repo-relative inputs and placeholder
state output:

```sh
node dist/cli.js run fixtures/workflow-definitions/simple-manual.valid.json <state-jsonl-path> '{"requestId":"manual-001"}'
```

When running under codex-supervisor, keep supervisor paths explicit through the
environment instead of writing workstation-local paths into docs:

```sh
CODEX_SUPERVISOR_CONFIG=<supervisor-config-path> npm test -- test/cli-loop-executor-smoke.test.ts
```

## Expected Artifacts

The focused smoke test creates temporary local artifacts and removes them at
the end of the test. During execution, expect:

- a temporary EIP RunRequest JSON file passed to the dry-run CLI;
- a local Flow run-state JSONL file at a caller-provided `<state-jsonl-path>` or
  test temporary state path;
- Flow run events for `run.created`, `step.attempt.started`,
  `step.attempt.completed`, and `run.completed`;
- an EIP EvidenceBundleRef with `type: "local_path"` and
  `uri: "artifacts/evidence/cli-loop-smoke/bundle.json"`.

The EvidenceBundleRef path is a local test artifact reference only. It is not a
production evidence store, not customer data, not a durable compliance archive,
and not proof that Ensen-loop wrote evidence outside the dry-run boundary.

## Failure Classification

| Failure class | Route follow-up to | Use when |
| --- | --- | --- |
| `protocol-gap` | TommyKammy/Ensen-protocol, using TommyKammy/Ensen-protocol#28 as the template | The CLI exits successfully but stdout is not valid JSON, the aggregate schema is unsupported, required EIP fields are missing, an EvidenceBundleRef is malformed, or the published protocol fixture/readme is insufficient for a conforming dry-run aggregate. |
| `loop-gap` | TommyKammy/Ensen-loop, linked to TommyKammy/Ensen-loop#35 | The dry-run CLI cannot produce the expected aggregate, exits non-zero, times out, reports blocked prerequisites, or returns non-zero invalid smoke JSON. |
| `flow-gap` | TommyKammy/Ensen-flow | Flow cannot start the configured CLI, loses the aggregate for a submitted request, rejects a valid aggregate, persists incorrect local run state, or wires the connector boundary incorrectly. |

Fail closed when the class is unclear. Do not infer success from naming,
comments, placeholder credentials, forwarded identity hints, or nearby metadata.
Classify from the authoritative boundary that failed: protocol artifact shape,
Loop CLI behavior, or Flow connector/run-state behavior.

## Cleanup

The focused tests clean up their temporary directories automatically. For manual
runs, remove only the caller-provided local state and evidence scratch paths:

```sh
rm -f <state-jsonl-path>
rm -rf <local-smoke-artifact-root>
```

Do not delete repository files, sibling checkouts, customer artifacts, or
supervisor state as part of this smoke cleanup.

## X-Gate 2 Reached Criteria

X-Gate 2 can be marked reached when all of the following are true:

- the Flow branch contains the runbook and linked tests;
- `npm run build` passes;
- `npm test` passes, including `test/cli-loop-executor-smoke.test.ts`;
- the documented smoke command or focused test has been run after
  TommyKammy/Ensen-flow#45 has landed;
- failures can be routed as `protocol-gap`, `loop-gap`, or `flow-gap` with a
  concrete follow-up issue in the owning repository;
- the smoke artifacts remain local test artifacts and do not include raw
  secrets, customer data, real repository mutation artifacts, real GitHub
  mutations, real Codex provider invocations, ERPNext live connector output, or
  regulated workflow evidence.
