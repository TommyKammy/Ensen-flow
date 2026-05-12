# Executor Transport Capabilities

This document defines the executor transport capability model for Ensen
protocol consumers and providers. It is transport-neutral vocabulary for
describing which executor operations are supported by a boundary; it is not an
API definition, connector implementation, SDK contract, server contract, queue
contract, or compliance claim.

The model exists so Ensen-loop, Ensen-flow, future executor providers, and
connector authors can compare capability evidence without turning a local
adapter behavior into a protocol guarantee. Capability statements describe the
boundary where a RunRequest, RunStatusSnapshot, RunResult, or EvidenceBundleRef
is exchanged. They do not prove that a runtime is production ready.

This document must not define OpenAPI endpoints. It must not require SDK
packages, runtime implementation directories, connector modules, or shared
execution code.

## Capability Vocabulary

Every executor transport boundary should describe each capability using one of
these support levels:

| Support level | Meaning | Required evidence |
| --- | --- | --- |
| required baseline | The boundary must support the operation for the protocol exchange to be meaningful. | Contract text, schema or fixture references, and consumer evidence that the boundary accepts or emits the expected artifact shape. |
| optional | The operation is allowed but not required for all transports. | Consumer or provider evidence that the operation exists and reports unsupported behavior when absent. |
| partial | The operation exists with documented limits. | A bounded statement of which modes, states, evidence roots, or retry cases are supported, plus fail-closed behavior outside those limits. |
| unsupported | The operation is not available at this boundary. | Explicit unsupported-operation behavior that rejects, blocks, or routes the request without coercing the capability into supported. |

Do not infer support from naming conventions, nearby documentation, successful
manual runs, or a connector class name. A capability is present only when the
boundary has explicit evidence for the operation and artifact it claims to
exchange.

## Capability Categories

| Capability | Baseline level | Protocol relationship | Unsupported-operation behavior |
| --- | --- | --- | --- |
| `submit` | required baseline for executor providers that accept work | Accepts a RunRequest v1 at the trusted executor boundary and binds it to an authoritative run or rejection record. | Reject or block the request; do not enqueue guessed work or synthesize missing scope. |
| `status` | optional unless the provider advertises asynchronous execution | Emits RunStatusSnapshot v1 observations for accepted, queued, running, cancelling, cancelled, completed, failed, blocked, or unknown states. | Report unsupported status polling; do not fabricate completed snapshots from terminal summaries. |
| `cancel` | optional | Requests cancellation for a run already bound to a RunRequest and authoritative run record. | Return an unsupported cancellation outcome or leave the run unchanged; do not mark a run cancelled by inference. |
| `fetchEvidence` | optional | Resolves or returns EvidenceBundleRef v1 references for evidence associated with a terminal or blocked run. | Report unsupported evidence fetch; do not embed evidence bodies, secrets, customer data, or workstation-local paths in protocol artifacts. |
| polling support | optional | Defines whether repeated status reads are expected and which RunStatusSnapshot states can appear. | Fail closed when polling state cannot be trusted; surface unknown as non-authoritative rather than success. |
| evidence reference support | optional | Defines whether RunResult may carry EvidenceBundleRef entries or only a terminal status without evidence links. | Preserve an empty or absent evidence reference set; do not invent evidence references to appear complete. |
| idempotency expectation | required baseline for retryable submit boundaries | Uses RunRequest `idempotencyKey` with the authoritative scope record to detect duplicate logical requests. | Reject or block when idempotency, scope, requester, or provenance is missing or malformed; do not accept by correlation id alone. |

The capability name describes a protocol-facing operation, not a transport
method. A REST endpoint, CLI command, message queue, local adapter, or future
provider boundary can all use the same capability vocabulary when the exchanged
artifact contract is the same.

## Baseline, Optional, Partial, And Unsupported

A minimally useful executor provider supports `submit` and the idempotency
expectation for retryable submission. That baseline means a RunRequest can be
accepted or rejected at a trusted boundary and duplicate logical submissions can
be recognized within the same authoritative scope.

`status`, `cancel`, `fetchEvidence`, polling support, and evidence reference
support are optional unless a provider or consumer explicitly advertises them.
Optional does not mean best-effort success. Optional capabilities must be either
documented as supported, documented as partial, or documented as unsupported.

Partial support must name the supported subset. Examples include status polling
without cancellation, RunResult evidence references without a fetch operation,
or cancellation only before a run leaves `queued`. Partial support must also
state the fail-closed result for cases outside the subset.

