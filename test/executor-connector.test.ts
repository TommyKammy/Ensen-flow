import { describe, expect, it } from "vitest";

import {
  createExecutorConnectorCapabilities,
  createUnsupportedExecutorConnectorOperationResult,
  mapExecutorPolicyDecisionToFlowControlState
} from "../src/index.js";
import type {
  ExecutorConnector,
  ExecutorConnectorStatusSnapshot,
  ExecutorSubmitRequest
} from "../src/index.js";

describe("executor connector abstraction", () => {
  const submitRequest: ExecutorSubmitRequest = {
    workflow: { id: "executor-demo", version: "flow.workflow.v1" },
    run: { id: "executor-demo-run" },
    step: { id: "bounded-executor-step", attempt: 1 },
    input: { subject: "demo" },
    idempotencyKey: "executor-demo-run:bounded-executor-step:1"
  };

  it("supports submit, status, cancel, and fetchEvidence through the connector capability model", async () => {
    const connector: ExecutorConnector = {
      identity: { id: "bounded-executor", displayName: "Bounded Executor" },
      capabilities: createExecutorConnectorCapabilities(),
      submit(request) {
        return {
          ok: true,
          connectorId: "bounded-executor",
          operation: "submit",
          value: {
            requestId: `exec-${request.run.id}`,
            acceptedAt: "2026-04-30T04:00:00.000Z",
            flowControl: mapExecutorPolicyDecisionToFlowControlState({
              decision: "allow",
              decidedAt: "2026-04-30T04:00:00.000Z",
              source: { type: "policy", id: "local-policy" }
            })
          }
        };
      },
      status(request) {
        return {
          ok: true,
          connectorId: "bounded-executor",
          operation: "status",
          value: {
            requestId: request.requestId,
            status: "succeeded",
            observedAt: "2026-04-30T04:00:01.000Z",
            result: {
              status: "succeeded",
              summary: "executor completed bounded work"
            }
          }
        };
      },
      cancel(request) {
        return {
          ok: true,
          connectorId: "bounded-executor",
          operation: "cancel",
          value: {
            requestId: request.requestId,
            cancelled: true,
            observedAt: "2026-04-30T04:00:02.000Z"
          }
        };
      },
      fetchEvidence(request) {
        return {
          ok: true,
          connectorId: "bounded-executor",
          operation: "fetchEvidence",
          value: {
            requestId: request.requestId,
            evidence: {
              kind: "local-jsonl",
              uri: "file://<executor-evidence-path>"
            }
          }
        };
      }
    };

    expect(connector.capabilities).toEqual({
      submit: { supported: true },
      status: { supported: true },
      cancel: { supported: true },
      fetchEvidence: { supported: true }
    });

    const submitted = await connector.submit(submitRequest);
    expect(submitted).toMatchObject({
      ok: true,
      operation: "submit",
      value: {
        requestId: "exec-executor-demo-run",
        flowControl: {
          state: "ready",
          authority: "ensen-flow"
        }
      }
    });

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    const status = await connector.status({ requestId: submitted.value.requestId });
    expect(status).toMatchObject({
      ok: true,
      operation: "status",
      value: {
        requestId: "exec-executor-demo-run",
        status: "succeeded",
        result: { status: "succeeded" }
      }
    });

    const cancel = await connector.cancel({ requestId: submitted.value.requestId });
    expect(cancel).toMatchObject({
      ok: true,
      operation: "cancel",
      value: {
        requestId: "exec-executor-demo-run",
        cancelled: true
      }
    });

    const evidence = await connector.fetchEvidence({ requestId: submitted.value.requestId });
    expect(evidence).toMatchObject({
      ok: true,
      operation: "fetchEvidence",
      value: {
        requestId: "exec-executor-demo-run",
        evidence: {
          kind: "local-jsonl"
        }
      }
    });
  });

  it("carries approval-required and blocked policy decisions as flow-owned control state", () => {
    expect(
      mapExecutorPolicyDecisionToFlowControlState({
        decision: "approval-required",
        reason: "human approval is required before dispatch",
        source: { type: "policy", id: "approval-policy" }
      })
    ).toEqual({
      state: "approval-required",
      authority: "ensen-flow",
      reason: "human approval is required before dispatch",
      policyDecision: {
        decision: "approval-required",
        reason: "human approval is required before dispatch",
        source: { type: "policy", id: "approval-policy" }
      }
    });

    expect(
      mapExecutorPolicyDecisionToFlowControlState({
        decision: "blocked",
        reason: "executor scope is not authorized",
        source: { type: "policy", id: "scope-policy" }
      })
    ).toMatchObject({
      state: "blocked",
      authority: "ensen-flow",
      reason: "executor scope is not authorized"
    });
  });

  it("keeps unsupported executor operations fail-closed and auditable", () => {
    const result = createUnsupportedExecutorConnectorOperationResult({
      connectorId: "submit-only-executor",
      operation: "fetchEvidence",
      reason: "connector does not expose durable evidence"
    });

    expect(result).toEqual({
      ok: false,
      connectorId: "submit-only-executor",
      operation: "fetchEvidence",
      error: {
        code: "unsupported-operation",
        message:
          "connector submit-only-executor does not support fetchEvidence: connector does not expose durable evidence",
        retryable: false,
        reason: "connector does not expose durable evidence"
      }
    });
  });

  it("represents needs-review without treating the executor status as terminal success", () => {
    const snapshot: ExecutorConnectorStatusSnapshot = {
      requestId: "exec-review",
      status: "needs-review",
      observedAt: "2026-04-30T04:00:03.000Z",
      flowControl: {
        state: "needs-review",
        authority: "ensen-flow",
        reason: "executor returned ambiguous evidence"
      }
    };

    expect(snapshot.status).toBe("needs-review");
    expect(snapshot.flowControl?.state).toBe("needs-review");
  });
});
