# EIP-0003 AuditEvent v1

AuditEvent v1 defines the transport-neutral event artifact for append-only audit
and evidence streams. The machine-readable schema lives in
`schemas/eip.audit-event.v1.schema.json`.

AuditEvent is a contract document, not an audit storage service, message broker,
runtime event emitter, workflow engine, or connector implementation.

## Required Fields

- `schemaVersion`: must be `eip.audit-event.v1`.
- `id`: the AuditEvent artifact id.
- `correlationId`: shared tracing and retry correlation id.
- `subject`: explicit object identifying the artifact or process the event is
  about.
- `type`: dot-separated event type name from the registry.
- `actor`: actor that produced or caused the event.
- `occurredAt`: UTC time when the audited fact occurred.

The legacy top-level field `timestamp` is not part of AuditEvent v1. Producers
must emit `occurredAt`; consumers should reject events that omit it or use
`timestamp` instead.

## Optional Fields

- `causationId`: AuditEvent or protocol artifact id that directly caused this
  event.
- `sequence`: producer-assigned positive sequence number within the stream or
  subject.
- `severity`: `debug`, `info`, `notice`, `warning`, `error`, or `critical`.
- `payload`: event-specific structured facts.
- `dataClassification`: common v1 classification label.
- `extensions`: `x-` prefixed extension map.

Top-level fields outside the schema are rejected. Extension data must stay under
`extensions` and must use `x-` prefixed keys so future core fields remain
unambiguous.

## Append-Only Usage

AuditEvent streams are append-only. Producers should record new facts as new
events instead of editing or replacing earlier events. Corrections should refer
to the earlier event with `causationId` or a payload field that names the
corrected event, while preserving the original event for evidence continuity.

Consumers must not infer repository, tenant, account, authorization, or
environment linkage from event ids, subject id shape, issue numbers, branch
names, or operator-facing summaries. Those bindings must come from
authoritative scope records outside this artifact. When the required binding,
actor, subject, or provenance is missing or malformed, consumers should fail
closed instead of accepting a guessed match.

## Event Type Registry

Event types use lowercase dot-separated namespaces. The first segment names the
owning domain, later segments narrow the event family and action.

| Event type | Owner | Meaning |
| --- | --- | --- |
| `loop.run.requested` | Ensen-loop | A loop run was requested. |
| `flow.step.completed` | Ensen-flow | A flow step completed. |

New event types should be added to this registry before producers emit them in
published fixtures or compatibility tests.

## Payload Safety

`payload` is for bounded, structured, synthetic or production-safe event facts.
It must not carry raw secrets, access tokens, private keys, passwords, customer
private values, or host-local absolute paths. Store sensitive values in an
approved secret store or evidence system and put only stable redacted references
or public digests in the AuditEvent.
