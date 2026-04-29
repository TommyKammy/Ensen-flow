import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import { readWorkflowRunState, runWorkflow } from "../src/index.js";
import type { WorkflowDefinition } from "../src/index.js";

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

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("sequential workflow runner", () => {
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

  it("records retryable failures and retries according to the step policy", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    const statePath = await createTempStatePath();
    let calls = 0;

    const result = await runWorkflow({
      definition,
      statePath,
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
  });

  it("records failed steps with diagnostic retry metadata", async () => {
    const definition = readWorkflowFixture("simple-manual.valid.json");
    const statePath = await createTempStatePath();

    const result = await runWorkflow({
      definition,
      statePath,
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
