import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  createEnsenLoopEipExecutorConnector,
  createFakeEnsenLoopEipExecutorTransport,
  createImmediateOnlyConnectorCapabilities,
  createUnsupportedExecutorConnectorOperationResult,
  mapExecutorPolicyDecisionToFlowControlState
} from "../src/index.js";
import type {
  ExecutorConnectorStatusSnapshot,
  ExecutorSubmitRequest,
  WorkflowDefinition
} from "../src/index.js";
import { readWorkflowRunState, runWorkflow } from "../src/index.js";
import {
  createFakeExecutorTransport,
  fakeFlowControlForDecision
} from "./support/fake-executor-transport.js";

const protocolSnapshotRoot = join(
  process.cwd(),
  "protocol-snapshots",
  "ensen-protocol",
  "v0.2.0"
);

const readProtocolFixture = async (relativePath: string): Promise<unknown> =>
  JSON.parse(await readFile(join(protocolSnapshotRoot, relativePath), "utf8")) as unknown;

const isFixtureRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readFixtureRequestId = (value: unknown): string => {
  if (!isFixtureRecord(value) || typeof value.requestId !== "string") {
    throw new Error("fixture must include requestId");
  }

  return value.requestId;
};

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

describe("Ensen-loop EIP executor connector", () => {
  const submitRequest: ExecutorSubmitRequest = {
    workflow: { id: "loop-eip-demo", version: "flow.workflow.v1" },
    run: { id: "loop-eip-demo-run" },
    step: { id: "loop-executor-step", attempt: 1 },
    input: { issue: 22 },
    idempotencyKey: "loop-eip-demo-run:loop-executor-step:1",
    source: {
      sourceId: "source_ensen_flow",
      sourceType: "manual",
      externalRef: "flow-local"
    },
    requestedBy: {
      actorId: "actor_ensen_flow",
      actorType: "system",
      displayName: "Ensen-flow"
    },
    workItem: {
      workItemId: "workitem_issue_22",
      externalId: "22",
      title: "Implement Ensen-loop executor connector via EIP",
      url: "https://github.com/TommyKammy/Ensen-flow/issues/22"
    },
    mode: "validate",
    target: {
      targetType: "repository",
      targetId: "repo_ensen_flow",
      externalRef: "TommyKammy/Ensen-flow"
    },
    policyContext: {
      policySetId: "policy_phase_1",
      riskClasses: ["external-executor"],
      requiresApproval: false
    }
  };

  it("converts bounded executor requests to EIP RunRequest and consumes terminal RunResult evidence", async () => {
    const submittedPayloads: unknown[] = [];
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          submittedPayloads.push(payload);
          return { requestId: payload.id, acceptedAt: "2026-04-30T04:00:00.000Z" };
        },
        getRunStatusSnapshot() {
          return {
            schemaVersion: "eip.run-status.v1",
            id: "sts_loop_eip_done",
            requestId: "req_loop_eip_demo_run_loop_executor_step_1",
            correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
            status: "completed",
            observedAt: "2026-04-30T04:00:02.000Z",
            message: "Run completed. Retrieve final details from RunResult."
          };
        },
        getRunResult() {
          return {
            schemaVersion: "eip.run-result.v1",
            id: "run_loop_eip_result",
            requestId: "req_loop_eip_demo_run_loop_executor_step_1",
            correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
            status: "succeeded",
            completedAt: "2026-04-30T04:00:03.000Z",
            verification: {
              status: "passed",
              summary: "Run completed and verification passed."
            },
            evidenceBundles: [
              {
                evidenceBundleId: "evb_loop_eip_bundle",
                digest:
                  "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
              }
            ]
          };
        },
        getEvidenceBundleRef() {
          return {
            schemaVersion: "eip.evidence-bundle-ref.v1",
            id: "evb_loop_eip_bundle",
            correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
            type: "local_path",
            uri: "artifacts/evidence/loop-eip-demo-run/bundle.json",
            createdAt: "2026-04-30T04:00:03.000Z",
            contentType: "application/json"
          };
        }
      },
      now: () => "2026-04-30T04:00:00.000Z"
    });

    const submitted = await connector.submit(submitRequest);

    expect(submitted).toMatchObject({
      ok: true,
      operation: "submit",
      value: {
        requestId: "req_loop_eip_demo_run_loop_executor_step_1",
        flowControl: { state: "ready", authority: "ensen-flow" }
      }
    });
    expect(submittedPayloads).toEqual([
      {
        schemaVersion: "eip.run-request.v1",
        id: "req_loop_eip_demo_run_loop_executor_step_1",
        correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
        idempotencyKey: "loop-eip-demo-run:loop-executor-step:1",
        source: submitRequest.source,
        requestedBy: submitRequest.requestedBy,
        workItem: submitRequest.workItem,
        mode: "validate",
        createdAt: "2026-04-30T04:00:00.000Z",
        target: submitRequest.target,
        policyContext: submitRequest.policyContext,
        extensions: {
          "x-ensen-flow": {
            workflowId: "loop-eip-demo",
            workflowVersion: "flow.workflow.v1",
            runId: "loop-eip-demo-run",
            stepId: "loop-executor-step",
            attempt: 1,
            input: { issue: 22 }
          }
        }
      }
    ]);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: true,
      operation: "status",
      value: {
        requestId: "req_loop_eip_demo_run_loop_executor_step_1",
        status: "succeeded",
        result: {
          status: "succeeded",
          summary: "Run completed and verification passed.",
          evidence: {
            evidenceBundles: [
              {
                evidenceBundleId: "evb_loop_eip_bundle"
              }
            ]
          }
        }
      }
    });

    expect(await connector.fetchEvidence({ requestId: submitted.value.requestId })).toMatchObject({
      ok: true,
      operation: "fetchEvidence",
      value: {
        requestId: "req_loop_eip_demo_run_loop_executor_step_1",
        evidence: {
          schemaVersion: "eip.evidence-bundle-ref.v1",
          type: "local_path",
          uri: "artifacts/evidence/loop-eip-demo-run/bundle.json"
        }
      }
    });
  });

  it("drives a workflow step through fake Ensen-loop EIP transport and persists the resulting run state", async () => {
    const transport = createFakeEnsenLoopEipExecutorTransport({
      completedAt: "2026-04-30T04:00:03.000Z",
      verificationSummary: "Fake loop-like execution completed."
    });
    const connector = createEnsenLoopEipExecutorConnector({
      transport,
      now: () => "2026-04-30T04:00:00.000Z"
    });
    const definition: WorkflowDefinition = {
      schemaVersion: "flow.workflow.v1",
      id: "loop-fake-transport-demo",
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
          id: "loop-like-executor",
          action: {
            type: "local",
            name: "fake_loop_eip_executor"
          }
        }
      ]
    };
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-loop-fake-"));
    const statePath = join(tempRoot, "runs", "loop-fake-transport.jsonl");

    try {
      const result = await runWorkflow({
        definition,
        statePath,
        triggerContext: {
          requestId: "fake-loop-run"
        },
        now: (() => {
          let index = 0;
          const timestamps = [
            "2026-04-30T04:00:00.000Z",
            "2026-04-30T04:00:01.000Z",
            "2026-04-30T04:00:02.000Z",
            "2026-04-30T04:00:04.000Z"
          ];
          return () => timestamps[index++] ?? "2026-04-30T04:00:05.000Z";
        })(),
        stepHandler: async ({ definition, runState, step, attempt }) => {
          const submitted = await connector.submit({
            workflow: {
              id: definition.id,
              version: definition.schemaVersion
            },
            run: {
              id: runState.run.runId
            },
            step: {
              id: step.id,
              attempt
            },
            idempotencyKey: `${runState.run.runId}:${step.id}:${attempt}`,
            policyDecision: { decision: "allow" },
            input: {
              requestId: "fake-loop-run"
            }
          });

          if (!submitted.ok) {
            throw new Error(submitted.error.reason ?? submitted.error.message);
          }

          const status = await connector.status({ requestId: submitted.value.requestId });

          if (!status.ok) {
            throw new Error(status.error.reason ?? status.error.message);
          }

          expect(status.value).toMatchObject({
            requestId: submitted.value.requestId,
            status: "succeeded",
            result: {
              status: "succeeded",
              summary: "Fake loop-like execution completed."
            }
          });
        }
      });

      expect(result.run.status).toBe("succeeded");
      expect(transport.submittedRunRequests).toHaveLength(1);
      expect(transport.submittedRunRequests[0]).toMatchObject({
        schemaVersion: "eip.run-request.v1",
        id: "req_loop_fake_transport_demo_fake_loop_run_loop_like_executor_1",
        mode: "validate"
      });

      const persisted = await readWorkflowRunState(statePath);
      expect(persisted.events.map((event) => event.type)).toEqual([
        "run.created",
        "step.attempt.started",
        "step.attempt.completed",
        "run.completed"
      ]);
      expect(persisted.stepAttempts["loop-like-executor"]).toMatchObject([
        {
          attempt: 1,
          status: "succeeded"
        }
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("keeps malformed fake Ensen-loop EIP status output fail-closed", async () => {
    const connector = createEnsenLoopEipExecutorConnector({
      transport: createFakeEnsenLoopEipExecutorTransport({
        statusSnapshots: [
          {
            schemaVersion: "eip.run-status.v1",
            requestId: "req_loop_eip_demo_run_loop_executor_step_1",
            correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
            status: "completed",
            observedAt: "2026-04-30T04:00:02.000Z"
          }
        ]
      }),
      now: () => "2026-04-30T04:00:00.000Z"
    });
    const submitted = await connector.submit(submitRequest);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: false,
      operation: "status",
      error: {
        code: "invalid-request",
        retryable: false,
        reason: "EIP RunStatusSnapshot id is malformed"
      }
    });
  });

  it("keeps malformed fake Ensen-loop EIP result output fail-closed", async () => {
    const connector = createEnsenLoopEipExecutorConnector({
      transport: createFakeEnsenLoopEipExecutorTransport({
        result: ({ requestId, request }) => ({
          schemaVersion: "eip.run-result.v1",
          id: `run_${requestId}`,
          requestId,
          correlationId: request?.correlationId ?? "corr_loop_eip_demo_run_loop_executor_step_1",
          status: "succeeded"
        })
      }),
      now: () => "2026-04-30T04:00:00.000Z"
    });
    const submitted = await connector.submit(submitRequest);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: false,
      operation: "status",
      error: {
        code: "invalid-request",
        retryable: false,
        reason: "EIP RunResult completedAt is malformed"
      }
    });
  });

  it("does not advertise or synthesize cancellation when the EIP transport has no cancel endpoint", async () => {
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          return {
            schemaVersion: "eip.run-status.v1",
            requestId: "req_loop_eip_demo_run_loop_executor_step_1",
            status: "running"
          };
        },
        getRunResult() {
          throw new Error("result should not be fetched for a running status");
        },
        getEvidenceBundleRef() {
          return {
            schemaVersion: "eip.evidence-bundle-ref.v1",
            id: "evb_loop_eip_bundle"
          };
        }
      }
    });

    expect(connector.capabilities.cancel).toEqual({
      supported: false,
      reason: "transport does not support cancellation"
    });

    const submitted = await connector.submit(submitRequest);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.cancel({ requestId: submitted.value.requestId })).toMatchObject({
      ok: false,
      operation: "cancel",
      error: {
        code: "unsupported-operation",
        reason: "transport does not support cancellation"
      }
    });
  });

  it("fails closed when an EIP cancel endpoint omits the cancelled receipt", async () => {
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          return {
            schemaVersion: "eip.run-status.v1",
            requestId: "req_loop_eip_demo_run_loop_executor_step_1",
            status: "running"
          };
        },
        getRunResult() {
          throw new Error("result should not be fetched for a cancel receipt");
        },
        getEvidenceBundleRef() {
          throw new Error("evidence should not be fetched for a cancel receipt");
        },
        cancelRunRequest() {
          return {
            requestId: "req_loop_eip_demo_run_loop_executor_step_1"
          };
        }
      }
    });
    const submitted = await connector.submit(submitRequest);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.cancel({ requestId: submitted.value.requestId })).toMatchObject({
      ok: false,
      operation: "cancel",
      error: {
        code: "invalid-request",
        reason: "EIP cancel receipt cancelled must be a boolean"
      }
    });
  });

  it("fails closed when an EIP cancel receipt belongs to a different request", async () => {
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          return {
            schemaVersion: "eip.run-status.v1",
            requestId: "req_loop_eip_demo_run_loop_executor_step_1",
            status: "running"
          };
        },
        getRunResult() {
          throw new Error("result should not be fetched for a mismatched cancel receipt");
        },
        getEvidenceBundleRef() {
          throw new Error("evidence should not be fetched for a mismatched cancel receipt");
        },
        cancelRunRequest() {
          return {
            requestId: "req_other_loop_run",
            cancelled: true
          };
        }
      }
    });
    const submitted = await connector.submit(submitRequest);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.cancel({ requestId: submitted.value.requestId })).toMatchObject({
      ok: false,
      operation: "cancel",
      error: {
        code: "invalid-request",
        reason: "EIP cancel receipt requestId does not match the submitted request"
      }
    });
  });

  it("uses remote EIP payload validation instead of same-instance submit state", async () => {
    const observedStatusRequests: string[] = [];
    const transport = {
      submitRunRequest(payload: { id: string }) {
        return { requestId: payload.id };
      },
      getRunStatusSnapshot(request: { requestId: string }) {
        observedStatusRequests.push(request.requestId);
        return {
          schemaVersion: "eip.run-status.v1",
          id: "sts_loop_eip_status",
          requestId: request.requestId,
          correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
          status: "running",
          observedAt: "2026-04-30T04:00:02.000Z"
        };
      },
      getRunResult() {
        throw new Error("result should not be fetched for a running status");
      },
      getEvidenceBundleRef(request: { requestId: string }) {
        return {
          schemaVersion: "eip.evidence-bundle-ref.v1",
          id: "evb_loop_eip_bundle",
          correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
          type: "local_path",
          uri: `artifacts/evidence/${request.requestId}/bundle.json`,
          createdAt: "2026-04-30T04:00:03.000Z"
        };
      },
      cancelRunRequest(request: { requestId: string }) {
        return {
          requestId: request.requestId,
          cancelled: true,
          observedAt: "2026-04-30T04:00:04.000Z"
        };
      }
    };
    const submittingConnector = createEnsenLoopEipExecutorConnector({ transport });
    const submitted = await submittingConnector.submit(submitRequest);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    const followUpConnector = createEnsenLoopEipExecutorConnector({ transport });

    expect(await followUpConnector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: true,
      value: {
        requestId: submitted.value.requestId,
        status: "running"
      }
    });
    expect(await followUpConnector.fetchEvidence({ requestId: submitted.value.requestId }))
      .toMatchObject({
        ok: true,
        value: {
          requestId: submitted.value.requestId,
          evidence: {
            schemaVersion: "eip.evidence-bundle-ref.v1"
          }
        }
      });
    expect(await followUpConnector.cancel({ requestId: submitted.value.requestId })).toMatchObject({
      ok: true,
      value: {
        requestId: submitted.value.requestId,
        cancelled: true
      }
    });
    expect(observedStatusRequests).toEqual([submitted.value.requestId]);
  });

  it("maps blocked and needs-review EIP RunResult statuses to flow-owned states", async () => {
    const createTerminalConnector = (status: "blocked" | "needs_review", summary: string) =>
      createEnsenLoopEipExecutorConnector({
        transport: {
          submitRunRequest(payload) {
            return { requestId: payload.id };
          },
          getRunStatusSnapshot() {
            return {
              schemaVersion: "eip.run-status.v1",
              id: "sts_loop_eip_done",
              requestId: "req_loop_eip_demo_run_loop_executor_step_1",
              correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
              status: "completed",
              observedAt: "2026-04-30T04:00:02.000Z"
            };
          },
          getRunResult() {
            return {
              schemaVersion: "eip.run-result.v1",
              id: "run_loop_eip_result",
              requestId: "req_loop_eip_demo_run_loop_executor_step_1",
              correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
              status,
              completedAt: "2026-04-30T04:00:03.000Z",
              verification: {
                status: "blocked",
                summary
              }
            };
          },
          getEvidenceBundleRef() {
            return {
              schemaVersion: "eip.evidence-bundle-ref.v1",
              id: "evb_loop_eip_bundle",
              correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
              type: "local_path",
              uri: "artifacts/evidence/loop-eip-demo-run/bundle.json",
              createdAt: "2026-04-30T04:00:03.000Z"
            };
          }
        }
      });
    const connector = createTerminalConnector("needs_review", "Executor returned ambiguous evidence.");
    const submitted = await connector.submit(submitRequest);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: true,
      value: {
        status: "needs-review",
        flowControl: {
          state: "needs-review",
          authority: "ensen-flow",
          reason: "Executor returned ambiguous evidence."
        },
        result: {
          status: "needs-review",
          summary: "Executor returned ambiguous evidence."
        }
      }
    });

    const blocked = createTerminalConnector("blocked", "Required approval was not available.");
    const blockedSubmit = await blocked.submit(submitRequest);

    if (!blockedSubmit.ok) {
      throw new Error("blocked submit should succeed");
    }

    expect(await blocked.status({ requestId: blockedSubmit.value.requestId })).toMatchObject({
      ok: true,
      value: {
        status: "blocked",
        flowControl: {
          state: "blocked",
          authority: "ensen-flow",
          reason: "Required approval was not available."
        },
        result: {
          status: "blocked",
          summary: "Required approval was not available."
        }
      }
    });
  });

  it("fails closed for unsupported EIP major versions", async () => {
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          return {
            schemaVersion: "eip.run-status.v2",
            id: "sts_loop_eip_v2",
            requestId: "req_loop_eip_demo_run_loop_executor_step_1",
            correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
            status: "running",
            observedAt: "2026-04-30T04:00:02.000Z"
          };
        },
        getRunResult() {
          throw new Error("result should not be fetched for unsupported status versions");
        },
        getEvidenceBundleRef() {
          throw new Error("evidence should not be fetched for unsupported status versions");
        }
      }
    });
    const submitted = await connector.submit(submitRequest);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: false,
      operation: "status",
      error: {
        code: "invalid-request",
        retryable: false,
        reason: "unsupported EIP RunStatusSnapshot schemaVersion eip.run-status.v2"
      }
    });
  });

  it("fails closed for malformed optional EIP RunStatusSnapshot fields", async () => {
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          return {
            schemaVersion: "eip.run-status.v1",
            id: "sts_loop_eip_status",
            requestId: "req_loop_eip_demo_run_loop_executor_step_1",
            correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
            status: "running",
            observedAt: "2026-04-30T04:00:02.000Z",
            message: 123
          };
        },
        getRunResult() {
          throw new Error("result should not be fetched for malformed status snapshots");
        },
        getEvidenceBundleRef() {
          throw new Error("evidence should not be fetched for malformed status snapshots");
        }
      }
    });
    const submitted = await connector.submit(submitRequest);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: false,
      operation: "status",
      error: {
        code: "invalid-request",
        retryable: false,
        reason: "EIP RunStatusSnapshot message must be a string"
      }
    });
  });

  it.each([
    {
      name: "missing id",
      snapshot: {
        schemaVersion: "eip.run-status.v1",
        requestId: "req_loop_eip_demo_run_loop_executor_step_1",
        correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
        status: "running",
        observedAt: "2026-04-30T04:00:02.000Z"
      },
      reason: "EIP RunStatusSnapshot id is malformed"
    },
    {
      name: "missing correlationId",
      snapshot: {
        schemaVersion: "eip.run-status.v1",
        id: "sts_loop_eip_status",
        requestId: "req_loop_eip_demo_run_loop_executor_step_1",
        status: "running",
        observedAt: "2026-04-30T04:00:02.000Z"
      },
      reason: "EIP RunStatusSnapshot correlationId is malformed"
    },
    {
      name: "missing observedAt",
      snapshot: {
        schemaVersion: "eip.run-status.v1",
        id: "sts_loop_eip_status",
        requestId: "req_loop_eip_demo_run_loop_executor_step_1",
        correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
        status: "running"
      },
      reason: "EIP RunStatusSnapshot observedAt is malformed"
    },
    {
      name: "malformed observedAt",
      snapshot: {
        schemaVersion: "eip.run-status.v1",
        id: "sts_loop_eip_status",
        requestId: "req_loop_eip_demo_run_loop_executor_step_1",
        correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
        status: "running",
        observedAt: "2026-04-30 04:00:02"
      },
      reason: "EIP RunStatusSnapshot observedAt is malformed"
    }
  ])("fails closed for required EIP RunStatusSnapshot field validation: $name", async ({
    snapshot,
    reason
  }) => {
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          return snapshot;
        },
        getRunResult() {
          throw new Error("result should not be fetched for invalid status snapshots");
        },
        getEvidenceBundleRef() {
          throw new Error("evidence should not be fetched for invalid status snapshots");
        }
      }
    });
    const submitted = await connector.submit(submitRequest);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: false,
      operation: "status",
      error: {
        code: "invalid-request",
        retryable: false,
        reason
      }
    });
  });

  it.each([
    {
      name: "missing id",
      result: {
        schemaVersion: "eip.run-result.v1",
        requestId: "req_loop_eip_demo_run_loop_executor_step_1",
        correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
        status: "succeeded",
        completedAt: "2026-04-30T04:00:03.000Z"
      },
      reason: "EIP RunResult id is malformed"
    },
    {
      name: "missing correlationId",
      result: {
        schemaVersion: "eip.run-result.v1",
        id: "run_loop_eip_result",
        requestId: "req_loop_eip_demo_run_loop_executor_step_1",
        status: "succeeded",
        completedAt: "2026-04-30T04:00:03.000Z"
      },
      reason: "EIP RunResult correlationId is malformed"
    },
    {
      name: "missing completedAt",
      result: {
        schemaVersion: "eip.run-result.v1",
        id: "run_loop_eip_result",
        requestId: "req_loop_eip_demo_run_loop_executor_step_1",
        correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
        status: "succeeded"
      },
      reason: "EIP RunResult completedAt is malformed"
    },
    {
      name: "malformed completedAt",
      result: {
        schemaVersion: "eip.run-result.v1",
        id: "run_loop_eip_result",
        requestId: "req_loop_eip_demo_run_loop_executor_step_1",
        correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
        status: "succeeded",
        completedAt: "2026-04-30 04:00:03"
      },
      reason: "EIP RunResult completedAt is malformed"
    }
  ])("fails closed for required EIP RunResult field validation: $name", async ({
    result,
    reason
  }) => {
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          return {
            schemaVersion: "eip.run-status.v1",
            id: "sts_loop_eip_status",
            requestId: "req_loop_eip_demo_run_loop_executor_step_1",
            correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
            status: "completed",
            observedAt: "2026-04-30T04:00:02.000Z"
          };
        },
        getRunResult() {
          return result;
        },
        getEvidenceBundleRef() {
          throw new Error("evidence should not be fetched for invalid run results");
        }
      }
    });
    const submitted = await connector.submit(submitRequest);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: false,
      operation: "status",
      error: {
        code: "invalid-request",
        retryable: false,
        reason
      }
    });
  });

  it("fails closed for malformed optional EIP RunResult fields", async () => {
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          return {
            schemaVersion: "eip.run-status.v1",
            id: "sts_loop_eip_status",
            requestId: "req_loop_eip_demo_run_loop_executor_step_1",
            correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
            status: "completed",
            observedAt: "2026-04-30T04:00:02.000Z"
          };
        },
        getRunResult() {
          return {
            schemaVersion: "eip.run-result.v1",
            id: "run_loop_eip_result",
            requestId: "req_loop_eip_demo_run_loop_executor_step_1",
            correlationId: "corr_loop_eip_demo_run_loop_executor_step_1",
            status: "succeeded",
            completedAt: "2026-04-30T04:00:03.000Z",
            verification: {
              status: "passed",
              summary: 123
            }
          };
        },
        getEvidenceBundleRef() {
          throw new Error("evidence should not be fetched for malformed run results");
        }
      }
    });
    const submitted = await connector.submit(submitRequest);

    if (!submitted.ok) {
      throw new Error("submit should succeed");
    }

    expect(await connector.status({ requestId: submitted.value.requestId })).toMatchObject({
      ok: false,
      operation: "status",
      error: {
        code: "invalid-request",
        retryable: false,
        reason: "EIP RunResult verification.summary must be a string"
      }
    });
  });

  it("records the supported EIP snapshot/version on the connector boundary", () => {
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          throw new Error("status should not be fetched for version visibility");
        },
        getRunResult() {
          throw new Error("result should not be fetched for version visibility");
        },
        getEvidenceBundleRef() {
          throw new Error("evidence should not be fetched for version visibility");
        }
      }
    });

    expect(connector.identity.version).toBe("eip.run-request.v1");
  });

  it.each([
    "fixtures/run-status/v1/valid/accepted-snapshot.json",
    "fixtures/run-status/v1/valid/running-snapshot.json",
    "fixtures/run-status/v1/valid/completed-snapshot.json"
  ])("consumes valid EIP RunStatusSnapshot fixture %s", async (fixturePath) => {
    const statusFixture = await readProtocolFixture(fixturePath);
    const requestId = readFixtureRequestId(statusFixture);
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          return statusFixture;
        },
        getRunResult() {
          return {
            schemaVersion: "eip.run-result.v1",
            id: "run_loop_eip_result",
            requestId,
            correlationId: "corr_01HV9ZX8J2K6T3QW4R5Y7M8N9R",
            status: "succeeded",
            completedAt: "2026-04-29T00:05:00Z",
            verification: {
              status: "passed",
              summary: "Run completed and verification passed."
            }
          };
        },
        getEvidenceBundleRef() {
          throw new Error("evidence should not be fetched for status fixture validation");
        }
      }
    });

    expect(await connector.status({ requestId })).toMatchObject({
      ok: true,
      operation: "status",
      value: {
        requestId
      }
    });
  });

  it.each([
    "fixtures/run-result/v1/valid/blocked-result.json",
    "fixtures/run-result/v1/valid/failed-result.json",
    "fixtures/run-result/v1/valid/succeeded-result.json"
  ])("consumes valid EIP RunResult fixture %s", async (fixturePath) => {
    const resultFixture = await readProtocolFixture(fixturePath);
    const requestId = readFixtureRequestId(resultFixture);
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          return {
            schemaVersion: "eip.run-status.v1",
            id: "sts_loop_eip_status",
            requestId,
            correlationId: "corr_01HV9ZX8J2K6T3QW4R5Y7M8N9R",
            status: "completed",
            observedAt: "2026-04-29T00:05:00Z"
          };
        },
        getRunResult() {
          return resultFixture;
        },
        getEvidenceBundleRef() {
          throw new Error("evidence should not be fetched for result fixture validation");
        }
      }
    });

    expect(await connector.status({ requestId })).toMatchObject({
      ok: true,
      operation: "status",
      value: {
        requestId
      }
    });
  });

  it.each([
    "fixtures/evidence-bundle-ref/v1/valid/file-uri.json",
    "fixtures/evidence-bundle-ref/v1/valid/local-path.json"
  ])("consumes valid EIP EvidenceBundleRef fixture %s", async (fixturePath) => {
    const evidenceFixture = await readProtocolFixture(fixturePath);
    const requestId = "req_01HV9ZX8J2K6T3QW4R5Y7M8N9Q";
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          throw new Error("status should not be fetched for evidence fixture validation");
        },
        getRunResult() {
          throw new Error("result should not be fetched for evidence fixture validation");
        },
        getEvidenceBundleRef() {
          return evidenceFixture;
        }
      }
    });

    expect(await connector.fetchEvidence({ requestId })).toMatchObject({
      ok: true,
      operation: "fetchEvidence",
      value: {
        requestId,
        evidence: evidenceFixture
      }
    });
  });

  it.each([
    "fixtures/run-status/v1/invalid/final-result-only-fields.json"
  ])("fails closed for invalid EIP RunStatusSnapshot fixture %s", async (fixturePath) => {
    const invalidStatus = await readProtocolFixture(fixturePath);
    const requestId = readFixtureRequestId(invalidStatus);
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          return invalidStatus;
        },
        getRunResult() {
          throw new Error("result should not be fetched for invalid status fixture validation");
        },
        getEvidenceBundleRef() {
          throw new Error("evidence should not be fetched for invalid status fixture validation");
        }
      }
    });

    expect(await connector.status({ requestId })).toMatchObject({
      ok: false,
      operation: "status",
      error: {
        code: "invalid-request",
        retryable: false
      }
    });
  });

  it.each([
    "fixtures/run-result/v1/invalid/missing-request-id.json",
    "fixtures/run-result/v1/invalid/running-status.json"
  ])("fails closed for invalid EIP RunResult fixture %s", async (fixturePath) => {
    const invalidResult = await readProtocolFixture(fixturePath);
    const requestId =
      isFixtureRecord(invalidResult) && typeof invalidResult.requestId === "string"
        ? invalidResult.requestId
        : "req_01HV9ZX8J2K6T3QW4R5Y7M8N9Q";
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          return {
            schemaVersion: "eip.run-status.v1",
            id: "sts_loop_eip_status",
            requestId,
            correlationId: "corr_01HV9ZX8J2K6T3QW4R5Y7M8N9R",
            status: "completed",
            observedAt: "2026-04-29T00:05:00Z"
          };
        },
        getRunResult() {
          return invalidResult;
        },
        getEvidenceBundleRef() {
          throw new Error("evidence should not be fetched for invalid result fixture validation");
        }
      }
    });

    expect(await connector.status({ requestId })).toMatchObject({
      ok: false,
      operation: "status",
      error: {
        code: "invalid-request",
        retryable: false
      }
    });
  });

  it.each([
    "fixtures/evidence-bundle-ref/v1/invalid/bad-checksum.json",
    "fixtures/evidence-bundle-ref/v1/invalid/raw-secret-uri.json"
  ])("fails closed for invalid EIP EvidenceBundleRef fixture %s", async (fixturePath) => {
    const invalidEvidence = await readProtocolFixture(fixturePath);
    const connector = createEnsenLoopEipExecutorConnector({
      transport: {
        submitRunRequest(payload) {
          return { requestId: payload.id };
        },
        getRunStatusSnapshot() {
          throw new Error("status should not be fetched for evidence fixture validation");
        },
        getRunResult() {
          throw new Error("result should not be fetched for evidence fixture validation");
        },
        getEvidenceBundleRef() {
          return invalidEvidence;
        }
      }
    });

    expect(await connector.fetchEvidence({ requestId: "req_01HV9ZX8J2K6T3QW4R5Y7M8N9Q" }))
      .toMatchObject({
        ok: false,
        operation: "fetchEvidence",
        error: {
          code: "invalid-request",
          retryable: false
        }
      });
  });
});
