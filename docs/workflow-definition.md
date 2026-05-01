# Workflow Definition Schema

Ensen-flow workflow definitions use the `flow.workflow.v1` schema version. The
schema describes standalone workflow orchestration metadata that the local runner
can validate without contacting Ensen-loop, executor connectors, or external
services.

## Boundary

The schema includes:

- an optional supported EIP `protocolVersion` boundary marker
- stable workflow and step IDs using kebab-case identifiers
- one trigger per workflow
- ordered step definitions with explicit `dependsOn` dependencies
- neutral action declarations for `local`, `approval`, and `notification`
- retry policies with `none`, `fixed`, or `exponential` backoff
- idempotency key semantics for `input`, `workflow`, and `static` sources
- free-form workflow and step metadata

Schema-owned objects reject unknown fields so typos and connector-specific drift
fail validation. Use `metadata` for workflow or step annotations and action
`with` values for neutral action inputs; both remain free-form at this boundary.

The schema does not include Ensen-loop-specific fields, run state transitions,
persistence behavior, executor connector configuration, or real Slack, Teams,
ERPNext, GitHub, or other connector behavior. Those concerns are deferred to
later Phase 1 issues.

Schedule triggers are intentionally small. The schema accepts only a local
`schedule` trigger with a `cron` string containing five UTC minute fields. Each
field must be either `*` or a numeric value in the field range. The runtime
helper `evaluateScheduleTrigger` can evaluate one supplied `scheduledFor`
timestamp against that cron expression in local tests, derive a deterministic
run ID and JSONL state path, and preserve trigger idempotency. This is not a
long-running scheduler daemon, cron service integration, cloud scheduler,
external calendar integration, or production time-zone policy.

Runner audit output is intentionally separate from the workflow definition
schema. The Phase 1 runner writes an internal neutral JSONL audit shape for
local lifecycle activity only; a formal mapping to EIP AuditEvent is deferred to
a later protocol or connector integration phase and does not depend on
Ensen-protocol runtime packages here.

Approval and notification are represented only as neutral action concepts. A
definition can name that a step requires an approval or notification action, but
the schema does not bind that action to a provider, credential, channel, or
runtime dispatch implementation.

## Shape

```json
{
  "protocolVersion": "0.1.0",
  "schemaVersion": "flow.workflow.v1",
  "id": "local-manual-demo",
  "name": "Local manual demo",
  "metadata": {
    "owner": "workflow-core"
  },
  "trigger": {
    "type": "manual",
    "idempotencyKey": {
      "source": "input",
      "field": "requestId",
      "required": true
    }
  },
  "steps": [
    {
      "id": "collect-input",
      "action": {
        "type": "local",
        "name": "collect_input",
        "with": {
          "mode": "dry-run"
        }
      },
      "retry": {
        "maxAttempts": 1,
        "backoff": {
          "strategy": "none"
        }
      }
    }
  ]
}
```

A bounded schedule trigger uses the same workflow shape with a schedule trigger:

```json
{
  "schemaVersion": "flow.workflow.v1",
  "id": "local-schedule-demo",
  "trigger": {
    "type": "schedule",
    "cron": "0 9 * * *",
    "idempotencyKey": {
      "source": "workflow",
      "template": "{workflow.id}:{trigger.type}:{trigger.scheduledFor}"
    }
  },
  "steps": [
    {
      "id": "scheduled-step",
      "action": {
        "type": "local",
        "name": "scheduled_noop"
      }
    }
  ]
}
```

The canonical fixture set lives in `fixtures/workflow-definitions/`. Tests load
those fixtures and validate them through `validateWorkflowDefinition`.

## Validation

Use the normal repository checks:

```sh
npm run build
npm test
```

For focused schema work, run:

```sh
npm run validate:workflow-fixtures
```
