import { constants } from "node:fs";
import { access, chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createCliEnsenLoopEipExecutorTransport,
  createEnsenLoopEipExecutorConnector,
  runWorkflow
} from "../src/index.js";
import type {
  ExecutorConnector,
  ExecutorConnectorStatusSnapshot,
  WorkflowDefinition,
  WorkflowStepHandler
} from "../src/index.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("Flow X-Gate 3 caller smoke", () => {
  it.each([
    {
      laneStatus: "succeeded",
      loopStatus: "completed",
      expectedRunStatus: "succeeded",
      expectedAttemptStatus: "succeeded",
      summary: "Loop X-Gate 3 local fake lane succeeded."
    },
    {
      laneStatus: "failed",
      loopStatus: "failed",
      expectedRunStatus: "failed",
      expectedAttemptStatus: "failed",
      summary: "Loop X-Gate 3 local fake lane failed."
    },
    {
      laneStatus: "blocked",
      loopStatus: "blocked",
      expectedRunStatus: "failed",
      expectedAttemptStatus: "failed",
      summary: "Loop X-Gate 3 local fake lane blocked."
    }
  ] as const)(
    "exercises the Loop-shaped X-Gate 3 boundary end to end for $laneStatus",
    async ({
      laneStatus,
      loopStatus,
      expectedRunStatus,
      expectedAttemptStatus,
      summary
    }) => {
      const tempRoot = await createTempRoot("ensen-flow-xgate3-smoke-");
      const cliPath = await writeLoopXGate3SmokeCli(tempRoot, {
        laneStatus,
        loopStatus,
        summary
      });
      const statePath = join(tempRoot, "flow-state", `${laneStatus}.jsonl`);
      const connector = createEnsenLoopEipExecutorConnector({
        transport: createCliEnsenLoopEipExecutorTransport({
          command: process.execPath,
          args: [cliPath],
          xGate3Smoke: {
            workspaceRoot: join(tempRoot, "workspace-root"),
            stateRoot: join(tempRoot, "state-root")
          }
        }),
        now: () => "2026-05-01T05:00:00.000Z"
      });

      const result = await runWorkflow({
        definition: createXGate3SmokeDefinition(laneStatus),
        statePath,
        triggerContext: {
          requestId: `xgate3-${laneStatus}`
        },
        now: fixedClock(),
        stepHandler: createLoopConnectorStepHandler(connector)
      });

      expect(result.run.status).toBe(expectedRunStatus);
      expect(result.stepAttempts["xgate3-local-lane"]).toMatchObject([
        {
          attempt: 1,
          status: expectedAttemptStatus,
          result: {
            executor: {
              requestId: `req_flow_xgate3_${laneStatus}_xgate3_${laneStatus}_xgate3_local_lane_1`,
              status: laneStatus,
              result: {
                status: laneStatus,
                summary,
                evidence: {
                  verification: {
                    status: laneStatus === "succeeded" ? "passed" : laneStatus,
                    summary
                  },
                  localArtifacts: {
                    laneRunId: `lane_flow_xgate3_${laneStatus}`,
                    stateFile: "state/x-gate3/lane-run.jsonl",
                    evidenceMetadata: [
                      "evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-bundle.json",
                      "evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-lane.json"
                    ]
                  },
                  localArtifactSemantics: "local-development-references-only",
                  productionEvidence: false
                }
              }
            }
          }
        }
      ]);
      expect(JSON.stringify(result)).not.toContain("production evidence archive");
      expect(JSON.stringify(result)).not.toContain(tempRoot);
    }
  );

  it("fails closed before invoking Loop when Flow builds invalid protocol input", async () => {
    const tempRoot = await createTempRoot("ensen-flow-xgate3-invalid-input-");
    const invokedPath = join(tempRoot, "loop-invoked.txt");
    const cliPath = await writeLoopXGate3SmokeCli(tempRoot, {
      laneStatus: "succeeded",
      loopStatus: "completed",
      summary: "Loop X-Gate 3 local fake lane succeeded.",
      invokedPath
    });
    const connector = createEnsenLoopEipExecutorConnector({
      transport: createCliEnsenLoopEipExecutorTransport({
        command: process.execPath,
        args: [cliPath],
        xGate3Smoke: {
          workspaceRoot: join(tempRoot, "workspace-root"),
          stateRoot: join(tempRoot, "state-root")
        }
      }),
      now: () => "2026-05-01T05:00:00.000Z"
    });

    const result = await runWorkflow({
      definition: createXGate3SmokeDefinition("invalid-input"),
      statePath: join(tempRoot, "flow-state", "invalid-input.jsonl"),
      triggerContext: {
        requestId: "xgate3-invalid-input"
      },
      now: fixedClock(),
      stepHandler: createLoopConnectorStepHandler(connector, {
        idempotencyKey: "bad"
      })
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["xgate3-local-lane"]).toMatchObject([
      {
        attempt: 1,
        status: "failed",
        retry: {
          retryable: false,
          reason: "EIP RunRequest idempotencyKey is malformed"
        }
      }
    ]);
    await expect(access(invokedPath, constants.F_OK)).rejects.toMatchObject({
      code: "ENOENT"
    });
  });

  it("fails closed when X-Gate 3 local roots are unsafe", async () => {
    const tempRoot = await createTempRoot("ensen-flow-xgate3-unsafe-root-");
    const connector = createEnsenLoopEipExecutorConnector({
      transport: createCliEnsenLoopEipExecutorTransport({
        command: "unused-loop-cli",
        xGate3Smoke: {
          workspaceRoot: "workspace-root",
          stateRoot: join(tempRoot, "state-root")
        }
      }),
      now: () => "2026-05-01T05:00:00.000Z"
    });

    const result = await runWorkflow({
      definition: createXGate3SmokeDefinition("unsafe-root"),
      statePath: join(tempRoot, "flow-state", "unsafe-root.jsonl"),
      triggerContext: {
        requestId: "xgate3-unsafe-root"
      },
      now: fixedClock(),
      stepHandler: createLoopConnectorStepHandler(connector)
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["xgate3-local-lane"]).toMatchObject([
      {
        attempt: 1,
        status: "failed",
        retry: {
          retryable: false,
          reason:
            "Ensen-loop X-Gate 3 smoke roots must be non-empty absolute local path strings without traversal or credential-shaped values"
        }
      }
    ]);
  });

  it("fails closed when Loop returns an invalid X-Gate 3 aggregate", async () => {
    const tempRoot = await createTempRoot("ensen-flow-xgate3-invalid-aggregate-");
    const cliPath = join(tempRoot, "loop-x-gate3-invalid-cli.mjs");
    await writeFile(
      cliPath,
      [
        "#!/usr/bin/env node",
        "process.stdout.write(JSON.stringify({ schemaVersion: 'ensen-loop.x-gate3-local-lane-smoke.v2' }));",
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(cliPath, 0o755);
    const connector = createEnsenLoopEipExecutorConnector({
      transport: createCliEnsenLoopEipExecutorTransport({
        command: process.execPath,
        args: [cliPath],
        xGate3Smoke: {
          workspaceRoot: join(tempRoot, "workspace-root"),
          stateRoot: join(tempRoot, "state-root")
        }
      }),
      now: () => "2026-05-01T05:00:00.000Z"
    });

    const result = await runWorkflow({
      definition: createXGate3SmokeDefinition("invalid-aggregate"),
      statePath: join(tempRoot, "flow-state", "invalid-aggregate.jsonl"),
      triggerContext: {
        requestId: "xgate3-invalid-aggregate"
      },
      now: fixedClock(),
      stepHandler: createLoopConnectorStepHandler(connector)
    });

    expect(result.run.status).toBe("failed");
    expect(result.stepAttempts["xgate3-local-lane"]).toMatchObject([
      {
        attempt: 1,
        status: "failed",
        retry: {
          retryable: false,
          reason:
            "unsupported EIP XGateSmokeAggregate schemaVersion ensen-loop.x-gate3-local-lane-smoke.v2"
        }
      }
    ]);
    expect(JSON.stringify(result)).not.toContain("localArtifacts");
  });
});

const createTempRoot = async (prefix: string): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(root);
  return root;
};

const createXGate3SmokeDefinition = (name: string): WorkflowDefinition => ({
  schemaVersion: "flow.workflow.v1",
  id: `flow-xgate3-${name}`,
  name: `Flow X-Gate 3 ${name}`,
  trigger: {
    type: "manual",
    idempotencyKey: {
      source: "input",
      field: "requestId"
    }
  },
  steps: [
    {
      id: "xgate3-local-lane",
      action: {
        type: "local",
        name: "loop_xgate3_local_lane"
      }
    }
  ]
});

const createLoopConnectorStepHandler = (
  connector: ExecutorConnector,
  overrides: { idempotencyKey?: string } = {}
): WorkflowStepHandler => async ({ definition, step, attempt, triggerContext, runState }) => {
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
    idempotencyKey:
      overrides.idempotencyKey ?? `${definition.id}:${runState.run.runId}:${step.id}:${attempt}`,
    policyDecision: { decision: "allow" },
    source: {
      sourceId: "source_flow_xgate3_smoke",
      sourceType: "manual",
      externalRef: String(triggerContext.requestId ?? "xgate3-smoke")
    },
    requestedBy: {
      actorId: "actor_ensen_flow_smoke",
      actorType: "system",
      displayName: "Ensen-flow X-Gate 3 smoke"
    },
    workItem: {
      workItemId: `workitem_${definition.id.replaceAll("-", "_")}`,
      externalId: step.id,
      title: "Flow X-Gate 3 local fake lane smoke"
    },
    mode: "validate"
  });

  if (!submitted.ok) {
    throw new Error(submitted.error.reason ?? submitted.error.message);
  }

  const status = await connector.status({ requestId: submitted.value.requestId });
  if (!status.ok) {
    throw new Error(status.error.reason ?? status.error.message);
  }

  return status.value satisfies ExecutorConnectorStatusSnapshot;
};

