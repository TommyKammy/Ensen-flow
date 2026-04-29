import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
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
          source: "unit-test"
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
        source: "unit-test"
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
});
