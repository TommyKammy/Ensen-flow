# Loop-Flow Protocol v0.2.0 Connection Smoke

This runbook is the pre-Phase 5 Flow-owned smoke for the Loop-Flow executor
boundary. It verifies that Flow constructs and consumes Protocol v0.2.0-shaped
artifacts through the executor connector boundary without importing Ensen-loop
runtime code, importing an Ensen-protocol runtime package, or depending on a
mutable sibling checkout at Flow runtime.

It is local smoke evidence only. It is not production Loop dispatch, provider
execution, SCM mutation, pull request creation, ERPNext behavior,
Pharma/GxP readiness, or compliance evidence.

Out of scope: no production Loop dispatch, no real executor service, no real
provider run, no repository mutation, no real pull request, no customer data,
not compliance evidence, and no production evidence archive.

## Snapshot Boundary

Use the copied active snapshot under
`protocol-snapshots/ensen-protocol/v0.2.0/` as the contract boundary:

- RunRequest: `schemas/eip.run-request.v1.schema.json` and
  `fixtures/run-request/v1/valid/`;
- RunStatusSnapshot: `schemas/eip.run-status.v1.schema.json` and
  `fixtures/run-status/v1/valid/`;
- RunResult: `schemas/eip.run-result.v1.schema.json` and
  `fixtures/run-result/v1/valid/`;
- EvidenceBundleRef: `schemas/eip.evidence-bundle-ref.v1.schema.json` and
  `fixtures/evidence-bundle-ref/v1/valid/`;
- capability vocabulary:
  `docs/integration/executor-transport-capabilities.md` and
  `fixtures/capability-variants/v1/valid/`.

Do not resolve this boundary by importing Ensen-protocol code or reading a
sibling checkout at Flow runtime. Snapshot drift is repaired by replacing the
copied snapshot from a tagged Protocol release.

## Local Commands

Install, build, and run the focused pre-Phase 5 smoke from the Ensen-flow
repository root:

```sh
npm ci
npm run build
npm test -- test/executor-connector.test.ts test/cli-loop-executor-smoke.test.ts test/protocol-snapshot.test.ts
```

The focused command validates the Flow executor connector, the local/fake Loop
CLI stdout smoke, and the copied Protocol v0.2.0 snapshot. The full repo check
remains:

```sh
npm test
```

If an operator also has a local Loop CLI, keep it optional and sanitized:

```sh
CODEX_SUPERVISOR_CONFIG=<supervisor-config-path> npm test -- test/cli-loop-executor-smoke.test.ts
```

The local CLI boundary is expected to accept a protocol-shaped
`<run-request-json-file>` and return a deterministic local/fake/dry-run
aggregate. It must not start a real provider session, mutate a repository,
create a real pull request, call production Loop services, or write customer
data.

## Capability Checks

The smoke keeps Protocol v0.2.0 capability levels explicit:

| Capability | Required smoke behavior |
| --- | --- |
| `submit` | Required baseline. Flow must submit a RunRequest-shaped payload with an idempotency key and explicit source/requester/work-item binding. |
| `status` | Optional or partial. Unsupported polling must return an unsupported operation or fail closed; Flow must not fabricate terminal RunStatusSnapshot success. |
| `cancel` | Optional or unsupported. Unsupported cancel leaves the run unchanged and reports unsupported cancellation; Flow must not mark the run cancelled by inference. |
| `fetchEvidence` | Optional, partial, or unsupported. Evidence absence does not rewrite authoritative terminal status, and unsupported fetch does not invent an EvidenceBundleRef. |
| polling support | Optional or partial. Repeated reads must stay anchored to the submitted request and authoritative status/result artifacts. |
| evidence reference support | Optional or partial. References remain public-safe local refs or fixture refs, not embedded evidence bodies or workstation paths. |
| idempotency expectation | Required baseline. Replays must stay bound to the same logical RunRequest scope instead of relying on correlation id or naming. |

Use
`protocol-snapshots/ensen-protocol/v0.2.0/fixtures/capability-variants/v1/valid/`
as the comparison set for unsupported, partial, and fully supported examples.

## Failure Routing

| Failure class | Route follow-up to | Use when |
| --- | --- | --- |
| `protocol-gap` | TommyKammy/Ensen-protocol, using TommyKammy/Ensen-protocol#28 as the template | The copied v0.2.0 snapshot is missing or ambiguous, fixture capability vocabulary disagrees with contract docs, an artifact shape cannot be represented by Protocol v0.2.0, or a successful local CLI output is not valid protocol-shaped JSON. |
| `loop-gap` | TommyKammy/Ensen-loop | The local/fake/dry-run Loop boundary cannot produce the expected aggregate, reports unsupported behavior that contradicts explicit Protocol text, exits non-zero without a valid blocked aggregate, times out, or claims real mutation/provider behavior in this smoke. |
| `flow-gap` | TommyKammy/Ensen-flow | Flow constructs an invalid RunRequest, rejects valid v0.2.0 artifacts, fabricates status/result/evidence/cancellation success, loses the submitted request binding, or documents an unsafe command or path. |

When ownership is unclear, keep the guard in place and route the ambiguity as
`protocol-gap` instead of resolving it through Flow-specific interpretation.

## Cleanup

The focused tests create temporary local artifacts and clean them up
automatically. Manual smoke cleanup is limited to caller-provided scratch paths:

```sh
rm -f <state-jsonl-path>
rm -rf <local-smoke-artifact-root>
```

Do not delete repository checkouts, supervisor state, sibling repositories,
customer artifacts, or production evidence stores as part of this smoke.