const fixedClock = (): (() => string) => {
  let index = 0;
  const timestamps = [
    "2026-05-01T05:00:00.000Z",
    "2026-05-01T05:00:01.000Z",
    "2026-05-01T05:00:02.000Z",
    "2026-05-01T05:00:03.000Z",
    "2026-05-01T05:00:04.000Z"
  ];
  return () => timestamps[index++] ?? "2026-05-01T05:00:05.000Z";
};

const writeLoopXGate3SmokeCli = async (
  root: string,
  input: {
    laneStatus: "succeeded" | "failed" | "blocked";
    loopStatus: "completed" | "failed" | "blocked";
    summary: string;
    invokedPath?: string;
  }
): Promise<string> => {
  const cliPath = join(root, "loop-x-gate3-cli.mjs");
  await writeFile(
    cliPath,
    [
      "#!/usr/bin/env node",
      "import { readFileSync, writeFileSync } from 'node:fs';",
      `const invokedPath = ${JSON.stringify(input.invokedPath)};`,
      "if (invokedPath !== undefined) writeFileSync(invokedPath, 'invoked\\n');",
      "const [command, requestPath, workspaceFlag, workspaceRoot, stateFlag, stateRoot] = process.argv.slice(2);",
      "if (command !== 'x-gate3-smoke' || requestPath === undefined || workspaceFlag !== '--workspace-root' || stateFlag !== '--state-root') {",
      "  process.stderr.write('expected x-gate3-smoke <run-request-json-file> --workspace-root <workspace-root> --state-root <state-root>');",
      "  process.exitCode = 2;",
      "} else {",
      "  const request = JSON.parse(readFileSync(requestPath, 'utf8'));",
      "  process.stdout.write(JSON.stringify({",
      "    schemaVersion: 'ensen-loop.x-gate3-local-lane-smoke.v1',",
      "    boundary: 'local-cli-bounded-fake-lane',",
      "    requestId: request.id,",
      "    correlationId: request.correlationId,",
      "    mutatesRepository: false,",
      "    invokesProvider: false,",
      "    startsAgentProviderSession: false,",
      "    writesProductionEvidenceArchive: false,",
      "    statusSnapshot: {",
      "      schemaVersion: 'eip.run-status.v1',",
      "      id: 'sts_flow_xgate3_smoke',",
      "      requestId: request.id,",
      "      correlationId: request.correlationId,",
      `      status: ${JSON.stringify(input.loopStatus)},`,
      "      observedAt: '2026-05-01T05:00:02.000Z',",
      `      message: ${JSON.stringify(input.summary)}`,
      "    },",
      "    runResult: {",
      "      schemaVersion: 'eip.run-result.v1',",
      "      id: 'run_flow_xgate3_smoke',",
      "      requestId: request.id,",
      "      correlationId: request.correlationId,",
      `      status: ${JSON.stringify(input.laneStatus)},`,
      "      completedAt: '2026-05-01T05:00:03.000Z',",
      "      verification: {",
      `        status: ${JSON.stringify(input.laneStatus === "succeeded" ? "passed" : input.laneStatus)},`,
      `        summary: ${JSON.stringify(input.summary)}`,
      "      },",
      "      warnings: [{ code: 'local-lane-only', message: 'Local smoke reference only.' }]",
      "    },",
      "    localArtifacts: {",
      `      laneRunId: ${JSON.stringify(`lane_flow_xgate3_${input.laneStatus}`)},`,
      "      stateFile: 'state/x-gate3/lane-run.jsonl',",
      "      evidenceMetadata: [",
      "        'evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-bundle.json',",
      "        'evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-lane.json'",
      "      ]",
      "    }",
      "  }));",
      "}",
      "void workspaceRoot;",
      "void stateRoot;",
      ""
    ].join("\n"),
    "utf8"
  );
  await chmod(cliPath, 0o755);
  return cliPath;
};
