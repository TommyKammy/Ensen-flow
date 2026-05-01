import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createFakeHttpNotificationTransport,
  createHttpNotificationConnector,
  readWorkflowRunState,
  runWorkflow
} from "../src/index.js";
import type {
  HttpNotificationSubmitRequest,
  WorkflowDefinition
} from "../src/index.js";

describe("HTTP notification connector skeleton", () => {
  const notifyRequest: HttpNotificationSubmitRequest = {
    workflowId: "notification-demo",
    runId: "notification-demo-run",
    stepId: "notify-operator",
    idempotencyKey: "notification-demo-run:notify-operator:attempt-1",
    notification: {
      endpointAlias: "local-operator-notification",
      method: "POST",
      payload: {
        subject: "placeholder-subject",
        outcome: "ready"
      }
    }
  };

  it("submits a local fake HTTP notification without exposing a real endpoint", async () => {
    const transport = createFakeHttpNotificationTransport({
      outcomes: [
        {
          status: "succeeded",
          summary: "local fake notification accepted"
        }
      ]
    });
    const connector = createHttpNotificationConnector({
      transport,
      now: () => "2026-05-02T03:00:00.000Z"
    });

    expect(connector.capabilities).toEqual({
      notify: { supported: true },
      submit: { supported: true },
      status: {
        supported: false,
        reason: "HTTP notification skeleton records local submit outcomes only"
      },
      cancel: {
        supported: false,
        reason: "HTTP notification skeleton does not support cancellation"
      },
      fetchEvidence: {
        supported: false,
        reason: "HTTP notification skeleton does not fetch external evidence"
      }
    });

    const submitted = await connector.submit(notifyRequest);

    expect(submitted).toMatchObject({
      ok: true,
      connectorId: "http-notification",
      operation: "submit",
      value: {
        requestId: "http-notification-notification-demo-run-notify-operator-attempt-1",
        acceptedAt: "2026-05-02T03:00:00.000Z",
        notification: {
          status: "succeeded",
          endpointAlias: "local-operator-notification",
          attempt: 1,
          idempotencyKey: "notification-demo-run:notify-operator:attempt-1",
          summary: "local fake notification accepted"
        },
        evidence: {
          kind: "http-notification-local",
          endpointAlias: "local-operator-notification"
        }
      }
    });
    expect(JSON.stringify(submitted)).not.toContain("https://");
    expect(transport.deliveries).toHaveLength(1);
    expect(transport.deliveries[0]).toMatchObject({
      endpointAlias: "local-operator-notification",
      idempotencyKey: "notification-demo-run:notify-operator:attempt-1"
    });
  });

  it("replays the same idempotency key without duplicating fake delivery", async () => {
    const transport = createFakeHttpNotificationTransport();
    const connector = createHttpNotificationConnector({ transport });

    const first = await connector.submit(notifyRequest);
    const replay = await connector.submit(notifyRequest);

    expect(first).toEqual(replay);
    expect(transport.deliveries).toHaveLength(1);
  });

  it("returns terminal and retryable fake notification failures explicitly", async () => {
    const terminalConnector = createHttpNotificationConnector({
      transport: createFakeHttpNotificationTransport({
        outcomes: [
          {
            status: "failed",
            summary: "local fake endpoint rejected notification",
            retryable: false
          }
        ]
      })
    });
    const retryableConnector = createHttpNotificationConnector({
      transport: createFakeHttpNotificationTransport({
        outcomes: [
          {
            status: "failed",
            summary: "local fake endpoint is temporarily unavailable",
            retryable: true
          }
        ]
      })
    });

    await expect(terminalConnector.submit(notifyRequest)).resolves.toMatchObject({
      ok: false,
      operation: "submit",
      error: {
        code: "execution-failed",
        retryable: false,
        message: "local fake endpoint rejected notification"
      }
    });
    await expect(retryableConnector.submit(notifyRequest)).resolves.toMatchObject({
      ok: false,
      operation: "submit",
      error: {
        code: "execution-failed",
        retryable: true,
        message: "local fake endpoint is temporarily unavailable"
      }
    });
  });

  it("fails closed for unsupported notification submit capability", async () => {
    const connector = createHttpNotificationConnector({
      transport: createFakeHttpNotificationTransport({
        capabilities: {
          notify: {
            supported: false,
            reason: "real outbound HTTP is not enabled"
          }
        }
      })
    });

    await expect(connector.submit(notifyRequest)).resolves.toMatchObject({
      ok: false,
      connectorId: "http-notification",
      operation: "submit",
      error: {
        code: "unsupported-operation",
        retryable: false,
        reason: "real outbound HTTP is not enabled"
      }
    });
  });

  it("records retryable notification attempts in run state and neutral audit output", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-http-notification-"));
    const statePath = join(tempRoot, "runs", "http-notification.jsonl");
    const auditPath = join(tempRoot, "audit", "http-notification.jsonl");
    const transport = createFakeHttpNotificationTransport({
      outcomes: [
        {
          status: "failed",
          summary: "local fake endpoint is temporarily unavailable",
          retryable: true
        },
        {
          status: "succeeded",
          summary: "local fake notification accepted on retry"
        }
      ]
    });
    const connector = createHttpNotificationConnector({
      transport,
      now: createClock([
        "2026-05-02T03:10:00.000Z",
        "2026-05-02T03:10:02.000Z"
      ])
    });

    try {
      await runWorkflow({
        definition: notificationWorkflow,
        statePath,
        auditPath,
        runId: "notification-demo-run",
        now: createClock([
          "2026-05-02T03:09:58.000Z",
          "2026-05-02T03:09:58.000Z",
          "2026-05-02T03:09:59.000Z",
          "2026-05-02T03:10:01.000Z",
          "2026-05-02T03:10:01.000Z",
          "2026-05-02T03:10:03.000Z",
          "2026-05-02T03:10:04.000Z"
        ]),
        stepHandler: async ({ attempt, runState, step }) => {
          const submitted = await connector.submit({
            workflowId: runState.run.workflowId,
            runId: runState.run.runId,
            stepId: step.id,
            idempotencyKey: `${runState.run.runId}:${step.id}`,
            attempt,
            notification: {
              endpointAlias: "local-operator-notification",
              method: "POST",
              payload: {
                subject: "placeholder-subject"
              }
            }
          });

          if (!submitted.ok) {
            throw new Error(submitted.error.message);
          }

          return {
            executor: {
              requestId: submitted.value.requestId,
              status: "succeeded",
              observedAt: submitted.value.acceptedAt,
              result: {
                status: "succeeded",
                summary: submitted.value.notification.summary,
                evidence: submitted.value.evidence
              }
            }
          };
        }
      });

      const persisted = await readWorkflowRunState(statePath);
      expect(persisted.run.terminalState).toBe("succeeded");
      expect(persisted.stepAttempts["notify-operator"]).toMatchObject([
        {
          attempt: 1,
          status: "retryable-failed",
          retry: {
            retryable: true,
            reason: "local fake endpoint is temporarily unavailable"
          }
        },
        {
          attempt: 2,
          status: "succeeded",
          result: {
            executor: {
              result: {
                summary: "local fake notification accepted on retry",
                evidence: {
                  endpointAlias: "local-operator-notification"
                }
              }
            }
          }
        }
      ]);
      expect(transport.deliveries).toHaveLength(2);
      expect(transport.deliveries.map((delivery) => delivery.idempotencyKey)).toEqual([
        "notification-demo-run:notify-operator",
        "notification-demo-run:notify-operator"
      ]);

      const auditJsonl = await readFile(auditPath, "utf8");
      expect(auditJsonl).toContain("step.retry.scheduled");
      expect(auditJsonl).toContain("local fake endpoint is temporarily unavailable");
      expect(auditJsonl).not.toContain("https://");
      expect(auditJsonl).not.toContain("secret");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });
});

const notificationWorkflow: WorkflowDefinition = {
  schemaVersion: "flow.workflow.v1",
  id: "notification-demo",
  trigger: {
    type: "manual"
  },
  steps: [
    {
      id: "notify-operator",
      action: {
        type: "notification",
        name: "http_notification",
        with: {
          endpointAlias: "local-operator-notification"
        }
      },
      retry: {
        maxAttempts: 2,
        backoff: {
          strategy: "fixed",
          delayMs: 1000
        }
      },
      idempotencyKey: {
        source: "workflow",
        template: "{run.id}:{step.id}"
      }
    }
  ]
};

const createClock = (timestamps: string[]): (() => string) => {
  let index = 0;

  return () => timestamps[Math.min(index++, timestamps.length - 1)];
};
