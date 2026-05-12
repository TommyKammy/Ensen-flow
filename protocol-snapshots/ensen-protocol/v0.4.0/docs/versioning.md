# Versioning

EIP versioning protects interoperability between independently released Ensen
components.

- Contract-breaking changes require a new major protocol version.
- Backward-compatible additions may be introduced in a minor version.
- Editorial-only changes may be introduced in a patch version.
- Fixtures and schemas identify the protocol version they target through
  `schemaVersion`, schema filenames, and versioned fixture directories.

Consumers must fail closed when they encounter an unsupported EIP major version.
Unsupported EIP major version artifacts must be rejected or blocked until the
consumer has adopted a protocol snapshot that explicitly includes that major
version. Consumers must not silently accept, downgrade, coerce, or interpret the
artifact as a neighboring supported major version.

The first published protocol baseline is `v0.1.0`.

`v0.4.0` is the X-Gate 3 Track B customer and regulated evidence boundary
snapshot. It keeps the existing v1 schema family and adds protocol guidance plus
public-safe examples for downstream Loop, Flow, and Pharma consumer intake:

- customer and regulated data classification profile;
- `public`, `internal`, `customer-confidential`, and `regulated`
  classification guidance;
- public-safe customer / regulated classification fixtures;
- confidential reference separation between non-public reference metadata and
  public fixture-safe examples;
- approval and draft-only evidence semantics for owner-controlled and regulated
  workflow boundaries.

`v0.4.0` does not introduce a runtime package, shared implementation, server,
SDK, connector implementation, ERPNext integration, workflow runtime, regulated
workflow execution, OpenAPI transport API, or compliance guarantee.

`v0.3.0` is the X-Gate 3 Track A operational evidence profile snapshot. It keeps
the existing v1 schema family and adds protocol guidance plus a public-safe
example for Loop and Flow artifact hygiene work before owner-controlled real
input:

- operational evidence profile for Track A artifact hygiene;
- guidance for data classification, checksums, producer metadata, retention
  hints, confidential references, and public fixture-safe artifacts;
- public-safe operational evidence profile example for synthetic conformance
  use;
- links from AuditEvent, EvidenceBundleRef, Protocol Snapshot Policy, docs
  index, and fixtures guidance.

`v0.3.0` does not introduce a runtime package, shared implementation, server,
SDK, connector implementation, artifact storage, cleanup, recovery, workflow
runtime, OpenAPI transport API, or compliance guarantee.

`v0.2.0` is the Phase 3 transport and capability contract snapshot. It keeps
the existing v1 schema family and adds protocol guidance plus conformance
examples for external executor and connector capability behavior:

- executor transport capability model;
- submit/status/cancel/fetchEvidence lifecycle guidance;
- polling and terminal-state handoff rules;
- transport error mapping and retryability guidance;
- capability variant examples for supported, partial, unsupported, and
  retryability scenarios.

`v0.2.0` does not introduce a runtime package, shared implementation, server,
SDK, connector implementation, workflow runtime, or OpenAPI transport API.

`v0.1.0` contains the v1 schema family and conformance fixture baseline:

- EIP-0000 Common Types
- EIP-0001 RunRequest
- EIP-0002 RunResult
- EIP-0003 AuditEvent
- EIP-0004 EvidenceBundleRef
- EIP-0005 RunStatusSnapshot
- EIP-0006 conformance fixture and public fixture safety tooling
- EIP-0007 Ensen-loop / Ensen-flow integration handoff notes

## Release Snapshot Handoff

Before publishing a protocol release for downstream consumers, run the snapshot
handoff check from `protocol-snapshot-policy.md`:

- record the protocol version and commit or tag selected for the release;
- name the schema families and fixture families included in the snapshot;
- name any intentionally excluded schema families or fixture families;
- confirm the consumer conformance checklist is linked for Loop, Flow, and
  future consumers;
- confirm unsupported EIP major version handling is covered by the consumer
  conformance evidence;
- record sanitized validation command evidence for `npm test`,
  `npm run check:fixtures`, `npm run check:public-fixtures`, and
  `npm run check:spec-boundary`.

The release snapshot remains a set of copied or vendored contract artifacts. It
does not create a runtime dependency on Ensen-protocol.
