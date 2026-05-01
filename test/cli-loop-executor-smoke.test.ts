import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  EnsenLoopCliTransportError,
  createCliEnsenLoopEipExecutorTransport,
  createEnsenLoopEipExecutorConnector,
  readWorkflowRunState,
  runWorkflow
} from "../src/index.js";
import type {
  ExecutorSubmitRequest,
  EipRunRequestV1,
  WorkflowDefinition
} from "../src/index.js";

describe("CLI-backed Ensen-loop executor smoke", () => {
  it("drives a workflow step through a local CLI stdout EIP boundary", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-cli-loop-smoke-"));
    const cliPath = join(tempRoot, "loop-dry-run-cli.mjs");
    const statePath = join(tempRoot, "runs", "cli-loop-smoke.jsonl");

    await writeFile(
      cliPath,
      [
        "#!/usr/bin/env node",
        "import { readFileSync } from 'node:fs';",
        "const command = process.argv[2];",
        "const requestPath = process.argv[3];",
        "if (command !== 'x-gate2-smoke' || requestPath === undefined) {",
        "  process.stderr.write('expected x-gate2-smoke <run-request-json-file>');",
        "  process.exitCode = 2;",
        "} else {",
        "  const request = JSON.parse(readFileSync(requestPath, 'utf8'));",
        "  const requestId = request.id;",
        "  const correlationId = request.correlationId;",
        "  process.stdout.write(JSON.stringify({",
        "    schemaVersion: 'ensen-loop.x-gate2-smoke.v1',",
        "    boundary: 'local-cli-stdout',",
        "    requestId,",
        "    correlationId,",
        "    mutatesRepository: false,",
        "    invokesProvider: false,",
        "    writesDurableEvidence: false,",
        "    statusSnapshot: {",
        "      schemaVersion: 'eip.run-status.v1',",
        "      id: 'sts_cli_loop_smoke',",
        "      requestId,",
        "      correlationId,",
        "      status: 'completed',",
        "      observedAt: '2026-04-30T04:00:02.000Z'",
        "    },",
        "    runResult: {",
        "      schemaVersion: 'eip.run-result.v1',",
        "      id: 'run_cli_loop_smoke',",
        "      requestId,",
        "      correlationId,",
        "      status: 'succeeded',",
        "      completedAt: '2026-04-30T04:00:03.000Z',",
        "      verification: { status: 'passed', summary: 'CLI dry-run smoke completed.' },",
        "      evidenceBundles: [{ evidenceBundleId: 'evb_cli_loop_smoke', digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }]",
        "    },",
        "    evidenceBundleRef: {",
        "      schemaVersion: 'eip.evidence-bundle-ref.v1',",
        "      id: 'evb_cli_loop_smoke',",
        "      correlationId,",
        "      type: 'local_path',",
        "      uri: 'artifacts/evidence/cli-loop-smoke/bundle.json',",
        "      createdAt: '2026-04-30T04:00:03.000Z',",
        "      contentType: 'application/json'",
        "    }",
        "  }));",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(cliPath, 0o755);

    try {
      const connector = createEnsenLoopEipExecutorConnector({
        transport: createCliEnsenLoopEipExecutorTransport({
          command: process.execPath,
          args: [cliPath, "x-gate2-smoke"]
        }),
        now: () => "2026-04-30T04:00:00.000Z"
      });
      const definition: WorkflowDefinition = {
        schemaVersion: "flow.workflow.v1",
        id: "cli-loop-smoke",
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
            id: "loop-dry-run",
            action: {
              type: "local",
              name: "loop_dry_run_cli"
            }
          }
        ]
      };

      const result = await runWorkflow({
        definition,
        statePath,
        triggerContext: { requestId: "cli-loop-smoke" },
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
          const submitRequest: ExecutorSubmitRequest = {
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
              smoke: true
            },
            source: {
              sourceId: "source_ensen_flow",
              sourceType: "manual",
              externalRef: "cli-smoke"
            },
            workItem: {
              workItemId: "workitem_cli_loop_smoke",
              externalId: "cli-loop-smoke",
              title: "CLI Loop dry-run smoke"
            }
          };
          const submitted = await connector.submit(submitRequest);

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
              summary: "CLI dry-run smoke completed.",
              evidence: {
                evidenceBundles: [
                  {
                    evidenceBundleId: "evb_cli_loop_smoke"
                  }
                ]
              }
            }
          });

          const evidence = await connector.fetchEvidence({ requestId: submitted.value.requestId });
          if (!evidence.ok) {
            throw new Error(evidence.error.reason ?? evidence.error.message);
          }

          expect(evidence.value.evidence).toMatchObject({
            schemaVersion: "eip.evidence-bundle-ref.v1",
            type: "local_path",
            uri: "artifacts/evidence/cli-loop-smoke/bundle.json"
          });
        }
      });

      expect(result.run.status).toBe("succeeded");

      const persisted = await readWorkflowRunState(statePath);
      expect(persisted.events.map((event) => event.type)).toEqual([
        "run.created",
        "step.attempt.started",
        "step.attempt.completed",
        "run.completed"
      ]);
      expect(persisted.stepAttempts["loop-dry-run"]).toMatchObject([
        {
          attempt: 1,
          status: "succeeded"
        }
      ]);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "protocol gap for non-JSON stdout",
      scriptBody: "process.stdout.write('not-json');",
      expectedClass: "protocol-gap"
    },
    {
      name: "loop gap for non-zero CLI exit",
      scriptBody: "process.stderr.write('dry-run CLI failed'); process.exitCode = 3;",
      expectedClass: "loop-gap"
    },
    {
      name: "loop gap for non-zero invalid smoke JSON",
      scriptBody:
        "process.stdout.write(JSON.stringify({ error: 'loop failed before aggregate' })); process.stderr.write('dry-run CLI failed'); process.exitCode = 3;",
      expectedClass: "loop-gap",
      expectedExitCode: 3,
      expectedStderr: "dry-run CLI failed"
    }
  ])("classifies CLI smoke failures as $name", async ({
    scriptBody,
    expectedClass,
    expectedExitCode,
    expectedStderr
  }) => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-cli-loop-failure-"));
    const cliPath = join(tempRoot, "loop-dry-run-cli.mjs");

    await writeFile(
      cliPath,
      [
        "#!/usr/bin/env node",
        "for await (const _chunk of process.stdin) { }",
        scriptBody,
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(cliPath, 0o755);

    try {
      const transport = createCliEnsenLoopEipExecutorTransport({
        command: process.execPath,
        args: [cliPath, "x-gate2-smoke"]
      });

      await expect(transport.submitRunRequest(createSmokeRunRequest()))
        .rejects.toMatchObject({
          failureClass: expectedClass,
          operation: "submit",
          ...(expectedExitCode === undefined ? {} : { exitCode: expectedExitCode }),
          ...(expectedStderr === undefined ? {} : { stderr: expectedStderr })
        });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      operation: "status",
      call: (transport: ReturnType<typeof createCliEnsenLoopEipExecutorTransport>) =>
        transport.getRunStatusSnapshot({ requestId: "req_missing_cli_loop_smoke" })
    },
    {
      operation: "result",
      call: (transport: ReturnType<typeof createCliEnsenLoopEipExecutorTransport>) =>
        transport.getRunResult({ requestId: "req_missing_cli_loop_smoke" })
    },
    {
      operation: "evidence",
      call: (transport: ReturnType<typeof createCliEnsenLoopEipExecutorTransport>) =>
        transport.getEvidenceBundleRef({ requestId: "req_missing_cli_loop_smoke" })
    }
  ])("labels missing cached aggregate errors as $operation", ({ operation, call }) => {
    const transport = createCliEnsenLoopEipExecutorTransport({
      command: "unused-loop-cli"
    });

    expect(() => call(transport)).toThrow(EnsenLoopCliTransportError);

    try {
      call(transport);
    } catch (error) {
      expect(error).toMatchObject({
        failureClass: "flow-gap",
        operation
      });
    }
  });

  it.each([
    {
      name: "status snapshot requestId",
      aggregate: {
        ...createSmokeAggregate(),
        statusSnapshot: {
          ...createSmokeAggregate().statusSnapshot,
          requestId: "req_wrong_cli_loop_smoke"
        }
      },
      expectedMessage: "EIP RunStatusSnapshot requestId does not match the submitted request"
    },
    {
      name: "top-level correlationId",
      aggregate: {
        ...createSmokeAggregate(),
        correlationId: "corr_wrong_cli_loop_smoke"
      },
      expectedMessage: "EIP XGate2SmokeAggregate correlationId does not match nested payloads"
    },
    {
      name: "run result schemaVersion",
      aggregate: {
        ...createSmokeAggregate(),
        runResult: {
          ...createSmokeAggregate().runResult,
          schemaVersion: "eip.run-result.v2"
        }
      },
      expectedMessage: "unsupported EIP RunResult schemaVersion eip.run-result.v2"
    },
    {
      name: "evidence bundle local path",
      aggregate: {
        ...createSmokeAggregate(),
        evidenceBundleRef: {
          ...createSmokeAggregate().evidenceBundleRef,
          uri: "../evidence/cli-loop-smoke/bundle.json"
        }
      },
      expectedMessage: "EIP EvidenceBundleRef local_path uri is malformed"
    }
  ])("rejects malformed nested aggregate $name before caching", async ({
    aggregate,
    expectedMessage
  }) => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-cli-loop-invalid-"));
    const cliPath = join(tempRoot, "loop-dry-run-cli.mjs");

    await writeFile(
      cliPath,
      [
        "#!/usr/bin/env node",
        `process.stdout.write(${JSON.stringify(JSON.stringify(aggregate))});`,
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(cliPath, 0o755);

    try {
      const transport = createCliEnsenLoopEipExecutorTransport({
        command: process.execPath,
        args: [cliPath, "x-gate2-smoke"]
      });

      await expect(transport.submitRunRequest(createSmokeRunRequest()))
        .rejects.toMatchObject({
          failureClass: "protocol-gap",
          operation: "submit",
          message: expectedMessage
        });
      expect(() =>
        transport.getRunStatusSnapshot({ requestId: "req_cli_loop_smoke" })
      ).toThrow(EnsenLoopCliTransportError);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("consumes a blocked smoke aggregate from non-zero CLI stdout", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-cli-loop-blocked-"));
    const cliPath = join(tempRoot, "loop-dry-run-cli.mjs");

    await writeFile(
      cliPath,
      [
        "#!/usr/bin/env node",
        "import { readFileSync } from 'node:fs';",
        "const requestPath = process.argv[3];",
        "const request = JSON.parse(readFileSync(requestPath, 'utf8'));",
        "process.stdout.write(JSON.stringify(createBlockedAggregate(request.id, request.correlationId)));",
        "process.stderr.write('blocked by Loop X-Gate 2 smoke prerequisites');",
        "process.exitCode = 1;",
        "function createBlockedAggregate(requestId, correlationId) {",
        "  return {",
        "    schemaVersion: 'ensen-loop.x-gate2-smoke.v1',",
        "    boundary: 'local-cli-stdout',",
        "    requestId,",
        "    correlationId,",
        "    mutatesRepository: false,",
        "    invokesProvider: false,",
        "    writesDurableEvidence: false,",
        "    statusSnapshot: {",
        "      schemaVersion: 'eip.run-status.v1',",
        "      id: 'sts_cli_loop_blocked',",
        "      requestId,",
        "      correlationId,",
        "      status: 'blocked',",
        "      observedAt: '2026-04-30T04:00:02.000Z',",
        "      message: 'Loop smoke blocked before external execution.'",
        "    },",
        "    runResult: {",
        "      schemaVersion: 'eip.run-result.v1',",
        "      id: 'run_cli_loop_blocked',",
        "      requestId,",
        "      correlationId,",
        "      status: 'blocked',",
        "      completedAt: '2026-04-30T04:00:03.000Z',",
        "      verification: {",
        "        status: 'blocked',",
        "        summary: 'Loop smoke blocked before external execution.'",
        "      },",
        "      errors: [{ code: 'missing-prerequisite', message: 'Loop smoke prerequisites are unavailable.' }]",
        "    }",
        "  };",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(cliPath, 0o755);

    try {
      const connector = createEnsenLoopEipExecutorConnector({
        transport: createCliEnsenLoopEipExecutorTransport({
          command: process.execPath,
          args: [cliPath, "x-gate2-smoke"]
        })
      });

      const submitted = await connector.submit({
        workflow: {
          id: "cli-loop-smoke",
          version: "flow.workflow.v1"
        },
        run: {
          id: "cli-loop-smoke"
        },
        step: {
          id: "loop-dry-run",
          attempt: 1
        },
        idempotencyKey: "cli-loop-smoke-0001",
        policyDecision: { decision: "allow" },
        source: createSmokeRunRequest().source,
        requestedBy: createSmokeRunRequest().requestedBy,
        workItem: createSmokeRunRequest().workItem
      });

      expect(submitted).toMatchObject({
        ok: true,
        value: {
          requestId: "req_cli_loop_smoke_loop_dry_run_1"
        }
      });

      const status = await connector.status({ requestId: "req_cli_loop_smoke_loop_dry_run_1" });

      expect(status).toMatchObject({
        ok: true,
        value: {
          requestId: "req_cli_loop_smoke_loop_dry_run_1",
          status: "blocked",
          flowControl: {
            state: "blocked"
          },
          result: {
            status: "blocked",
            summary: "Loop smoke blocked before external execution."
          }
        }
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      status: "succeeded",
      runStatus: "completed",
      summary: "Loop X-Gate 3 local fake lane succeeded."
    },
    {
      status: "failed",
      runStatus: "failed",
      summary: "Loop X-Gate 3 local fake lane failed."
    },
    {
      status: "blocked",
      runStatus: "blocked",
      summary: "Loop X-Gate 3 local fake lane blocked."
    }
  ])("consumes a valid X-Gate 3 local lane aggregate with $status result", async ({
    status,
    runStatus,
    summary
  }) => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-cli-loop-xgate3-"));
    const cliPath = join(tempRoot, "loop-x-gate3-cli.mjs");

    await writeFile(
      cliPath,
      [
        "#!/usr/bin/env node",
        "import { readFileSync } from 'node:fs';",
        "const requestPath = process.argv[3];",
        "const request = JSON.parse(readFileSync(requestPath, 'utf8'));",
        "process.stdout.write(JSON.stringify({",
        "  ...createXGate3Aggregate(request.id, request.correlationId),",
        `  statusSnapshot: { ...createXGate3Aggregate(request.id, request.correlationId).statusSnapshot, status: ${JSON.stringify(runStatus)}, message: ${JSON.stringify(summary)} },`,
        `  runResult: { ...createXGate3Aggregate(request.id, request.correlationId).runResult, status: ${JSON.stringify(status)}, verification: { status: ${JSON.stringify(status)}, summary: ${JSON.stringify(summary)} } }`,
        "}));",
        `if (${JSON.stringify(status)} === 'blocked') process.exitCode = 1;`,
        `if (${JSON.stringify(status)} === 'failed') process.exitCode = 2;`,
        "function createXGate3Aggregate(requestId, correlationId) { return {",
        "  schemaVersion: 'ensen-loop.x-gate3-local-lane-smoke.v1',",
        "  boundary: 'local-cli-bounded-fake-lane',",
        "  requestId,",
        "  correlationId,",
        "  mutatesRepository: false,",
        "  invokesProvider: false,",
        "  startsAgentProviderSession: false,",
        "  writesProductionEvidenceArchive: false,",
        "  statusSnapshot: {",
        "    schemaVersion: 'eip.run-status.v1',",
        "    id: 'sts_cli_loop_xgate3',",
        "    requestId,",
        "    correlationId,",
        "    status: 'completed',",
        "    observedAt: '2026-05-01T04:00:02.000Z'",
        "  },",
        "  runResult: {",
        "    schemaVersion: 'eip.run-result.v1',",
        "    id: 'run_cli_loop_xgate3',",
        "    requestId,",
        "    correlationId,",
        "    status: 'succeeded',",
        "    completedAt: '2026-05-01T04:00:03.000Z',",
        "    verification: {",
        "      status: 'passed',",
        "      summary: 'Loop X-Gate 3 local fake lane succeeded.'",
        "    }",
        "  },",
        "  localArtifacts: {",
        "    laneRunId: 'lane_xgate3_smoke',",
        "    stateFile: 'state/x-gate3/lane-run.jsonl',",
        "    evidenceMetadata: [",
        "      'evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-bundle.json',",
        "      'evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-lane.json'",
        "    ]",
        "  }",
        "}; }",
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(cliPath, 0o755);

    try {
      const connector = createEnsenLoopEipExecutorConnector({
        transport: createCliEnsenLoopEipExecutorTransport({
          command: process.execPath,
          args: [cliPath, "x-gate3-smoke"]
        })
      });

      const submitted = await connector.submit({
        workflow: {
          id: "cli-loop-smoke",
          version: "flow.workflow.v1"
        },
        run: {
          id: "cli-loop-smoke"
        },
        step: {
          id: "loop-dry-run",
          attempt: 1
        },
        idempotencyKey: "cli-loop-smoke-0001",
        policyDecision: { decision: "allow" },
        source: createSmokeRunRequest().source,
        requestedBy: createSmokeRunRequest().requestedBy,
        workItem: createSmokeRunRequest().workItem
      });

      expect(submitted).toMatchObject({
        ok: true,
        value: {
          requestId: "req_cli_loop_smoke_loop_dry_run_1"
        }
      });

      const result = await connector.status({ requestId: "req_cli_loop_smoke_loop_dry_run_1" });

      expect(result).toMatchObject({
        ok: true,
        value: {
          requestId: "req_cli_loop_smoke_loop_dry_run_1",
          status: status === "succeeded" ? "succeeded" : status,
          result: {
            status,
            summary,
            evidence: {
              localArtifacts: {
                laneRunId: "lane_xgate3_smoke",
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
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "empty evidenceMetadata",
      localArtifacts: {
        ...createXGate3Aggregate().localArtifacts,
        evidenceMetadata: []
      }
    },
    {
      name: "omitted evidenceMetadata",
      localArtifacts: {
        laneRunId: createXGate3Aggregate().localArtifacts.laneRunId,
        stateFile: createXGate3Aggregate().localArtifacts.stateFile
      }
    }
  ])("accepts X-Gate 3 local artifacts with $name", async ({ localArtifacts }) => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-cli-loop-xgate3-metadata-"));
    const cliPath = join(tempRoot, "loop-x-gate3-cli.mjs");
    const aggregate = {
      ...createXGate3Aggregate(),
      localArtifacts
    };

    await writeFile(
      cliPath,
      [
        "#!/usr/bin/env node",
        "import { readFileSync } from 'node:fs';",
        "const request = JSON.parse(readFileSync(process.argv[3], 'utf8'));",
        `const aggregate = ${JSON.stringify(aggregate)};`,
        "aggregate.requestId = request.id;",
        "aggregate.correlationId = request.correlationId;",
        "aggregate.statusSnapshot.requestId = request.id;",
        "aggregate.statusSnapshot.correlationId = request.correlationId;",
        "aggregate.runResult.requestId = request.id;",
        "aggregate.runResult.correlationId = request.correlationId;",
        "process.stdout.write(JSON.stringify(aggregate));",
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(cliPath, 0o755);

    try {
      const connector = createEnsenLoopEipExecutorConnector({
        transport: createCliEnsenLoopEipExecutorTransport({
          command: process.execPath,
          args: [cliPath, "x-gate3-smoke"]
        })
      });

      const submitted = await connector.submit(createSmokeSubmitRequest());
      expect(submitted).toMatchObject({
        ok: true,
        value: {
          requestId: "req_cli_loop_smoke_loop_dry_run_1"
        }
      });

      const result = await connector.status({ requestId: "req_cli_loop_smoke_loop_dry_run_1" });
      expect(result).toMatchObject({
        ok: true,
        value: {
          result: {
            evidence: {
              localArtifacts: {
                laneRunId: "lane_xgate3_smoke",
                stateFile: "state/x-gate3/lane-run.jsonl",
                evidenceMetadata: []
              },
              localArtifactSemantics: "local-development-references-only",
              productionEvidence: false
            }
          }
        }
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "unknown top-level field",
      aggregate: {
        ...createXGate3Aggregate(),
        providerRan: false
      },
      expectedMessage: "EIP XGate3LocalLaneSmokeAggregate has unsupported field providerRan"
    },
    {
      name: "mismatched requestId",
      aggregate: {
        ...createXGate3Aggregate(),
        requestId: "req_wrong_cli_loop_smoke"
      },
      expectedMessage:
        "EIP XGate3LocalLaneSmokeAggregate requestId does not match the submitted request"
    },
    {
      name: "mismatched correlationId",
      aggregate: {
        ...createXGate3Aggregate(),
        correlationId: "corr_wrong_cli_loop_smoke"
      },
      expectedMessage:
        "EIP XGate3LocalLaneSmokeAggregate correlationId does not match nested payloads"
    },
    {
      name: "unexpected repository mutation flag",
      aggregate: {
        ...createXGate3Aggregate(),
        mutatesRepository: true
      },
      expectedMessage: "EIP XGate3LocalLaneSmokeAggregate mutatesRepository must be false"
    },
    {
      name: "unexpected provider invocation flag",
      aggregate: {
        ...createXGate3Aggregate(),
        invokesProvider: true
      },
      expectedMessage: "EIP XGate3LocalLaneSmokeAggregate invokesProvider must be false"
    },
    {
      name: "unexpected agent-provider session flag",
      aggregate: {
        ...createXGate3Aggregate(),
        startsAgentProviderSession: true
      },
      expectedMessage:
        "EIP XGate3LocalLaneSmokeAggregate startsAgentProviderSession must be false"
    },
    {
      name: "unexpected production evidence archive flag",
      aggregate: {
        ...createXGate3Aggregate(),
        writesProductionEvidenceArchive: true
      },
      expectedMessage:
        "EIP XGate3LocalLaneSmokeAggregate writesProductionEvidenceArchive must be false"
    },
    {
      name: "non-array evidence metadata",
      aggregate: {
        ...createXGate3Aggregate(),
        localArtifacts: {
          ...createXGate3Aggregate().localArtifacts,
          evidenceMetadata: "evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-bundle.json"
        }
      },
      expectedMessage:
        "EIP XGate3LocalLaneSmokeAggregate localArtifacts.evidenceMetadata must be an array"
    },
    {
      name: "traversing local artifact path",
      aggregate: {
        ...createXGate3Aggregate(),
        localArtifacts: {
          ...createXGate3Aggregate().localArtifacts,
          evidenceMetadata: ["../state/x-gate3/aggregate.json"]
        }
      },
      expectedMessage:
        "EIP XGate3LocalLaneSmokeAggregate localArtifacts.evidenceMetadata[0] is malformed"
    },
    {
      name: "absolute local artifact path",
      aggregate: {
        ...createXGate3Aggregate(),
        localArtifacts: {
          ...createXGate3Aggregate().localArtifacts,
          evidenceMetadata: ["/tmp/x-gate3/aggregate.json"]
        }
      },
      expectedMessage:
        "EIP XGate3LocalLaneSmokeAggregate localArtifacts.evidenceMetadata[0] is malformed"
    },
    {
      name: "home-relative local artifact path",
      aggregate: {
        ...createXGate3Aggregate(),
        localArtifacts: {
          ...createXGate3Aggregate().localArtifacts,
          evidenceMetadata: ["~/state/x-gate3/aggregate.json"]
        }
      },
      expectedMessage:
        "EIP XGate3LocalLaneSmokeAggregate localArtifacts.evidenceMetadata[0] is malformed"
    },
    {
      name: "user-home-relative local artifact path",
      aggregate: {
        ...createXGate3Aggregate(),
        localArtifacts: {
          ...createXGate3Aggregate().localArtifacts,
          evidenceMetadata: ["~operator/state/x-gate3/aggregate.json"]
        }
      },
      expectedMessage:
        "EIP XGate3LocalLaneSmokeAggregate localArtifacts.evidenceMetadata[0] is malformed"
    },
    {
      name: "unsafe state file path",
      aggregate: {
        ...createXGate3Aggregate(),
        localArtifacts: {
          ...createXGate3Aggregate().localArtifacts,
          stateFile: "../state/x-gate3/lane-run.jsonl"
        }
      },
      expectedMessage: "EIP XGate3LocalLaneSmokeAggregate localArtifacts.stateFile is malformed"
    },
    {
      name: "credential-shaped local artifact metadata path",
      aggregate: {
        ...createXGate3Aggregate(),
        localArtifacts: {
          ...createXGate3Aggregate().localArtifacts,
          evidenceMetadata: ["state/x-gate3/token=sample-secret/log.txt"]
        }
      },
      expectedMessage:
        "EIP XGate3LocalLaneSmokeAggregate localArtifacts.evidenceMetadata[0] is malformed"
    },
    {
      name: "underscore-delimited GitHub token artifact value",
      aggregate: {
        ...createXGate3Aggregate(),
        localArtifacts: {
          ...createXGate3Aggregate().localArtifacts,
          evidenceMetadata: ["state/x-gate3/ghp_sampletokenvalue/log.txt"]
        }
      },
      expectedMessage:
        "EIP XGate3LocalLaneSmokeAggregate localArtifacts.evidenceMetadata[0] is malformed"
    },
    {
      name: "underscore-delimited GitHub fine-grained token artifact value",
      aggregate: {
        ...createXGate3Aggregate(),
        localArtifacts: {
          ...createXGate3Aggregate().localArtifacts,
          evidenceMetadata: ["state/x-gate3/github_pat_sampletokenvalue/log.txt"]
        }
      },
      expectedMessage:
        "EIP XGate3LocalLaneSmokeAggregate localArtifacts.evidenceMetadata[0] is malformed"
    }
  ])("rejects malformed X-Gate 3 local lane aggregate $name", async ({
    aggregate,
    expectedMessage
  }) => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-cli-loop-xgate3-invalid-"));
    const cliPath = join(tempRoot, "loop-x-gate3-cli.mjs");

    await writeFile(
      cliPath,
      [
        "#!/usr/bin/env node",
        `process.stdout.write(${JSON.stringify(JSON.stringify(aggregate))});`,
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(cliPath, 0o755);

    try {
      const transport = createCliEnsenLoopEipExecutorTransport({
        command: process.execPath,
        args: [cliPath, "x-gate3-smoke"]
      });

      await expect(transport.submitRunRequest(createSmokeRunRequest()))
        .rejects.toMatchObject({
          failureClass: "protocol-gap",
          operation: "submit",
          message: expectedMessage
        });
      expect(() =>
        transport.getRunResult({ requestId: "req_cli_loop_smoke" })
      ).toThrow(EnsenLoopCliTransportError);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "production evidence claim",
      extension: {
        localArtifacts: createXGate3Aggregate().localArtifacts,
        localArtifactSemantics: "local-development-references-only",
        productionEvidence: true
      }
    },
    {
      name: "unsupported local artifact field",
      extension: {
        localArtifacts: {
          ...createXGate3Aggregate().localArtifacts,
          evidenceMetadata: [
            {
              kind: "aggregate-json",
              path: "state/x-gate3/aggregate.json",
              durableEvidenceArchive: true
            }
          ]
        },
        localArtifactSemantics: "local-development-references-only",
        productionEvidence: false
      }
    },
    {
      name: "unsupported local lane field",
      extension: {
        localArtifacts: createXGate3Aggregate().localArtifacts,
        localArtifactSemantics: "local-development-references-only",
        productionEvidence: false,
        providerRan: true
      }
    }
  ])("does not surface unsafe X-Gate 3 local lane evidence from $name", async ({
    extension
  }) => {
    const transport = createFakeTransportWithResultExtension(extension);
    const connector = createEnsenLoopEipExecutorConnector({ transport });
    const submitted = await connector.submit(createSmokeSubmitRequest());
    if (!submitted.ok) {
      throw new Error(submitted.error.reason ?? submitted.error.message);
    }

    const result = await connector.status({ requestId: submitted.value.requestId });

    expect(result).toMatchObject({
      ok: true,
      value: {
        result: {
          evidence: {
            verification: {
              summary: "Loop X-Gate 3 local fake lane succeeded."
            }
          }
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain("localArtifacts");
    expect(JSON.stringify(result)).not.toContain("productionEvidence");
    expect(JSON.stringify(result)).not.toContain("providerRan");
  });

  it.each([
    {
      name: "protocol gap for unsupported successful aggregate shape",
      scriptBody:
        "process.stdout.write(JSON.stringify({ schemaVersion: 'ensen-loop.x-gate3-local-lane-smoke.v2' }));",
      expectedClass: "protocol-gap"
    },
    {
      name: "loop gap for non-zero invalid aggregate shape",
      scriptBody:
        "process.stdout.write(JSON.stringify({ schemaVersion: 'ensen-loop.x-gate3-local-lane-smoke.v2' })); process.exitCode = 3;",
      expectedClass: "loop-gap"
    }
  ])("classifies X-Gate 3 invalid aggregate output as $name", async ({
    scriptBody,
    expectedClass
  }) => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-cli-loop-xgate3-class-"));
    const cliPath = join(tempRoot, "loop-x-gate3-cli.mjs");

    await writeFile(
      cliPath,
      ["#!/usr/bin/env node", scriptBody, ""].join("\n"),
      "utf8"
    );
    await chmod(cliPath, 0o755);

    try {
      const transport = createCliEnsenLoopEipExecutorTransport({
        command: process.execPath,
        args: [cliPath, "x-gate3-smoke"]
      });

      await expect(transport.submitRunRequest(createSmokeRunRequest()))
        .rejects.toMatchObject({
          failureClass: expectedClass,
          operation: "submit"
        });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("invokes X-Gate 3 smoke with explicit local roots and cleans the request file", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-cli-loop-xgate3-roots-"));
    const cliPath = join(tempRoot, "loop-x-gate3-cli.mjs");
    const observedArgsPath = join(tempRoot, "observed-args.json");
    const workspaceRoot = join(tempRoot, "workspace-root");
    const stateRoot = join(tempRoot, "state-root");

    await writeFile(
      cliPath,
      [
        "#!/usr/bin/env node",
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "const observedArgsPath = process.env.OBSERVED_ARGS_PATH;",
        "const command = process.argv[2];",
        "const requestPath = process.argv[3];",
        "const workspaceFlag = process.argv[4];",
        "const stateFlag = process.argv[6];",
        "if (observedArgsPath === undefined) throw new Error('missing observed args path');",
        "writeFileSync(observedArgsPath, JSON.stringify({ args: process.argv.slice(2), requestPath }));",
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
        "      id: 'sts_cli_loop_xgate3_roots',",
        "      requestId: request.id,",
        "      correlationId: request.correlationId,",
        "      status: 'completed',",
        "      observedAt: '2026-05-01T04:00:02.000Z'",
        "    },",
        "    runResult: {",
        "      schemaVersion: 'eip.run-result.v1',",
        "      id: 'run_cli_loop_xgate3_roots',",
        "      requestId: request.id,",
        "      correlationId: request.correlationId,",
        "      status: 'succeeded',",
        "      completedAt: '2026-05-01T04:00:03.000Z',",
        "      verification: { status: 'passed', summary: 'Loop X-Gate 3 local fake lane succeeded.' }",
        "    },",
        "    localArtifacts: {",
        "      laneRunId: 'lane_xgate3_roots',",
        "      stateFile: 'state/x-gate3/lane-run.jsonl',",
        "      evidenceMetadata: [",
        "        'evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-bundle.json',",
        "        'evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-lane.json'",
        "      ]",
        "    }",
        "  }));",
        "}",
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(cliPath, 0o755);

    try {
      const transport = createCliEnsenLoopEipExecutorTransport({
        command: process.execPath,
        args: [cliPath],
        env: {
          ...process.env,
          OBSERVED_ARGS_PATH: observedArgsPath
        },
        xGate3Smoke: {
          workspaceRoot,
          stateRoot
        }
      });

      await expect(transport.submitRunRequest(createSmokeRunRequest())).resolves.toMatchObject({
        requestId: "req_cli_loop_smoke"
      });

      const observed = JSON.parse(await readFile(observedArgsPath, "utf8")) as {
        args: string[];
        requestPath: string;
      };
      expect(observed.args).toEqual([
        "x-gate3-smoke",
        observed.requestPath,
        "--workspace-root",
        workspaceRoot,
        "--state-root",
        stateRoot
      ]);
      await expect(readFile(observed.requestPath, "utf8")).rejects.toMatchObject({
        code: "ENOENT"
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it.each([
    {
      name: "empty workspace root",
      workspaceRoot: (_tempRoot: string) => "",
      stateRoot: (tempRoot: string) => join(tempRoot, "state-root")
    },
    {
      name: "relative workspace root",
      workspaceRoot: (_tempRoot: string) => "workspace-root",
      stateRoot: (tempRoot: string) => join(tempRoot, "state-root")
    },
    {
      name: "URL-style workspace root",
      workspaceRoot: (_tempRoot: string) => "https://example.test/workspace-root",
      stateRoot: (tempRoot: string) => join(tempRoot, "state-root")
    },
    {
      name: "scheme-like workspace root",
      workspaceRoot: (_tempRoot: string) => "flow-root:workspace-root",
      stateRoot: (tempRoot: string) => join(tempRoot, "state-root")
    },
    {
      name: "traversal-style workspace root",
      workspaceRoot: (tempRoot: string) => `${join(tempRoot, "workspace-root")}/../other-root`,
      stateRoot: (tempRoot: string) => join(tempRoot, "state-root")
    },
    {
      name: "credential-shaped state root",
      workspaceRoot: (tempRoot: string) => join(tempRoot, "workspace-root"),
      stateRoot: (tempRoot: string) => `${join(tempRoot, "state-root")}?token=sample-secret`
    }
  ])("rejects unsafe X-Gate 3 local roots before invoking Loop: $name", async ({
    workspaceRoot,
    stateRoot
  }) => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-cli-loop-xgate3-root-guard-"));
    const transport = createCliEnsenLoopEipExecutorTransport({
      command: "unused-loop-cli",
      xGate3Smoke: {
        workspaceRoot: workspaceRoot(tempRoot),
        stateRoot: stateRoot(tempRoot)
      }
    });

    try {
      await expect(transport.submitRunRequest(createSmokeRunRequest())).rejects.toMatchObject({
        failureClass: "flow-gap",
        operation: "submit",
        message:
          "Ensen-loop X-Gate 3 smoke roots must be non-empty absolute local path strings without traversal or credential-shaped values"
      });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("times out a CLI process that ignores SIGTERM", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-cli-loop-timeout-"));
    const cliPath = join(tempRoot, "loop-dry-run-cli.mjs");

    await writeFile(
      cliPath,
      [
        "#!/usr/bin/env node",
        "process.on('SIGTERM', () => {",
        "  process.stderr.write('ignored SIGTERM');",
        "});",
        "for await (const _chunk of process.stdin) { }",
        "setInterval(() => {}, 1000);",
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(cliPath, 0o755);

    try {
      const transport = createCliEnsenLoopEipExecutorTransport({
        command: process.execPath,
        args: [cliPath, "x-gate2-smoke"],
        timeoutMs: 100
      });

      await expect(transport.submitRunRequest(createSmokeRunRequest()))
        .rejects.toMatchObject({
          failureClass: "loop-gap",
          operation: "submit",
          stderr: "ignored SIGTERM"
        });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("does not classify a CLI process that closes during timeout grace as timed out", async () => {
    const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-cli-loop-timeout-"));
    const cliPath = join(tempRoot, "loop-dry-run-cli.mjs");

    await writeFile(
      cliPath,
      [
        "#!/usr/bin/env node",
        "process.on('SIGTERM', () => {",
        "  process.stdout.write(JSON.stringify({",
        "    schemaVersion: 'ensen-loop.x-gate2-smoke.v1',",
        "    statusSnapshot: {",
        "      schemaVersion: 'eip.run-status.v1',",
        "      id: 'sts_cli_loop_timeout_grace',",
        "      requestId: 'req_cli_loop_smoke',",
        "      correlationId: 'corr_cli_loop_smoke',",
        "      status: 'completed',",
        "      observedAt: '2026-04-30T04:00:02.000Z'",
        "    },",
        "    runResult: {",
        "      schemaVersion: 'eip.run-result.v1',",
        "      id: 'run_cli_loop_timeout_grace',",
        "      requestId: 'req_cli_loop_smoke',",
        "      correlationId: 'corr_cli_loop_smoke',",
        "      status: 'succeeded',",
        "      completedAt: '2026-04-30T04:00:03.000Z'",
        "    }",
        "  }));",
        "  process.exit(0);",
        "});",
        "for await (const _chunk of process.stdin) { }",
        "setInterval(() => {}, 1000);",
        ""
      ].join("\n"),
      "utf8"
    );
    await chmod(cliPath, 0o755);

    try {
      const transport = createCliEnsenLoopEipExecutorTransport({
        command: process.execPath,
        args: [cliPath, "x-gate2-smoke"],
        timeoutMs: 100
      });

      await expect(transport.submitRunRequest(createSmokeRunRequest())).resolves.toMatchObject({
        requestId: "req_cli_loop_smoke"
      });
      expect(transport.getRunStatusSnapshot({ requestId: "req_cli_loop_smoke" }))
        .toMatchObject({
          schemaVersion: "eip.run-status.v1",
          requestId: "req_cli_loop_smoke",
          status: "completed"
        });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("classifies an unstartable CLI command as a flow gap", async () => {
    const transport = createCliEnsenLoopEipExecutorTransport({
      command: "ensen-flow-missing-loop-cli-command"
    });

    await expect(transport.submitRunRequest(createSmokeRunRequest()))
      .rejects.toBeInstanceOf(EnsenLoopCliTransportError);
    await expect(transport.submitRunRequest(createSmokeRunRequest()))
      .rejects.toMatchObject({
        failureClass: "flow-gap",
        operation: "submit"
      });
  });
});

const createSmokeRunRequest = (): EipRunRequestV1 => ({
  schemaVersion: "eip.run-request.v1",
  id: "req_cli_loop_smoke",
  correlationId: "corr_cli_loop_smoke",
  idempotencyKey: "cli-loop-smoke-0001",
  source: {
    sourceId: "source_ensen_flow",
    sourceType: "manual",
    externalRef: "cli-smoke"
  },
  requestedBy: {
    actorId: "actor_ensen_flow",
    actorType: "system",
    displayName: "Ensen-flow"
  },
  workItem: {
    workItemId: "workitem_cli_loop_smoke",
    externalId: "cli-loop-smoke",
    title: "CLI Loop dry-run smoke"
  },
  mode: "validate",
  createdAt: "2026-04-30T04:00:00.000Z"
});

const createSmokeAggregate = () => ({
  schemaVersion: "ensen-loop.x-gate2-smoke.v1",
  boundary: "local-cli-stdout",
  requestId: "req_cli_loop_smoke",
  correlationId: "corr_cli_loop_smoke",
  mutatesRepository: false,
  invokesProvider: false,
  writesDurableEvidence: false,
  statusSnapshot: {
    schemaVersion: "eip.run-status.v1",
    id: "sts_cli_loop_smoke",
    requestId: "req_cli_loop_smoke",
    correlationId: "corr_cli_loop_smoke",
    status: "completed",
    observedAt: "2026-04-30T04:00:02.000Z"
  },
  runResult: {
    schemaVersion: "eip.run-result.v1",
    id: "run_cli_loop_smoke",
    requestId: "req_cli_loop_smoke",
    correlationId: "corr_cli_loop_smoke",
    status: "succeeded",
    completedAt: "2026-04-30T04:00:03.000Z",
    verification: {
      status: "passed",
      summary: "CLI dry-run smoke completed."
    }
  },
  evidenceBundleRef: {
    schemaVersion: "eip.evidence-bundle-ref.v1",
    id: "evb_cli_loop_smoke",
    correlationId: "corr_cli_loop_smoke",
    type: "local_path",
    uri: "artifacts/evidence/cli-loop-smoke/bundle.json",
    createdAt: "2026-04-30T04:00:03.000Z",
    contentType: "application/json"
  }
});

const createXGate3Aggregate = () => ({
  schemaVersion: "ensen-loop.x-gate3-local-lane-smoke.v1",
  boundary: "local-cli-bounded-fake-lane",
  requestId: "req_cli_loop_smoke",
  correlationId: "corr_cli_loop_smoke",
  mutatesRepository: false,
  invokesProvider: false,
  startsAgentProviderSession: false,
  writesProductionEvidenceArchive: false,
  statusSnapshot: {
    schemaVersion: "eip.run-status.v1",
    id: "sts_cli_loop_xgate3",
    requestId: "req_cli_loop_smoke",
    correlationId: "corr_cli_loop_smoke",
    status: "completed",
    observedAt: "2026-05-01T04:00:02.000Z"
  },
  runResult: {
    schemaVersion: "eip.run-result.v1",
    id: "run_cli_loop_xgate3",
    requestId: "req_cli_loop_smoke",
    correlationId: "corr_cli_loop_smoke",
    status: "succeeded",
    completedAt: "2026-05-01T04:00:03.000Z",
    verification: {
      status: "passed",
      summary: "Loop X-Gate 3 local fake lane succeeded."
    }
  },
  localArtifacts: {
    laneRunId: "lane_xgate3_smoke",
    stateFile: "state/x-gate3/lane-run.jsonl",
    evidenceMetadata: [
      "evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-bundle.json",
      "evidence/run_01HV7Y8M8F2KQ5W3P9R6T4N2AB-lane.json"
    ]
  }
});

const createSmokeSubmitRequest = (): ExecutorSubmitRequest => ({
  workflow: {
    id: "cli-loop-smoke",
    version: "flow.workflow.v1"
  },
  run: {
    id: "cli-loop-smoke"
  },
  step: {
    id: "loop-dry-run",
    attempt: 1
  },
  idempotencyKey: "cli-loop-smoke-0001",
  policyDecision: { decision: "allow" },
  source: createSmokeRunRequest().source,
  requestedBy: createSmokeRunRequest().requestedBy,
  workItem: createSmokeRunRequest().workItem
});

const createFakeTransportWithResultExtension = (extension: Record<string, unknown>) => {
  const requestIds: string[] = [];
  const submittedRunRequests: EipRunRequestV1[] = [];
  return {
    submittedRunRequests,
    submitRunRequest(request: EipRunRequestV1) {
      requestIds.push(request.id);
      submittedRunRequests.push(request);
      return {
        requestId: request.id,
        acceptedAt: "2026-05-01T04:00:01.000Z"
      };
    },
    getRunStatusSnapshot({ requestId }: { requestId: string }) {
      if (!requestIds.includes(requestId)) {
        throw new Error("unknown request");
      }
      return {
        schemaVersion: "eip.run-status.v1",
        id: "sts_cli_loop_xgate3_extension",
        requestId,
        correlationId: "corr_cli_loop_smoke",
        status: "completed",
        observedAt: "2026-05-01T04:00:02.000Z"
      };
    },
    getRunResult({ requestId }: { requestId: string }) {
      if (!requestIds.includes(requestId)) {
        throw new Error("unknown request");
      }
      return {
        schemaVersion: "eip.run-result.v1",
        id: "run_cli_loop_xgate3_extension",
        requestId,
        correlationId: "corr_cli_loop_smoke",
        status: "succeeded",
        completedAt: "2026-05-01T04:00:03.000Z",
        verification: {
          status: "passed",
          summary: "Loop X-Gate 3 local fake lane succeeded."
        },
        extensions: {
          "x-ensen-flow-local-lane": extension
        }
      };
    },
    getEvidenceBundleRef() {
      throw new Error("evidence should not be fetched");
    }
  };
};
