# X-Gate 3 Flow Caller Boundary Runbook

This runbook documents the Flow-owned Phase 3 / X-Gate 3 caller boundary for
local development smoke evidence. It is not production automation, not
compliance evidence, and not evidence of regulated workflow readiness.

The boundary is intentionally process-shaped: Ensen-flow prepares
protocol-shaped input, invokes a local Ensen-loop smoke command as a child
process, reads one aggregate from process stdout, and routes findings to the
owning repository. Ensen-flow must not import Ensen-loop implementation code,
Ensen-loop internal packages, ERPNext adapters, Pharma/GxP packs, or runtime
code from other Ensen repositories.

## Scope

The X-Gate 3 caller boundary proves that Flow can describe how it will call the
Loop Phase 3 local fake lane without changing Flow runtime behavior yet. The
smoke is a local development boundary, not a shared implementation contract and
not a production executor integration.

Out of scope:

- no runtime connector implementation;
- no shared Ensen-loop implementation imports;
- no protocol schema changes;
- no real provider invocation;
- no real repository mutation;
- no real pull request, review, or issue mutation;
- no ERPNext behavior;
- no Pharma/GxP workflow pack or compliance claim;
- no customer data, production credentials, or durable production evidence.

## Command Boundary

Flow callers should treat the Loop smoke command as an external process with
placeholder paths supplied by the operator or supervisor:

```sh
x-gate3-smoke <run-request-json-file> --workspace-root <workspace-root> --state-root <state-root>
```

The `<run-request-json-file>` input is a protocol-shaped RunRequest JSON file.
The `<workspace-root>` and `<state-root>` values are local smoke roots only.
Docs, tests, fixtures, and issue output must keep these as placeholders or
repo-relative paths; they must not publish workstation-local absolute paths,
secrets, customer data, or production evidence locations.

For a real sibling Loop checkout, use environment variables or placeholders
rather than durable host paths in published notes:

```sh
LOOP_ROOT=<codex-supervisor-root-or-loop-checkout>
FLOW_SMOKE_ROOT=<absolute-temporary-flow-x-gate3-smoke-root>
: "${LOOP_ROOT:?Set LOOP_ROOT to a local Ensen-loop checkout root}"
: "${FLOW_SMOKE_ROOT:?Set FLOW_SMOKE_ROOT to a per-run temporary absolute root}"
node "$LOOP_ROOT/dist/index.js" x-gate3-smoke <run-request-json-file> --workspace-root "$FLOW_SMOKE_ROOT/workspace" --state-root "$FLOW_SMOKE_ROOT/state"
```

The Flow-owned local smoke test creates its own temporary RunRequest input and
invokes an X-Gate 3-shaped local fake lane process. It is the required smoke
test for this repository:

```sh
npm test -- test/x-gate3-flow-smoke.test.ts
```

## Stdout Contract

The command should write one JSON aggregate to process stdout. Flow may consume
only the boundary fields needed to classify the smoke result:

- aggregate schema version, so Flow can fail closed on unsupported aggregate
  shapes;
- boundary flags, so local fake lane, dry-run, and no-production-mutation
  claims remain explicit in the output;
- RunStatusSnapshot, representing the observed status at the boundary;
- RunResult, representing the terminal result when the smoke reaches one;
- local artifact references, such as local evidence or log files created under
  the supplied local state root.

Flow must treat stderr, exit status, and stdout as boundary signals rather than
trusted authority. Missing, malformed, mixed-version, or contradictory signals
fail closed and must be routed as a finding.

## Artifact Handling

Flow may consume local artifact references only as local smoke pointers. They
are not production evidence, not compliance evidence, not a customer archive,
and not proof that an external executor or provider ran.

Allowed local smoke references include:

- a local aggregate JSON file under `<state-root>`;
- a local log or transcript under `<state-root>`;
- a local evidence-bundle reference whose URI is placeholder-based or
  repo-relative.

Flow must not publish raw secrets, access tokens, customer records, provider
payloads, real repository data, real review text, ERPNext records, or Pharma/GxP
evidence as part of X-Gate 3 smoke output.

Cleanup is limited to the temporary smoke root created for a single local run,
for example `<temporary-flow-x-gate3-smoke-root>/workspace`,
`<temporary-flow-x-gate3-smoke-root>/state`, and temporary RunRequest files.
Do not delete repository checkouts, supervisor state, customer data,
production evidence paths, shared caches, or any path that was not created for
the current smoke run.

## Failure Routing

| Failure class | Route follow-up to | Use when |
| --- | --- | --- |
| `protocol-gap` | TommyKammy/Ensen-protocol, using TommyKammy/Ensen-protocol#28 for concrete protocol contract ambiguity | The command boundary needs a protocol contract that is missing, ambiguous, contradictory, or not covered by the current protocol snapshot or fixtures. |
| `loop-gap` | TommyKammy/Ensen-loop | The local fake lane command is unavailable, exits non-zero for a Loop-owned reason, omits the promised aggregate, mislabels boundary flags, or writes malformed local smoke artifacts. |
| `flow-gap` | TommyKammy/Ensen-flow | Flow constructs invalid protocol-shaped input, invokes the process boundary incorrectly, trusts unsupported stdout, accepts unsafe artifact references, or documents a caller behavior it cannot later enforce. |

Fail closed when the owner is unclear. Do not infer success from names, comments,
placeholder credentials, forwarded identity headers, path shape, sibling
records, or nearby metadata. Route concrete protocol contract ambiguity through
TommyKammy/Ensen-protocol#28 rather than widening Flow or Loop behavior by
assumption.

## Verification

Run the repo-owned documentation contract test:

```sh
npm test -- test/x-gate3-flow-smoke.test.ts
npm test -- test/x-gate3-flow-runbook.test.ts
```

Before marking the runbook complete, inspect the docs diff for boundary wording,
placeholder-only paths, cleanup limits, and Protocol #28 routing language. Full
local verification should continue to use the repo-owned commands:

```sh
npm run build
npm test
```

## X-Gate 3 Reached Criteria

X-Gate 3 documentation can be marked ready when all of the following are true:

- `npm test -- test/x-gate3-flow-smoke.test.ts` passes and proves the Flow
  runner plus connector can exercise the Loop-shaped local fake lane boundary;
- the Flow runbook describes protocol-shaped input and process stdout output;
- README or docs navigation links to this runbook;
- the command shape uses placeholders or documented environment variables only;
- expected stdout fields include aggregate schema version, boundary flags,
  RunStatusSnapshot, RunResult, and local artifact references;
- failure routing covers `protocol-gap`, `loop-gap`, and `flow-gap`;
- concrete protocol contract ambiguity routes to TommyKammy/Ensen-protocol#28;
- the wording preserves the Ensen-flow repository boundary and forbids shared
  Ensen-loop implementation imports;
- cleanup is limited to the temporary smoke root created for the current run;
- the smoke remains local development evidence only, with no production
  automation, external mutation, or compliance evidence claim.
