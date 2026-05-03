# Controlled Pilot Rollback and Recovery Runbook

This runbook documents the Flow-owned controlled pilot recovery boundary for
Track A safety and Flow Phase 5 planning. It is an operator guide for local and
controlled pilot candidates only. It is not a production runbook, not customer
repo guidance, not ERPNext behavior, not regulated data handling, not an
electronic signature or batch-release process, and not a compliance claim.

Related planning references:

- Ensen-general `Roadmap/X-Gate 3 Track A safety tracker.md`, especially
  `FLOW-X3A-003`;
- Flow Phase 5 roadmap items for verification, review, evidence, recovery, and
  controlled pilot readiness;
- `docs/x-gate3-flow-caller-boundary-runbook.md` for the Flow caller boundary;
- `docs/loop-flow-protocol-v0.2.0-connection-smoke.md` for the pre-Phase 5
  Loop connector boundary.

## Recovery Boundary

Flow owns the local workflow definition, JSONL run state, neutral audit JSONL
events, public-safe audit/evidence export, trigger idempotency checks, and local
connector result recording. Flow does not own Ensen-loop internal lane state,
provider sessions, repository mutation, customer artifacts, ERPNext records, or
Pharma/GxP workflow packs.

Use the implemented JSONL recovery boundary first:

```sh
npm run build
node dist/cli.js run fixtures/workflow-definitions/simple-manual.valid.json <state-jsonl-path> '{"requestId":"manual-001"}'
```

Programmatic callers should inspect the state with
`inspectWorkflowRunRecovery(<state-jsonl-path>)` before choosing retry, re-run,
abandon, or manual repair. Safe stop is explicit:
`stopWorkflowRunRecovery` appends a `canceled` terminal event. Operators must
not recover by deleting, editing, truncating, or rewriting the JSONL history.
The controlled pilot choices are retry, re-run, abandon, or manual repair.

## Decision Table

| Observed state | Default choice | Operator action | Preserved records | Do not do |
| --- | --- | --- | --- | --- |
| `recoverable` JSONL state with no active attempt | Retry or resume | Continue from projected JSONL state with the same run ID, trigger context, and idempotency key. | Existing run JSONL, neutral audit JSONL, local evidence references, completed step attempts. | Do not create a second run for the same logical request only because a summary looked stale. |
| Terminal `succeeded`, `failed`, or `canceled` run | Re-run only with a new explicit request | Start a new state path and new request ID when the operator intentionally wants another attempt. | Prior terminal run, audit events, exported evidence metadata. | Do not replay active work into a terminal run. |
| `approval-required` step | Manual approval recovery | Keep the run non-terminal until a human records the next choice: retry after approval, re-run, abandon, or manual repair. | Approval-required step result, neutral audit event, review notes. | Do not infer approval from Loop status, notification delivery, issue text, naming, or nearby metadata. |
| Active step attempt or contradictory step order | Manual repair | Stop and inspect the JSONL file, connector receipt, and audit events; repair only through an explicit follow-up patch or documented operator note. | All JSONL lines and local evidence references. | Do not assume external side effects are absent. |
| Retryable connector or notification failure | Retry | Reuse the same idempotency binding and step retry policy. Preserve the failed attempt and retry metadata. | Failed attempt, retry reason, next attempt time, connector evidence. | Do not change payload, endpoint alias, headers, request ID, or idempotency key during replay. |
| `blocked` connector outcome | Abandon or manual repair | Treat the blocked result as an explicit connector outcome and route the owner-specific follow-up. | Blocked step result and terminal failed run record when present. | Do not wrap a Loop connector failure as Flow-owned lane state. |
| Corrupt JSONL state or unsafe artifact diagnostic | Manual repair | Reject automated recovery and repair JSONL/artifact hygiene with a focused follow-up. | Original corrupt file and sanitized diagnostic. | Do not fabricate success, evidence, or approval to get past the guard. |

