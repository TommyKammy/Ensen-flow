import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
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
        "const chunks = [];",
        "for await (const chunk of process.stdin) chunks.push(chunk);",
        "const envelope = JSON.parse(Buffer.concat(chunks).toString('utf8'));",
        "const requestId = envelope.request?.id ?? envelope.requestId;",
        "const correlationId = envelope.request?.correlationId ?? `corr_${requestId.slice(4)}`;",
        "switch (envelope.operation) {",
        "  case 'submit':",
        "    process.stdout.write(JSON.stringify({ requestId, acceptedAt: '2026-04-30T04:00:00.000Z' }));",
        "    break;",
        "  case 'status':",
        "    process.stdout.write(JSON.stringify({",
        "      schemaVersion: 'eip.run-status.v1',",
        "      id: 'sts_cli_loop_smoke',",
        "      requestId,",
        "      correlationId,",
        "      status: 'completed',",
        "      observedAt: '2026-04-30T04:00:02.000Z'",
        "    }));",
        "    break;",
        "  case 'result':",
        "    process.stdout.write(JSON.stringify({",
        "      schemaVersion: 'eip.run-result.v1',",
        "      id: 'run_cli_loop_smoke',",
        "      requestId,",
        "      correlationId,",
        "      status: 'succeeded',",
        "      completedAt: '2026-04-30T04:00:03.000Z',",
        "      verification: { status: 'passed', summary: 'CLI dry-run smoke completed.' },",
        "      evidenceBundles: [{ evidenceBundleId: 'evb_cli_loop_smoke', digest: 'sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef' }]",
        "    }));",
        "    break;",
        "  case 'evidence':",
        "    process.stdout.write(JSON.stringify({",
        "      schemaVersion: 'eip.evidence-bundle-ref.v1',",
        "      id: 'evb_cli_loop_smoke',",
        "      correlationId,",
        "      type: 'local_path',",
        "      uri: 'artifacts/evidence/cli-loop-smoke/bundle.json',",
        "      createdAt: '2026-04-30T04:00:03.000Z',",
        "      contentType: 'application/json'",
        "    }));",
        "    break;",
        "  default:",
        "    process.stderr.write(`unsupported operation ${envelope.operation}`);",
        "    process.exitCode = 2;",
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
          args: [cliPath]
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
    }
  ])("classifies CLI smoke failures as $name", async ({
    scriptBody,
    expectedClass
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
        args: [cliPath]
      });

      await expect(transport.getRunStatusSnapshot({ requestId: "req_cli_loop_smoke" }))
        .rejects.toMatchObject({
          failureClass: expectedClass,
          operation: "status"
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
        args: [cliPath],
        timeoutMs: 100
      });

      await expect(transport.getRunStatusSnapshot({ requestId: "req_cli_loop_smoke" }))
        .rejects.toMatchObject({
          failureClass: "loop-gap",
          operation: "status",
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
        "    schemaVersion: 'eip.run-status.v1',",
        "    id: 'sts_cli_loop_timeout_grace',",
        "    requestId: 'req_cli_loop_smoke',",
        "    correlationId: 'corr_cli_loop_timeout_grace',",
        "    status: 'completed',",
        "    observedAt: '2026-04-30T04:00:02.000Z'",
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
        args: [cliPath],
        timeoutMs: 100
      });

      await expect(transport.getRunStatusSnapshot({ requestId: "req_cli_loop_smoke" }))
        .resolves.toMatchObject({
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

    await expect(transport.getRunStatusSnapshot({ requestId: "req_cli_loop_smoke" }))
      .rejects.toBeInstanceOf(EnsenLoopCliTransportError);
    await expect(transport.getRunStatusSnapshot({ requestId: "req_cli_loop_smoke" }))
      .rejects.toMatchObject({
        failureClass: "flow-gap",
        operation: "status"
      });
  });
});
