# Transport Error Mapping And Retryability

This document defines transport error mapping and retryability guidance for
executor boundaries that exchange RunRequest, RunStatusSnapshot, RunResult, and
EvidenceBundleRef artifacts. It is transport-neutral contract text. It is not a retry engine, provider adapter, queue policy, SDK contract, OpenAPI response
schema, provider-specific error code catalog, or production readiness claim.

Protocol guidance must not require automatic retry behavior. A consumer may use
this mapping as input to consumer-local orchestration, but retry timing,
attempt limits, backoff, circuit breaking, and provider-specific recovery rules
remain owned by Loop, Flow, or another consuming runtime.

This document must not define provider-specific error code catalogs. Provider
codes may be recorded as sanitized diagnostics only when the trusted boundary
has already mapped them into one of the categories below.

## Mapping Rules

Map an error at the trusted executor boundary where the protocol artifact is
submitted, observed, cancelled, or resolved. Do not infer category, retryable
state, tenant, repository, account, issue, environment, or evidence linkage
from naming conventions, path shape, forwarded headers, operator text, timeline
summaries, or nearby metadata.

When a prerequisite signal is missing or malformed, fail-closed. A missing
scope binding, unknown capability, unsupported EIP major version, absent
evidence authorization, or ambiguous terminal state must stay blocked,
unsupported, unknown, or rejected instead of being upgraded into success by
retry.

Retryability is advisory unless a consumer boundary makes it authoritative.
`retryable` means a consumer-local retry may be reasonable after preserving the
same authoritative scope and idempotency binding. `not retryable` means retrying
the same operation is expected to repeat the same rejected or terminal outcome
until the prerequisite, request, capability, or protocol contract changes.

## Error Categories

| Category | Typical boundary | Retryability guidance | RunStatusSnapshot expectation | RunResult expectation | Diagnostics expectation |
| --- | --- | --- | --- | --- | --- |
| validation failure | RunRequest, RunStatusSnapshot, RunResult, or EvidenceBundleRef parsing and validation | not retryable until the artifact is corrected | Do not emit a successful snapshot from an invalid artifact. If status is already known, surface `blocked`, `failed`, or `unknown` only from the authoritative boundary. | Use `blocked` when the run cannot start or continue because the protocol artifact is invalid; use `failed` only when a submitted run terminally failed after validation. | Name the invalid artifact family, schema version, field path when safe, and validator command. |
| unsupported capability | `submit`, `status`, `cancel`, `fetchEvidence`, polling, or evidence reference boundary | not retryable as the same operation; route or use supported consumer-local behavior | Use `unknown` only for unsupported status observation; do not fabricate `completed`, `failed`, or `cancelled`. | Use `blocked` when the requested protocol exchange cannot proceed because the required capability is unavailable. | Name the capability and support level from `executor-transport-capabilities.md`. |
| transient transport failure | trusted boundary returns a temporary network, queue, availability, or rate-limit failure without accepting a terminal outcome | retryable only as consumer-local policy using the same idempotency and scope binding | A prior authoritative snapshot remains valid; a new snapshot should not be invented from the transport error. | Do not emit a terminal RunResult unless the authoritative boundary records one. | Record sanitized transport class, retry correlation, and the boundary that failed. |
| provider rejection | trusted provider explicitly rejects the request, authorization, scope, quota, policy, or prerequisite | not retryable until the rejected prerequisite changes | If the rejection happens before a run is bound, no successful status snapshot exists. If it happens during a run, status must come from the authoritative run record. | Use `blocked` for unmet prerequisites or policy blocks; use `failed` for terminal provider execution failure after acceptance. | Preserve provider reason as sanitized diagnostic text without secrets or provider-specific code catalogs. |
| timeout | consumer-local wait, polling, submission, cancellation, or evidence fetch window expires before an authoritative terminal artifact is retrieved | retryable for observation or fetch when the boundary allows it; not evidence of terminal success or failure | Use `unknown` for non-authoritative status observation, or keep the previous authoritative snapshot. | Do not synthesize RunResult from timeout. A terminal RunResult requires the authoritative result boundary. | Name the timed operation, timeout class, and whether the next action is retry, fallback, or escalation. |
| cancellation conflict | cancel request races with completion, unsupported cancellation, or a provider state outside the supported cancellation window | retryable only when the boundary documents a still-open cancellation window | Status remains the authoritative run state: `accepted`, `queued`, `cancelling`, `cancelled`, `completed`, `failed`, `blocked`, or `unknown` as observed. | Use `cancelled` only after authoritative terminal cancellation; otherwise use the actual terminal result. | Name the cancellation boundary, supported window, and conflicting observed state. |
| evidence unavailable | EvidenceBundleRef is absent, inaccessible, expired, unauthorized, or outside supported evidence roots | retryable only for temporary retrieval failures; not retryable for unsupported, unauthorized, expired, or absent evidence | Status is unchanged. Do not mark a run completed or failed from evidence absence alone. | Use `blocked` when required evidence is unavailable for handoff; otherwise preserve the terminal status and diagnostics that evidence is unavailable. | Name the evidence reference or placeholder root using public-safe values only. |
| unknown failure | trusted boundary cannot classify the failure without guessing context | retryable only as consumer-local observation or escalation; do not treat as success | Use `unknown` or preserve the last authoritative snapshot. | Use `blocked` when missing classification prevents a safe handoff; use `failed` only when the authoritative result says execution failed. | Record what signal was missing and route the ambiguity instead of inventing a category. |

