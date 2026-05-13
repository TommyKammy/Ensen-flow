import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWorkflowRun,
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
  it("fails closed for committed customer workflow artifacts in draft-only mode without explicit human approval", async () => {
    const definition = createCustomerWorkflowApprovalBoundaryDefinition();
    const statePath = await createTempPath("ensen-flow-approval-", "runs/draft-only.jsonl");
    const auditPath = await createTempPath("ensen-flow-approval-audit-", "audit/draft-only.jsonl");
    let stepHandlerCalled = false;

    const result = await runWorkflow({
      definition,
      statePath,
      auditPath,
      triggerContext: {
        requestId: "draft-only-committed-without-approval",
        customerWorkflow: {
          ref: "public-release-approval",
          mode: "draft-only",
          erpNext: {
            siteRef: "erpnext-public-demo",
            objectType: "Sales Order",
            endpointRef: "erpnext-public-api"
          }
        }
      },
      stepHandler: () => {
        stepHandlerCalled = true;
        return {
          requestId: "req_draft_only_commit_without_approval",
          status: "succeeded",
          observedAt: "2026-05-13T01:00:02.000Z",
          result: {
            status: "succeeded",
            summary: "Draft artifact was treated as committed.",
            output: {
              customerWorkflowArtifact: {
                artifactIntent: "committed",
                approvalState: "approval-required",
                externalApplicationState: "not-applied"
              }
            }
          }
        } satisfies ExecutorConnectorStatusSnapshot;
      }
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["draft-action"]).toMatchObject([
      {
        attempt: 1,
        status: "failed",
        retry: {
          retryable: false,
          reason:
            "draft-only customer workflow artifacts cannot be committed without explicit human approval"
        }
      }
    ]);
    expect(stepHandlerCalled).toBe(true);
    const stateJsonl = await readFile(statePath, "utf8");
    expect(stateJsonl).toContain("\"step.attempt.started\"");
    expect(stateJsonl).toContain("\"step.attempt.failed\"");
    expect(stateJsonl).not.toContain("\"step.attempt.completed\"");
    expect(stateJsonl).not.toContain("customerWorkflowArtifact");
    const auditJsonl = await readFile(auditPath, "utf8");
    expect(auditJsonl).toContain(
      "draft-only customer workflow artifacts cannot be committed without explicit human approval"
    );
    expect(auditJsonl).not.toContain("\"step.completed\"");
  });

  it("allows read-only customer workflow observation without creating draft or committed artifacts", async () => {
    const definition = createCustomerWorkflowApprovalBoundaryDefinition();
    const statePath = await createTempPath("ensen-flow-approval-", "runs/read-only.jsonl");

    const result = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "read-only-observation",
        customerWorkflow: {
          ref: "public-release-approval",
          mode: "read-only",
          erpNext: {
            siteRef: "erpnext-public-demo",
            objectType: "Sales Order",
            endpointRef: "erpnext-public-api"
          }
        }
      },
      stepHandler: () =>
        ({
          requestId: "req_read_only_observation",
          status: "succeeded",
          observedAt: "2026-05-13T01:01:00.000Z",
          result: {
            status: "succeeded",
            summary: "Read-only observation recorded.",
            output: {
              customerWorkflowArtifact: {
                artifactIntent: "observation",
                externalApplicationState: "not-applied"
              }
            }
          }
        }) satisfies ExecutorConnectorStatusSnapshot
    });

    expect(result.run.status).toBe("succeeded");
    expect(result.stepAttempts["draft-action"][0]?.result).toMatchObject({
      executor: {
        result: {
          output: {
            customerWorkflowArtifact: {
              artifactIntent: "observation",
              externalApplicationState: "not-applied"
            }
          }
        }
      }
    });
  });

  it("fails closed when read-only customer workflow mode creates a draft-only artifact", async () => {
    const definition = createCustomerWorkflowApprovalBoundaryDefinition();
    const statePath = await createTempPath("ensen-flow-approval-", "runs/read-only-draft.jsonl");

    const result = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "read-only-draft",
        customerWorkflow: {
          ref: "public-release-approval",
          mode: "read-only",
          erpNext: {
            siteRef: "erpnext-public-demo",
            objectType: "Sales Order",
            endpointRef: "erpnext-public-api"
          }
        }
      },
      stepHandler: () =>
        ({
          requestId: "req_read_only_draft",
          status: "succeeded",
          observedAt: "2026-05-13T01:02:00.000Z",
          result: {
            status: "succeeded",
            output: {
              customerWorkflowArtifact: {
                artifactIntent: "draft-only",
                approvalState: "approval-required",
                externalApplicationState: "not-applied"
              }
            }
          }
        }) satisfies ExecutorConnectorStatusSnapshot
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["draft-action"][0]?.retry?.reason).toBe(
      "read-only customer workflow mode cannot create draft-only or committed artifacts"
    );
  });

  it("fails closed when read-only customer workflow mode records approval lifecycle state", async () => {
    const definition = createCustomerWorkflowApprovalBoundaryDefinition();
    const statePath = await createTempPath("ensen-flow-approval-", "runs/read-only-approval.jsonl");

    const result = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "read-only-approval",
        customerWorkflow: {
          ref: "public-release-approval",
          mode: "read-only",
          erpNext: {
            siteRef: "erpnext-public-demo",
            objectType: "Sales Order",
            endpointRef: "erpnext-public-api"
          }
        }
      },
      stepHandler: () =>
        ({
          requestId: "req_read_only_approval",
          status: "succeeded",
          observedAt: "2026-05-13T01:02:30.000Z",
          result: {
            status: "succeeded",
            output: {
              customerWorkflowArtifact: {
                artifactIntent: "observation",
                approvalState: "approval-required",
                externalApplicationState: "not-applied"
              }
            }
          }
        }) satisfies ExecutorConnectorStatusSnapshot
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["draft-action"][0]?.retry?.reason).toBe(
      "read-only customer workflow mode cannot record approval lifecycle states"
    );
  });

  it("records draft-only approval-required artifacts without treating them as committed", async () => {
    const definition = createCustomerWorkflowApprovalBoundaryDefinition();
    const statePath = await createTempPath("ensen-flow-approval-", "runs/draft-required.jsonl");

    const result = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "draft-required",
        customerWorkflow: {
          ref: "public-release-approval",
          mode: "draft-only",
          erpNext: {
            siteRef: "erpnext-public-demo",
            objectType: "Sales Order",
            endpointRef: "erpnext-public-api"
          }
        }
      },
      stepHandler: () =>
        ({
          requestId: "req_draft_required",
          status: "succeeded",
          observedAt: "2026-05-13T01:03:00.000Z",
          result: {
            status: "succeeded",
            output: {
              customerWorkflowArtifact: {
                artifactIntent: "draft-only",
                approvalState: "approval-required",
                externalApplicationState: "not-applied",
                decisionBoundary: "<approval-boundary>"
              }
            }
          }
        }) satisfies ExecutorConnectorStatusSnapshot
    });

    expect(result.run.status).toBe("succeeded");
    expect(result.stepAttempts["draft-action"][0]?.result).toMatchObject({
      executor: {
        result: {
          output: {
            customerWorkflowArtifact: {
              artifactIntent: "draft-only",
              approvalState: "approval-required",
              externalApplicationState: "not-applied"
            }
          }
        }
      }
    });
  });

  it("fails closed when draft-only artifacts omit approvalState", async () => {
    const definition = createCustomerWorkflowApprovalBoundaryDefinition();
    const statePath = await createTempPath("ensen-flow-approval-", "runs/draft-missing-state.jsonl");

    const result = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "draft-missing-state",
        customerWorkflow: {
          ref: "public-release-approval",
          mode: "draft-only",
          erpNext: {
            siteRef: "erpnext-public-demo",
            objectType: "Sales Order",
            endpointRef: "erpnext-public-api"
          }
        }
      },
      stepHandler: () =>
        ({
          requestId: "req_draft_missing_state",
          status: "succeeded",
          observedAt: "2026-05-13T01:03:15.000Z",
          result: {
            status: "succeeded",
            output: {
              customerWorkflowArtifact: {
                artifactIntent: "draft-only",
                externalApplicationState: "not-applied"
              }
            }
          }
        }) satisfies ExecutorConnectorStatusSnapshot
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["draft-action"][0]?.retry?.reason).toBe(
      "draft-only customer workflow artifacts require an explicit lifecycle approvalState before approval"
    );
  });

  it("fails closed for malformed non-string approvalState values", async () => {
    const definition = createCustomerWorkflowApprovalBoundaryDefinition();
    const statePath = await createTempPath("ensen-flow-approval-", "runs/draft-malformed-state.jsonl");

    const result = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "draft-malformed-state",
        customerWorkflow: {
          ref: "public-release-approval",
          mode: "draft-only",
          erpNext: {
            siteRef: "erpnext-public-demo",
            objectType: "Sales Order",
            endpointRef: "erpnext-public-api"
          }
        }
      },
      stepHandler: () =>
        ({
          requestId: "req_draft_malformed_state",
          status: "succeeded",
          observedAt: "2026-05-13T01:03:20.000Z",
          result: {
            status: "succeeded",
            output: {
              customerWorkflowArtifact: {
                artifactIntent: "draft-only",
                approvalState: false,
                externalApplicationState: "not-applied"
              }
            }
          }
        }) satisfies ExecutorConnectorStatusSnapshot
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["draft-action"][0]?.retry?.reason).toBe(
      "customer workflow artifact approvalState must be a string"
    );
  });

  it.each([
    {
      requestId: "draft-missing-application-state",
      artifact: {
        artifactIntent: "draft-only",
        approvalState: "approval-required"
      }
    },
    {
      requestId: "draft-pending-application-state",
      artifact: {
        artifactIntent: "draft-only",
        approvalState: "approval-required",
        externalApplicationState: "pending"
      }
    }
  ] as const)(
    "fails closed for $requestId artifacts without not-applied state",
    async ({ requestId, artifact }) => {
      const definition = createCustomerWorkflowApprovalBoundaryDefinition();
      const statePath = await createTempPath("ensen-flow-approval-", `runs/${requestId}.jsonl`);

      const result = await runWorkflow({
        definition,
        statePath,
        triggerContext: {
          requestId,
          customerWorkflow: {
            ref: "public-release-approval",
            mode: "draft-only",
            erpNext: {
              siteRef: "erpnext-public-demo",
              objectType: "Sales Order",
              endpointRef: "erpnext-public-api"
            }
          }
        },
        stepHandler: () =>
          ({
            requestId: `req_${requestId.replaceAll("-", "_")}`,
            status: "succeeded",
            observedAt: "2026-05-13T01:03:30.000Z",
            result: {
              status: "succeeded",
              output: {
                customerWorkflowArtifact: artifact
              }
            }
          }) satisfies ExecutorConnectorStatusSnapshot
      });

      expect(result.run.status).toBe("failed");
      expect(result.stepAttempts["draft-action"][0]?.retry?.reason).toBe(
        "customer workflow artifacts must remain not-applied in read-only or draft-only mode"
      );
    }
  );

  it.each(["rejected", "revoked", "superseded"] as const)(
    "records draft-only %s artifacts as distinguishable not-applied evidence",
    async (approvalState) => {
      const definition = createCustomerWorkflowApprovalBoundaryDefinition();
      const statePath = await createTempPath(
        "ensen-flow-approval-",
        `runs/draft-${approvalState}.jsonl`
      );

      const result = await runWorkflow({
        definition,
        statePath,
        triggerContext: {
          requestId: `draft-${approvalState}`,
          customerWorkflow: {
            ref: "public-release-approval",
            mode: "draft-only",
            erpNext: {
              siteRef: "erpnext-public-demo",
              objectType: "Sales Order",
              endpointRef: "erpnext-public-api"
            }
          }
        },
        stepHandler: () =>
          ({
            requestId: `req_draft_${approvalState}`,
            status: "succeeded",
            observedAt: "2026-05-13T01:04:00.000Z",
            result: {
              status: "succeeded",
              output: {
                customerWorkflowArtifact: {
                  artifactIntent: "draft-only",
                  approvalState,
                  externalApplicationState: "not-applied",
                  decisionBoundary: "<approval-boundary>",
                  ...(approvalState === "superseded"
                    ? { supersedesRef: "draft-action-previous" }
                    : {})
                }
              }
            }
          }) satisfies ExecutorConnectorStatusSnapshot
      });

      expect(result.run.status).toBe("succeeded");
      expect(result.stepAttempts["draft-action"][0]?.result).toMatchObject({
        executor: {
          result: {
            output: {
              customerWorkflowArtifact: {
                artifactIntent: "draft-only",
                approvalState,
                externalApplicationState: "not-applied"
              }
            }
          }
        }
      });
    }
  );

  it.each([
    {
      requestId: "malformed-single-artifact",
      output: {
        customerWorkflowArtifact: "draft-only"
      },
      expectedReason: "customer workflow artifact must be an object"
    },
    {
      requestId: "malformed-artifact-array",
      output: {
        customerWorkflowArtifacts: [
          {
            artifactIntent: "draft-only",
            approvalState: "approval-required",
            externalApplicationState: "not-applied"
          },
          "draft-only"
        ]
      },
      expectedReason: "customer workflow artifacts must be an array of objects"
    }
  ] as const)(
    "fails closed for $requestId customer workflow payloads",
    async ({ requestId, output, expectedReason }) => {
      const definition = createCustomerWorkflowApprovalBoundaryDefinition();
      const statePath = await createTempPath("ensen-flow-approval-", `runs/${requestId}.jsonl`);

      const result = await runWorkflow({
        definition,
        statePath,
        triggerContext: {
          requestId,
          customerWorkflow: {
            ref: "public-release-approval",
            mode: "draft-only",
            erpNext: {
              siteRef: "erpnext-public-demo",
              objectType: "Sales Order",
              endpointRef: "erpnext-public-api"
            }
          }
        },
        stepHandler: () =>
          ({
            requestId: `req_${requestId.replaceAll("-", "_")}`,
            status: "succeeded",
            observedAt: "2026-05-13T01:04:30.000Z",
            result: {
              status: "succeeded",
              output
            }
          }) satisfies ExecutorConnectorStatusSnapshot
      });

      expect(result.run.status).toBe("failed");
      expect(result.stepAttempts["draft-action"][0]?.retry?.reason).toBe(expectedReason);
    }
  );

  it("ignores inherited customer workflow artifact fields on executor output", async () => {
    const definition = createCustomerWorkflowApprovalBoundaryDefinition();
    const statePath = await createTempPath("ensen-flow-approval-", "runs/inherited-artifact.jsonl");
    Object.defineProperty(Object.prototype, "customerWorkflowArtifact", {
      configurable: true,
      value: "draft-only"
    });

    try {
      const result = await runWorkflow({
        definition,
        statePath,
        triggerContext: {
          requestId: "inherited-artifact",
          customerWorkflow: {
            ref: "public-release-approval",
            mode: "draft-only",
            erpNext: {
              siteRef: "erpnext-public-demo",
              objectType: "Sales Order",
              endpointRef: "erpnext-public-api"
            }
          }
        },
        stepHandler: () =>
          ({
            requestId: "req_inherited_artifact",
            status: "succeeded",
            observedAt: "2026-05-13T01:04:45.000Z",
            result: {
              status: "succeeded",
              output: {
                observation: "own payload data"
              }
            }
          }) satisfies ExecutorConnectorStatusSnapshot
      });

      expect(result.run.status).toBe("succeeded");
      expect(result.stepAttempts["draft-action"][0]?.result).toMatchObject({
        executor: {
          result: {
            output: {
              observation: "own payload data"
            }
          }
        }
      });
    } finally {
      delete Object.prototype.customerWorkflowArtifact;
    }
  });

  it("fails closed when customer workflow output tries to infer an automatic quality decision", async () => {
    const definition = createCustomerWorkflowApprovalBoundaryDefinition();
    const statePath = await createTempPath("ensen-flow-approval-", "runs/automatic-decision.jsonl");

    const result = await runWorkflow({
      definition,
      statePath,
      triggerContext: {
        requestId: "automatic-quality-decision",
        customerWorkflow: {
          ref: "public-release-approval",
          mode: "draft-only",
          erpNext: {
            siteRef: "erpnext-public-demo",
            objectType: "Sales Order",
            endpointRef: "erpnext-public-api"
          }
        }
      },
      stepHandler: () =>
        ({
          requestId: "req_automatic_quality_decision",
          status: "succeeded",
          observedAt: "2026-05-13T01:05:00.000Z",
          result: {
            status: "succeeded",
            output: {
              automaticQualityDecision: true,
              customerWorkflowArtifact: {
                artifactIntent: "draft-only",
                approvalState: "approval-required",
                externalApplicationState: "not-applied"
              }
            }
          }
        }) satisfies ExecutorConnectorStatusSnapshot
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["draft-action"][0]?.retry?.reason).toBe(
      "customer workflow output cannot infer automatic quality decisions"
    );
    await expect(readFile(statePath, "utf8")).resolves.not.toContain(
      "automaticQualityDecision"
    );
  });

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

  it("uses persisted customer workflow trigger context when resuming a run", async () => {
    const definition = createCustomerWorkflowApprovalBoundaryDefinition();
    delete definition.trigger.idempotencyKey;
    const statePath = await createTempPath("ensen-flow-approval-", "runs/resume-persisted-context.jsonl");
    const runId = `${definition.id}-local-run`;
    let stepHandlerCalled = false;

    await createWorkflowRun(statePath, {
      runId,
      workflowId: definition.id,
      workflowVersion: "flow.workflow.v1",
      trigger: {
        type: "manual",
        receivedAt: "2026-05-13T01:08:00.000Z",
        context: {
          requestId: "persisted-draft-context",
          customerWorkflow: {
            ref: "public-release-approval",
            mode: "draft-only",
            erpNext: {
              siteRef: "erpnext-public-demo",
              objectType: "Sales Order",
              endpointRef: "erpnext-public-api"
            }
          }
        }
      },
      createdAt: "2026-05-13T01:08:01.000Z"
    });

    const result = await runWorkflow({
      definition,
      statePath,
      stepHandler: ({ triggerContext }) => {
        stepHandlerCalled = true;
        expect(triggerContext).toMatchObject({
          customerWorkflow: {
            ref: "public-release-approval",
            mode: "draft-only"
          }
        });
        return {
          requestId: "req_resume_persisted_context",
          status: "succeeded",
          observedAt: "2026-05-13T01:08:02.000Z",
          result: {
            status: "succeeded",
            output: {
              customerWorkflowArtifact: {
                artifactIntent: "committed",
                approvalState: "approval-required",
                externalApplicationState: "not-applied"
              }
            }
          }
        } satisfies ExecutorConnectorStatusSnapshot;
      }
    });

    expect(stepHandlerCalled).toBe(true);
    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["draft-action"][0]?.retry?.reason).toBe(
      "draft-only customer workflow artifacts cannot be committed without explicit human approval"
    );
    await expect(readFile(statePath, "utf8")).resolves.not.toContain("customerWorkflowArtifact");
  });

  it.each([
    {
      executorStatus: "blocked",
      expectedAttemptStatus: "blocked",
      expectedRunStatus: "failed",
      expectedClassification: "blocked",
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

const createCustomerWorkflowApprovalBoundaryDefinition = (): WorkflowDefinition => ({
  schemaVersion: "flow.workflow.v1",
  id: "customer-approval-boundary-demo",
  metadata: {
    customerWorkflowAllowlist: {
      schemaVersion: "flow.customer-workflow-allowlist.v1",
      entries: [
        {
          customerWorkflowRef: "public-release-approval",
          modes: ["read-only", "draft-only"],
          erpNext: {
            siteRefs: ["erpnext-public-demo"],
            objectTypes: ["Sales Order"],
            endpointRefs: ["erpnext-public-api"]
          }
        }
      ]
    }
  },
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
      id: "draft-action",
      action: {
        type: "local",
        name: "draft_action"
      }
    }
  ]
});

const createClock = (timestamps: string[]): (() => string) => {
  let index = 0;

  return () => timestamps[Math.min(index++, timestamps.length - 1)];
};
