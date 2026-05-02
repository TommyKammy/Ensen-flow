# EIP-0001 RunRequest v1

RunRequest v1 defines the transport-neutral request artifact used to ask an
Ensen-compatible executor to run work. The machine-readable schema lives in
`schemas/eip.run-request.v1.schema.json`.

RunRequest is a contract document, not an executor API, queue format, webhook
handler, connector implementation, or runtime service.

## Required Fields

- `schemaVersion`: must be `eip.run-request.v1`.
- `id`: the RunRequest artifact id.
- `correlationId`: shared tracing and retry correlation id.
- `idempotencyKey`: producer-assigned key for the same logical request.
- `source`: object identifying the source system that produced the request.
- `requestedBy`: actor that requested or dispatched the work.
- `workItem`: work item reference for the requested work.
- `mode`: requested executor mode: `plan`, `apply`, or `validate`.
- `createdAt`: UTC creation time for the request artifact.

## Optional Fields

- `target`: explicit repository, workspace, environment, or manual target.
- `policyContext`: policy set and risk-class hints for enforcement.
- `dataClassification`: common v1 classification label.
- `extensions`: `x-` prefixed extension map.

Top-level fields outside the schema are rejected. Extension data must stay under
`extensions` and must use `x-` prefixed keys so future core fields remain
unambiguous.

## Source and Work Item Binding

`source` is always an object using the common v1 SourceRef shape. A string such
as `"github"` is not enough because it cannot carry a durable source id or
explicit external source reference.

`workItem.externalId` carries the identifier used by the external source system,
such as a GitHub issue number or a manual intake ticket. Consumers must not
derive repository, tenant, account, authorization, or environment bindings from
the external id alone. Those bindings must come from authoritative scope records
outside this artifact.

## Idempotency

Producers should reuse the same `idempotencyKey` when retrying the same logical
RunRequest after a transport timeout, queue retry, or dispatcher restart.
Consumers should use the tuple of artifact type, authoritative scope record, and
`idempotencyKey` to detect duplicate logical requests.

`correlationId` remains useful for tracing related artifacts, but it is not a
deduplication key by itself and is not an authorization token. If the scope
record, requester, source, or required provenance is missing or malformed,
consumers should fail closed instead of accepting a guessed idempotency match.

## Fixture Safety

Checked-in RunRequest fixtures must be synthetic and public. Raw credentials,
access tokens, private customer values, and host-local absolute paths are not
valid fixture content, even inside `extensions`.
