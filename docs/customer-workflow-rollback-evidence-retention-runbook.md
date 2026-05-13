# Customer Workflow Rollback and Evidence Retention Runbook

This runbook documents the Flow-owned Track B customer workflow rollback,
revocation, and evidence retention boundary. It is operator-facing guidance for
local, fake, read-only, and draft-only customer workflow contexts.

Flow owns local workflow definition validation, JSONL run state, neutral audit
events, public-safe audit export, evidence metadata filtering, customer workflow
allowlist checks, and draft-only approval state recording. Flow does not own
ERPNext records, customer systems, live write-back, Ensen-loop internals,
external notification delivery, production evidence archives, or Pharma
workflow pack behavior.

This runbook does not claim production readiness.
This runbook does not claim compliance readiness.
This runbook does not claim live ERPNext write-back support.

## Operator Choices

Use the authoritative local run state and audit/evidence boundary before acting.
Do not infer success, approval, customer linkage, or ERPNext linkage from issue
text, path shape, comments, notification delivery, forwarded headers, placeholder
credentials, or nearby metadata.

The allowed operator choices are retry, re-run, abandon, manual repair, revoke,
and supersede. Each choice must preserve retained evidence and must keep the
deleted local artifact boundary narrow.

The covered failure cases are partial failure, notification misfire, draft
revocation, and customer workflow abort.

Coverage keywords: partial failure; notification misfire; draft revocation;
customer workflow abort.

Recovery surfaces: audit export, notification recovery, draft artifact recovery,
workflow state recovery.

| Situation | Default choice | Operator action | Retained evidence | Cleanup limit |
| --- | --- | --- | --- | --- |
| Retryable partial failure before any external draft claim | Retry | Reuse the same request ID, idempotency binding, workflow definition, and customer workflow allowlist entry. | Failed attempt, retry metadata, audit events, public-safe evidence export metadata, local confidential references. | Delete only temporary input files created for the retry. |
| Terminal failure or intentionally changed input | Re-run | Start a new run state path and request ID, then link the new run to the prior run in the operator note. | Prior terminal run JSONL, audit export, notification receipts, draft evidence references. | Do not rewrite or truncate the prior run. |
| Unsafe customer workflow input, allowlist miss, or live-write-back request | Abandon | Keep the guard outcome and record the owner follow-up. | Rejection diagnostic category, run or audit records if any were safely created, issue journal note. | Remove only scratch artifacts that are not evidence. |
| Contradictory JSONL state, corrupt file, or mixed evidence snapshot | Manual repair | Stop automated recovery and repair with a focused follow-up change or documented operator note. | Original JSONL file, sanitized diagnostic, audit/evidence exports, repair note. | Do not fabricate a clean replacement history. |
| Draft-only artifact should no longer be used | Revoke | Record the draft artifact as `revoked` or route to an explicit revocation follow-up; keep it `not-applied`. | Draft artifact reference, revocation reason, approval state, audit event, evidence metadata. | Do not delete the draft artifact reference from history. |
| A safer replacement draft is needed | Supersede | Create a new draft-only artifact under a new explicit run or step outcome and link it to the superseded draft. | Superseded draft reference, replacement draft reference, reason, audit trail. | Clean only newly created scratch files outside the evidence set. |
| Customer workflow abort requested before completion | Abandon or revoke | Stop local continuation with an explicit terminal or non-terminal operator decision; revoke draft-only artifacts when needed. | Abort note, prior step attempts, audit export, notification receipts, draft artifact state. | Do not silently remove the run or draft evidence. |

## Recovery Cases

Partial failure recovery starts from the Flow-owned JSONL state. Use
`inspectWorkflowRunRecovery(<state-jsonl-path>)` and preserve its diagnostic. A
`recoverable` result may retry with the same binding. A terminal result requires
a new explicit re-run. `approval-required`, `blocked`, `corrupt`, and
`manual-repair-needed` states require an operator decision before any new state
or audit record is appended.

