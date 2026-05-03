# Ensen-protocol v0.3.0 Operational Evidence Profile Snapshot

This directory is a copied snapshot of public Ensen Interop Protocol
operational evidence profile artifacts from `TommyKammy/Ensen-protocol`
release tag `v0.3.0`, release URL
`https://github.com/TommyKammy/Ensen-protocol/releases/tag/v0.3.0`, protocol
version `0.3.0`.

It is intentionally repo-owned by Ensen-flow. Ensen-flow must not require an
Ensen-protocol checkout, package, service, fixture path, or runtime dependency
to build, test, or operate.

## Contents

- `docs/integration/operational-evidence-profile.md`: Protocol guidance for
  X-Gate 3 Track A artifact hygiene before owner-controlled real input.
- `fixtures/operational-evidence-profile/v1/valid/public-fixture-safe-profile.json`:
  public fixture-safe synthetic example for local Track A hygiene tests.
- `manifest.json`: source release tag, release URL, copied artifact list,
  validation evidence, update policy, and intentional exclusions.

The v0.3.0 snapshot does not replace the v0.2.0 copied schema and connector
contract snapshot. Flow keeps v0.2.0 as the active EIP schema boundary while
using this v0.3.0 directory as a local, auditable reference for operational
evidence profile work.

## Validation Evidence

The v0.3.0 source release recorded these protocol validation commands:

```sh
npm test
npm run check:fixtures
npm run check:public-fixtures
npm run check:schema-ids
npm run check:spec-boundary
```

Flow records these commands as source-release evidence for this copied
snapshot. This issue does not require rerunning sibling-repo protocol commands
from the Flow worktree.

## Update Policy

Treat this directory as read-only protocol fixture data. Runtime code should
access it only through explicit test or protocol helper boundaries.

To update the operational evidence profile snapshot, replace this versioned
directory from a tagged Ensen-protocol release and update `manifest.json` in
the same change. Do not point tests or runtime code at a sibling checkout as a
mutable shared dependency.

Copied protocol artifacts should normally remain unchanged from the tagged
release. If Flow must correct consumer-facing snapshot provenance without
redefining schema, runtime, or behavior contracts, record the correction in
`manifest.json` through a local correction entry and set the copied artifact
policy accordingly.
