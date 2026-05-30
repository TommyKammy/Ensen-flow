# Controlled Pilot Rollback and Revocation Runbook

This runbook defines the Flow-owned controlled pilot rollback, revocation,
supersession, and retry boundary for X-Gate 5 readiness review. It applies only
to fake, local, read-only, or draft-only pilot rehearsal inputs. It does not
authorize customer execution, live ERPNext write-back, regulated workflow
execution, production evidence retention, or compliance claims.

The explicit non-goals are:

- customer pilot approval remains out of scope;
- regulated workflow execution approval remains out of scope;
- ERPNext live write-back approval remains out of scope;
- compliance claims remain out of scope;
- production-ready claims remain out of scope.

## Operator Entry

Start from the authoritative Flow JSONL state, not from issue comments, summary
text, branch names, notification delivery, forwarded headers, placeholder
credentials, or nearby metadata. Missing provenance, scope, authorization, or
snapshot consistency is a blocker, not an invitation to infer success.

Build the local CLI before any dry-run command:

```sh
npm run build
```

Create or reproduce a fake local run with an explicit request ID:

```sh
node dist/cli.js run fixtures/workflow-definitions/simple-manual.valid.json <state-jsonl-path> '{"requestId":"pilot-rollback-dry-run"}'
```

Export public-safe audit and evidence metadata from retained state:

```sh
node dist/cli.js export-audit-evidence <state-jsonl-path> [audit-jsonl-path] --output <export-json-path>
```

From the companion supervisor checkout, validate issue readiness with an
operator-provided config path:

```sh
CODEX_SUPERVISOR_CONFIG=<supervisor-config-path> node dist/index.js issue-lint <this-issue-number> --config "$CODEX_SUPERVISOR_CONFIG"
```

## Expected Artifacts

The commands above may create or read these artifacts:

| Artifact | Expected owner | Retention rule |
| --- | --- | --- |
| `<state-jsonl-path>` | Flow local run state | Retain every appended line, including failed, revoked, superseded, retried, blocked, and canceled facts. |
| `[audit-jsonl-path]` | Flow neutral audit events | Retain when present; missing audit input must not cause state deletion. |
| `<export-json-path>` | Public-safe audit/evidence export | Regenerate from retained state; do not hand-edit it into agreement with an operator summary. |
| `<temporary-input-json-file>` | Scratch input for the current dry run | May be deleted after the run when it is not the only evidence of a decision. |
| `<local-scratch-artifact-root>` | Scratch artifacts for the current dry run | May be deleted only after evidence-bearing references have been retained elsewhere. |

Retained evidence includes workflow run JSONL, neutral audit JSONL,
public-safe exports, local confidential reference indexes, connector receipts,
retry metadata, blocked outcomes, approval rejection notes, revocation reasons,
supersession links, and operator repair notes.

Deleted local artifacts are limited to scratch files created for the current
attempt:

```sh
rm -f <temporary-input-json-file>
rm -rf <local-scratch-artifact-root>
```

Do not delete, truncate, rewrite, or hide run JSONL, audit JSONL, public-safe
exports, local confidential reference indexes, issue journals, supervisor
state, repository branches, repository worktrees, sibling checkout state,
customer artifacts, ERPNext records, production evidence stores, or regulated
workflow records.

## Failure Classification

Use the producing boundary as the failure classification source:

| Classification | Owner | Use when |
| --- | --- | --- |
| `flow-gap` | TommyKammy/Ensen-flow | Flow accepts changed input, loses retry/idempotency binding, deletes evidence, emits unsafe exports, misclassifies JSONL lifecycle state, or hides revoked, superseded, or retried relationships. |
| `loop-gap` | TommyKammy/Ensen-loop | The executor connector returns malformed, missing, blocked, failed, or transport unavailable results for Loop-owned reasons. Preserve the connector receipt as evidence. |
| `protocol-gap` | TommyKammy/Ensen-protocol | The copied protocol snapshot cannot represent the required run status, result, evidence reference, retryability, revocation, supersession, or capability fact. |
| `operator-blocker` | Operator or governance prerequisite | Pilot scope, approval authority, customer linkage, regulated boundary, live write-back authority, or evidence retention ownership is missing or only implied. |

Fail closed when the classification is unclear. Do not infer tenant,
repository, workflow, customer, environment, approval, revocation, or
supersession linkage from naming conventions or display text.

## Decision Table

| Situation | Default decision | Required action | Relationship visibility | Cleanup limit |
| --- | --- | --- | --- | --- |
| Partial failure before terminal state | Retry | Continue only when `inspectWorkflowRunRecovery(<state-jsonl-path>)` is `recoverable` and the request ID, trigger context, workflow definition, step input, and idempotency binding are unchanged. | Mark the later attempt as retried from the failed attempt in the operator note or state evidence; keep both attempts visible. | Delete only scratch input duplicated by retained state. |
| Approval rejection | Revoke or abandon | Preserve the rejected approval state and route a human decision before any re-run. | A revoked relationship must point at the rejected or no-longer-valid evidence; the prior evidence remains visible. | Do not delete the rejected approval result or draft evidence. |
| Changed input | Re-run | Start a new state path and request ID. Link the new run to the superseded run in the operator note. | The new run is superseded-from the prior run; the prior run is superseded by the replacement. | Do not rewrite the original trigger context or request ID. |
| Blocked result | Abandon or manual repair | Treat the blocked result as authoritative connector evidence until the owning boundary resolves it. | Keep the blocked result linked to any follow-up retry or revocation decision. | Do not convert a blocked result into success to clear X-Gate 5. |
| Transport unavailable | Retry only if unchanged | Retry only through the same fake/local transport boundary with the same request and idempotency binding. | The retry relationship must show the unavailable transport result and the subsequent attempt. | Do not fabricate a delivery receipt or evidence bundle. |
| Draft or local evidence no longer valid | Revoke | Record an explicit revoked decision, reason, actor, timestamp, and linked evidence reference. | Revoked evidence remains visible as revoked, not deleted or renamed. | Remove only scratch copies outside retained evidence. |
| Safer replacement evidence is produced | Supersede | Create the replacement under a new explicit run or step outcome and link it to the superseded evidence. | Superseded and replacement references must both remain visible. | Do not collapse the relationship into a single current artifact. |

## X-Gate 5 Blockers

X-Gate 5 remains blocked until all of these are explicitly true for the
controlled pilot rehearsal:

- failure classification is recorded for partial failure, approval rejection,
  changed input, blocked result, and transport unavailable cases;
- retained evidence and deleted local artifacts are separated before cleanup;
- revoked, superseded, and retried relationships remain visible in retained
  state, evidence, export, or operator notes;
- issue readiness metadata and supervisor lint pass without relying on
  host-local absolute paths;
- all commands above have been executed or dry-run with fake or read-only
  inputs only.

X-Gate 5 must not be used to claim customer pilot approval, regulated workflow
execution approval, ERPNext live write-back approval, compliance readiness, or
production readiness.

## Verification

Run the focused documentation coverage first:

```sh
npm test -- test/controlled-pilot-rollback-revocation-runbook.test.ts
```

Then run the repo-owned checks:

```sh
npm run build
npm test
```

For manual verification, execute or dry-run the documented CLI commands with
fake or read-only inputs. Preserve generated state and export artifacts until
the operator has confirmed that they are not the only evidence of a failed,
revoked, superseded, retried, blocked, or canceled pilot rehearsal.
