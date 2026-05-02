# Schemas

This directory is reserved for machine-readable EIP contract schemas.

Schemas added here should be versioned, documented, and covered by fixtures or
tests that demonstrate their intended interoperability behavior.

- `eip.common.v1.schema.json` defines reusable v1 common types and a fixture
  envelope used by common-type conformance tests.
- `eip.run-request.v1.schema.json` defines the transport-neutral RunRequest v1
  contract for executor requests.
- `eip.run-result.v1.schema.json` defines the transport-neutral RunResult v1
  contract for terminal executor results.
- `eip.audit-event.v1.schema.json` defines the transport-neutral AuditEvent v1
  contract for append-only audit and evidence streams.
- `eip.evidence-bundle-ref.v1.schema.json` defines the transport-neutral
  EvidenceBundleRef v1 contract for evidence material references.
- `eip.run-status.v1.schema.json` defines the transport-neutral
  RunStatusSnapshot v1 contract for async executor status polling.
