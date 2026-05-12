# Fixtures

This directory is reserved for EIP contract fixtures.

Fixtures should be minimal examples that prove protocol behavior. Use
placeholders for credentials, tenants, hosts, and operator-specific values.

- `common/v1/valid/` contains valid EIP-0000 common type fixtures.
- `common/v1/invalid/` contains negative fixtures that must fail validation.
- `run-request/v1/valid/` contains valid EIP-0001 RunRequest fixtures.
- `run-request/v1/invalid/` contains negative RunRequest fixtures and fixture
  safety examples.
- `run-result/v1/valid/` contains valid EIP-0002 RunResult fixtures.
- `run-result/v1/invalid/` contains negative RunResult fixtures.
- `audit-event/v1/valid/` contains valid EIP-0003 AuditEvent fixtures.
- `audit-event/v1/invalid/` contains negative AuditEvent fixtures.
- `evidence-bundle-ref/v1/valid/` contains valid EIP-0004 EvidenceBundleRef
  fixtures.
- `evidence-bundle-ref/v1/invalid/` contains negative EvidenceBundleRef
  fixtures.
- `run-status/v1/valid/` contains valid EIP-0005 RunStatusSnapshot fixtures.
- `run-status/v1/invalid/` contains negative RunStatusSnapshot fixtures.
- `capability-variants/v1/valid/` contains public-safe Phase 3 conformance
  examples for executor transport capability variants. These examples are
  fixture-like guidance, not a new EIP schema family.
- `operational-evidence-profile/v1/valid/` contains public-safe Track A
  artifact hygiene examples for
  `docs/integration/operational-evidence-profile.md`. These examples are
  fixture-like guidance, not a new EIP schema family.
- `customer-regulated-data-classification/v1/valid/` contains public-safe
  Track B classification profile examples for
  `docs/integration/customer-regulated-data-classification-profile.md`. These
  examples are fixture-like guidance, not a new EIP schema family.
- `approval-evidence-semantics/v1/valid/` contains public-safe Track B approval
  and draft-only evidence semantics examples for
  `docs/integration/approval-and-draft-evidence-semantics.md`. These examples
  are fixture-like guidance, not a new EIP schema family.

## X-Gate 2 Loop-Flow Dry-Run Smoke

X-Gate 2 uses this public fixture suite to align the narrow loop-flow dry-run
smoke path across Ensen-flow and Ensen-loop:

```text
RunRequest -> RunStatusSnapshot -> RunResult -> EvidenceBundleRef
```

The expected consumer snapshot is the `v0.1.0` release snapshot: tag `v0.1.0`
at commit `43fa3e7`. Flow and Loop must vendor or copy that immutable release
snapshot of the protocol artifacts into their own consumer test trees.
Ensen-protocol provides no runtime package, server, SDK, connector, or shared
implementation for this smoke path.

Use these EIP artifacts for the smoke contract:

| Smoke artifact | Contract source | Fixture source |
| --- | --- | --- |
| RunRequest v1 | `schemas/eip.run-request.v1.schema.json` | `fixtures/run-request/v1/` |
| RunStatusSnapshot v1 | `schemas/eip.run-status.v1.schema.json` | `fixtures/run-status/v1/` |
| RunResult v1 | `schemas/eip.run-result.v1.schema.json` | `fixtures/run-result/v1/` |
| EvidenceBundleRef v1 | `schemas/eip.evidence-bundle-ref.v1.schema.json` | `fixtures/evidence-bundle-ref/v1/` |

Public smoke examples must stay synthetic and publishable. They must not include
raw secret values, token values, customer data, real repository mutation
payloads, or workstation-local path values. Use placeholders such as
`<tenant-id>`, `<credential-ref>`, `<repository-ref>`, `<evidence-root>`, and
`<supervisor-config-path>` when the smoke example needs to name a boundary
without exposing local or private state.

Route X-Gate 2 failures by ownership:

- protocol gap: the EIP schema, fixture path, fixture safety rule, compatibility
  guidance, or snapshot-copy policy is ambiguous or missing in Ensen-protocol.
- loop gap: Ensen-loop cannot consume the copied snapshot, emit the expected
  dry-run `RunStatusSnapshot` or `RunResult`, or reference an
  `EvidenceBundleRef` without redefining the protocol contract.
