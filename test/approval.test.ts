import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  inspectWorkflowRunRecovery,
  readWorkflowRunState,
  runWorkflow
} from "../src/index.js";
import type {
  ExecutorConnectorStatusSnapshot,
  WorkflowDefinition
} from "../src/index.js";

const tempRoots: string[] = [];

const createTempPath = async (prefix: string, relativePath: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return join(root, relativePath);
};

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("approval recovery model", () => {
  it("keeps approval-required steps human-controlled instead of retrying automatically", async () => {
    const definition = createApprovalWorkflowDefinition();
    const statePath = await createTempPath("ensen-flow-approval-", "runs/approval.jsonl");
    const auditPath = await createTempPath("ensen-flow-approval-audit-", "audit/approval.jsonl");
    const calls: number[] = [];

    const result = await runWorkflow({
      definition,
      statePath,
      auditPath,
      triggerContext: {
        requestId: "approval-required"
      },
      now: createClock([
        "2026-05-03T01:00:00.000Z",
        "2026-05-03T01:00:01.000Z",
        "2026-05-03T01:00:02.000Z",
        "2026-05-03T01:00:03.000Z"
      ]),
      stepHandler: ({ attempt }) => {
        calls.push(attempt);
        return {
          requestId: "req_approval_required",
          status: "approval-required",
          observedAt: "2026-05-03T01:00:02.000Z",
          result: {
            status: "blocked",
            summary: "Human approval is required before retry or dispatch."
          }
        } satisfies ExecutorConnectorStatusSnapshot;
      }
    });

    expect(calls).toEqual([1]);
    expect(result.run.status).toBe("running");
    expect(result.stepAttempts["operator-approval"]).toMatchObject([
      {
        attempt: 1,
        status: "approval-required",
        retry: {
          retryable: false,
          reason: "Human approval is required before retry or dispatch."
        },
        recovery: {
          state: "approval-required",
          decision: "await-human-approval",
          reason: "Human approval is required before retry or dispatch."
        }
      }
    ]);

    await expect(inspectWorkflowRunRecovery(statePath)).resolves.toMatchObject({
      classification: "approval-required",
      action: "operator-review-required",
      diagnostic:
        "workflow run has approval-required step attempts; human approval is required before retry, re-run, abandon, or manual repair"
    });

    const auditJsonl = await readFile(auditPath, "utf8");
    expect(auditJsonl).toContain("\"step.failed\"");
    expect(auditJsonl).toContain("\"status\":\"approval-required\"");
    expect(auditJsonl).not.toContain("step.retry.scheduled");

    const persisted = await readWorkflowRunState(statePath);
    expect(persisted.events.map((event) => event.type)).toEqual([
      "run.created",
      "step.attempt.started",
      "step.attempt.failed"
    ]);

    const stateBeforeRerun = await readFile(statePath, "utf8");
    await expect(
      runWorkflow({
        definition,
        statePath,
        auditPath,
        triggerContext: {
          requestId: "approval-required"
        },
        stepHandler: () => undefined
      })
    ).rejects.toThrow(
      "existing workflow run state has approval-required step operator-approval#1; human approval is required before recovery"
    );
    await expect(readFile(statePath, "utf8")).resolves.toBe(stateBeforeRerun);
  });

  it("rejects changed replay input before adding recovery or audit records", async () => {
    const definition = createApprovalWorkflowDefinition();
    const statePath = await createTempPath("ensen-flow-approval-", "runs/approval.jsonl");
    const auditPath = await createTempPath("ensen-flow-approval-audit-", "audit/approval.jsonl");

    await runWorkflow({
      definition,
      statePath,
      auditPath,
      triggerContext: {
        requestId: "approval-original"
      },
      stepHandler: () => undefined
    });
    const stateBeforeReplay = await readFile(statePath, "utf8");
    const auditBeforeReplay = await readFile(auditPath, "utf8");

    await expect(
      runWorkflow({
        definition,
        statePath,
        auditPath,
        triggerContext: {
          requestId: "approval-drifted"
        },
        stepHandler: () => undefined
      })
    ).rejects.toThrow("existing workflow run state has a different idempotency key");

    await expect(readFile(statePath, "utf8")).resolves.toBe(stateBeforeReplay);
    await expect(readFile(auditPath, "utf8")).resolves.toBe(auditBeforeReplay);
  });

  it.each([
    {
      executorStatus: "blocked",
      expectedAttemptStatus: "blocked",
      expectedRunStatus: "failed",
      expectedClassification: "terminal",
      expectedDecision: "block-run",
      expectedAuditStatus: "blocked",
      summary: "Required approval prerequisite is blocked."
    },
    {
      executorStatus: "needs-review",
      expectedAttemptStatus: "manual-repair-needed",
      expectedRunStatus: "running",
      expectedClassification: "manual-repair-needed",
      expectedDecision: "manual-repair-needed",
      expectedAuditStatus: "manual-repair-needed",
      summary: "Approval state requires manual repair before replay."
    }
  ] as const)(
    "records $expectedAttemptStatus recovery without automatic retry",
    async ({
      executorStatus,
      expectedAttemptStatus,
      expectedRunStatus,
      expectedClassification,
      expectedDecision,
      expectedAuditStatus,
      summary
    }) => {
      const definition = createApprovalWorkflowDefinition();
      const statePath = await createTempPath("ensen-flow-approval-", `runs/${executorStatus}.jsonl`);
      const auditPath = await createTempPath(
        "ensen-flow-approval-audit-",
        `audit/${executorStatus}.jsonl`
      );
      const calls: number[] = [];

      const result = await runWorkflow({
        definition,
        statePath,
        auditPath,
        triggerContext: {
          requestId: `approval-${executorStatus}`
        },
        now: createClock([
          "2026-05-03T01:10:00.000Z",
          "2026-05-03T01:10:01.000Z",
          "2026-05-03T01:10:02.000Z",
          "2026-05-03T01:10:03.000Z"
        ]),
        stepHandler: ({ attempt }) => {
          calls.push(attempt);
          return {
            requestId: `req_${executorStatus.replace("-", "_")}`,
            status: executorStatus,
            observedAt: "2026-05-03T01:10:02.000Z",
            result: {
              status: "blocked",
              summary
            }
          } satisfies ExecutorConnectorStatusSnapshot;
        }
      });

      expect(calls).toEqual([1]);
      expect(result.run.status).toBe(expectedRunStatus);
      expect(result.stepAttempts["operator-approval"]).toMatchObject([
        {
          attempt: 1,
          status: expectedAttemptStatus,
          retry: {
            retryable: false,
            reason: summary
          },
          recovery: {
            state: expectedAttemptStatus,
            decision: expectedDecision,
            reason: summary
          }
        }
      ]);
      await expect(inspectWorkflowRunRecovery(statePath)).resolves.toMatchObject({
        classification: expectedClassification
      });

      const auditJsonl = await readFile(auditPath, "utf8");
      expect(auditJsonl).toContain(`"status":"${expectedAuditStatus}"`);
      expect(auditJsonl).not.toContain("step.retry.scheduled");
    }
  );
});

const createApprovalWorkflowDefinition = (): WorkflowDefinition => ({
  schemaVersion: "flow.workflow.v1",
  id: "approval-recovery-demo",
  trigger: {
    type: "manual",
    idempotencyKey: {
      source: "input",
      field: "requestId",
      required: true
    }
  },
  steps: [
    {
      id: "operator-approval",
      action: {
        type: "approval",
        name: "operator_approval"
      },
      retry: {
        maxAttempts: 3,
        backoff: {
          strategy: "fixed",
          delayMs: 1000
        }
      }
    }
  ]
});

const createClock = (timestamps: string[]): (() => string) => {
  let index = 0;

  return () => timestamps[Math.min(index++, timestamps.length - 1)];
};
