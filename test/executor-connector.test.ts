import { describe, expect, it } from "vitest";

import {
  createImmediateOnlyConnectorCapabilities,
  createUnsupportedExecutorConnectorOperationResult,
  mapExecutorPolicyDecisionToFlowControlState
} from "../src/index.js";
import type {
  ExecutorConnectorStatusSnapshot,
  ExecutorSubmitRequest
} from "../src/index.js";
import {
  createFakeExecutorTransport,
  fakeFlowControlForDecision
} from "./support/fake-executor-transport.js";

describe("executor connector abstraction", () => {
  const submitRequest: ExecutorSubmitRequest = {
    workflow: { id: "executor-demo", version: "flow.workflow.v1" },
    run: { id: "executor-demo-run" },
    step: { id: "bounded-executor-step", attempt: 1 },
    input: { subject: "demo" },
    idempotencyKey: "executor-demo-run:bounded-executor-step:1"
  };

  it("supports a fake submit-to-result flow through the connector capability model", async () => {
    const connector = createFakeExecutorTransport({
      connectorId: "bounded-executor",
      statusScript: [
        {
          status: "succeeded",
          observedAt: "2026-04-30T04:00:01.000Z",
          result: {
            status: "succeeded",
            summary: "executor completed bounded work"
          }
        }
      ],
      evidence: {
        kind: "local-jsonl",
        uri: "artifacts/fake-executor/evidence.json"
      }
    });

    expect(connector.capabilities).toEqual({
      submit: { supported: true },
      status: { supported: true },
      cancel: { supported: true },
      fetchEvidence: { supported: true }
    });

    const submitted = await connector.submit({
      ...submitRequest,
      policyDecision: {
        decision: "allow",
        decidedAt: "2026-04-30T04:00:00.000Z",
        source: { type: "policy", id: "local-policy" }
      }
    });
    expect(submitted).toMatchObject({
      ok: true,
      operation: "submit",
      value: {
        requestId: "fake-executor-demo-run-bounded-executor-step-1",
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
        requestId: "fake-executor-demo-run-bounded-executor-step-1",
        status: "succeeded",
        result: { status: "succeeded" }
      }
    });

    const cancel = await connector.cancel({ requestId: submitted.value.requestId });
    expect(cancel).toMatchObject({
      ok: true,
      operation: "cancel",
      value: {
        requestId: "fake-executor-demo-run-bounded-executor-step-1",
        cancelled: true
      }
    });

    const evidence = await connector.fetchEvidence({ requestId: submitted.value.requestId });
    expect(evidence).toMatchObject({
      ok: true,
      operation: "fetchEvidence",
      value: {
        requestId: "fake-executor-demo-run-bounded-executor-step-1",
        evidence: {
          kind: "local-jsonl"
        }
      }
    });
  });

  it("scripts pending and running fake executor status before a terminal result", async () => {
    const connector = createFakeExecutorTransport({
      statusScript: [
        { status: "accepted", observedAt: "2026-04-30T04:00:01.000Z" },
        { status: "running", observedAt: "2026-04-30T04:00:02.000Z" },
        {
          status: "succeeded",
          observedAt: "2026-04-30T04:00:03.000Z",
          result: { status: "succeeded", summary: "fake executor finished" }
        }
      ]
    });

    const submitted = await connector.submit({
      ...submitRequest,
      policyDecision: { decision: "allow" }
    });

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: true,
      value: { status: "accepted" }
    });
    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: true,
      value: { status: "running" }
    });
    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: true,
      value: {
        status: "succeeded",
        result: { status: "succeeded" }
      }
    });
  });

  it("keeps empty fake status scripts well-formed by using the default terminal status", async () => {
    const connector = createFakeExecutorTransport({
      statusScript: []
    });
    const submitted = await connector.submit({
      ...submitRequest,
      policyDecision: { decision: "allow" }
    });

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: true,
      value: {
        requestId: submitted.value.requestId,
        status: "succeeded",
        result: {
          status: "succeeded",
          summary: "fake executor completed bounded work"
        }
      }
    });
  });

  it("maps blocked and needs-review fake outcomes to flow-owned control state", async () => {
    const blocked = createFakeExecutorTransport({
      statusScript: [
        {
          status: "blocked",
          flowControl: fakeFlowControlForDecision({
            decision: "blocked",
            reason: "executor scope is not authorized",
            source: { type: "policy", id: "scope-policy" }
          }),
          result: {
            status: "blocked",
            summary: "executor scope is not authorized"
          }
        }
      ]
    });
    const needsReview = createFakeExecutorTransport({
      statusScript: [
        {
          status: "needs-review",
          flowControl: fakeFlowControlForDecision({
            decision: "needs-review",
            reason: "executor returned ambiguous evidence",
            source: { type: "connector", id: "fake-executor-transport" }
          })
        }
      ]
    });

    const blockedSubmit = await blocked.submit({
      ...submitRequest,
      policyDecision: { decision: "allow" }
    });
    const reviewSubmit = await needsReview.submit({
      ...submitRequest,
      run: { id: "executor-review-run" },
      policyDecision: { decision: "allow" }
    });

    if (!blockedSubmit.ok || !reviewSubmit.ok) {
      throw new Error("submits should succeed");
    }

    expect(await blocked.status({ requestId: blockedSubmit.value.requestId })).toMatchObject({
      ok: true,
      value: {
        status: "blocked",
        flowControl: {
          state: "blocked",
          authority: "ensen-flow",
          reason: "executor scope is not authorized"
        },
        result: { status: "blocked" }
      }
    });
    expect(await needsReview.status({ requestId: reviewSubmit.value.requestId })).toMatchObject({
      ok: true,
      value: {
        status: "needs-review",
        flowControl: {
          state: "needs-review",
          authority: "ensen-flow",
          reason: "executor returned ambiguous evidence"
        }
      }
    });
  });

  it("makes cancellation visible in later fake status reads", async () => {
    const connector = createFakeExecutorTransport({
      statusScript: [{ status: "running" }]
    });
    const submitted = await connector.submit({
      ...submitRequest,
      policyDecision: { decision: "allow" }
    });

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.cancel({ requestId: submitted.value.requestId })).toMatchObject({
      ok: true,
      value: {
        requestId: submitted.value.requestId,
        cancelled: true
      }
    });
    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: true,
      value: {
        status: "cancelled",
        result: { status: "cancelled" }
      }
    });
  });

  it("keeps immediate-only and partial fake executor capabilities fail-closed", async () => {
    const immediateOnly = createFakeExecutorTransport({
      connectorId: "fake-immediate-only",
      capabilities: createImmediateOnlyConnectorCapabilities({
        unsupportedReason: "fake immediate executor has no durable async handle"
      })
    });
    const partial = createFakeExecutorTransport({
      connectorId: "fake-partial-executor",
      capabilities: {
        fetchEvidence: {
          supported: false,
          reason: "fake partial executor does not expose durable evidence"
        }
      }
    });

    expect(await immediateOnly.status({ requestId: "fake-request" })).toMatchObject({
      ok: false,
      operation: "status",
      error: {
        code: "unsupported-operation",
        reason: "fake immediate executor has no durable async handle"
      }
    });

    const submitted = await partial.submit({
      ...submitRequest,
      policyDecision: { decision: "allow" }
    });

    if (!submitted.ok) {
      throw new Error("partial submit should succeed");
    }

    expect(await partial.fetchEvidence({ requestId: submitted.value.requestId })).toMatchObject({
      ok: false,
      operation: "fetchEvidence",
      error: {
        code: "unsupported-operation",
        reason: "fake partial executor does not expose durable evidence"
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
