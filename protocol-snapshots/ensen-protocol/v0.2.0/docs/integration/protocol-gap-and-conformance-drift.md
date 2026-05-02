# Protocol Gap And Conformance Drift Routing

Use this post-gate drift routing guide when a future smoke regression,
conformance mismatch, or protocol ambiguity needs a GitHub issue after the
X-Gate 2 loop-flow dry-run smoke path has already been reached. This guide
hardens follow-up routing and does not reopen that reached decision.

This is an issue authoring guide, not a runtime contract. Keep reports focused
on EIP contract text, schemas, fixtures, compatibility guidance, consumer
handoff evidence, and validation commands.

## Required Issue Fields

A protocol gap or conformance drift issue should include:

- protocol snapshot version: the Ensen-protocol release tag and immutable commit
  used by the consumer, such as `v0.1.0` / `43fa3e7` for the X-Gate 2 smoke
  snapshot;
- failing consumer repo: `TommyKammy/Ensen-protocol`,
  `TommyKammy/Ensen-loop`, `TommyKammy/Ensen-flow`, or another explicit
  consumer repository;
- gap classification: one of the classifications below;
- observed artifact: the sanitized schema, fixture, command, boundary result,
  or handoff record that drifted;
- expected artifact: the EIP text, schema, fixture, compatibility note, or
  consumer handoff expectation the artifact should match;
- reproduction boundary: the protocol validation command or consumer parser,
  adapter, authoring, ingestion, or dispatch boundary where the mismatch was
  observed;
- sanitized artifact references: repo-relative file paths, public fixture
  names, release tags, commit identifiers, issue links, and placeholder roots;
- unsupported EIP major version behavior: whether the observed artifact hit a
  consumer fail-closed path and which boundary rejected or blocked it;
- proposed routing: Protocol, Loop, Flow, or consumer-local follow-up.

Use repo-relative commands in public issue text:

```sh
npm test
npm run check:public-fixtures
npm run check:spec-boundary
```

Use documented placeholders such as `<protocol-snapshot>`, `<consumer-repo>`,
`<consumer-worktree>`, `<fixture-copy-root>`,
`<consumer-conformance-command>`, `<supervisor-config-path>`, and
`<codex-supervisor-root>` when a local value would expose private state.

## Gap Classification

Choose exactly one primary classification. Add secondary notes only when the
linked evidence proves the broader routing is explicit.

| Classification | Route to | Use when |
| --- | --- | --- |
| protocol gap | Ensen-protocol | EIP text, schema, fixture coverage, compatibility guidance, or snapshot-copy policy is missing. |
| loop gap | Ensen-loop | Loop cannot consume the copied protocol snapshot, emit the expected dry-run protocol artifacts, or reject an unsupported EIP major version at its boundary. |
| flow gap | Ensen-flow | Flow cannot author, ingest, preserve, or classify protocol artifacts from the copied snapshot without redefining the contract. |
| schema/spec ambiguity | Ensen-protocol | The contract can be read in more than one compatible way and consumers would need to guess. |
| fixture drift | Ensen-protocol first, then consumers | A public fixture no longer matches the accepted schema or EIP text, or a consumer copied a stale fixture snapshot. |
| consumer implementation bug | Owning consumer repo | The protocol contract is explicit and the mismatch is caused by consumer-local parsing, validation, dispatch, or presentation code. |

If the report depends on an unsupported EIP major version, keep the behavior
fail closed. The consumer must reject or block the artifact at the first trusted
parser, adapter, authoring, ingestion, or dispatch boundary instead of
downgrading, coercing, or silently accepting it as a supported major version.

## Evidence Hygiene

Issue bodies and public examples must be sanitized. Do not include raw secret
values, token values, customer data, real repository mutation payloads, or
workstation-local path values. Do not paste raw production logs, credentialed
URIs, tenant-specific identifiers, private branch names that imply customer
state, or irreversible mutation evidence.

Acceptable public references include:

- repo-relative schema and fixture paths;
- Ensen-protocol release tags and commit identifiers;
- public GitHub issue or pull request links;
- sanitized command names and pass/fail outcomes;
- placeholders for local roots, evidence storage, repositories, credentials,
  tenants, and supervisor configuration.

When evidence is not sanitized, reject the issue content and ask for a sanitized
artifact reference before routing. Do not infer Protocol, Loop, or Flow
ownership from file names, path shape, or nearby comments alone.

## Routing Links

Use these documents as the routing source of truth:

- [X-Gate 2 smoke fixture README](../../fixtures/README.md)
- [Protocol Snapshot Policy](../protocol-snapshot-policy.md)
- [Consumer Conformance Handoff Checklist](consumer-conformance-handoff-checklist.md)
- [Ensen-loop Consumer Guide](ensen-loop-consumer-guide.md)
- [Ensen-flow Consumer Guide](ensen-flow-consumer-guide.md)

If a report shows a concrete protocol gap, open the Ensen-protocol issue first.
After the protocol expectation is explicit, open Loop or Flow follow-ups that
name the protocol issue, protocol snapshot version, and consumer boundary to
change. If the protocol is already explicit, route directly to the owning
consumer repository as a consumer implementation bug.
