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
  HttpNotificationOutcome,
  HttpNotificationSubmitRequest,
  HttpNotificationTransportDelivery,
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
      headers: {
        "x-flow-fixture": "local-notification"
      },
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
      headers: {
        "x-flow-fixture": "local-notification"
      },
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

  it("serializes concurrent same-key submits before transport delivery completes", async () => {
    const deliveries: HttpNotificationTransportDelivery[] = [];
    const delivery = createDeferred<HttpNotificationOutcome>();
    const connector = createHttpNotificationConnector({
      transport: {
        deliver(request) {
          deliveries.push(request);
          return delivery.promise;
        }
      },
      now: () => "2026-05-02T03:00:00.000Z"
    });

    const first = connector.submit(notifyRequest);
    const replay = connector.submit(notifyRequest);

    await Promise.resolve();
    expect(deliveries).toHaveLength(1);

    delivery.resolve({
      status: "succeeded",
      summary: "local fake notification accepted"
    });

    await expect(first).resolves.toMatchObject({ ok: true });
    await expect(replay).resolves.toMatchObject({ ok: true });
    await expect(first).resolves.toEqual(await replay);
    expect(deliveries).toHaveLength(1);
  });

  it("preinstalls the in-flight reservation before synchronously re-entrant delivery callbacks", async () => {
    const deliveries: HttpNotificationTransportDelivery[] = [];
    let reentrant: Promise<unknown> | undefined;
    let connector: ReturnType<typeof createHttpNotificationConnector>;

    connector = createHttpNotificationConnector({
      transport: {
        deliver(request) {
          deliveries.push(request);
          reentrant = connector.submit(notifyRequest);

          return {
            status: "succeeded",
            summary: "local fake notification accepted"
          };
        }
      },
      now: () => "2026-05-02T03:00:00.000Z"
    });

    const first = connector.submit(notifyRequest);
    const firstResult = await first;

    expect(firstResult).toMatchObject({ ok: true });
    expect(reentrant).toBeDefined();
    await expect(reentrant).resolves.toEqual(firstResult);
    expect(deliveries).toHaveLength(1);
  });

  it("fails closed for concurrent same-key submits with a changed fingerprint", async () => {
    const deliveries: HttpNotificationTransportDelivery[] = [];
    const delivery = createDeferred<HttpNotificationOutcome>();
    const connector = createHttpNotificationConnector({
      transport: {
        deliver(request) {
          deliveries.push(request);
          return delivery.promise;
        }
      },
      now: () => "2026-05-02T03:00:00.000Z"
    });

    const first = connector.submit(notifyRequest);
    const changed = await connector.submit({
      ...notifyRequest,
      notification: {
        ...notifyRequest.notification,
        endpointAlias: "local-operator-escalation"
      }
    });

    expect(changed).toMatchObject({
      ok: false,
      operation: "submit",
      error: {
        code: "invalid-request",
        retryable: false,
        message:
          "HTTP notification idempotencyKey reuse must keep workflowId/runId/stepId/endpointAlias/method/headers/payload unchanged"
      }
    });
    expect(deliveries).toHaveLength(1);

    delivery.resolve({
      status: "succeeded",
      summary: "local fake notification accepted"
    });

    await expect(first).resolves.toMatchObject({ ok: true });
    expect(deliveries).toHaveLength(1);
  });

  it("rejects idempotency replay when the request shape changes", async () => {
    const transport = createFakeHttpNotificationTransport();
    const connector = createHttpNotificationConnector({ transport });

    await expect(connector.submit(notifyRequest)).resolves.toMatchObject({
      ok: true
    });
    await expect(
      connector.submit({
        ...notifyRequest,
        notification: {
          ...notifyRequest.notification,
          endpointAlias: "local-operator-escalation"
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      operation: "submit",
      error: {
        code: "invalid-request",
        retryable: false,
        message:
          "HTTP notification idempotencyKey reuse must keep workflowId/runId/stepId/endpointAlias/method/headers/payload unchanged"
      }
    });
    expect(transport.deliveries).toHaveLength(1);
  });

  it("keeps canonical evidence fields separate from transport evidence", async () => {
    const connector = createHttpNotificationConnector({
      transport: createFakeHttpNotificationTransport({
        outcomes: [
          {
            status: "succeeded",
            evidence: {
              kind: "untrusted-kind",
              endpointAlias: "untrusted-endpoint",
              attempt: 999,
              idempotencyKey: "untrusted-key",
              localStatus: "accepted"
            }
          }
        ]
      })
    });

    await expect(connector.submit(notifyRequest)).resolves.toMatchObject({
      ok: true,
      value: {
        evidence: {
          kind: "http-notification-local",
          endpointAlias: "local-operator-notification",
          attempt: 1,
          idempotencyKey: "notification-demo-run:notify-operator:attempt-1",
          transport: {
            kind: "untrusted-kind",
            endpointAlias: "untrusted-endpoint",
            attempt: 999,
            idempotencyKey: "untrusted-key",
            localStatus: "accepted"
          }
        }
      }
    });
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

  it("does not store a successful replay receipt for failed delivery", async () => {
    const transport = createFakeHttpNotificationTransport({
      outcomes: [
        {
          status: "failed",
          summary: "local fake endpoint rejected notification",
          retryable: false
        },
        {
          status: "succeeded",
          summary: "local fake notification accepted on retry"
        }
      ]
    });
    const connector = createHttpNotificationConnector({
      transport,
      now: createClock(["2026-05-02T03:00:00.000Z"])
    });

    await expect(connector.submit(notifyRequest)).resolves.toMatchObject({
      ok: false,
      error: {
        code: "execution-failed",
        message: "local fake endpoint rejected notification"
      }
    });
    await expect(connector.submit(notifyRequest)).resolves.toMatchObject({
      ok: true,
      value: {
        notification: {
          summary: "local fake notification accepted on retry"
        }
      }
    });
    expect(transport.deliveries).toHaveLength(2);
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

  it("rejects invalid retry attempt values", async () => {
    const connector = createHttpNotificationConnector({
      transport: createFakeHttpNotificationTransport()
    });

    await expect(connector.submit({ ...notifyRequest, attempt: 0 })).resolves.toMatchObject({
      ok: false,
      operation: "submit",
      error: {
        code: "invalid-request",
        retryable: false,
        message: "HTTP notification attempt must be a positive integer"
      }
    });
    await expect(connector.submit({ ...notifyRequest, attempt: 1.5 })).resolves.toMatchObject({
      ok: false,
      operation: "submit",
      error: {
        code: "invalid-request",
        retryable: false,
        message: "HTTP notification attempt must be a positive integer"
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

const createDeferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} => {
  let resolve: (value: T) => void = () => undefined;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });

  return { promise, resolve };
};
