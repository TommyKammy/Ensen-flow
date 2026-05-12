# Cross-Repo Change Policy

Protocol changes start in Ensen-protocol. Runtime repositories consume the
accepted contract after the protocol issue defines the schema, fixture, and
compatibility impact.

## Protocol-First Flow

1. Open the protocol issue first in Ensen-protocol.
2. Define the affected EIP text, schema, fixture, compatibility, and security
   expectations in the protocol issue or linked pull request.
3. Land protocol artifacts before depending on them from Ensen-loop or
   Ensen-flow.
4. Open follow-up Ensen-loop or Ensen-flow issues that reference the protocol
   issue and the protocol commit or release.
5. Vendor or copy the accepted fixture snapshots into each runtime repository's
   conformance tests.
6. Keep runtime-local implementation examples in the runtime repository, not in
   Ensen-protocol.

The protocol issue first rule prevents runtime behavior from becoming the
undocumented source of truth.

## Dependency Boundary

Ensen-loop and Ensen-flow must not import each other's implementation code,
private helpers, service modules, connector code, or runtime tests. They may both
consume the same protocol docs, schemas, and public fixture snapshots.

This repository must not add runtime implementation directories such as
`src/runtime`, `src/workflow`, `src/loop`, or `src/connectors`.

## Fixture Snapshot Policy

Runtime repositories should vendor or copy fixture snapshots rather than import
runtime code from another repository. A runtime-side vendoring record should
include:

- the source Ensen-protocol commit or release;
- the copied schema and fixture relative paths;
- the local conformance test that consumes the snapshot;
- any unsupported optional fields and the planned follow-up issue.

Invalid fixtures remain useful. Copy them as fail-closed regression tests when
the runtime parser or adapter boundary should reject the same input.

## Support Matrix Example

| Artifact | Protocol owner | Ensen-loop issue | Ensen-flow issue | Fixture handoff |
| --- | --- | --- | --- | --- |
| RunRequest v1 field addition | Ensen-protocol issue first | Open after protocol acceptance if loop dispatch changes | Open after protocol acceptance if flow request authoring changes | Copy updated `fixtures/run-request/v1/` snapshot |
| RunResult v1 terminal status change | Ensen-protocol issue first | Open if loop result publication changes | Open if flow result consumption changes | Copy updated `fixtures/run-result/v1/` snapshot |
| EvidenceBundleRef v1 URI rule | Ensen-protocol issue first | Open if loop evidence references change | Open if flow evidence display or export changes | Copy updated `fixtures/evidence-bundle-ref/v1/` snapshot |

## Release Notes

Protocol pull requests that affect runtime consumers should include:

- the protocol issue link;
- the affected EIP artifacts;
- the fixture snapshot paths to copy;
- expected Ensen-loop and Ensen-flow follow-up issue links, or a note that no
  runtime follow-up is required.