## Status And Result Expectations

RunStatusSnapshot is an observation of authoritative run state. It may expose
`unknown` when a status read is non-authoritative or cannot be safely
classified. It must not turn a timeout, unsupported operation, transport
exception, stale projection, or operator summary into `completed`, `failed`,
`blocked`, or `cancelled` without an authoritative boundary record.

RunResult is the terminal artifact. It must not be synthesized from a
RunStatusSnapshot, timeout, retry attempt, provider message, polling loop, or
consumer-local summary. Use `blocked` for missing prerequisites, unsupported
capabilities, unsupported EIP major version, unavailable required evidence, or
policy rejection that prevents a safe protocol handoff. Use `failed` for an
accepted run that terminally failed at the provider boundary. Use `cancelled`
only when cancellation is the authoritative terminal result.

Diagnostics should identify the category, operation, trusted boundary,
artifact family, sanitized provider reason when available, retryability
guidance, and next routing owner. Diagnostics must not contain raw credentials,
sample secrets, unsigned tokens treated as valid auth, customer data, real
repository mutation evidence, workstation-local paths, or provider-specific
catalog claims.

## Unsupported EIP Major Versions

Unsupported EIP major version handling remains fail-closed. A consumer that
receives an unsupported major version must reject or block the artifact at its
parser, ingestion, authoring, or dispatch boundary and preserve sanitized
evidence of the unsupported version and boundary that rejected it.

Do not retry an unsupported EIP major version as though it were a transient
transport failure. Retry is allowed only after the artifact is replaced with a
supported protocol snapshot or the consuming boundary explicitly adds support
for that major version.

## Drift Routing

Use [protocol-gap-and-conformance-drift.md](protocol-gap-and-conformance-drift.md)
when the category, retryability guidance, artifact expectation, or ownership is
missing or disagrees across Protocol, Loop, Flow, and consumer-local evidence.

Route findings as follows:

- Ensen-protocol: missing or ambiguous category text, retryability guidance,
  status/result mapping, schema/spec ambiguity, or unsupported-major-version
  contract wording;
- Ensen-loop: Loop provider boundary behavior contradicts explicit protocol
  text, drops diagnostics, or maps a transport error to the wrong terminal
  outcome;
- Ensen-flow: Flow connector, authoring, ingestion, or presentation behavior
  contradicts explicit protocol text or broadens retryability beyond the
  connector capability evidence;
- consumer-local follow-up: retry schedule, backoff, alerting, provider code
  lookup, local queue behavior, local timeout value, or UX copy can be fixed
  without changing shared EIP contract text.

Keep the guard in place while routing. If category or ownership is unclear,
block, reject, surface `unknown`, or open the appropriate follow-up instead of
assuming retryability.

## Fixture And Example Safety

public fixture safety behavior is unchanged. This document adds mapping and
retryability guidance only; it does not change public fixture safety
implementation, policy, schemas, fixture validation, or public example
boundaries.

Public examples and issue reports must use repo-relative paths, release tags,
public issue links, and placeholders such as `<protocol-snapshot>`,
`<consumer-repo>`, `<executor-boundary>`, `<run-id>`, `<operation>`, and
`<evidence-root>`. Do not include raw credentials, customer data, real
repository mutation evidence, or workstation-local paths.
