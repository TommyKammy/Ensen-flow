# Conformance Fixtures

The `fixtures/` tree is the public conformance suite for Ensen protocol
consumers. Each EIP schema owns a versioned fixture directory with `valid/` and
`invalid/` cases:

- `valid/` fixtures must validate against the matching schema and pass public
  fixture safety checks.
- `invalid/` fixtures must fail for the documented schema or fixture-safety
  reason.

Run the conformance checks from the repository root:

```sh
npm install
npm test -- test/fixtures.test.ts
npm run check:fixtures
npm run check:public-fixtures
npm run check:schema-ids
npm test
```

The tooling is validation tooling only. It is not a runtime library for
Ensen-loop, Ensen-flow, or connectors.

## Fixture Safety

Public fixture snapshots must not include raw credentials, credential-bearing
URIs, customer-specific values, tenant-specific values, or workstation-local
absolute paths. Use placeholders such as `<tenant-id>`, `<credential-ref>`, and
`<evidence-root>` when a fixture needs to describe a sensitive or local boundary.

Negative examples may live under `invalid/` to prove the safety checks fail
closed. Do not vendor those negative examples as runtime seed data.

## Vendoring Guidance

Ensen-loop and Ensen-flow should vendor fixture snapshots as immutable protocol
test inputs. Consumers should copy the needed `schemas/` files and the matching
`fixtures/<artifact>/v<version>/` directories into their own conformance test
tree, then run the copied valid and invalid cases against their local parser or
adapter boundary.

When vendoring fixtures:

- keep the upstream relative path and file name with the copied fixture;
- record the source repository commit in the consumer repository;
- treat `valid/` fixtures as required compatibility examples;
- treat `invalid/` fixtures as fail-closed regression tests;
- keep local runtime credentials, tenant ids, host names, and operator paths out
  of the vendored snapshot.

If a consumer needs implementation-specific examples, place them in the relevant
runtime repository and label them as local examples rather than protocol
conformance fixtures.