Notification misfire handling stays at the notification connector boundary.
Retry a fake/local notification only when the endpoint alias, method, headers,
payload, request ID, and idempotency binding are unchanged. If the destination
or payload must change, re-run with a new explicit request and retain the
misfire receipt. Notification delivery does not prove approval, ERPNext write,
customer acknowledgement, or workflow completion.

Draft revocation is an evidence-preserving action. A revoked draft remains part
of the audit trail as a draft-only, not-applied artifact with a revocation reason
or follow-up reference. Revocation must not rewrite the original step result,
delete the draft reference from JSONL history, or convert the draft into a
committed ERPNext record.

Customer workflow abort handling must keep the prior history intact. When the
operator aborts a run, record the abort as an explicit terminal or manual repair
decision and preserve already written run state, audit events, notification
receipts, and draft evidence metadata. Abort does not mean local evidence can be
silently deleted.

Manual repair is required when provenance, scope, authorization context, or
snapshot consistency is missing. Reject mixed-snapshot audit export inputs,
changed replay payloads, untrusted forwarded identity fields, placeholder
credentials, or customer workflow references that are not explicitly bound by
the Flow allowlist.

## Evidence Retention Boundary

Retain these by default:

- workflow run JSONL files and every appended line;
- neutral audit JSONL files;
- public-safe audit export artifacts;
- local confidential reference indexes;
- notification receipts, failed delivery records, retry metadata, and blocked
  outcomes;
- draft-only artifact references, revocation decisions, supersession links, and
  approval-required, rejected, revoked, or superseded states;
- issue journals, operator repair notes, repository branches, and worktrees.

Deleted local artifact boundaries are intentionally narrow. Operators may delete
only temporary scratch files created for the current local attempt, such as:

```sh
rm -f <temporary-input-json-file>
rm -rf <local-scratch-artifact-root>
```

Do not delete or rewrite run JSONL, audit JSONL, public-safe exports, local
confidential reference indexes, notification receipts, draft artifact references,
supervisor state, repository checkouts, customer artifacts, ERPNext records,
production evidence stores, or sibling repository state.

## Audit Export And State Recovery

Audit export should be regenerated from retained state, not hand-edited. Use the
built CLI after local build:

```sh
npm run build
node dist/cli.js export-audit-evidence <state-jsonl-path> [audit-jsonl-path] --output <export-json-path>
```

If export inputs disagree, appear to come from different snapshots, or include
unsafe evidence references, fail closed and preserve the failed export diagnostic.
Public-safe exports must not include customer-confidential, regulated,
restricted, raw local path, raw secret, workstation-local, or unclassified
evidence references.

Workflow state recovery should preserve the authoritative lifecycle record. When
operator-facing summaries or detail surfaces disagree with JSONL lifecycle
facts, repair the derived surface and keep the original records. Do not redefine
truth around stale summaries, badge text, notification status, or issue comments.

## Boundary Notes

ERPNext remains a boundary note in this repository. Flow may record fake,
read-only, and draft-only mode vocabulary and reject live-write-back attempts,
but it does not implement ERPNext connector calls, customer data fixtures,
production regulated workflow execution, or live write-back.

Pharma workflow packs remain out of scope. Track B evidence and draft semantics
may inform future Pharma integration contracts, but this runbook does not
implement Pharma workflow behavior, GxP validation, electronic signatures, batch
release, final disposition, or customer SOP approval.

## Verification

Run the focused documentation coverage first:

```sh
npm test -- test/docs-navigation.test.ts
```

Then run the repo-owned checks:

```sh
npm run build
npm test
```

From the companion supervisor checkout, issue readiness can be checked with a
placeholder config path:

```sh
CODEX_SUPERVISOR_CONFIG=<supervisor-config-path> node dist/index.js issue-lint <this-issue-number> --config "$CODEX_SUPERVISOR_CONFIG"
```
