import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { runCli } from "../src/cli.js";
import {
  createControlledPilotInputFingerprint,
  createFakeHttpNotificationTransport,
  readWorkflowRunState,
  runSelectedControlledPilot
} from "../src/index.js";
import type {
  ControlledPilotInputPackage,
  FakeHttpNotificationTransport,
  HttpNotificationOutcome,
  HttpNotificationTransport
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

const createRawWebhookInputFingerprint = (
  webhook: ControlledPilotInputPackage["webhook"]
): string => createHash("sha256").update(stableStringify(webhook)).digest("hex");

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

  it("runs the approved pilot through the repeatable CLI fake transport path", async () => {
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (message?: unknown): void => {
      logs.push(String(message));
    };

    try {
      await expect(
        runCli([
          "run-controlled-pilot",
          "fixtures/controlled-pilot/webhook-review-notification.dry-run.json",
          stateRoot,
          auditPath
        ])
      ).resolves.toBe(0);
    } finally {
      console.log = originalLog;
    }

    const output = JSON.parse(logs.join("\n")) as Record<string, unknown>;
    expect(output).toMatchObject({
      pilotId: "webhook-review-notification",
      mode: "dry-run",
      workflowId: "controlled-pilot-webhook-review-notification",
      status: "succeeded",
      terminalState: "succeeded",
      stateRoot,
      auditPath
    });

    const runId = output.runId;
    if (typeof runId !== "string") {
      throw new Error("CLI output runId must be a string");
    }
    const state = await readWorkflowRunState(join(stateRoot, `${runId}.jsonl`));
    expect(state.run.status).toBe("succeeded");
    await expect(readAuditEvents(auditPath)).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "workflow.completed",
          outcome: { status: "succeeded" }
        })
      ])
    );
  });

  it("binds approval to the normalized webhook input fingerprint", async () => {
    const inputPackage = createPilotPackage();
    inputPackage.webhook.headers = {
      "Content-Type": "application/json"
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

    expect(result.run.status).toBe("succeeded");
    expect(transport.deliveries).toHaveLength(1);
    expect(result.run.trigger.context?.webhook).toMatchObject({
      headers: {
        "content-type": "application/json"
      },
      inputFingerprint: inputPackage.approval!.inputFingerprint
    });
  });

  it("rejects real notification transports for the selected dry-run pilot", async () => {
    const inputPackage = createPilotPackage();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    let deliveries = 0;
    const realTransport: HttpNotificationTransport = {
      inputBoundary: {
        mode: "real",
        dryRunFirstEvidence: {
          mode: "dry-run",
          reference: "docs/connector-capability-matrix.md"
        },
        override: {
          approvedBy: "pilot-owner",
          approvedAt: "2026-05-30T00:00:00.000Z",
          reason: "Synthetic override is not valid for the selected dry-run pilot."
        }
      },
      deliver() {
        deliveries += 1;
        return {
          status: "succeeded",
          summary: "real transport accepted notification"
        };
      }
    };

    await expect(
      runSelectedControlledPilot({
        inputPackage,
        stateRoot,
        auditPath,
        notificationTransport: realTransport
      })
    ).rejects.toThrow(
      "selected controlled pilot notification transport must declare a fake, local, or dry-run input boundary"
    );

    expect(deliveries).toBe(0);
    await expect(readFile(auditPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects approval bound to a raw webhook fingerprint before notification", async () => {
    const inputPackage = createPilotPackage();
    inputPackage.webhook.headers = {
      "Content-Type": "application/json"
    };
    inputPackage.approval!.inputFingerprint = createRawWebhookInputFingerprint(
      inputPackage.webhook
    );
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const transport = createFakeHttpNotificationTransport();

    await expect(
      runSelectedControlledPilot({
        inputPackage,
        stateRoot,
        auditPath,
        notificationTransport: transport
      })
    ).rejects.toThrow("controlled pilot approval inputFingerprint must match the webhook input");

    expect(transport.deliveries).toHaveLength(0);
  });

  it("rejects unsafe approval checkpoint IDs before notification", async () => {
    const inputPackage = createPilotPackage();
    inputPackage.approval!.checkpointId = ["tok", "en: placeholder"].join("");
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
    expect(result.stepAttempts["human-approval"][0]).toMatchObject({
      status: "failed",
      retry: {
        retryable: false,
        reason:
          "step handler approvalCheckpoint is invalid: audit event approval.checkpointId must not contain unsafe workflow artifact values (category: token)"
      }
    });
    expect(result.stepAttempts["human-approval"][0]?.result).toBeUndefined();
    expect(transport.deliveries).toHaveLength(0);
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

  it("does not resume an approval-required pilot run while approval is still missing", async () => {
    const inputPackage = createPilotPackage();
    delete inputPackage.approval;
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const transport = createFakeHttpNotificationTransport();

    const pending = await runSelectedControlledPilot({
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

    await expect(
      runSelectedControlledPilot({
        inputPackage,
        stateRoot,
        auditPath,
        notificationTransport: transport
      })
    ).rejects.toThrow(
      "existing workflow run state has approval-required step human-approval#1; human approval is required before recovery"
    );

    expect(pending.run.status).toBe("running");
    await expect(readFile(statePath, "utf8")).resolves.toBe(stateBeforeReplay);
    await expect(readFile(auditPath, "utf8")).resolves.toBe(auditBeforeReplay);
    expect(transport.deliveries).toHaveLength(0);
  });

  it("rejects resumed approval when the inputRef changed", async () => {
    const pendingPackage = createPilotPackage();
    delete pendingPackage.approval;
    const approvedPackage = createPilotPackage();
    approvedPackage.inputRef = "fixtures/controlled-pilot/webhook-review-notification.alt.json";
    approvedPackage.approval!.inputRef = approvedPackage.inputRef;
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const transport = createFakeHttpNotificationTransport();

    const pending = await runSelectedControlledPilot({
      inputPackage: pendingPackage,
      stateRoot,
      auditPath,
      notificationTransport: transport
    });
    const expectedRunId = createExpectedWebhookRunId(
      "controlled-pilot-webhook-review-notification",
      pendingPackage.webhook.requestId
    );
    const statePath = join(stateRoot, `${expectedRunId}.jsonl`);
    const stateBeforeReplay = await readFile(statePath, "utf8");
    const auditBeforeReplay = await readFile(auditPath, "utf8");

    await expect(
      runSelectedControlledPilot({
        inputPackage: approvedPackage,
        stateRoot,
        auditPath,
        notificationTransport: transport
      })
    ).rejects.toThrow("controlled pilot inputRef must match the pending approval run");

    expect(pending.run.status).toBe("running");
    await expect(readFile(statePath, "utf8")).resolves.toBe(stateBeforeReplay);
    await expect(readFile(auditPath, "utf8")).resolves.toBe(auditBeforeReplay);
    expect(transport.deliveries).toHaveLength(0);
  });

  it("rejects resumed approval when the notification package changed", async () => {
    const pendingPackage = createPilotPackage();
    delete pendingPackage.approval;
    const changedPackage = createPilotPackage();
    changedPackage.notification = {
      ...changedPackage.notification,
      payload: {
        ...changedPackage.notification.payload,
        message: "Synthetic dry-run notification updated after approval request."
      }
    };
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const transport = createFakeHttpNotificationTransport();

    const pending = await runSelectedControlledPilot({
      inputPackage: pendingPackage,
      stateRoot,
      auditPath,
      notificationTransport: transport
    });
    const expectedRunId = createExpectedWebhookRunId(
      "controlled-pilot-webhook-review-notification",
      pendingPackage.webhook.requestId
    );
    const statePath = join(stateRoot, `${expectedRunId}.jsonl`);
    const stateBeforeReplay = await readFile(statePath, "utf8");
    const auditBeforeReplay = await readFile(auditPath, "utf8");

    await expect(
      runSelectedControlledPilot({
        inputPackage: changedPackage,
        stateRoot,
        auditPath,
        notificationTransport: transport
      })
    ).rejects.toThrow("controlled pilot notification package must match the pending approval run");

    expect(pending.run.status).toBe("running");
    await expect(readFile(statePath, "utf8")).resolves.toBe(stateBeforeReplay);
    await expect(readFile(auditPath, "utf8")).resolves.toBe(auditBeforeReplay);
    expect(transport.deliveries).toHaveLength(0);
  });

  it("rejects invalid notification targets before recording pending approval", async () => {
    const inputPackage = createPilotPackage();
    delete inputPackage.approval;
    inputPackage.notification.endpointAlias = "https://example.invalid/operator";
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const transport = createFakeHttpNotificationTransport();
    const expectedRunId = createExpectedWebhookRunId(
      "controlled-pilot-webhook-review-notification",
      inputPackage.webhook.requestId
    );
    const statePath = join(stateRoot, `${expectedRunId}.jsonl`);

    await expect(
      runSelectedControlledPilot({
        inputPackage,
        stateRoot,
        auditPath,
        notificationTransport: transport
      })
    ).rejects.toThrow(
      "HTTP notification endpointAlias must be a stable local alias, not a URL or secret"
    );

    await expect(readFile(statePath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(auditPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(transport.deliveries).toHaveLength(0);
  });

  it("resumes the approval checkpoint after approval is supplied for the same dry-run input", async () => {
    const pendingPackage = createPilotPackage();
    delete pendingPackage.approval;
    const approvedPackage = createPilotPackage();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const transport = createFakeHttpNotificationTransport();

    const pending = await runSelectedControlledPilot({
      inputPackage: pendingPackage,
      stateRoot,
      auditPath,
      notificationTransport: transport
    });

    expect(pending.run.status).toBe("running");
    expect(transport.deliveries).toHaveLength(0);

    const approved = await runSelectedControlledPilot({
      inputPackage: approvedPackage,
      stateRoot,
      auditPath,
      notificationTransport: transport
    });

    expect(approved.run.status).toBe("succeeded");
    expect(transport.deliveries).toHaveLength(1);
    expect(approved.stepAttempts["human-approval"]).toMatchObject([
      {
        attempt: 1,
        status: "approval-required"
      },
      {
        attempt: 2,
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
    expect(new Set(auditEvents.map((event) => event.id)).size).toBe(auditEvents.length);
    expect(auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "step.failed",
          step: { id: "human-approval", attempt: 1 },
          approval: expect.objectContaining({ state: "approval-required" })
        }),
        expect.objectContaining({
          type: "step.completed",
          step: { id: "human-approval", attempt: 2 },
          approval: expect.objectContaining({
            state: "approved",
            decidedBy: "pilot-owner"
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

  it("does not retry non-retryable notification failures", async () => {
    const inputPackage = createPilotPackage();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const transport = createFakeHttpNotificationTransport({
      outcomes: [
        {
          status: "failed",
          summary: "local fake endpoint rejected notification permanently",
          retryable: false
        }
      ]
    });

    const result = await runSelectedControlledPilot({
      inputPackage,
      stateRoot,
      auditPath,
      notificationTransport: transport
    });

    expect(result.run.status).toBe("failed");
    expect(transport.deliveries).toHaveLength(1);
    expect(result.stepAttempts["notify-operator"]).toMatchObject([
      {
        attempt: 1,
        status: "failed",
        retry: {
          retryable: false,
          reason: "local fake endpoint rejected notification permanently"
        }
      }
    ]);
  });

  it("fails closed when the dry-run transport returns malformed output", async () => {
    const inputPackage = createPilotPackage();
    const root = await createTempRoot();
    const stateRoot = join(root, "runs");
    const auditPath = join(root, "audit", "pilot.audit.jsonl");
    const transport = createFakeHttpNotificationTransport({
      outcomes: [
        {
          status: "accepted",
          summary: "malformed dry-run transport status"
        } as unknown as HttpNotificationOutcome
      ]
    });

    const result = await runSelectedControlledPilot({
      inputPackage,
      stateRoot,
      auditPath,
      notificationTransport: transport
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["notify-operator"]).toMatchObject([
      {
        attempt: 1,
        status: "failed",
        retry: {
          retryable: false,
          reason: "HTTP notification transport outcome status must be succeeded or failed"
        }
      }
    ]);
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

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  return `{${entries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`)
    .join(",")}}`;
};
