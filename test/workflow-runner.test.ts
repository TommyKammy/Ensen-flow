import { mkdtemp, readFile, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendWorkflowRunEvent,
  createWorkflowRun,
  inspectWorkflowRunRecovery,
  readWorkflowRunState,
  runWorkflow
} from "../src/index.js";
import type {
  CustomerWorkflowAllowlistPolicy,
  ExecutorConnectorStatusSnapshot,
  WorkflowDefinition
} from "../src/index.js";

const tempRoots: string[] = [];

const readWorkflowFixture = (name: string): WorkflowDefinition =>
  JSON.parse(
    readFileSync(join(process.cwd(), "fixtures", "workflow-definitions", name), "utf8")
  ) as WorkflowDefinition;

const createTempStatePath = async () => {
  const root = await mkdtemp(join(tmpdir(), "ensen-flow-runner-"));
  tempRoots.push(root);
  return join(root, "runs", "manual-run.jsonl");
};

const createTempAuditPath = async () => {
  const root = await mkdtemp(join(tmpdir(), "ensen-flow-audit-"));
  tempRoots.push(root);
  return join(root, "audit", "manual-run.audit.jsonl");
};

const readAuditEvents = async (auditPath: string): Promise<Array<Record<string, unknown>>> =>
  (await readFile(auditPath, "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

const customerWorkflowAllowlistPolicy = (): CustomerWorkflowAllowlistPolicy => ({
  schemaVersion: "flow.customer-workflow-allowlist.v1",
  entries: [
    {
      customerWorkflowRef: "public-release-approval",
      modes: ["fake", "read-only", "draft-only", "live-write-back"],
      erpNext: {
        siteRefs: ["erpnext-public-demo"],
        objectTypes: ["Sales Order"],
        endpointRefs: ["erpnext-public-api"]
      }
    }
  ]
});

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("sequential workflow runner", () => {
  it("recovers a non-terminal JSONL run state from the next incomplete step", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    const statePath = await createTempStatePath();
    const auditPath = await createTempAuditPath();
    const calls: string[] = [];

    await createWorkflowRun(statePath, {
      runId: "local-manual-demo-manual-recover",
      workflowId: "local-manual-demo",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:06:00.000Z",
        context: {
          requestId: "manual-recover"
        },
        idempotencyKey: {
          source: "input",
          key: "manual-recover"
        }
      },
      createdAt: "2026-04-29T00:06:01.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "local-manual-demo-manual-recover",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:06:02.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.completed",
      runId: "local-manual-demo-manual-recover",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:06:03.000Z"
    });

    const result = await runWorkflow({
      definition,
      statePath,
      auditPath,
      triggerContext: {
        requestId: "manual-recover"
      },
      now: (() => {
        let index = 0;
        const timestamps = [
          "2026-04-29T00:06:04.000Z",
          "2026-04-29T00:06:05.000Z",
          "2026-04-29T00:06:06.000Z"
        ];
        return () => timestamps[index++] ?? "2026-04-29T00:06:07.000Z";
      })(),
      stepHandler: ({ step }) => {
        calls.push(step.id);
      }
    });

    expect(calls).toEqual(["notify-operator"]);
    expect(result.run.status).toBe("succeeded");
    expect(result.events.map((event) => event.type)).toEqual([
      "run.created",
      "step.attempt.started",
      "step.attempt.completed",
      "step.attempt.started",
      "step.attempt.completed",
      "run.completed"
    ]);
    expect(result.stepAttempts["collect-input"]).toHaveLength(1);
    expect(result.stepAttempts["notify-operator"]).toMatchObject([
      {
        attempt: 1,
        startedAt: "2026-04-29T00:06:04.000Z",
        completedAt: "2026-04-29T00:06:05.000Z",
        status: "succeeded"
      }
    ]);

    expect((await readAuditEvents(auditPath)).map((event) => event.type)).toEqual([
      "step.started",
      "step.completed",
      "workflow.completed"
    ]);
  });

  it("fails closed when persisted step history is not an ordered prefix", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    const statePath = await createTempStatePath();
    const auditPath = await createTempAuditPath();

    await createWorkflowRun(statePath, {
      runId: "local-manual-demo-manual-prefix",
      workflowId: "local-manual-demo",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:07:00.000Z",
        context: {
          requestId: "manual-prefix"
        },
        idempotencyKey: {
          source: "input",
          key: "manual-prefix"
        }
      },
      createdAt: "2026-04-29T00:07:01.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "local-manual-demo-manual-prefix",
      stepId: "notify-operator",
      attempt: 1,
      occurredAt: "2026-04-29T00:07:02.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.completed",
      runId: "local-manual-demo-manual-prefix",
      stepId: "notify-operator",
      attempt: 1,
      occurredAt: "2026-04-29T00:07:03.000Z"
    });

    await expect(
      runWorkflow({
        definition,
        statePath,
        auditPath,
        triggerContext: {
          requestId: "manual-prefix"
        }
      })
    ).rejects.toThrow(
      "existing workflow run state references step notify-operator after an incomplete earlier step; manual repair is required before recovery"
    );

    const persisted = await readWorkflowRunState(statePath);
    expect(persisted.events.map((event) => event.type)).toEqual([
      "run.created",
      "step.attempt.started",
      "step.attempt.completed"
    ]);
    await expect(readFile(auditPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("emits deterministic neutral audit events for a successful run", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    const statePath = await createTempStatePath();
    const auditPath = await createTempAuditPath();

    await runWorkflow({
      definition,
      statePath,
      auditPath,
      triggerContext: {
        requestId: "manual-audit"
      },
      now: (() => {
        let index = 0;
        const timestamps = [
          "2026-04-29T00:03:00.000Z",
          "2026-04-29T00:03:01.000Z",
          "2026-04-29T00:03:02.000Z",
          "2026-04-29T00:03:03.000Z",
          "2026-04-29T00:03:04.000Z",
          "2026-04-29T00:03:05.000Z"
        ];
        return () => timestamps[index++] ?? "2026-04-29T00:03:06.000Z";
      })()
    });

    const auditEvents = await readAuditEvents(auditPath);

    expect(auditEvents.map((event) => event.type)).toEqual([
      "workflow.started",
      "step.started",
      "step.completed",
      "step.started",
      "step.completed",
      "workflow.completed"
    ]);
    expect(auditEvents[0]).toMatchObject({
      id: "audit.local-manual-demo-manual-audit.000001",
      occurredAt: "2026-04-29T00:03:01.000Z",
      actor: { type: "system", id: "ensen-flow.local-runner" },
      source: { type: "runner", id: "ensen-flow.local-runner" },
      workflow: { id: "local-manual-demo", version: "flow.workflow.v1" },
      run: { id: "local-manual-demo-manual-audit" }
    });
    expect(auditEvents[1]).toMatchObject({
      id: "audit.local-manual-demo-manual-audit.000002",
      occurredAt: "2026-04-29T00:03:02.000Z",
      step: { id: "collect-input", attempt: 1 }
    });
  });

  it("runs the simple manual workflow fixture to completion", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    const statePath = await createTempStatePath();

    const result = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "manual-001"
      },
      now: (() => {
        let index = 0;
        const timestamps = [
          "2026-04-29T00:00:00.000Z",
          "2026-04-29T00:00:01.000Z",
          "2026-04-29T00:00:02.000Z",
          "2026-04-29T00:00:03.000Z",
          "2026-04-29T00:00:04.000Z",
          "2026-04-29T00:00:05.000Z"
        ];
        return () => timestamps[index++] ?? "2026-04-29T00:00:06.000Z";
      })()
    });

    expect(result.run.status).toBe("succeeded");
    expect(result.run.trigger.idempotencyKey).toEqual({
      source: "input",
      key: "manual-001"
    });

    const persisted = await readWorkflowRunState(statePath);
    expect(persisted.events.map((event) => event.type)).toEqual([
      "run.created",
      "step.attempt.started",
      "step.attempt.completed",
      "step.attempt.started",
      "step.attempt.completed",
      "run.completed"
    ]);
    expect(Object.keys(persisted.stepAttempts)).toEqual([
      "collect-input",
      "notify-operator"
    ]);
  });

  it("runs a workflow that declares the supported EIP protocol version", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    definition.protocolVersion = "0.2.0";
    const statePath = await createTempStatePath();

    const result = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "manual-supported-eip"
      }
    });

    expect(result.run.status).toBe("succeeded");
    expect(result.run.workflowId).toBe("local-manual-demo");
  });

  it("rejects cyclic dependencies before writing state or audit records", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    definition.steps[0].dependsOn = ["notify-operator"];
    definition.steps[1].dependsOn = ["collect-input"];
    const statePath = await createTempStatePath();
    const auditPath = await createTempAuditPath();

    await expect(
      runWorkflow({
        definition,
        statePath,
        auditPath,
        triggerContext: {
          requestId: "manual-cycle"
        }
      })
    ).rejects.toThrow("workflow definition dependencies cannot be ordered");

    await expect(readFile(statePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(auditPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects unsupported EIP protocol versions before writing state or audit records", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    (definition as WorkflowDefinition & { protocolVersion: string }).protocolVersion = "1.0.0";
    const statePath = await createTempStatePath();
    const auditPath = await createTempAuditPath();
    let stepHandlerCalled = false;

    await expect(
      runWorkflow({
        definition,
        statePath,
        auditPath,
        triggerContext: {
          requestId: "manual-unsupported-eip"
        },
        stepHandler: () => {
          stepHandlerCalled = true;
        }
      })
    ).rejects.toThrow(
      "unsupported EIP protocolVersion \"1.0.0\"; fail-closed until an explicit Ensen-flow connector boundary supports the new EIP major version"
    );

    expect(stepHandlerCalled).toBe(false);
    await expect(readFile(statePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(auditPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("fails closed when customer workflow input has no allowlist before writing state or audit records", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    const statePath = await createTempStatePath();
    const auditPath = await createTempAuditPath();
    let stepHandlerCalled = false;

    await expect(
      runWorkflow({
        definition,
        statePath,
        auditPath,
        triggerContext: {
          requestId: "manual-customer-workflow-miss",
          customerWorkflow: {
            ref: "customer-workflow-private-placeholder",
            mode: "draft-only",
            erpNext: {
              siteRef: "erpnext-private-site-placeholder",
              objectType: "Sales Order",
              endpointRef: "erpnext-private-endpoint-placeholder"
            }
          }
        },
        stepHandler: () => {
          stepHandlerCalled = true;
        }
      })
    ).rejects.toThrow(
      "customer workflow input is not allowlisted for mode draft-only; diagnostic redacted"
    );

    expect(stepHandlerCalled).toBe(false);
    await expect(readFile(statePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(auditPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("runs customer workflow input only when workflow and ERPNext references match the allowlist", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    definition.metadata = {
      ...definition.metadata,
      customerWorkflowAllowlist: customerWorkflowAllowlistPolicy()
    };
    const statePath = await createTempStatePath();

    const result = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "manual-customer-workflow-pass",
        customerWorkflow: {
          ref: "public-release-approval",
          mode: "draft-only",
          erpNext: {
            siteRef: "erpnext-public-demo",
            objectType: "Sales Order",
            endpointRef: "erpnext-public-api"
          }
        }
      }
    });

    expect(result.run.status).toBe("succeeded");
  });

  it("redacts unsafe customer workflow and ERPNext values from allowlist miss diagnostics", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    definition.metadata = {
      ...definition.metadata,
      customerWorkflowAllowlist: customerWorkflowAllowlistPolicy()
    };
    const statePath = await createTempStatePath();
    const auditPath = await createTempAuditPath();

    await expect(
      runWorkflow({
        definition,
        statePath,
        auditPath,
        triggerContext: {
          requestId: "manual-customer-workflow-redacted",
          customerWorkflow: {
            ref: "public-release-approval",
            mode: "draft-only",
            erpNext: {
              siteRef: "erpnext-private-site-placeholder",
              objectType: "regulated-object-placeholder",
              endpointRef: "erpnext-private-endpoint-placeholder"
            }
          }
        }
      })
    ).rejects.toThrow(
      "ERPNext reference is not allowlisted for mode draft-only; diagnostic redacted"
    );

    await expect(
      runWorkflow({
        definition,
        statePath: await createTempStatePath(),
        triggerContext: {
          requestId: "manual-customer-workflow-live-write-back",
          customerWorkflow: {
            ref: "public-release-approval",
            mode: "live-write-back"
          }
        }
      })
    ).rejects.toThrow(
      "customer workflow input requested live-write-back mode; ERPNext live write-back remains disabled; diagnostic redacted"
    );

    await expect(readFile(statePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(auditPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("runs a valid manual workflow without trigger idempotency metadata", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    delete definition.trigger.idempotencyKey;
    const statePath = await createTempStatePath();

    const result = await runWorkflow({
      definition,
      statePath,
      now: (() => {
        let index = 0;
        const timestamps = [
          "2026-04-29T00:04:00.000Z",
          "2026-04-29T00:04:01.000Z",
          "2026-04-29T00:04:02.000Z",
          "2026-04-29T00:04:03.000Z",
          "2026-04-29T00:04:04.000Z",
          "2026-04-29T00:04:05.000Z"
        ];
        return () => timestamps[index++] ?? "2026-04-29T00:04:06.000Z";
      })()
    });

    expect(result.run.status).toBe("succeeded");
    expect(result.run.trigger).toEqual({
      type: "manual",
      receivedAt: "2026-04-29T00:04:00.000Z",
      context: {}
    });

    const persisted = await readWorkflowRunState(statePath);
    expect(persisted.run.trigger).toEqual(result.run.trigger);
  });

  it("records retryable failures and retries according to the step policy", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    const statePath = await createTempStatePath();
    const auditPath = await createTempAuditPath();
    let calls = 0;

    const result = await runWorkflow({
      definition,
      statePath,
      auditPath,
      triggerContext: {
        requestId: "manual-retry"
      },
      now: (() => {
        let index = 0;
        const timestamps = [
          "2026-04-29T00:01:00.000Z",
          "2026-04-29T00:01:01.000Z",
          "2026-04-29T00:01:02.000Z",
          "2026-04-29T00:01:03.000Z",
          "2026-04-29T00:01:04.000Z",
          "2026-04-29T00:01:05.000Z",
          "2026-04-29T00:01:06.000Z",
          "2026-04-29T00:01:07.000Z",
          "2026-04-29T00:01:08.000Z"
        ];
        return () => timestamps[index++] ?? "2026-04-29T00:01:09.000Z";
      })(),
      stepHandler: ({ step }) => {
        if (step.id === "notify-operator" && calls === 0) {
          calls += 1;
          throw new Error("operator notice transport unavailable");
        }
      }
    });

    expect(result.run.status).toBe("succeeded");
    expect(result.stepAttempts["notify-operator"]).toEqual([
      {
        attempt: 1,
        startedAt: "2026-04-29T00:01:04.000Z",
        failedAt: "2026-04-29T00:01:05.000Z",
        retry: {
          retryable: true,
          nextAttemptAt: "2026-04-29T00:01:06.000Z",
          reason: "operator notice transport unavailable"
        },
        status: "retryable-failed"
      },
      {
        attempt: 2,
        startedAt: "2026-04-29T00:01:06.000Z",
        completedAt: "2026-04-29T00:01:07.000Z",
        retry: undefined,
        status: "succeeded"
      }
    ]);

    const auditEvents = await readAuditEvents(auditPath);
    expect(auditEvents.map((event) => event.type)).toEqual([
      "workflow.started",
      "step.started",
      "step.completed",
      "step.started",
      "step.failed",
      "step.retry.scheduled",
      "step.started",
      "step.completed",
      "workflow.completed"
    ]);
    expect(auditEvents[5]).toMatchObject({
      type: "step.retry.scheduled",
      occurredAt: "2026-04-29T00:01:05.000Z",
      step: { id: "notify-operator", attempt: 1 },
      retry: {
        retryable: true,
        nextAttemptAt: "2026-04-29T00:01:06.000Z",
        reason: "operator notice transport unavailable"
      }
    });
  });

  it("classifies a partial connector failure as retryable and preserves recovery evidence", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    definition.id = "connector-partial-recovery-demo";
    definition.steps = [
      {
        id: "dispatch-local-connector",
        action: {
          type: "local",
          name: "partial_failure_connector"
        },
        retry: {
          maxAttempts: 2,
          backoff: {
            strategy: "fixed",
            delayMs: 1000
          }
        }
      }
    ];
    const statePath = await createTempStatePath();
    const auditPath = await createTempAuditPath();

    const result = await runWorkflow({
      definition,
      statePath,
      auditPath,
      triggerContext: {
        requestId: "connector-partial-recovery"
      },
      now: createClock([
        "2026-05-03T00:00:00.000Z",
        "2026-05-03T00:00:00.000Z",
        "2026-05-03T00:00:01.000Z",
        "2026-05-03T00:00:02.000Z",
        "2026-05-03T00:00:03.000Z",
        "2026-05-03T00:00:04.000Z",
        "2026-05-03T00:00:05.000Z"
      ]),
      stepHandler: ({ attempt }) =>
        attempt === 1
          ? ({
              requestId: "req_connector_partial_recovery_1",
              status: "failed",
              observedAt: "2026-05-03T00:00:02.000Z",
              result: {
                status: "failed",
                summary: "local connector accepted the request but lost the completion receipt",
                evidence: {
                  connectorId: "partial-failure-connector",
                  recoveryClass: "retryable",
                  localReceiptRef: "evidence/partial-failure/receipt.json"
                }
              }
            } satisfies ExecutorConnectorStatusSnapshot)
          : ({
              requestId: "req_connector_partial_recovery_2",
              status: "succeeded",
              observedAt: "2026-05-03T00:00:04.000Z",
              result: {
                status: "succeeded",
                summary: "local connector replay observed the prior receipt",
                evidence: {
                  connectorId: "partial-failure-connector",
                  recoveryClass: "recovered",
                  localReceiptRef: "evidence/partial-failure/receipt.json"
                }
              }
            } satisfies ExecutorConnectorStatusSnapshot)
    });

    expect(result.run.status).toBe("succeeded");
    expect(result.stepAttempts["dispatch-local-connector"]).toMatchObject([
      {
        attempt: 1,
        status: "retryable-failed",
        retry: {
          retryable: true,
          nextAttemptAt: "2026-05-03T00:00:03.000Z",
          reason: "local connector accepted the request but lost the completion receipt"
        },
        result: {
          executor: {
            requestId: "req_connector_partial_recovery_1",
            status: "failed",
            result: {
              evidence: {
                recoveryClass: "retryable",
                localReceiptRef: "evidence/partial-failure/receipt.json"
              }
            }
          }
        }
      },
      {
        attempt: 2,
        status: "succeeded",
        result: {
          executor: {
            status: "succeeded",
            result: {
              evidence: {
                recoveryClass: "recovered"
              }
            }
          }
        }
      }
    ]);

    const auditEvents = await readAuditEvents(auditPath);
    expect(auditEvents.map((event) => event.type)).toEqual([
      "workflow.started",
      "step.started",
      "step.failed",
      "step.retry.scheduled",
      "step.started",
      "step.completed",
      "workflow.completed"
    ]);
    expect(JSON.stringify(result)).not.toContain(tmpdir());
  });

  it("records failed steps with diagnostic retry metadata", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    const statePath = await createTempStatePath();
    const auditPath = await createTempAuditPath();

    const result = await runWorkflow({
      definition,
      statePath,
      auditPath,
      triggerContext: {
        requestId: "manual-failed"
      },
      now: (() => {
        let index = 0;
        const timestamps = [
          "2026-04-29T00:02:00.000Z",
          "2026-04-29T00:02:01.000Z",
          "2026-04-29T00:02:02.000Z",
          "2026-04-29T00:02:03.000Z",
          "2026-04-29T00:02:04.000Z"
        ];
        return () => timestamps[index++] ?? "2026-04-29T00:02:05.000Z";
      })(),
      stepHandler: ({ step }) => {
        if (step.id === "collect-input") {
          throw new Error("manual input was incomplete");
        }
      }
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["collect-input"]).toEqual([
      {
        attempt: 1,
        startedAt: "2026-04-29T00:02:02.000Z",
        failedAt: "2026-04-29T00:02:03.000Z",
        retry: {
          retryable: false,
          nextAttemptAt: undefined,
          reason: "manual input was incomplete"
        },
        status: "failed"
      }
    ]);

    const auditEvents = await readAuditEvents(auditPath);
    expect(auditEvents.map((event) => event.type)).toEqual([
      "workflow.started",
      "step.started",
      "step.failed",
      "workflow.failed"
    ]);
    expect(auditEvents[3]).toMatchObject({
      type: "workflow.failed",
      occurredAt: "2026-04-29T00:02:04.000Z",
      outcome: {
        status: "failed",
        reason: "manual input was incomplete"
      }
    });
  });

  it("fails the step when a handler returns a malformed non-void result", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    definition.steps = [definition.steps[0]];
    const statePath = await createTempStatePath();

    const result = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "manual-malformed-handler"
      },
      now: (() => {
        let index = 0;
        const timestamps = [
          "2026-04-29T00:05:00.000Z",
          "2026-04-29T00:05:01.000Z",
          "2026-04-29T00:05:02.000Z",
          "2026-04-29T00:05:03.000Z",
          "2026-04-29T00:05:04.000Z"
        ];
        return () => timestamps[index++] ?? "2026-04-29T00:05:05.000Z";
      })(),
      stepHandler: () => ({}) as never
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["collect-input"]).toMatchObject([
      {
        attempt: 1,
        status: "failed",
        retry: {
          retryable: false,
          reason: "stepHandler must return an ExecutorConnectorStatusSnapshot or { executor }"
        }
      }
    ]);
  });

  it.each([
    {
      executorStatus: "succeeded",
      resultStatus: "succeeded",
      expectedRunStatus: "succeeded",
      expectedAttemptStatus: "succeeded",
      summary: "Loop X-Gate 3 local fake lane succeeded."
    },
    {
      executorStatus: "failed",
      resultStatus: "failed",
      expectedRunStatus: "failed",
      expectedAttemptStatus: "failed",
      summary: "Loop X-Gate 3 local fake lane failed."
    },
    {
      executorStatus: "blocked",
      resultStatus: "blocked",
      expectedRunStatus: "failed",
      expectedAttemptStatus: "blocked",
      summary: "Loop X-Gate 3 local fake lane blocked."
    }
  ] as const)(
    "persists X-Gate 3 local lane $executorStatus outcome in Flow run state",
    async ({
      executorStatus,
      resultStatus,
      expectedRunStatus,
      expectedAttemptStatus,
      summary
    }) => {
      const definition = readWorkflowFixture("simple-manual.valid.json");
      definition.id = `xgate3-local-lane-${executorStatus}`;
      definition.steps = [
        {
          id: "xgate3-local-lane",
          action: {
            type: "local",
            name: "loop_xgate3_local_lane"
          }
        }
      ];
      const statePath = await createTempStatePath();

      const result = await runWorkflow({
        definition,
        statePath,
        triggerContext: {
          requestId: `xgate3-${executorStatus}`
        },
        now: (() => {
          let index = 0;
          const timestamps = [
            "2026-05-01T04:00:00.000Z",
            "2026-05-01T04:00:01.000Z",
            "2026-05-01T04:00:02.000Z",
            "2026-05-01T04:00:03.000Z"
          ];
          return () => timestamps[index++] ?? "2026-05-01T04:00:04.000Z";
        })(),
        stepHandler: () =>
          ({
            requestId: `req_xgate3_${executorStatus}_local_lane`,
            status: executorStatus,
            observedAt: "2026-05-01T04:00:03.000Z",
            result: {
              status: resultStatus,
              summary,
              evidence: {
                verification: {
                  status: resultStatus === "succeeded" ? "passed" : resultStatus,
                  summary
                },
                warnings: [{ code: "local-lane-only", message: "Local smoke reference only." }],
                ...(resultStatus === "succeeded"
                  ? {}
                  : { errors: [{ code: resultStatus, message: summary }] }),
                localArtifacts: {
                  laneRunId: `lane_xgate3_${executorStatus}`,
                  stateFile: "state/x-gate3/lane-run.jsonl",
                  evidenceMetadata: ["evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-bundle.json"]
                },
                localArtifactSemantics: "local-development-references-only",
                productionEvidence: false
              }
            }
          }) satisfies ExecutorConnectorStatusSnapshot
      });

      expect(result.run.status).toBe(expectedRunStatus);
      expect(result.stepAttempts["xgate3-local-lane"]).toMatchObject([
        {
          attempt: 1,
          status: expectedAttemptStatus,
          result: {
            executor: {
              requestId: `req_xgate3_${executorStatus}_local_lane`,
              status: executorStatus,
              result: {
                status: resultStatus,
                summary,
                evidence: {
                  verification: {
                    status: resultStatus === "succeeded" ? "passed" : resultStatus,
                    summary
                  },
                  localArtifacts: {
                    laneRunId: `lane_xgate3_${executorStatus}`,
                    stateFile: "state/x-gate3/lane-run.jsonl",
                    evidenceMetadata: [
                      "evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-bundle.json"
                    ]
                  },
                  localArtifactSemantics: "local-development-references-only",
                  productionEvidence: false
                }
              }
            }
          }
        }
      ]);

      const persisted = await readWorkflowRunState(statePath);
      expect(JSON.stringify(persisted)).not.toContain("compliance evidence");
      expect(JSON.stringify(persisted)).not.toContain("production evidence archive");
      expect(persisted.stepAttempts["xgate3-local-lane"][0].result).toEqual(
        result.stepAttempts["xgate3-local-lane"][0].result
      );
    }
  );

  it("keeps Loop executor connector failure as executor evidence, not Flow-owned lane state", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    definition.id = "loop-executor-partial-failure-demo";
    definition.steps = [
      {
        id: "loop-executor-dispatch",
        action: {
          type: "local",
          name: "ensen_loop_eip_executor"
        }
      }
    ];
    const statePath = await createTempStatePath();

    const result = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "loop-executor-partial-failure"
      },
      now: createClock([
        "2026-05-03T00:10:00.000Z",
        "2026-05-03T00:10:00.000Z",
        "2026-05-03T00:10:01.000Z",
        "2026-05-03T00:10:02.000Z",
        "2026-05-03T00:10:03.000Z"
      ]),
      stepHandler: () =>
        ({
          requestId: "req_loop_executor_partial_failure",
          status: "failed",
          observedAt: "2026-05-03T00:10:02.000Z",
          result: {
            status: "failed",
            summary: "Ensen-loop executor connector returned a loop-gap failure",
            evidence: {
              connectorId: "ensen-loop-eip",
              failureClass: "loop-gap",
              operation: "status",
              localArtifactSemantics: "local-development-references-only"
            }
          }
        }) satisfies ExecutorConnectorStatusSnapshot
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["loop-executor-dispatch"]).toMatchObject([
      {
        attempt: 1,
        status: "failed",
        retry: {
          retryable: false,
          reason: "Ensen-loop executor connector returned a loop-gap failure"
        },
        result: {
          executor: {
            requestId: "req_loop_executor_partial_failure",
            status: "failed",
            result: {
              evidence: {
                connectorId: "ensen-loop-eip",
                failureClass: "loop-gap",
                operation: "status",
                localArtifactSemantics: "local-development-references-only"
              }
            }
          }
        }
      }
    ]);
    expect(JSON.stringify(result.stepAttempts["loop-executor-dispatch"][0].result)).not.toContain(
      "laneState"
    );
    expect(JSON.stringify(result.stepAttempts["loop-executor-dispatch"][0].result)).not.toContain(
      "flowOwnedLane"
    );

    await expect(inspectWorkflowRunRecovery(statePath)).resolves.toMatchObject({
      classification: "terminal",
      action: "do-not-replay",
      run: {
        status: "failed",
        terminalState: "failed"
      }
    });
  });

  it("returns the existing terminal run when the idempotency key matches", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    const statePath = await createTempStatePath();

    const first = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "manual-idempotent"
      }
    });
    const second = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "manual-idempotent"
      }
    });

    expect(second).toEqual(first);
    expect(second.run.trigger.idempotencyKey).toEqual({
      source: "input",
      key: "manual-idempotent"
    });
  });

  it("fails closed when repeated execution changes the idempotency key", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    const statePath = await createTempStatePath();

    await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "manual-original"
      }
    });

    await expect(
      runWorkflow({
        definition,
        statePath,
        triggerContext: {
          requestId: "manual-drifted"
        }
      })
    ).rejects.toThrow("existing workflow run state has a different idempotency key");
  });
});

const createClock = (timestamps: string[]): (() => string) => {
  let index = 0;

  return () => timestamps[Math.min(index++, timestamps.length - 1)];
};
