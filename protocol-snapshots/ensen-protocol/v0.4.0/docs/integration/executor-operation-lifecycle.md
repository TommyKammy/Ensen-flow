# Executor Operation Lifecycle

This document defines transport-neutral lifecycle semantics for executor
operations described by the
[executor transport capability model](executor-transport-capabilities.md). It
does not define an HTTP API, OpenAPI endpoint, SDK, runtime server, queue
adapter, connector implementation, or production readiness claim.
It must not define OpenAPI endpoints and must not require SDK packages.

Lifecycle statements describe how protocol consumers reason about `submit`,
`status`, `cancel`, and `fetchEvidence` when existing EIP artifacts cross a
trusted boundary. They preserve the current v1 schemas for RunRequest,
RunStatusSnapshot, RunResult, and EvidenceBundleRef.

## Shared Lifecycle Rules

Each operation inherits the capability support levels from
`executor-transport-capabilities.md`: `required baseline`, `optional`,
`partial`, and `unsupported`. A boundary must publish which support level
applies before consumers treat an operation as available.

Lifecycle decisions must be anchored to authoritative boundary records and EIP
artifacts. Do not infer a run, tenant, repository, account, issue, environment,
or evidence linkage from path shape, naming conventions, status text, nearby
metadata, or a matching `correlationId` alone.

The `correlationId` traces related artifacts. It is not an authorization,
idempotency, scope, or run-binding token. Retryable submission uses the
RunRequest `idempotencyKey` together with the authoritative scope record. When
scope, requester, provenance, idempotency, or artifact binding is missing or
malformed, consumers should fail closed instead of accepting guessed context.

Unsupported and out-of-subset operations are explicit outcomes. A consumer must
reject, block, or route the operation without treating absence, timeout,
operator text, or a different supported operation as proof of success.

## submit lifecycle

`submit` accepts a RunRequest at a trusted executor boundary and either binds it
to an authoritative run record or records an authoritative rejection. Executor
providers that accept work expose `submit` as the `required baseline`
operation.

Successful submission does not require an immediate RunResult. The first
authoritative outcome may be a submitted run record, an accepted or queued
RunStatusSnapshot, or a terminal RunResult if the boundary can complete the run
synchronously. The artifact ids and scope binding must still point back to the
submitted RunRequest.

Retries of the same logical submission reuse the RunRequest `idempotencyKey`
inside the same authoritative scope. A retry may return the existing bound run
or rejection record, but it must not enqueue duplicate work by relying on
`correlationId` alone.

When `submit` is `partial`, the boundary must state the accepted request modes,
work item types, scopes, or executor classes. Requests outside that subset stay
blocked or rejected. When `submit` is `unsupported`, the boundary is not an
executor provider for that exchange and must not synthesize a run.

## status lifecycle

`status` reads the authoritative run state for a RunRequest-bound run and emits
RunStatusSnapshot observations. It is `optional` unless a provider advertises
asynchronous execution or polling support.

A RunStatusSnapshot may report accepted, queued, running, cancelling,
cancelled, completed, failed, blocked, or unknown states permitted by the v1
schema. A terminal snapshot is only a status echo. Final details, verification,
diagnostics, and evidence references belong in RunResult.

The status read must be tied to the authoritative run binding. Consumers should
not construct snapshots from stale summaries, display badges, timeline text, or
the newest-looking projection when those surfaces disagree with the lifecycle
record.

When `status` is `partial`, the boundary must name the supported states,
polling interval expectations, or freshness limits. Outside that subset, the
consumer reports unsupported or unknown status rather than fabricating
completion. When `status` is `unsupported`, consumers must not poll a different
surface and present it as protocol status.

## Polling And Terminal-State Rules

Protocol polling is a consumer-owned polling loop over the provider's trusted
`status` boundary. The protocol defines which artifacts and states cross that
boundary; it does not define a shared scheduler, worker loop, retry engine,
timer implementation, or runtime package.

The polling cadence belongs to the consumer and the provider-specific
capability contract. A boundary may publish a recommended minimum interval,
backoff expectation, freshness limit, or maximum observation age. When no such
contract is published, the consumer uses consumer-local orchestration and must
not present its local retry timing as shared protocol behavior.

Polling reads emit RunStatusSnapshot observations. `accepted`, `queued`,
`running`, and `cancelling` are non-terminal progress observations. `unknown`
is non-authoritative and must remain retry, fallback, or escalation input
rather than success or failure. `cancelled`, `completed`, `failed`, and
`blocked` are terminal snapshot status echo values: they indicate that polling
has observed a terminal boundary state, but they do not carry final details.

The terminal handoff from polling to result retrieval is explicit. After a
terminal snapshot status echo, consumers retrieve the RunResult bound to the
same RunRequest and authoritative run record. RunResult carries final status,
completion time, verification, diagnostics, change request references, and
evidence references. Consumers must not synthesize RunResult content from a
snapshot, progress text, timeline entry, badge, timeout, or operator summary.

