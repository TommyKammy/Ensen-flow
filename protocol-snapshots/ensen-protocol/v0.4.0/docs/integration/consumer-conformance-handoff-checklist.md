# Consumer Conformance Handoff Checklist

Use this checklist when Ensen-loop, Ensen-flow, or a domain-specific consumer
vendors or copies an Ensen-protocol release snapshot into its own conformance
tests. The goal is to prove which protocol contract the consumer uses without
turning Ensen-protocol into a shared runtime package.

Use `../protocol-snapshot-policy.md` to decide what belongs in the snapshot
record, when to copy or vendor artifacts, and when to open a protocol follow-up
issue before downstream implementation work.

Ensen-protocol is a contract repository and not a runtime dependency. Consumer
repositories may copy protocol documents, schemas, and fixtures into their own
test trees, but they must not import runtime code, SDKs, adapters, workflow
modules, connector modules, or private helpers from this repository.

## Snapshot Record

Record the snapshot in the consumer repository near the conformance tests:

- protocol snapshot version: the Ensen-protocol release tag, commit, or other
  immutable snapshot identifier copied by the consumer;
- source repository: `TommyKammy/Ensen-protocol`;
- copied schema paths: the repo-relative `schemas/` files copied into the
  consumer test tree;
- copied fixture paths: the repo-relative `fixtures/<artifact>/v<version>/`
  directories copied into the consumer test tree;
- consumer conformance command evidence: sanitized command names, exit status,
  and relevant log excerpts from the consumer repository;
- local conformance test owner: the consumer-side test file or task that reads
  the copied snapshot;
- unsupported-major-version rejection: sanitized evidence naming the unsupported
  EIP major version, the consumer boundary that rejected the artifact, and the
  local check or test command that proved the fail-closed behavior;
- exceptions: unsupported optional fields or deferred compatibility work, each
  linked to an explicit consumer follow-up issue.

Use placeholders such as `<protocol-snapshot>`, `<consumer-repo>`,
`<consumer-conformance-command>`, `<schema-copy-root>`, and
`<fixture-copy-root>` when a concrete local value would expose workstation-local
paths, customer data, repository mutations, or secrets.

## Required Artifact Checks

The consumer handoff should name every public artifact family it copies or
intentionally excludes:

| Artifact | Protocol schema | Fixture family | Consumer check |
| --- | --- | --- | --- |
| RunRequest | `schemas/eip.run-request.v1.schema.json` | `fixtures/run-request/v1/` | Validate accepted run input and reject invalid request fixtures at the consumer boundary. |
| RunStatusSnapshot | `schemas/eip.run-status.v1.schema.json` | `fixtures/run-status/v1/` | Validate async status snapshots and document unsupported optional fields. |
| RunResult | `schemas/eip.run-result.v1.schema.json` | `fixtures/run-result/v1/` | Validate terminal run outcomes and keep consumer-local result examples separate. |
| AuditEvent | `schemas/eip.audit-event.v1.schema.json` | `fixtures/audit-event/v1/` | Validate emitted or consumed audit events without adding customer-specific audit samples to protocol fixtures. |
| EvidenceBundleRef | `schemas/eip.evidence-bundle-ref.v1.schema.json` | `fixtures/evidence-bundle-ref/v1/` | Validate evidence references with placeholder roots or sanitized URIs only. |

If a consumer does not use one of these artifacts, record the explicit reason in
the consumer snapshot record. Do not infer conformance from a neighboring
artifact, runtime naming convention, or copied file shape alone.

If a copied artifact declares an unsupported EIP major version, the consumer
must fail closed at the parser, adapter, or ingestion boundary before runtime
work is dispatched. The consumer must reject or block the artifact and record
which protocol snapshot was active, which major versions were supported, the
unsupported EIP major version that was rejected, and the consumer boundary that
rejected the artifact. Do not downgrade, coerce, or silently accept the artifact
as a supported major version.

## Evidence Hygiene

Consumer conformance evidence should be sanitized before it is copied into an
issue, pull request, release note, or handoff record:

- include repo-relative commands such as `npm test`, task names, or documented
  environment variable names;
- include the protocol snapshot version and copied schema paths and copied
  fixture paths;
- include unsupported EIP major version rejection evidence when that fail-closed
  path is exercised;
- exclude raw secrets, credential-bearing URIs, customer data, tenant-specific
  identifiers, real repository mutation payloads, and workstation-local paths;
- replace local roots with placeholders such as `<codex-supervisor-root>`,
  `<supervisor-config-path>`, `<consumer-worktree>`, or `<fixture-copy-root>`;
- keep valid and invalid fixture results separate so fail-closed coverage is
  visible.

The evidence proves that the consumer checked its local parser or adapter
boundary against the copied protocol snapshot. It does not create a runtime
dependency on Ensen-protocol.

## Protocol-First Routing

File protocol ambiguity in Ensen-protocol first. Clarify the intended contract
in EIP text, schemas, fixtures, compatibility notes, or this checklist before
opening Ensen-loop or Ensen-flow implementation fixes.

After the protocol expectation is explicit, open downstream Loop or Flow
follow-up issues that reference the Ensen-protocol issue and the protocol
snapshot version. Downstream issues should describe the consumer-specific
implementation or test change, not redefine the protocol expectation.
