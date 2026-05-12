# EIP-0005 RunStatusSnapshot v1

RunStatusSnapshot v1 defines the transport-neutral polling artifact an
Ensen-compatible async executor may expose while a run is accepted, queued,
running, cancelling, or recently terminal. The machine-readable schema lives in
`schemas/eip.run-status.v1.schema.json`.

RunStatusSnapshot is a contract document, not a runtime service, workflow
engine, connector implementation, queue implementation, or replacement for
RunResult.

## Required Fields

- `schemaVersion`: must be `eip.run-status.v1`.
- `id`: the RunStatusSnapshot artifact id.
- `requestId`: the RunRequest artifact id this snapshot describes.
- `correlationId`: shared tracing and retry correlation id.
- `status`: current observed run status.
- `observedAt`: UTC time when this snapshot was observed.

## Statuses

- `accepted`: the executor boundary accepted the request but has not queued
  work yet.
- `queued`: work is waiting for executor capacity.
- `running`: work is actively executing.
- `cancelling`: cancellation was requested and is still being applied.
- `cancelled`: the run was stopped before normal completion.
- `completed`: the run reached normal completion.
- `failed`: the run attempted work and failed.
- `blocked`: the run cannot continue because a prerequisite is missing.
- `unknown`: the executor cannot currently determine the run state.

Consumers must treat `unknown` as non-authoritative. They should retry, fall
back to the authoritative executor record, or escalate instead of inferring a
successful result.

Polling consumers should interpret these values at the transport boundary:

| Status | Boundary meaning |
| --- | --- |
| `accepted` | The trusted boundary accepted the request and may not have assigned executor capacity yet. |
| `queued` | The run is waiting for executor capacity or provider-local scheduling. |
| `running` | The run is actively executing at the provider boundary. |
| `cancelling` | A cancellation request was accepted and is still being applied. |
| `cancelled` | The run has reached a stopped terminal observation; retrieve the final RunResult before treating the run as closed. |
| `completed` | The run has reached a normal terminal observation; retrieve the final RunResult before consuming final details. |
| `failed` | The run has reached a failed terminal observation; retrieve the final RunResult for diagnostics and evidence references. |
| `blocked` | The run has reached a blocked terminal observation because a prerequisite is missing; retrieve the final RunResult for the blocking boundary and evidence references. |
| `unknown` | The provider cannot currently make an authoritative state claim; this is not success, failure, or completion. |

See
[`integration/executor-operation-lifecycle.md`](integration/executor-operation-lifecycle.md)
for the transport-level polling and terminal-state handoff rules that use this
artifact.

## Optional Fields

- `runId`: executor-local run id when the executor has assigned one.
- `message`: bounded operator-facing status text.
- `progress`: bounded progress counters such as `current`, `total`, `percent`,
  and `unit`.
- `extensions`: `x-` prefixed extension map.

Top-level fields outside the schema are rejected. Extension data must stay under
`extensions` and must use `x-` prefixed keys so future core fields remain
unambiguous.

## RunResult Separation

RunStatusSnapshot is for polling state. It must not carry final-result-only
details such as `completedAt`, `changeRequests`, `evidenceBundles`,
`verification`, terminal `errors`, terminal `warnings`, or terminal `metrics`.

When a snapshot reports `completed`, `failed`, `blocked`, or `cancelled`, it is
only a terminal snapshot status echo. Consumers retrieve final details via
RunResult. RunResult is the terminal artifact that carries completion time,
evidence references, change request references, verification summaries,
diagnostics, and metrics.

## Connector Use

An Ensen-flow executor connector may use RunStatusSnapshot as the shared polling
contract for an asynchronous executor:

1. Ensen-flow submits or receives a RunRequest.
2. The executor connector polls the executor-specific boundary.
3. The connector normalizes each observation into RunStatusSnapshot v1.
4. Ensen-flow displays or routes the snapshot while continuing to wait for the
   terminal RunResult.

This lets an Ensen-flow executor connector interoperate with async executors
without importing Ensen-loop runtime code, queue internals, or loop-specific
state machines. The connector only depends on the protocol artifact shape.

## Binding and Safety

`requestId` is the explicit binding to the RunRequest this snapshot describes.
Consumers must not infer repository, tenant, account, authorization, or
environment linkage from id shape, branch names, issue numbers, status text, or
nearby operator-facing metadata. Those bindings must come from authoritative
scope records outside this artifact.

When `requestId`, `correlationId`, provenance, or scope context is missing or
malformed, consumers should fail closed instead of accepting a guessed match.

Checked-in RunStatusSnapshot fixtures must be synthetic and public. Raw
credentials, access tokens, private customer values, and host-local absolute
paths are not valid fixture content, even inside `extensions`, `message`, or
progress text.