In this contract, unsupported polling means the provider has no protocol status
boundary for the exchange. Consumers may still use consumer-local orchestration
to wait for a synchronous response, a terminal RunResult, or a provider-local
callback, but they must report polling as unsupported and must not invent
RunStatusSnapshot semantics from another surface.

In this contract, partially supported polling means the boundary publishes a
constrained subset: for example, only `queued` and `running`, only terminal
echoes, no cancellation-related states, a maximum freshness window, or
provider-specific minimum polling cadence. Observations outside that subset are
unsupported or unknown unless the authoritative boundary explicitly extends the
subset.

A timeout is a consumer-local observation that a polling policy expired before
a trusted terminal artifact was retrieved. A stale snapshot is an observation
whose `observedAt` or provider freshness contract is too old to rely on. A
no-progress report is a consumer-local report that repeated authoritative reads
did not advance according to the published capability subset. These conditions
are protocol-visible guidance for reporting and escalation, but they are not
new RunStatusSnapshot statuses and do not imply `failed`, `blocked`,
`cancelled`, `completed`, or any RunResult status.

## cancel lifecycle

`cancel` requests cancellation for an already submitted run that is explicitly
bound to a RunRequest and authoritative run record. Cancellation is `optional`
and best-effort unless Loop and Flow evidence proves a stronger boundary
contract for a specific provider.

A successful cancel request means the trusted boundary accepted the request to
try cancellation. It does not guarantee immediate termination, rollback, or
absence of side effects. Follow-up status may remain queued or running, move to
cancelling, or eventually produce a cancelled, failed, blocked, or completed
terminal state depending on the provider boundary.

RunStatusSnapshot may expose `cancelling` or `cancelled` observations. RunResult
may later record final `cancelled` status. Consumers must not mark a run
cancelled from a timeout, missing response, operator note, or unsupported
capability result.

When `cancel` is `partial`, the boundary must name the supported cancellation
window, such as only before dispatch or only while queued. Runs outside that
window remain governed by status and RunResult. When `cancel` is `unsupported`,
the run remains unchanged and the consumer reports unsupported cancellation.

## fetchEvidence lifecycle

`fetchEvidence` performs reference retrieval for evidence associated with a
terminal or blocked run. It is `optional` and complements, but does not replace,
EvidenceBundleRef entries in RunResult.

The operation resolves or returns EvidenceBundleRef artifacts or storage
references that the consumer is authorized to access. It is not direct evidence
payload transport. Protocol artifacts do not embed evidence bodies, raw logs,
credentials, token values, customer data, real repository mutation payloads, or
workstation-local paths.

Evidence references must stay bound to the authoritative run or result they
describe. Consumers must not broaden an evidence reference from one run to a
sibling run, same-parent issue, nearby timeline entry, or matching
`correlationId` unless an explicit authoritative link says it applies there.

When `fetchEvidence` is `partial`, the boundary must name the supported
evidence roots, artifact classes, retention windows, or authorization modes.
Outside that subset, the consumer reports unsupported evidence retrieval. When
`fetchEvidence` is `unsupported`, the consumer may still preserve
EvidenceBundleRef references already present in RunResult, but it must not
invent retrievable evidence.

## Supported, Partial, And Unsupported Behavior

Capability support describes operation availability; lifecycle semantics
describe what the operation means after it is invoked. A supported operation
must identify its trusted boundary, accepted artifact shape, authoritative
binding, and fail-closed behavior. A partial operation must identify the exact
subset and the out-of-subset result. An unsupported operation must produce a
clear unsupported-operation outcome or route the request without pretending the
operation succeeded.

The lifecycle does not add new schema fields. If a consumer needs a field or
state that cannot be represented by RunRequest, RunStatusSnapshot, RunResult,
or EvidenceBundleRef, route that as Protocol schema/spec ambiguity instead of
adding consumer-local semantics that imply a shared contract.

## Drift Routing

Use
[protocol-gap-and-conformance-drift.md](protocol-gap-and-conformance-drift.md)
when lifecycle evidence disagrees across Protocol, Loop, and Flow.

Route missing or ambiguous lifecycle contract text to Ensen-protocol as a
protocol gap or schema/spec ambiguity. Route Loop provider behavior that
contradicts explicit protocol text to Ensen-loop. Route Flow connector matrix,
authoring, ingestion, or presentation behavior that contradicts explicit
protocol text to Ensen-flow.

Public examples and issue reports must use repo-relative paths, release tags,
public issue links, and placeholders such as `<protocol-snapshot>`,
`<consumer-repo>`, `<executor-boundary>`, `<run-id>`, and `<evidence-root>`.
Do not include raw secrets, customer data, real repository mutation evidence,
or workstation-local paths.
