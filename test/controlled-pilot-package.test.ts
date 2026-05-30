import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createControlledPilotInputFingerprint,
  createFakeHttpNotificationTransport,
  readWorkflowRunState,
  runSelectedControlledPilot
} from "../src/index.js";
import type {
  ControlledPilotInputPackage,
  FakeHttpNotificationTransport
} from "../src/index.js";

const tempRoots: string[] = [];

const readFixture = <T>(...parts: string[]): T =>
  JSON.parse(readFileSync(join(process.cwd(), "fixtures", ...parts), "utf8")) as T;

const createPilotPackage = (): ControlledPilotInputPackage =>
  readFixture("controlled-pilot", "webhook-review-notification.dry-run.json");

const createExpectedWebhookRunId = (workflowId: string, requestId: string): string => {
  const slug =
    requestId
      .toLowerCase()
      .replaceAll(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "request";
  const fingerprint = createHash("sha256").update(requestId).digest("hex").slice(0, 12);
  return `${workflowId}-webhook-${slug}-${fingerprint}`;
};

const createTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ensen-flow-controlled-pilot-"));
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

describe("selected controlled pilot dry-run package", () => {
  it("runs the approved webhook review notification pilot through the dry-run transport", async () => {
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const transport = createFakeHttpNotificationTransport();

    const result = await runSelectedControlledPilot({
      inputPackage: createPilotPackage(),
      stateRoot,
      auditPath,
      notificationTransport: transport,
      now: createClock([
        "2026-05-30T00:00:00.000Z",
        "2026-05-30T00:00:01.000Z",
        "2026-05-30T00:00:02.000Z",
        "2026-05-30T00:00:03.000Z",
        "2026-05-30T00:00:04.000Z",
        "2026-05-30T00:00:05.000Z"
      ])
    });

    expect(result.run.status).toBe("succeeded");
    expect(transport.deliveries).toHaveLength(1);
    expect(result.stepAttempts["human-approval"]).toMatchObject([
      {
        status: "succeeded",
        result: {
          executor: {
            result: {
              output: {
                approvalCheckpoint: {
                  state: "approved",
                  decidedBy: "pilot-owner",
                  inputRef: "fixtures/controlled-pilot/webhook-review-notification.dry-run.json"
                }
              }
            }
          }
        }
      }
    ]);

    const auditEvents = await readAuditEvents(auditPath);
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "step.completed",
          step: { id: "human-approval", attempt: 1 },
          approval: expect.objectContaining({
            state: "approved",
            decidedBy: "pilot-owner",
            inputRef: "fixtures/controlled-pilot/webhook-review-notification.dry-run.json",
            reason: "Approve the synthetic webhook review notification dry-run."
          })
        })
      ])
    );
  });

  it("fails closed before notification when the approval checkpoint is missing", async () => {
    const inputPackage = createPilotPackage();
    delete inputPackage.approval;
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const transport = createFakeHttpNotificationTransport();

    const result = await runSelectedControlledPilot({
      inputPackage,
      stateRoot,
      auditPath,
      notificationTransport: transport
    });

    expect(result.run.status).toBe("running");
    expect(transport.deliveries).toHaveLength(0);
    expect(result.stepAttempts["human-approval"]).toMatchObject([
      {
        status: "approval-required",
        recovery: {
          state: "approval-required",
          decision: "await-human-approval"
        }
      }
    ]);

    const auditEvents = await readAuditEvents(auditPath);
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "step.failed",
          step: { id: "human-approval", attempt: 1 },
          approval: expect.objectContaining({
            state: "approval-required",
            inputRef: "fixtures/controlled-pilot/webhook-review-notification.dry-run.json",
            reason: "human approval checkpoint is required before notification"
          })
        })
      ])
    );
  });

  it("records approval rejection as a blocked checkpoint without notification delivery", async () => {
    const inputPackage = createPilotPackage();
    inputPackage.approval = {
      ...inputPackage.approval!,
      state: "rejected",
      reason: "Reject the synthetic notification dry-run for operator review."
    };
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const transport = createFakeHttpNotificationTransport();

    const result = await runSelectedControlledPilot({
      inputPackage,
      stateRoot,
      auditPath,
      notificationTransport: transport
    });

    expect(result.run.status).toBe("failed");
    expect(transport.deliveries).toHaveLength(0);
    expect(result.stepAttempts["human-approval"][0]).toMatchObject({
      status: "blocked",
      recovery: {
        state: "blocked",
        decision: "block-run",
        reason: "Reject the synthetic notification dry-run for operator review."
      },
      result: {
        executor: {
          result: {
            output: {
              approvalCheckpoint: {
                state: "rejected",
                decidedBy: "pilot-owner"
              }
            }
          }
        }
      }
    });

    const auditEvents = await readAuditEvents(auditPath);
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "step.failed",
          approval: expect.objectContaining({
            state: "rejected",
            decidedBy: "pilot-owner",
            reason: "Reject the synthetic notification dry-run for operator review."
          })
        })
      ])
    );
  });

  it("rejects changed webhook input replay before appending state, audit, or notification records", async () => {
    const inputPackage = createPilotPackage();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const transport = createFakeHttpNotificationTransport();

    const first = await runSelectedControlledPilot({
      inputPackage,
      stateRoot,
      auditPath,
      notificationTransport: transport
    });
    const expectedRunId = createExpectedWebhookRunId(
      "controlled-pilot-webhook-review-notification",
      inputPackage.webhook.requestId
    );
    const statePath = join(stateRoot, `${expectedRunId}.jsonl`);
    const stateBeforeReplay = await readFile(statePath, "utf8");
    const auditBeforeReplay = await readFile(auditPath, "utf8");

    const changedPackage = createPilotPackage();
    changedPackage.webhook.payload = {
      eventType: "local-demo.updated",
      subject: "placeholder-subject"
    };
    changedPackage.approval!.inputFingerprint =
      createControlledPilotInputFingerprint(changedPackage);

    await expect(
      runSelectedControlledPilot({
        inputPackage: changedPackage,
        stateRoot,
        auditPath,
        notificationTransport: transport
      })
    ).rejects.toThrow("webhook requestId reuse must keep normalized input unchanged");

    expect(first.run.runId).toBe(expectedRunId);
    await expect(readFile(statePath, "utf8")).resolves.toBe(stateBeforeReplay);
    await expect(readFile(auditPath, "utf8")).resolves.toBe(auditBeforeReplay);
    expect(await readWorkflowRunState(statePath)).toEqual(first);
    expect((transport as FakeHttpNotificationTransport).deliveries).toHaveLength(1);
  });
});

const createClock = (timestamps: string[]): (() => string) => {
  let index = 0;

  return () => timestamps[Math.min(index++, timestamps.length - 1)];
};
