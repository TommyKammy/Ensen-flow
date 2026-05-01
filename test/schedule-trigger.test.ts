import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  evaluateScheduleTrigger,
  readWorkflowRunState,
  validateWorkflowDefinition
} from "../src/index.js";
import type { WorkflowDefinition } from "../src/index.js";

const tempRoots: string[] = [];

const createScheduleWorkflow = (): WorkflowDefinition => ({
  schemaVersion: "flow.workflow.v1",
  id: "local-schedule-demo",
  trigger: {
    type: "schedule",
    cron: "0 9 * * *",
    idempotencyKey: {
      source: "workflow",
      template: "{workflow.id}:{trigger.type}:{trigger.scheduledFor}"
    }
  },
  steps: [
    {
      id: "scheduled-step",
      action: {
        type: "local",
        name: "scheduled_noop"
      }
    }
  ]
});

const createTempRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), "ensen-flow-schedule-"));
  tempRoots.push(root);
  return root;
};

const readAuditEvents = async (auditPath: string): Promise<Array<Record<string, unknown>>> =>
  (await readFile(auditPath, "utf8"))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as Record<string, unknown>);

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("schedule trigger", () => {
  it("accepts the bounded local schedule trigger shape", () => {
    const result = validateWorkflowDefinition(createScheduleWorkflow());

    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("rejects malformed schedule trigger input", () => {
    const definition = createScheduleWorkflow();
    definition.trigger = {
      type: "schedule",
      cron: "every morning"
    };

    const result = validateWorkflowDefinition(definition);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      {
        path: "trigger.cron",
        message: "schedule cron must use five UTC minute fields with * or numeric values"
      }
    ]);
  });

  it("evaluates a due schedule once and returns the same terminal run on repeat", async () => {
    const definition = createScheduleWorkflow();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "schedule.audit.jsonl");

    const first = await evaluateScheduleTrigger({
      definition,
      stateRoot,
      auditPath,
      scheduledFor: "2026-05-02T09:00:00.000Z",
      now: (() => {
        let index = 0;
        const timestamps = [
          "2026-05-02T09:00:01.000Z",
          "2026-05-02T09:00:02.000Z",
          "2026-05-02T09:00:03.000Z",
          "2026-05-02T09:00:04.000Z"
        ];
        return () => timestamps[index++] ?? "2026-05-02T09:00:05.000Z";
      })()
    });
    const second = await evaluateScheduleTrigger({
      definition,
      stateRoot,
      auditPath,
      scheduledFor: "2026-05-02T09:00:00.000Z"
    });

    if (!("run" in first) || !("run" in second)) {
      throw new Error("schedule should have produced a workflow run");
    }

    expect(second).toEqual(first);
    expect(first.run.runId).toBe("local-schedule-demo-scheduled-20260502T090000000Z");
    expect(first.run.trigger).toEqual({
      type: "schedule",
      receivedAt: "2026-05-02T09:00:01.000Z",
      context: {
        schedule: {
          cron: "0 9 * * *",
          scheduledFor: "2026-05-02T09:00:00.000Z"
        }
      },
      idempotencyKey: {
        source: "workflow",
        key: "local-schedule-demo:schedule:2026-05-02T09:00:00.000Z"
      }
    });

    const persisted = await readWorkflowRunState(
      join(stateRoot, "local-schedule-demo-scheduled-20260502T090000000Z.jsonl")
    );
    expect(persisted.events.map((event) => event.type)).toEqual([
      "run.created",
      "step.attempt.started",
      "step.attempt.completed",
      "run.completed"
    ]);

    const auditEvents = await readAuditEvents(auditPath);
    expect(auditEvents.map((event) => event.type)).toEqual([
      "workflow.started",
      "step.started",
      "step.completed",
      "workflow.completed"
    ]);
    expect(auditEvents[0]).toMatchObject({
      id: "audit.local-schedule-demo-scheduled-20260502T090000000Z.000001",
      run: { id: "local-schedule-demo-scheduled-20260502T090000000Z" }
    });
  });

  it("does not create run state when the schedule is not due", async () => {
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");

    const result = await evaluateScheduleTrigger({
      definition: createScheduleWorkflow(),
      stateRoot,
      scheduledFor: "2026-05-02T09:01:00.000Z"
    });

    expect(result).toEqual({
      status: "not-due",
      reason: "scheduledFor does not match trigger.cron"
    });
    await expect(
      readFile(join(stateRoot, "local-schedule-demo-scheduled-20260502T090100000Z.jsonl"), "utf8")
    ).rejects.toMatchObject({ code: "ENOENT" });
  });
});
