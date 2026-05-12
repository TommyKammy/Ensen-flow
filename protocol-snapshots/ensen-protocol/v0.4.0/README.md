# Ensen-protocol v0.4.0 Track B Evidence Boundary Snapshot

This directory is a copied snapshot of public Ensen Interop Protocol artifacts
from `TommyKammy/Ensen-protocol` release tag `v0.4.0`, release URL
`https://github.com/TommyKammy/Ensen-protocol/releases/tag/v0.4.0`, protocol
version `0.4.0`, target commit
`f6c3c5bee2574c8660f6954fe58a9e7625daad12`.

It is intentionally repo-owned by Ensen-flow. Ensen-flow must not require an
Ensen-protocol checkout, package, service, fixture path, or runtime dependency
to build, test, or operate.

## Contents

- `docs/data-classification.md`: Protocol classification vocabulary including
  `public`, `internal`, `customer-confidential`, and `regulated`.
- `docs/integration/customer-regulated-data-classification-profile.md`: Track B
  customer / regulated evidence classification profile.
- `docs/integration/approval-and-draft-evidence-semantics.md`: Track B approval
  and draft-only evidence semantics.
- `fixtures/customer-regulated-data-classification/v1/valid/public-safe-profile.json`:
  public-safe synthetic Track B classification example.
- `fixtures/approval-evidence-semantics/v1/valid/public-safe-draft-action.json`:
  public-safe synthetic approval and draft-only evidence example.
- `manifest.json`: source release evidence, copied artifact list, validation
  evidence, update policy, and intentional exclusions.

The checked-in examples are public-safe contract fixtures. They do not contain
customer data, regulated data, raw secrets, credentials, private repository
details, workstation-local absolute paths, live ERPNext write-back targets,
electronic signature records, batch release records, final disposition records,
or real external mutation evidence.

## Boundary

This snapshot is protocol intake only. It does not add ERPNext live connector
behavior, production regulated workflow execution, customer-data fixtures,
credential handling, retention storage, electronic signatures, a validated
system, or compliance evidence claims.

Flow may use the Track B vocabulary to classify and route local audit/evidence
metadata, but customer-specific and regulated-looking references must remain
outside public-safe exports unless a later issue adds an explicit controlled
runtime boundary.

The v0.2.0 snapshot remains Flow's existing executor connector conformance
boundary. This v0.4.0 snapshot is adopted as a local, auditable reference for
Track B classification and approval evidence semantics.

## Validation Evidence

The v0.4.0 source release recorded these protocol validation commands:

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

To update this Track B snapshot, replace this versioned directory from a tagged
Ensen-protocol release and update `manifest.json` in the same change. Do not
point tests or runtime code at a sibling checkout as a mutable shared
dependency.
