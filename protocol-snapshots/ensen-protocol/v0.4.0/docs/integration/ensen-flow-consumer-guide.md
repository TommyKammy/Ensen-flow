# Ensen-flow Consumer Guide

Ensen-flow consumes Ensen protocol artifacts as published contracts. It should
read schemas, examples, compatibility notes, and conformance fixtures from this
repository without sharing runtime dependencies with Ensen-loop.

Ensen-flow must not import Ensen-loop implementation code, loop services,
connector modules, or private test helpers. Ensen-loop must likewise remain an
independent consumer of the same protocol artifacts.

## Fixture Handoff

Use copied or vendored fixture snapshots for flow-side conformance tests:

- copy the required `schemas/` files and matching
  `fixtures/<artifact>/v<version>/` directories into the Ensen-flow test tree;
- preserve the upstream relative path and fixture file name in local metadata;
- record the Ensen-protocol commit used for the snapshot;
- treat `valid/` fixtures as required compatibility examples;
- treat `invalid/` fixtures as fail-closed regression coverage;
- reject or block any unsupported EIP major version at the flow parser,
  authoring, or ingestion boundary, and record sanitized evidence for the active
  protocol snapshot, supported major versions, the rejected version, the flow
  boundary that blocked it (`parser`, `authoring`, or `ingestion`), and the
  command or test that proved the fail-closed behavior;
- keep flow-specific credentials, tenant ids, host names, and operator paths out
  of the vendored snapshot.

Do not import Ensen-loop runtime code to build flow fixtures. If flow-specific
examples are needed, add them in the Ensen-flow repository as local examples and
label them separately from protocol conformance fixtures.

## Support Matrix Example

| Artifact | Protocol source | Flow usage | Handoff expectation |
| --- | --- | --- | --- |
| RunRequest v1 | `schemas/eip.run-request.v1.schema.json` and `fixtures/run-request/v1/` | Validate flow-authored executor requests | Copy schema and fixtures into flow conformance tests |
| RunResult v1 | `schemas/eip.run-result.v1.schema.json` and `fixtures/run-result/v1/` | Validate consumed terminal executor outcomes | Copy schema and fixtures; keep flow-local result examples separate |
| EvidenceBundleRef v1 | `schemas/eip.evidence-bundle-ref.v1.schema.json` and `fixtures/evidence-bundle-ref/v1/` | Validate evidence references surfaced in flow state | Copy schema and fixtures; use placeholders for local evidence roots |
| AuditEvent v1 | `schemas/eip.audit-event.v1.schema.json` and `fixtures/audit-event/v1/` | Validate flow-originated audit events | Copy schema and fixtures; add flow-only audit samples locally if needed |

## Change Intake

When Ensen-flow needs a contract change, open or reference the Ensen-protocol
issue first. Implement flow changes only after the protocol change is accepted,
documented, and backed by schema or fixture updates where applicable.

Unsupported EIP major version handling follows `../protocol-snapshot-policy.md`
and `consumer-conformance-handoff-checklist.md`: Ensen-flow must fail closed
instead of accepting, downgrading, coercing, or interpreting the artifact as a
supported major version.
