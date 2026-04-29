import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  appendWorkflowRunEvent,
  createWorkflowRun,
  readWorkflowRunState
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
