# Local File Connector Skeleton

The local file connector is a Phase 1 skeleton for bounded fixture file actions.
It lets a workflow step read or write a small local fixture through an explicit
root alias without turning Ensen-flow into unrestricted filesystem automation.

## Safe Root Boundary

Callers must construct the connector with one or more allowed roots:

```ts
createLocalFileConnector({
  allowedRoots: [{ alias: "fixture-root", path: "<absolute-temp-fixture-root>" }]
});
```

The root alias is the durable reference. Submit results, run state evidence, and
audit-oriented surfaces use the alias plus a relative path such as
`inputs/payload.txt`; they must not publish workstation-local absolute paths.

Requests fail closed when the root alias is missing, the requested path is
absolute, the path traverses outside the allowed root, the action is not `read`
or `write`, or write content is not an explicit string. Existing symbolic links
in the allowed root or requested path are rejected before the connector reads or
writes fixture content.

## Actions

`read` loads a UTF-8 fixture file and returns the content inline with sanitized
evidence. Missing read targets return a retryable connector failure so the local
runner can record explicit retry behavior through the step retry policy.

`write` creates parent directories under the allowed root and writes UTF-8
fixture content. Repeating a successful submission with the same idempotency key
and the same request fingerprint replays the stored receipt instead of writing a
second time. Reusing the idempotency key with a changed action, path, root, or
content fails closed.

By default, `createLocalFileConnector` creates an in-memory idempotency store
scoped to that connector instance. Callers that recreate connectors during a
retry must pass a shared or durable `idempotencyStore` so successful receipts
survive connector recreation:

```ts
const idempotencyStore = createInMemoryLocalFileIdempotencyStore();

createLocalFileConnector({
  allowedRoots: [{ alias: "fixture-root", path: "<absolute-temp-fixture-root>" }],
  idempotencyStore
});
```

The bundled in-memory store serializes same-process submissions for one key and
rejects changed replays. Cross-process workers need a caller-owned durable store
with equivalent compare-and-set behavior, such as one backed by run state or a
database record. The connector does not silently infer durability from the
fixture root.

## Cleanup

Tests and callers own the temporary fixture root lifecycle. Use a per-run
temporary root and remove it after verification. The connector does not clean a
root, scan a home directory, mutate repository files outside an explicit test
root, or manage production artifact storage.

## Non-Goals

This connector does not provide unrestricted filesystem access, binary blob
processing, customer data handling, lane-state file access, repository
automation, production artifact storage, ERPNext behavior, Ensen-loop executor
integration, Pharma/GxP workflow packs, e-signatures, or compliance claims.

Use focused local verification:

```sh
npm test -- test/file-connector.test.ts
```