Unsupported is an explicit capability state. Consumers must not coerce
an unsupported operation into a supported one by retrying another operation,
parsing operator-facing text, treating a missing response as success, or
substituting guessed context.

## Consumer And Provider Evidence

Flow connector capability matrix evidence should map each connector row to the
capability vocabulary in this document. The matrix should state whether
`submit`, `status`, `cancel`, `fetchEvidence`, polling support, evidence
reference support, and idempotency expectation are required baseline, optional,
partial, or unsupported for that connector boundary.

Loop provider boundary evidence should identify the trusted provider boundary
where RunRequest submission, RunStatusSnapshot polling, RunResult terminal
output, cancellation, and EvidenceBundleRef handling are accepted, rejected, or
reported as unsupported. The provider boundary is the evidence anchor; issue
text, adapter names, and local operator summaries are derived context.

When Flow and Loop evidence disagree, use the authoritative boundary record and
artifact evidence first. Repair the derived capability row or provider summary;
do not redefine protocol truth around a convenience projection.

## Artifact Compatibility

This model is compatible with the existing EIP artifacts:

- RunRequest carries the transport-neutral submit artifact and the
  `idempotencyKey` used for retryable submission.
- RunStatusSnapshot carries transport-neutral status observations for polling
  boundaries.
- RunResult carries terminal outcome, verification, diagnostic, and evidence
  reference summaries.
- EvidenceBundleRef carries evidence references without embedding evidence
  bodies or credentials.

No new schema fields are required by this model. If a consumer proves that a
capability cannot be represented with the current artifacts, route that as a
protocol gap instead of adding local-only fields or extension keys that imply a
general contract.

## Conformance Fixture Examples

Phase 3 capability variants are covered by public-safe examples under
`fixtures/capability-variants/v1/valid/`. They are fixture-like conformance
inputs for Loop and Flow consumers, not a new runtime, SDK, connector, OpenAPI
endpoint, provider server, or schema family.

Use these examples when checking capability matrices and provider-boundary
evidence:

| Example | Consumer conformance use |
| --- | --- |
| `fixtures/capability-variants/v1/valid/fully-supported-transport.json` | supported capability variant example for a boundary that advertises submit, status, cancel, fetchEvidence, polling, evidence references, and idempotency |
| `fixtures/capability-variants/v1/valid/submit-only-no-polling.json` | partial capability variant example for submit-only or no-polling transports |
| `fixtures/capability-variants/v1/valid/unsupported-cancel.json` | unsupported capability variant example for cancel requests that must remain blocked or routed |
| `fixtures/capability-variants/v1/valid/evidence-unavailable.json` | evidence unavailable example for absent, inaccessible, expired, unauthorized, or unsupported evidence retrieval |
| `fixtures/capability-variants/v1/valid/retryability-examples.json` | retryable transport failure example and non-retryable transport failure example for transport error mapping |

Loop consumers should compare provider-boundary evidence with each example's
`capabilitySummary` before treating an operation as available. Flow consumers
should compare connector capability matrix rows with the same summaries. Both
consumers should preserve the referenced RunRequest, RunStatusSnapshot,
RunResult, and EvidenceBundleRef artifact families as copied contract fixtures
and keep unsupported or partial operations fail closed.

## Drift Routing

Loop and Flow consumers should report capability drift through
`protocol-gap-and-conformance-drift.md` as conformance drift. A drift report
should include the protocol snapshot version, failing consumer repo, observed
artifact, expected artifact, reproduction boundary, sanitized artifact
references, and the capability whose support level drifted.

Use these routing rules:

- route missing or ambiguous capability contract text to Ensen-protocol as a
  protocol gap;
- route a Flow connector capability matrix mismatch to Ensen-flow when this
  document is explicit and the connector evidence is wrong;
- route a Loop provider boundary mismatch to Ensen-loop when this document is
  explicit and the provider evidence is wrong;
- route unclear artifact compatibility to Ensen-protocol as schema/spec
  ambiguity;
- keep unsupported operations fail closed while the issue is triaged.

Public examples and issue reports must use repo-relative paths, release tags,
public issue links, and placeholders such as `<protocol-snapshot>`,
`<consumer-repo>`, `<executor-boundary>`, and `<evidence-root>`. Do not include
raw credentials, customer data, real repository mutation evidence, or
workstation-local paths.
