# Workflow Definition Schema

Ensen-flow workflow definitions use the `flow.workflow.v1` schema version. The
schema describes standalone workflow orchestration metadata that the local runner
can validate without contacting Ensen-loop, executor connectors, or external
services.

## Boundary

The schema includes:

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

Approval and notification are represented only as neutral action concepts. A
definition can name that a step requires an approval or notification action, but
the schema does not bind that action to a provider, credential, channel, or
runtime dispatch implementation.

## Shape

```json
{
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