## Partial Failure Classification

Classify from the boundary that produced the authoritative failure:

| Class | Owner | Use when |
| --- | --- | --- |
| `flow-gap` | TommyKammy/Ensen-flow | Flow writes unsafe run/audit artifacts, accepts changed replay input, loses idempotency binding, misprojects JSONL state, or deletes history during cleanup. |
| `loop-gap` | TommyKammy/Ensen-loop | The Loop connector boundary returns a malformed, missing, blocked, or failed aggregate for Loop-owned reasons. Keep the result as connector evidence. |
| `protocol-gap` | TommyKammy/Ensen-protocol | The copied protocol snapshot cannot represent the needed RunRequest, RunStatusSnapshot, RunResult, capability, retryability, or evidence shape. |

Fail closed when ownership is unclear. Do not infer tenant, repository, run,
approval, or environment binding from path shape, branch names, issue text,
comments, forwarded headers, placeholder credentials, or human-readable
summaries.

## Specific Recovery Cases

JSONL state recovery starts from `inspectWorkflowRunRecovery`. `recoverable`
means Flow can continue from projected local state. `terminal` means no replay.
`approval-required`, `blocked`, `corrupt`, and `manual-repair-needed` require an
operator decision before new state or audit records are appended.

Approval recovery remains human-controlled. An `approval-required` result keeps
the run non-terminal; retry, re-run, abandon, and manual repair are explicit
operator choices. Notification delivery, Loop status text, or issue comments do
not count as approval.

Retry and idempotency recovery must preserve request binding. Replays use the
same request ID, trigger idempotency key, step idempotency key, normalized
webhook input, notification endpoint alias, method, headers, and payload. If
any replay input changes, Flow rejects before writing new state or audit events.

Notification misfires are connector outcomes. Retryable fake/local notification
failures may retry through the configured step retry policy. Terminal failures
record the failed attempt and, when retries are exhausted, a terminal failed
run. Operators should re-run only with a new explicit request when the payload
or destination must change.

Webhook replay handling is fail-closed. Reusing a `requestId` is allowed only
when the normalized webhook input is unchanged. Changed payload, headers, path,
or received timestamp must be rejected before partial run state or audit output
is written.

Loop connector failures stay at the connector boundary. Flow records the
executor status/result/evidence in the step attempt and routes `loop-gap`
follow-ups to Ensen-loop. Flow must not translate Loop failures into internal
Flow wrapper state or claim that Loop work was recovered by Flow alone.

## Cleanup Boundary

Cleanup is allowed only for scratch data created for the current local or
controlled pilot attempt:

```sh
rm -f <temporary-input-json-file>
rm -rf <local-scratch-artifact-root>
```

Preserve these by default:

- workflow run JSONL files and every appended line;
- neutral audit JSONL files;
- public-safe audit/evidence exports;
- local confidential reference indexes;
- connector receipts, blocked outcomes, retry metadata, approval-required
  outcomes, and manual repair notes;
- issue journals, supervisor state, repository checkouts, branches, and
  worktrees.

Do not automatically clean repository checkouts, supervisor state, sibling
repos, Ensen-loop lane state, production evidence stores, customer artifacts,
ERPNext records, or any path not created for the current scratch attempt.

## Verification

Run focused local verification first:

```sh
npm test -- test/workflow-runner.test.ts test/docs-navigation.test.ts
```

Then run the repo-owned checks:

```sh
npm run build
npm test
```

Manual docs review should compare this runbook against
Ensen-general `Roadmap/X-Gate 3 Track A safety tracker.md` and the Flow Phase 5
roadmap boundary. From the companion supervisor checkout, issue readiness can
be checked with a placeholder config path:

```sh
CODEX_SUPERVISOR_CONFIG=<supervisor-config-path> node dist/index.js issue-lint <this-issue-number> --config "$CODEX_SUPERVISOR_CONFIG"
```
