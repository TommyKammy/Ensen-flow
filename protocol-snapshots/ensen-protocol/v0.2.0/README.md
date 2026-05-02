# Ensen-protocol v0.2.0 Snapshot

This directory is a copied snapshot of public Ensen Interop Protocol artifacts
from `TommyKammy/Ensen-protocol` release tag `v0.2.0`, protocol version
`0.2.0`. The tag object SHA and target commit are recorded in `manifest.json`.

It is intentionally repo-owned by Ensen-flow. Ensen-flow must not require an
Ensen-protocol checkout, package, service, fixture path, or runtime dependency
to build, test, or operate.

## Contents

- `schemas/eip.run-request.v1.schema.json`
- `schemas/eip.run-status.v1.schema.json`
- `schemas/eip.run-result.v1.schema.json`
- `schemas/eip.evidence-bundle-ref.v1.schema.json`
- `schemas/eip.audit-event.v1.schema.json`
- `schemas/eip.common.v1.schema.json`, copied as schema support for `$ref`
  resolution
- valid and invalid public conformance fixtures for RunRequest,
  RunStatusSnapshot, RunResult, EvidenceBundleRef, AuditEvent, common schema
  envelopes, and Phase 3 capability variants
- selected public contract docs used by Flow for connector boundary alignment,
  including `docs/integration/executor-transport-capabilities.md`

## Validation Evidence

The v0.2.0 source release recorded these protocol validation commands:

```sh
npm test
npm run check:fixtures
npm run check:public-fixtures
npm run check:schema-ids
npm run check:spec-boundary
```

Flow records these commands as source-release evidence for this copied snapshot.
This issue does not require rerunning sibling-repo protocol commands from the
Flow worktree.

## Update Policy

Treat this directory as read-only protocol fixture data. Runtime code should
access it only through explicit test or protocol helper boundaries.

To update the snapshot, replace this versioned directory from a tagged
Ensen-protocol release and update `manifest.json` in the same change. Do not
point tests or runtime code at a sibling checkout as a mutable shared
dependency.

Copied protocol artifacts should normally remain unchanged from the tagged
release. If Flow must correct consumer-facing snapshot provenance without
redefining schema, runtime, or behavior contracts, record the correction in
`manifest.json` through `policy.localCorrections` and set
`policy.copiedArtifactsUnmodified` accordingly.