- flow gap: Ensen-flow cannot build the CLI-backed smoke request, preserve the
  copied protocol snapshot, or classify the dry-run result without redefining
  the protocol contract.

Downstream X-Gate 2 issues should point back to these fixture expectations:

- [Ensen-flow X-Gate 2 CLI-backed smoke issue](https://github.com/TommyKammy/Ensen-flow/issues/37)
- [Ensen-loop X-Gate 2 dry-run output issue](https://github.com/TommyKammy/Ensen-loop/issues/35)

## Phase 3 Capability Variant Examples

Phase 3 adds public-safe conformance examples for the executor capability model,
lifecycle rules, polling behavior, evidence retrieval, and transport
retryability guidance. They are intentionally transport-neutral JSON examples:
they do not imply that Ensen-protocol provides a runtime server, SDK,
connector, OpenAPI endpoint, queue, or provider implementation.

Use these examples as copied or vendored conformance inputs:

| Example | Covered behavior |
| --- | --- |
| `fixtures/capability-variants/v1/valid/fully-supported-transport.json` | supported capability variant example for submit, status, cancel, fetchEvidence, polling, evidence references, and idempotency |
| `fixtures/capability-variants/v1/valid/submit-only-no-polling.json` | partial capability variant example for submit-only or no-polling transports |
| `fixtures/capability-variants/v1/valid/unsupported-cancel.json` | unsupported capability variant example for cancel requests that must not be inferred as successful |
| `fixtures/capability-variants/v1/valid/evidence-unavailable.json` | evidence unavailable example for absent, inaccessible, expired, or unsupported evidence retrieval |
| `fixtures/capability-variants/v1/valid/retryability-examples.json` | retryable transport failure example and non-retryable transport failure example |

Loop and Flow consumers should use the examples as conformance check rows:

- compare each consumer capability matrix or provider boundary against
  `capabilitySummary`;
- verify unsupported and out-of-subset operations stay blocked, rejected,
  unknown, or routed instead of being coerced into success;
- verify retryable transport failures preserve the same authoritative scope and
  idempotency binding;
- verify non-retryable validation, unsupported capability, or unavailable
  evidence cases do not produce fabricated RunStatusSnapshot or RunResult
  success;
- keep local commands and evidence references repo-relative or placeholder-based
  when copying the examples into consumer repositories.

## Track B Customer / Regulated Classification Example

Track B adds public-safe classification profile examples for customer /
regulated evidence planning. The examples do not contain customer data,
regulated data, raw secrets, credentials, private repository details, or
workstation-local absolute paths.

Use this example as copied or vendored conformance input:

| Example | Covered behavior |
| --- | --- |
| `fixtures/customer-regulated-data-classification/v1/valid/public-safe-profile.json` | public-safe Track B classification vocabulary, classification-required surfaces, fail-closed handling, and non-claims |

Loop, Flow, and Pharma consumers should use the example to verify that customer
/ regulated references require explicit classification and that missing or
unknown classification stays blocked or routed instead of inferred.

The example also includes a sanitized confidential reference shape. It shows a
stable synthetic id, placeholder locator, checksum, producer metadata, and
`public` fixture classification without storing the controlled material. Runtime
repositories can cite that shape from artifact hygiene and public export checks,
but real customer / regulated evidence references must remain in the controlled
consumer boundary.

## Track B Approval and Draft-Only Evidence Example

Track B adds public-safe approval and draft-only evidence examples for shared
approval vocabulary and draft-only workflow evidence. The examples do not
contain customer data, regulated data, raw secrets, credentials, private
repository details, workstation-local absolute paths, live write-back records,
electronic signature records, batch release records, or final disposition
records.

Use this example as copied or vendored conformance input:

| Example | Covered behavior |
| --- | --- |
| `fixtures/approval-evidence-semantics/v1/valid/public-safe-draft-action.json` | approval-required, approved, rejected, revoked, and superseded vocabulary; draft-only action artifact handling; AuditEvent and EvidenceBundleRef usage; and non-claims |

Loop, Flow, and Pharma consumers should use the example to verify that a
draft-only action artifact remains not-applied until the authoritative workflow
boundary records approval, and that rejected, revoked, or superseded evidence
stays represented as append-only evidence instead of inferred success.
