# Ensen-loop Consumer Guide

Ensen-loop consumes Ensen protocol artifacts as published contracts. It should
read schemas, examples, compatibility notes, and conformance fixtures from this
repository without sharing runtime dependencies with Ensen-flow.

Ensen-loop must not import Ensen-flow implementation code, adapters, workflow
modules, or private test helpers. Ensen-flow must likewise remain an independent
consumer of the same protocol artifacts.

## Fixture Handoff

Use copied or vendored fixture snapshots for loop-side conformance tests:

- copy the required `schemas/` files and matching
  `fixtures/<artifact>/v<version>/` directories into the Ensen-loop test tree;
- preserve the upstream relative path and fixture file name in local metadata;
- record the Ensen-protocol commit used for the snapshot;
- treat `valid/` fixtures as required compatibility examples;
- treat `invalid/` fixtures as fail-closed regression coverage;
- reject or block any unsupported EIP major version at the loop parser or
  executor-dispatch boundary, and record sanitized evidence for the active
  protocol snapshot, supported major versions, the rejected version, the loop
  boundary that blocked it (`parser` or `executor-dispatch`), and the command or
  test that proved the fail-closed behavior;
- keep loop-specific credentials, tenant ids, host names, and operator paths out
  of the vendored snapshot.

Do not import Ensen-flow runtime code to build loop fixtures. If loop-specific
examples are needed, add them in the Ensen-loop repository as local examples and
label them separately from protocol conformance fixtures.

## Support Matrix Example

| Artifact | Protocol source | Loop usage | Handoff expectation |
| --- | --- | --- | --- |
| RunRequest v1 | `schemas/eip.run-request.v1.schema.json` and `fixtures/run-request/v1/` | Validate accepted run inputs before executor dispatch | Copy schema and fixtures into loop conformance tests |
| RunResult v1 | `schemas/eip.run-result.v1.schema.json` and `fixtures/run-result/v1/` | Validate terminal executor outcomes | Copy schema and fixtures; keep loop-local result examples separate |
| RunStatusSnapshot v1 | `schemas/eip.run-status.v1.schema.json` and `fixtures/run-status/v1/` | Validate async status polling output | Copy schema and fixtures; document unsupported optional fields |
| AuditEvent v1 | `schemas/eip.audit-event.v1.schema.json` and `fixtures/audit-event/v1/` | Validate emitted loop audit events | Copy schema and fixtures; add loop-only audit samples locally if needed |

## Change Intake

When Ensen-loop needs a contract change, open or reference the Ensen-protocol
issue first. Implement loop changes only after the protocol change is accepted,
documented, and backed by schema or fixture updates where applicable.

Unsupported EIP major version handling follows `../protocol-snapshot-policy.md`
and `consumer-conformance-handoff-checklist.md`: Ensen-loop must fail closed
instead of accepting, downgrading, coercing, or interpreting the artifact as a
supported major version.
