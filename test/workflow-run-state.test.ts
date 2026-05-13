import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendWorkflowRunEvent,
  createWorkflowRun,
  inspectWorkflowRunRecovery,
  readWorkflowRunState,
  stopWorkflowRunRecovery
} from "../src/index.js";

const tempRoots: string[] = [];

const createTempStatePath = async () => {
  const root = await mkdtemp(join(tmpdir(), "ensen-flow-run-state-"));
  tempRoots.push(root);
  const statePath = join(root, "runs", "manual-run.jsonl");
  await mkdir(join(root, "runs"), { recursive: true });
  return statePath;
};

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("workflow run JSONL state", () => {
  it("classifies an existing terminal run as recovery-terminal without replaying work", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-terminal-001",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });

    await appendWorkflowRunEvent(statePath, {
      type: "run.completed",
      runId: "run-terminal-001",
      terminalState: "succeeded",
      occurredAt: "2026-04-29T00:00:02.000Z"
    });

    const contentsBeforeRecovery = await readFile(statePath, "utf8");

    await expect(inspectWorkflowRunRecovery(statePath)).resolves.toMatchObject({
      classification: "terminal",
      action: "do-not-replay",
      historyPreserved: true,
      run: {
        runId: "run-terminal-001",
        workflowId: "operator-review",
        status: "succeeded",
        terminalState: "succeeded"
      },
      eventCount: 2
    });
    await expect(readFile(statePath, "utf8")).resolves.toBe(contentsBeforeRecovery);
  });

  it("classifies corrupt JSONL as fail-closed recovery-corrupt with a sanitized diagnostic", async () => {
    const statePath = await createTempStatePath();
    await writeFile(
      statePath,
      [
        JSON.stringify({
          type: "run.created",
          runId: "run-corrupt-001",
          workflowId: "operator-review",
          workflowVersion: "flow.workflow.v1",
          trigger: { type: "manual", receivedAt: "2026-04-29T00:00:00.000Z" },
          occurredAt: "2026-04-29T00:00:01.000Z"
        }),
        "{not-json"
      ].join("\n"),
      "utf8"
    );

    const report = await inspectWorkflowRunRecovery(statePath);

    expect(report).toMatchObject({
      classification: "corrupt",
      action: "repair-jsonl-before-recovery",
      historyPreserved: true
    });
    expect(report.diagnostic).toContain("workflow run state line 2: invalid JSON");
    expect(report.diagnostic).not.toContain(tmpdir());
  });

  it("classifies active step attempts as manual-repair-needed before recovery", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-active-001",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });

    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "run-active-001",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z"
    });

    await expect(inspectWorkflowRunRecovery(statePath)).resolves.toMatchObject({
      classification: "manual-repair-needed",
      action: "operator-review-required",
      historyPreserved: true,
      run: {
        runId: "run-active-001",
        status: "running"
      },
      activeStepAttempts: [
        {
          stepId: "collect-input",
          attempt: 1,
          status: "running",
          startedAt: "2026-04-29T00:00:02.000Z"
        }
      ]
    });
  });

  it("safely stops a non-terminal JSONL run by appending canceled without deleting history", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-stop-001",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "run-stop-001",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z"
    });
    const contentsBeforeStop = await readFile(statePath, "utf8");

    const report = await stopWorkflowRunRecovery({
      statePath,
      runId: "run-stop-001",
      stoppedAt: "2026-04-29T00:00:03.000Z"
    });

    expect(report).toMatchObject({
      classification: "terminal",
      action: "do-not-replay",
      historyPreserved: true,
      run: {
        runId: "run-stop-001",
        status: "canceled",
        terminalState: "canceled"
      },
      eventCount: 3
    });
    await expect(readFile(statePath, "utf8")).resolves.toBe(
      `${contentsBeforeStop}${JSON.stringify({
        type: "run.completed",
        runId: "run-stop-001",
        terminalState: "canceled",
        occurredAt: "2026-04-29T00:00:03.000Z"
      })}\n`
    );
  });

  it("returns an already-terminal blocked recovery report without appending completion", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-stop-blocked-001",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "run-stop-blocked-001",
      stepId: "approval-gate",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.failed",
      runId: "run-stop-blocked-001",
      stepId: "approval-gate",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:03.000Z",
      retry: {
        retryable: false,
        reason: "Required approval prerequisite is blocked."
      },
      recovery: {
        state: "blocked",
        decision: "block-run",
        reason: "Required approval prerequisite is blocked."
      }
    });
    await appendWorkflowRunEvent(statePath, {
      type: "run.completed",
      runId: "run-stop-blocked-001",
      terminalState: "failed",
      occurredAt: "2026-04-29T00:00:04.000Z",
      recovery: {
        state: "blocked",
        decision: "block-run",
        reason: "Required approval prerequisite is blocked."
      }
    });
    const contentsBeforeStop = await readFile(statePath, "utf8");

    const report = await stopWorkflowRunRecovery({
      statePath,
      runId: "run-stop-blocked-001",
      stoppedAt: "2026-04-29T00:00:05.000Z"
    });

    expect(report).toMatchObject({
      classification: "blocked",
      action: "operator-review-required",
      historyPreserved: true,
      run: {
        runId: "run-stop-blocked-001",
        status: "failed",
        terminalState: "failed"
      },
      eventCount: 4
    });
    await expect(readFile(statePath, "utf8")).resolves.toBe(contentsBeforeStop);
  });

  it("classifies failed non-terminal step attempts as manual-repair-needed", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-failed-open-001",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "run-failed-open-001",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.failed",
      runId: "run-failed-open-001",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:03.000Z",
      retry: {
        retryable: false,
        reason: "manual input rejected"
      }
    });

    await expect(inspectWorkflowRunRecovery(statePath)).resolves.toMatchObject({
      classification: "manual-repair-needed",
      action: "operator-review-required",
      historyPreserved: true,
      run: {
        runId: "run-failed-open-001",
        status: "running"
      },
      eventCount: 3
    });
  });

  it("classifies non-terminal state without active attempts as recoverable", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-recoverable-001",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });

    await expect(inspectWorkflowRunRecovery(statePath)).resolves.toMatchObject({
      classification: "recoverable",
      action: "resume-from-projected-state",
      historyPreserved: true,
      run: {
        runId: "run-recoverable-001",
        status: "created"
      },
      eventCount: 1
    });
  });

  it("persists and reads workflow run events in append order", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-001",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z",
        context: {
          operator: "local-test",
          source: "unit-test",
          payload: {
            retryable: true,
            labels: ["review", null, 2]
          }
        },
        idempotencyKey: {
          source: "input",
          key: "ticket-123"
        }
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });

    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "run-001",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z"
    });

    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.completed",
      runId: "run-001",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:03.000Z"
    });

    await appendWorkflowRunEvent(statePath, {
      type: "run.completed",
      runId: "run-001",
      terminalState: "succeeded",
      occurredAt: "2026-04-29T00:00:04.000Z"
    });

    const state = await readWorkflowRunState(statePath);

    expect(state.run).toMatchObject({
      runId: "run-001",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      status: "succeeded",
      terminalState: "succeeded"
    });
    expect(state.run.trigger).toEqual({
      type: "manual",
      receivedAt: "2026-04-29T00:00:00.000Z",
      context: {
        operator: "local-test",
        source: "unit-test",
        payload: {
          retryable: true,
          labels: ["review", null, 2]
        }
      },
      idempotencyKey: {
        source: "input",
        key: "ticket-123"
      }
    });
    expect(state.events.map((event) => event.type)).toEqual([
      "run.created",
      "step.attempt.started",
      "step.attempt.completed",
      "run.completed"
    ]);
    expect(state.stepAttempts).toEqual({
      "collect-input": [
        {
          attempt: 1,
          startedAt: "2026-04-29T00:00:02.000Z",
          completedAt: "2026-04-29T00:00:03.000Z",
          retry: undefined,
          status: "succeeded"
        }
      ]
    });
  });

  it("fails closed on malformed JSONL records", async () => {
    const statePath = await createTempStatePath();
    await writeFile(
      statePath,
      [
        JSON.stringify({
          type: "run.created",
          runId: "run-001",
          workflowId: "operator-review",
          workflowVersion: "flow.workflow.v1",
          trigger: { type: "manual", receivedAt: "2026-04-29T00:00:00.000Z" },
          occurredAt: "2026-04-29T00:00:01.000Z"
        }),
        JSON.stringify({
          type: "run.completed",
          runId: "run-001",
          terminalState: "unknown",
          occurredAt: "2026-04-29T00:00:02.000Z"
        })
      ].join("\n"),
      "utf8"
    );

    await expect(readWorkflowRunState(statePath)).rejects.toThrow(
      "workflow run state line 2: terminalState must be succeeded, failed, canceled, or retryable-failed"
    );
  });

  it.each([
    { context: { dropped: undefined }, message: "trigger.context.dropped must contain only JSON-serializable values" },
    { context: { fn: () => undefined }, message: "trigger.context.fn must contain only JSON-serializable values" },
    { context: { marker: Symbol("bad") }, message: "trigger.context.marker must contain only JSON-serializable values" },
    { context: { count: 1n }, message: "trigger.context.count must contain only JSON-serializable values" },
    { context: { value: Number.NaN }, message: "trigger.context.value must contain only finite numbers" },
    { context: { received: new Date("2026-04-29T00:00:00.000Z") }, message: "trigger.context.received must contain only JSON-serializable values" }
  ])("rejects non-JSON trigger context values before writing %#", async ({ context, message }) => {
    const statePath = await createTempStatePath();

    await expect(
      createWorkflowRun(statePath, {
        runId: "run-001",
        workflowId: "operator-review",
        workflowVersion: "flow.workflow.v1",
        trigger: {
          type: "manual",
          receivedAt: "2026-04-29T00:00:00.000Z",
          context
        },
        createdAt: "2026-04-29T00:00:01.000Z"
      })
    ).rejects.toThrow(`workflow run state line 1: ${message}`);

    await expect(readFile(statePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects circular trigger context values before writing", async () => {
    const statePath = await createTempStatePath();
    const context: Record<string, unknown> = {};
    context.self = context;

    await expect(
      createWorkflowRun(statePath, {
        runId: "run-001",
        workflowId: "operator-review",
        workflowVersion: "flow.workflow.v1",
        trigger: {
          type: "manual",
          receivedAt: "2026-04-29T00:00:00.000Z",
          context
        },
        createdAt: "2026-04-29T00:00:01.000Z"
      })
    ).rejects.toThrow(
      "workflow run state line 1: trigger.context.self must not contain circular references"
    );

    await expect(readFile(statePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each([
    {
      context: { authorization: "Bearer ghp_placeholderUnsafeToken123" },
      message:
        "trigger.context.authorization must not contain unsafe workflow artifact values (category: token)"
    },
    {
      context: { evidencePath: ["", "home", "operator", "flow", "state.jsonl"].join("/") },
      message:
        "trigger.context.evidencePath must not contain unsafe workflow artifact values (category: workstation-local-path)"
    },
    {
      context: { evidencePath: ["", "tmp", "flow", "state.jsonl"].join("/") },
      message:
        "trigger.context.evidencePath must not contain unsafe workflow artifact values (category: workstation-local-path)"
    },
    {
      context: { evidencePath: ["", "var", "log", "flow.log"].join("/") },
      message:
        "trigger.context.evidencePath must not contain unsafe workflow artifact values (category: workstation-local-path)"
    },
    {
      context: { evidenceUri: ["file:", "", "", "Users", "operator", "flow", "state.jsonl"].join("/") },
      message:
        "trigger.context.evidenceUri must not contain unsafe workflow artifact values (category: workstation-local-path)"
    },
    {
      context: { evidenceUri: ["file:", "", "", "home", "operator", "flow", "state.jsonl"].join("/") },
      message:
        "trigger.context.evidenceUri must not contain unsafe workflow artifact values (category: workstation-local-path)"
    },
    {
      context: {
        evidenceUri: ["file:", "", "", "C:", "Users", "operator", "flow", "state.jsonl"].join("/")
      },
      message:
        "trigger.context.evidenceUri must not contain unsafe workflow artifact values (category: workstation-local-path)"
    }
  ])(
    "rejects unsafe trigger context artifact values before writing %#",
    async ({ context, message }) => {
      const statePath = await createTempStatePath();

      await expect(
        createWorkflowRun(statePath, {
          runId: "run-unsafe-trigger-context",
          workflowId: "operator-review",
          workflowVersion: "flow.workflow.v1",
          trigger: {
            type: "manual",
            receivedAt: "2026-04-29T00:00:00.000Z",
            context
          },
          createdAt: "2026-04-29T00:00:01.000Z"
        })
      ).rejects.toThrow(`workflow run state line 1: ${message}`);

      await expect(readFile(statePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }
  );

  it.each([
    {
      context: { connectorConfig: { apiKey: "placeholder-api-key-value" } },
      message:
        "trigger.context.connectorConfig.apiKey must not contain unsafe workflow artifact values (category: credential)"
    },
    {
      context: { connectorConfig: { accessToken: "placeholder-token-value" } },
      message:
        "trigger.context.connectorConfig.accessToken must not contain unsafe workflow artifact values (category: credential)"
    },
    {
      context: { connectorConfig: { bearerToken: "placeholder-token-value" } },
      message:
        "trigger.context.connectorConfig.bearerToken must not contain unsafe workflow artifact values (category: credential)"
    },
    {
      context: { intake: { patientId: "patient-12345" } },
      message:
        "trigger.context.intake.patientId must not contain unsafe workflow artifact values (category: regulated-content)"
    },
    {
      context: { intake: { customerEmail: "private-customer@example.invalid" } },
      message:
        "trigger.context.intake.customerEmail must not contain unsafe workflow artifact values (category: customer-identifier)"
    },
    {
      context: { serialized: JSON.stringify({ customerEmail: "private-customer@example.invalid" }) },
      message:
        "trigger.context.serialized.customerEmail must not contain unsafe workflow artifact values (category: customer-identifier)"
    }
  ])(
    "rejects credential and regulated-shaped trigger fields without echoing values %#",
    async ({ context, message }) => {
      const statePath = await createTempStatePath();

      await expect(
        createWorkflowRun(statePath, {
          runId: "run-unsafe-trigger-field",
          workflowId: "operator-review",
          workflowVersion: "flow.workflow.v1",
          trigger: {
            type: "manual",
            receivedAt: "2026-04-29T00:00:00.000Z",
            context
          },
          createdAt: "2026-04-29T00:00:01.000Z"
        })
      ).rejects.toThrow(`workflow run state line 1: ${message}`);

      await expect(readFile(statePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    }
  );

  it.each([
    { context: { connectorConfig: { apiKey: {} } } },
    { context: { connectorConfig: { credentials: {} } } },
    { context: { intake: { patientId: {} } } },
    { context: { intake: { customerEmail: {} } } }
  ])("allows empty object placeholders for sensitive trigger fields %#", async ({ context }) => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-empty-sensitive-placeholder",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z",
        context
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });

    const state = await readWorkflowRunState(statePath);

    expect(state.run.trigger.context).toEqual(context);
  });

  it.each(["succeeded", "failed", "canceled", "retryable-failed"] as const)(
    "represents %s as a distinct terminal state",
    async (terminalState) => {
      const statePath = await createTempStatePath();

      await createWorkflowRun(statePath, {
        runId: `run-${terminalState}`,
        workflowId: "operator-review",
        workflowVersion: "flow.workflow.v1",
        trigger: {
          type: "manual",
          receivedAt: "2026-04-29T00:00:00.000Z"
        },
        createdAt: "2026-04-29T00:00:01.000Z"
      });

      await appendWorkflowRunEvent(statePath, {
        type: "run.completed",
        runId: `run-${terminalState}`,
        terminalState,
        occurredAt: "2026-04-29T00:00:02.000Z"
      });

      const state = await readWorkflowRunState(statePath);

      expect(state.run.status).toBe(terminalState);
      expect(state.run.terminalState).toBe(terminalState);
    }
  );

  it("retains retry metadata on failed step attempts", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-retry-001",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });

    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "run-retry-001",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:01.500Z"
    });

    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.failed",
      runId: "run-retry-001",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z",
      retry: {
        retryable: true,
        nextAttemptAt: "2026-04-29T00:00:12.000Z",
        reason: "temporary unavailable dependency"
      }
    });

    const state = await readWorkflowRunState(statePath);

    expect(state.stepAttempts["collect-input"]).toEqual([
      {
        attempt: 1,
        startedAt: "2026-04-29T00:00:01.500Z",
        failedAt: "2026-04-29T00:00:02.000Z",
        retry: {
          retryable: true,
          nextAttemptAt: "2026-04-29T00:00:12.000Z",
          reason: "temporary unavailable dependency"
        },
        status: "retryable-failed"
      }
    ]);
  });

  it("allows the next attempt after a retryable failed attempt", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-retry-002",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });

    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "run-retry-002",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:01.500Z"
    });

    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.failed",
      runId: "run-retry-002",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z",
      retry: {
        retryable: true,
        nextAttemptAt: "2026-04-29T00:00:12.000Z"
      }
    });

    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "run-retry-002",
      stepId: "collect-input",
      attempt: 2,
      occurredAt: "2026-04-29T00:00:12.000Z"
    });

    const state = await readWorkflowRunState(statePath);

    expect(state.stepAttempts["collect-input"]).toMatchObject([
      { attempt: 1, status: "retryable-failed" },
      { attempt: 2, status: "running" }
    ]);
  });

  it.each([
    {
      event: {
        type: "step.attempt.completed" as const,
        occurredAt: "2026-04-29T00:00:02.000Z"
      },
      expectedStatus: "succeeded"
    },
    {
      event: {
        type: "step.attempt.failed" as const,
        occurredAt: "2026-04-29T00:00:02.000Z",
        retry: { retryable: false }
      },
      expectedStatus: "failed"
    }
  ])(
    "fails closed when a new attempt follows a $expectedStatus attempt",
    async ({ event, expectedStatus }) => {
      const statePath = await createTempStatePath();

      await createWorkflowRun(statePath, {
        runId: "run-retry-003",
        workflowId: "operator-review",
        workflowVersion: "flow.workflow.v1",
        trigger: {
          type: "manual",
          receivedAt: "2026-04-29T00:00:00.000Z"
        },
        createdAt: "2026-04-29T00:00:01.000Z"
      });

      await appendWorkflowRunEvent(statePath, {
        type: "step.attempt.started",
        runId: "run-retry-003",
        stepId: "collect-input",
        attempt: 1,
        occurredAt: "2026-04-29T00:00:01.500Z"
      });

      await appendWorkflowRunEvent(statePath, {
        ...event,
        runId: "run-retry-003",
        stepId: "collect-input",
        attempt: 1
      });

      const contentsBeforeRejectedAppend = await readFile(statePath, "utf8");

      await expect(
        appendWorkflowRunEvent(statePath, {
          type: "step.attempt.started",
          runId: "run-retry-003",
          stepId: "collect-input",
          attempt: 2,
          occurredAt: "2026-04-29T00:00:03.000Z"
        })
      ).rejects.toThrow(
        `workflow run state line 4: workflow step attempt collect-input#2: step.attempt.started cannot follow ${expectedStatus}`
      );
      await expect(readFile(statePath, "utf8")).resolves.toBe(contentsBeforeRejectedAppend);
    }
  );

  it("rejects appending events before the run is created", async () => {
    const statePath = await createTempStatePath();

    await expect(
      appendWorkflowRunEvent(statePath, {
        type: "step.attempt.started",
        runId: "run-001",
        stepId: "collect-input",
        attempt: 1,
        occurredAt: "2026-04-29T00:00:02.000Z"
      })
    ).rejects.toThrow(
      "appendWorkflowRunEvent requires an existing workflow run state file; call createWorkflowRun before appendWorkflowRunEvent"
    );
  });

  it("rejects appending events for a different run without modifying state", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-001",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });

    const contentsBeforeAppend = await readFile(statePath, "utf8");

    await expect(
      appendWorkflowRunEvent(statePath, {
        type: "step.attempt.started",
        runId: "run-002",
        stepId: "collect-input",
        attempt: 1,
        occurredAt: "2026-04-29T00:00:02.000Z"
      })
    ).rejects.toThrow("appendWorkflowRunEvent event.runId must match the existing workflow run");

    await expect(readFile(statePath, "utf8")).resolves.toBe(contentsBeforeAppend);
    await expect(readWorkflowRunState(statePath)).resolves.toMatchObject({
      events: [{ runId: "run-001", type: "run.created" }]
    });
  });

  it("rejects appending events after run completion without modifying state", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-001",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });

    await appendWorkflowRunEvent(statePath, {
      type: "run.completed",
      runId: "run-001",
      terminalState: "succeeded",
      occurredAt: "2026-04-29T00:00:02.000Z"
    });

    const contentsBeforeAppend = await readFile(statePath, "utf8");

    await expect(
      appendWorkflowRunEvent(statePath, {
        type: "step.attempt.started",
        runId: "run-001",
        stepId: "collect-input",
        attempt: 1,
        occurredAt: "2026-04-29T00:00:03.000Z"
      })
    ).rejects.toThrow("appendWorkflowRunEvent cannot append to a completed workflow run");

    await expect(readFile(statePath, "utf8")).resolves.toBe(contentsBeforeAppend);
    await expect(readWorkflowRunState(statePath)).resolves.toMatchObject({
      run: {
        runId: "run-001",
        status: "succeeded",
        terminalState: "succeeded"
      }
    });
  });

  it("serializes concurrent terminal appends for the same state file", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-001",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });

    const results = await Promise.allSettled([
      appendWorkflowRunEvent(statePath, {
        type: "run.completed",
        runId: "run-001",
        terminalState: "succeeded",
        occurredAt: "2026-04-29T00:00:02.000Z"
      }),
      appendWorkflowRunEvent(statePath, {
        type: "run.completed",
        runId: "run-001",
        terminalState: "failed",
        occurredAt: "2026-04-29T00:00:03.000Z"
      })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rejected = results.filter((result) => result.status === "rejected");
    expect(rejected).toHaveLength(1);
    expect(rejected[0]).toMatchObject({
      reason: expect.objectContaining({
        message: "appendWorkflowRunEvent cannot append to a completed workflow run"
      })
    });

    const lines = (await readFile(statePath, "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(2);

    const state = await readWorkflowRunState(statePath);
    expect(["succeeded", "failed"]).toContain(state.run.terminalState);
    expect(state.events.map((event) => event.type)).toEqual(["run.created", "run.completed"]);
  });

  it("fails closed when records appear after run completion", async () => {
    const statePath = await createTempStatePath();
    await writeFile(
      statePath,
      [
        JSON.stringify({
          type: "run.created",
          runId: "run-001",
          workflowId: "operator-review",
          workflowVersion: "flow.workflow.v1",
          trigger: { type: "manual", receivedAt: "2026-04-29T00:00:00.000Z" },
          occurredAt: "2026-04-29T00:00:01.000Z"
        }),
        JSON.stringify({
          type: "run.completed",
          runId: "run-001",
          terminalState: "succeeded",
          occurredAt: "2026-04-29T00:00:02.000Z"
        }),
        JSON.stringify({
          type: "step.attempt.started",
          runId: "run-001",
          stepId: "collect-input",
          attempt: 1,
          occurredAt: "2026-04-29T00:00:03.000Z"
        })
      ].join("\n"),
      "utf8"
    );

    await expect(readWorkflowRunState(statePath)).rejects.toThrow(
      "workflow run state line 3: no records are allowed after run.completed"
    );
  });

  it("fails closed on out-of-order step attempt transitions", async () => {
    const statePath = await createTempStatePath();
    await writeFile(
      statePath,
      [
        JSON.stringify({
          type: "run.created",
          runId: "run-001",
          workflowId: "operator-review",
          workflowVersion: "flow.workflow.v1",
          trigger: { type: "manual", receivedAt: "2026-04-29T00:00:00.000Z" },
          occurredAt: "2026-04-29T00:00:01.000Z"
        }),
        JSON.stringify({
          type: "step.attempt.completed",
          runId: "run-001",
          stepId: "collect-input",
          attempt: 1,
          occurredAt: "2026-04-29T00:00:02.000Z"
        })
      ].join("\n"),
      "utf8"
    );

    await expect(readWorkflowRunState(statePath)).rejects.toThrow(
      "workflow run state line 2: workflow step attempt collect-input#1: step.attempt.completed requires step.attempt.started first"
    );
  });

  it("rejects result metadata on started step attempts before appending", async () => {
    const statePath = await createTempStatePath();

    await createWorkflowRun(statePath, {
      runId: "run-started-result",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });

    await expect(
      appendWorkflowRunEvent(statePath, {
        type: "step.attempt.started",
        runId: "run-started-result",
        stepId: "collect-input",
        attempt: 1,
        occurredAt: "2026-04-29T00:00:02.000Z",
        result: { ignored: true }
      })
    ).rejects.toThrow(
      "workflow run state line 1: result is only allowed on terminal step attempt events"
    );

    const persisted = await readWorkflowRunState(statePath);
    expect(persisted.events.map((event) => event.type)).toEqual(["run.created"]);
  });

  it("rejects unsafe terminal result artifact values before appending", async () => {
    const statePath = await createTempStatePath();
    const privateKeyBlock = [
      "-----BEGIN PRIVATE KEY-----",
      "placeholderUnsafeKey",
      "-----END PRIVATE KEY-----"
    ].join("\n");

    await createWorkflowRun(statePath, {
      runId: "run-unsafe-result",
      workflowId: "operator-review",
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-04-29T00:00:00.000Z"
      },
      createdAt: "2026-04-29T00:00:01.000Z"
    });
    await appendWorkflowRunEvent(statePath, {
      type: "step.attempt.started",
      runId: "run-unsafe-result",
      stepId: "collect-input",
      attempt: 1,
      occurredAt: "2026-04-29T00:00:02.000Z"
    });

    await expect(
      appendWorkflowRunEvent(statePath, {
        type: "step.attempt.completed",
        runId: "run-unsafe-result",
        stepId: "collect-input",
        attempt: 1,
        occurredAt: "2026-04-29T00:00:03.000Z",
        result: {
          evidence: {
            keyMaterial: privateKeyBlock
          }
        }
      })
    ).rejects.toThrow(
      "workflow run state line 1: result.evidence.keyMaterial must not contain unsafe workflow artifact values (category: private-key)"
    );

    const persisted = await readWorkflowRunState(statePath);
    expect(persisted.events.map((event) => event.type)).toEqual([
      "run.created",
      "step.attempt.started"
    ]);
    expect(JSON.stringify(persisted)).not.toContain("placeholderUnsafeKey");
  });

  it("fails closed on duplicate terminal step attempt transitions", async () => {
    const statePath = await createTempStatePath();
    await writeFile(
      statePath,
      [
        JSON.stringify({
          type: "run.created",
          runId: "run-001",
          workflowId: "operator-review",
          workflowVersion: "flow.workflow.v1",
          trigger: { type: "manual", receivedAt: "2026-04-29T00:00:00.000Z" },
          occurredAt: "2026-04-29T00:00:01.000Z"
        }),
        JSON.stringify({
          type: "step.attempt.started",
          runId: "run-001",
          stepId: "collect-input",
          attempt: 1,
          occurredAt: "2026-04-29T00:00:02.000Z"
        }),
        JSON.stringify({
          type: "step.attempt.completed",
          runId: "run-001",
          stepId: "collect-input",
          attempt: 1,
          occurredAt: "2026-04-29T00:00:03.000Z"
        }),
        JSON.stringify({
          type: "step.attempt.failed",
          runId: "run-001",
          stepId: "collect-input",
          attempt: 1,
          occurredAt: "2026-04-29T00:00:04.000Z"
        })
      ].join("\n"),
      "utf8"
    );

    await expect(readWorkflowRunState(statePath)).rejects.toThrow(
      "workflow run state line 4: workflow step attempt collect-input#1: step.attempt.failed cannot follow succeeded"
    );
  });

  it("fails closed when starting a new attempt before the active attempt finishes", async () => {
    const statePath = await createTempStatePath();
    await writeFile(
      statePath,
      [
        JSON.stringify({
          type: "run.created",
          runId: "run-001",
          workflowId: "operator-review",
          workflowVersion: "flow.workflow.v1",
          trigger: { type: "manual", receivedAt: "2026-04-29T00:00:00.000Z" },
          occurredAt: "2026-04-29T00:00:01.000Z"
        }),
        JSON.stringify({
          type: "step.attempt.started",
          runId: "run-001",
          stepId: "collect-input",
          attempt: 1,
          occurredAt: "2026-04-29T00:00:02.000Z"
        }),
        JSON.stringify({
          type: "step.attempt.started",
          runId: "run-001",
          stepId: "collect-input",
          attempt: 2,
          occurredAt: "2026-04-29T00:00:03.000Z"
        })
      ].join("\n"),
      "utf8"
    );

    await expect(readWorkflowRunState(statePath)).rejects.toThrow(
      "workflow run state line 3: workflow step attempt collect-input#2: step.attempt.started cannot follow running attempt collect-input#1"
    );
  });

  it("fails closed when step attempt numbers skip ahead", async () => {
    const statePath = await createTempStatePath();
    await writeFile(
      statePath,
      [
        JSON.stringify({
          type: "run.created",
          runId: "run-001",
          workflowId: "operator-review",
          workflowVersion: "flow.workflow.v1",
          trigger: { type: "manual", receivedAt: "2026-04-29T00:00:00.000Z" },
          occurredAt: "2026-04-29T00:00:01.000Z"
        }),
        JSON.stringify({
          type: "step.attempt.started",
          runId: "run-001",
          stepId: "collect-input",
          attempt: 1,
          occurredAt: "2026-04-29T00:00:02.000Z"
        }),
        JSON.stringify({
          type: "step.attempt.failed",
          runId: "run-001",
          stepId: "collect-input",
          attempt: 1,
          occurredAt: "2026-04-29T00:00:03.000Z",
          retry: {
            retryable: true,
            nextAttemptAt: "2026-04-29T00:00:13.000Z"
          }
        }),
        JSON.stringify({
          type: "step.attempt.started",
          runId: "run-001",
          stepId: "collect-input",
          attempt: 3,
          occurredAt: "2026-04-29T00:00:14.000Z"
        })
      ].join("\n"),
      "utf8"
    );

    await expect(readWorkflowRunState(statePath)).rejects.toThrow(
      "workflow run state line 4: workflow step attempt collect-input#3: attempt numbers must increase by 1"
    );
  });

  it("rejects non-ISO timestamp strings", async () => {
    const statePath = await createTempStatePath();
    await writeFile(
      statePath,
      JSON.stringify({
        type: "run.created",
        runId: "run-001",
        workflowId: "operator-review",
        workflowVersion: "flow.workflow.v1",
        trigger: { type: "manual", receivedAt: "Jan 15, 2024" },
        occurredAt: "2026-04-29T00:00:01.000Z"
      }),
      "utf8"
    );

    await expect(readWorkflowRunState(statePath)).rejects.toThrow(
      "workflow run state line 1: receivedAt must be an ISO timestamp string"
    );
  });
});
