# Protocol Snapshot Policy

A protocol snapshot is the release or tagged contract artifacts from
Ensen-protocol that a consumer copies or vendors for local conformance tests. It
is not a runtime dependency, SDK, transport API, shared implementation package,
workflow module, connector module, or source of private helpers.

Ensen-loop, Ensen-flow, domain-specific Flow variants, and future consumers
should treat a snapshot as immutable protocol evidence: Markdown contract text,
JSON Schemas, public fixtures, compatibility guidance, and the validation
commands that proved the snapshot was publishable.

Consumers must fail closed when an artifact declares an unsupported EIP major
version. A copied or vendored snapshot authorizes only the major versions named
by that snapshot; unsupported EIP major version artifacts must be rejected or
blocked rather than silently accepted, downgraded, coerced, or interpreted as a
nearby supported major version.

## Snapshot Metadata

Each consumer snapshot record should include:

- protocol version: the Ensen-protocol release version the consumer adopted;
- commit or tag: the immutable Git commit, release tag, or signed release
  pointer used for the copied artifacts;
- schema families: the repo-relative `schemas/` files copied or intentionally
  excluded;
- fixture families: the repo-relative `fixtures/<artifact>/v<version>/`
  directories copied or intentionally excluded;
- contract documents: the EIP Markdown files or compatibility notes the
  consumer used to interpret the schema and fixture families;
- validation commands: sanitized command names and pass/fail results for the
  protocol snapshot and the consumer-side conformance run;
- operational evidence profile: the
  `docs/integration/operational-evidence-profile.md` guidance used when the
  copied snapshot includes Track A artifact hygiene examples;
- customer / regulated classification profile: the
  `docs/integration/customer-regulated-data-classification-profile.md` guidance
  used when the copied snapshot includes Track B customer / regulated
  classification evidence, confidential reference examples, or public export
  checks that prove controlled material stays outside public fixtures;
- consumer owner: the local consumer test, task, or adapter boundary that reads
  the copied snapshot;
- unsupported EIP major version evidence: sanitized evidence naming the
  unsupported EIP major version, the consumer boundary that rejected or blocked
  it, and the local check or test command that proved the fail-closed behavior;
- exceptions: unsupported optional fields, deferred compatibility work, or
  intentional exclusions, each linked to an explicit follow-up issue.

Use placeholders such as `<protocol-snapshot>`, `<consumer-repo>`,
`<schema-copy-root>`, `<fixture-copy-root>`, and
`<consumer-conformance-command>` when a real local value would expose a secret,
customer value, workstation-local path, or repository mutation payload.

## Copy Or Vendor

Consumers should copy or vendor protocol artifacts when the existing protocol
contract is clear and the consumer only needs local test inputs or local parser
coverage. Keep copied artifacts under consumer-owned test or conformance paths,
preserve the upstream relative paths where practical, and record the protocol
version plus commit or tag next to the copied files.

Copying or vendoring is appropriate for:

- schema families that already describe the consumer boundary;
- fixture families that already cover valid and invalid behavior;
- compatibility notes that explain existing optional or deprecated fields;
- release snapshots used to prove Loop and Flow consume the same contract
  without sharing runtime code.

Consumers must keep runtime credentials, tenant identifiers, customer examples,
host-specific roots, and workstation-local paths out of copied protocol
artifacts. Local examples may exist in the consumer repository, but they should
be labeled as consumer-local examples, not protocol conformance fixtures.

## Open A Protocol Follow-Up

Open a protocol follow-up issue before downstream implementation work when the
consumer cannot prove the boundary from the copied snapshot. The follow-up
should stay in Ensen-protocol until the contract is explicit.

Open the protocol issue when:

- schema text, fixture behavior, compatibility guidance, or handoff guidance is
  ambiguous;
- Loop and Flow would need to interpret the same artifact differently;
- the consumer needs a new schema family, fixture family, or validation rule;
- a fixture would require secrets, customer data, real repository mutation, or a
  workstation-local path to explain the behavior;
- a downstream workaround would redefine the protocol expectation instead of
  testing a consumer-owned adapter.

After the protocol issue lands, open downstream Ensen-loop or Ensen-flow issues
that reference the protocol issue, protocol version, and commit or tag. Those
issues should implement or test the consumer boundary; they should not redefine
the protocol contract.

## Release Handoff

Before a protocol release is handed to consumers, the release owner should
record the snapshot handoff evidence:

- protocol version and commit or tag selected for the release;
- schema families and fixture families included in the snapshot;
- any intentionally excluded schema families or fixture families;
- compatibility notes that affect Loop, Flow, or future consumers;
- unsupported EIP major version fail-closed evidence linked to the consumer
  conformance checklist;
- validation commands run from the repository root:

```sh
npm test
npm run check:fixtures
npm run check:public-fixtures
npm run check:spec-boundary
```

The handoff should link to the
`integration/consumer-conformance-handoff-checklist.md` checklist so each
consumer records its copied snapshot and local conformance evidence.
