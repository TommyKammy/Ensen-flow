import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  createInMemoryLocalFileIdempotencyStore,
  createLocalFileConnector,
  readWorkflowRunState,
  runWorkflow
} from "../src/index.js";
import type {
  LocalFileSubmitRequest,
  WorkflowDefinition
} from "../src/index.js";

const tempRoots: string[] = [];

const createTempRoot = async (): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "ensen-flow-file-connector-"));
  tempRoots.push(root);
  return root;
};

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});

describe("local file connector skeleton", () => {
  it("reads local fixture files under an explicit allowed root with sanitized evidence", async () => {
    const fixtureRoot = await createTempRoot();
    await mkdir(join(fixtureRoot, "inputs"), { recursive: true });
    await writeFile(join(fixtureRoot, "inputs", "payload.txt"), "fixture payload", "utf8");
    const connector = createLocalFileConnector({
      allowedRoots: [{ alias: "fixture-root", path: fixtureRoot }],
      now: () => "2026-05-02T04:00:00.000Z"
    });

    const result = await connector.submit({
      workflowId: "file-demo",
      runId: "file-demo-run",
      stepId: "read-fixture",
      idempotencyKey: "file-demo-run:read-fixture",
      file: {
        action: "read",
        rootAlias: "fixture-root",
        path: "inputs/payload.txt"
      }
    });

    expect(result).toMatchObject({
      ok: true,
      connectorId: "local-file",
      operation: "submit",
      value: {
        requestId: "local-file-file-demo-run-read-fixture",
        acceptedAt: "2026-05-02T04:00:00.000Z",
        file: {
          action: "read",
          rootAlias: "fixture-root",
          path: "inputs/payload.txt",
          bytes: 15
        },
        output: {
          content: "fixture payload"
        },
        evidence: {
          kind: "local-file-fixture",
          rootAlias: "fixture-root",
          path: "inputs/payload.txt"
        }
      }
    });
    expect(JSON.stringify(result)).not.toContain(fixtureRoot);
  });

  it("writes local fixture files idempotently without leaking absolute paths", async () => {
    const fixtureRoot = await createTempRoot();
    const idempotencyStore = createInMemoryLocalFileIdempotencyStore();
    const connector = createLocalFileConnector({
      allowedRoots: [{ alias: "fixture-root", path: fixtureRoot }],
      idempotencyStore,
      now: () => "2026-05-02T04:01:00.000Z"
    });
    const recreatedConnector = createLocalFileConnector({
      allowedRoots: [{ alias: "fixture-root", path: fixtureRoot }],
      idempotencyStore,
      now: () => "2026-05-02T04:01:01.000Z"
    });
    const request: LocalFileSubmitRequest = {
      workflowId: "file-demo",
      runId: "file-demo-run",
      stepId: "write-fixture",
      idempotencyKey: "file-demo-run:write-fixture",
      file: {
        action: "write",
        rootAlias: "fixture-root",
        path: "outputs/result.txt",
        content: "first write"
      }
    };

    const first = await connector.submit(request);
    await writeFile(join(fixtureRoot, "outputs", "result.txt"), "tampered", "utf8");
    const replay = await recreatedConnector.submit(request);

    expect(first).toEqual(replay);
    await expect(readFile(join(fixtureRoot, "outputs", "result.txt"), "utf8")).resolves.toBe(
      "tampered"
    );
    expect(JSON.stringify(first)).not.toContain(fixtureRoot);
  });

  it("rejects changed replays from a shared idempotency store after connector recreation", async () => {
    const fixtureRoot = await createTempRoot();
    const idempotencyStore = createInMemoryLocalFileIdempotencyStore();
    const connector = createLocalFileConnector({
      allowedRoots: [{ alias: "fixture-root", path: fixtureRoot }],
      idempotencyStore
    });
    const recreatedConnector = createLocalFileConnector({
      allowedRoots: [{ alias: "fixture-root", path: fixtureRoot }],
      idempotencyStore
    });
    const request: LocalFileSubmitRequest = {
      workflowId: "file-demo",
      runId: "file-demo-run",
      stepId: "write-fixture",
      idempotencyKey: "file-demo-run:write-fixture",
      file: {
        action: "write",
        rootAlias: "fixture-root",
        path: "outputs/result.txt",
        content: "first write"
      }
    };

    await expect(connector.submit(request)).resolves.toMatchObject({ ok: true });
    await expect(
      recreatedConnector.submit({
        ...request,
        file: {
          ...request.file,
          content: "changed write"
        }
      })
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "invalid-request",
        message:
          "local file idempotencyKey reuse must keep workflowId/runId/stepId/action/rootAlias/path/content unchanged",
        retryable: false
      }
    });
  });

  it("serializes concurrent same-key submissions through the shared idempotency store", async () => {
    const fixtureRoot = await createTempRoot();
    const idempotencyStore = createInMemoryLocalFileIdempotencyStore();
    const timestamps = [
      "2026-05-02T04:01:10.000Z",
      "2026-05-02T04:01:11.000Z"
    ];
    let timestampIndex = 0;
    const connector = createLocalFileConnector({
      allowedRoots: [{ alias: "fixture-root", path: fixtureRoot }],
      idempotencyStore,
      now: () => timestamps[Math.min(timestampIndex++, timestamps.length - 1)]
    });
    const request: LocalFileSubmitRequest = {
      workflowId: "file-demo",
      runId: "file-demo-run",
      stepId: "write-fixture",
      idempotencyKey: "file-demo-run:write-fixture",
      file: {
        action: "write",
        rootAlias: "fixture-root",
        path: "outputs/result.txt",
        content: "first write"
      }
    };

    const [first, second] = await Promise.all([
      connector.submit(request),
      connector.submit(request)
    ]);

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      ok: true,
      value: {
        acceptedAt: "2026-05-02T04:01:10.000Z"
      }
    });
    await expect(readFile(join(fixtureRoot, "outputs", "result.txt"), "utf8")).resolves.toBe(
      "first write"
    );
  });

  it.each([
    {
      name: "path traversal",
      file: {
        action: "read",
        rootAlias: "fixture-root",
        path: "../outside.txt"
      },
      message: "local file path must stay under the allowed root"
    },
    {
      name: "absolute path",
      file: {
        action: "read",
        rootAlias: "fixture-root",
        path: join(tmpdir(), "outside.txt")
      },
      message: "local file path must be relative to an allowed root"
    },
    {
      name: "unsupported action",
      file: {
        action: "delete",
        rootAlias: "fixture-root",
        path: "outputs/result.txt"
      },
      message: "local file action must be read or write"
    }
  ])("fails closed for unsafe local file requests: $name", async ({ file, message }) => {
    const fixtureRoot = await createTempRoot();
    const connector = createLocalFileConnector({
      allowedRoots: [{ alias: "fixture-root", path: fixtureRoot }]
    });

    await expect(
      connector.submit({
        workflowId: "file-demo",
        runId: "file-demo-run",
        stepId: "file-step",
        idempotencyKey: "file-demo-run:file-step",
        file
      } as LocalFileSubmitRequest)
    ).resolves.toMatchObject({
      ok: false,
      operation: "submit",
      error: {
        code: "invalid-request",
        message,
        retryable: false
      }
    });
  });

  it("rejects unsafe allowed root configuration before fixture operations are available", () => {
    expect(() =>
      createLocalFileConnector({
        allowedRoots: [{ alias: "fixture-root", path: "relative-fixtures" }]
      })
    ).toThrow("local file allowed root path must be absolute");
  });

  it("records retryable file connector failures in run state with sanitized evidence", async () => {
    const tempRoot = await createTempRoot();
    const fixtureRoot = join(tempRoot, "fixtures");
    const statePath = join(tempRoot, "state", "file-demo.jsonl");
    const connector = createLocalFileConnector({
      allowedRoots: [{ alias: "fixture-root", path: fixtureRoot }]
    });

    const result = await runWorkflow({
      definition: fileWorkflow,
      statePath,
      runId: "file-demo-run",
      now: createClock([
        "2026-05-02T04:02:00.000Z",
        "2026-05-02T04:02:00.000Z",
        "2026-05-02T04:02:01.000Z",
        "2026-05-02T04:02:02.000Z",
        "2026-05-02T04:02:03.000Z",
        "2026-05-02T04:02:04.000Z",
        "2026-05-02T04:02:05.000Z"
      ]),
      stepHandler: async ({ attempt, runState, step }) => {
        if (attempt === 2) {
          await mkdir(join(fixtureRoot, "inputs"), { recursive: true });
          await writeFile(join(fixtureRoot, "inputs", "ready.txt"), "ready", "utf8");
        }

        const submitted = await connector.submit({
          workflowId: runState.run.workflowId,
          runId: runState.run.runId,
          stepId: step.id,
          idempotencyKey: `${runState.run.runId}:${step.id}:attempt-${attempt}`,
          file: {
            action: "read",
            rootAlias: "fixture-root",
            path: attempt === 1 ? "inputs/missing.txt" : "inputs/ready.txt"
          }
        });

        if (!submitted.ok) {
          throw new Error(submitted.error.message);
        }

        return {
          executor: {
            requestId: submitted.value.requestId,
            status: "succeeded",
            result: {
              status: "succeeded",
              summary: submitted.value.file.summary,
              evidence: submitted.value.evidence
            }
          }
        };
      }
    });

    const persisted = await readWorkflowRunState(statePath);

    expect(result.run.status).toBe("succeeded");
    expect(persisted.stepAttempts["read-fixture"]).toMatchObject([
      {
        attempt: 1,
        status: "retryable-failed",
        retry: {
          retryable: true,
          reason: "local file read target was not found"
        }
      },
      {
        attempt: 2,
        status: "succeeded",
        result: {
          executor: {
            result: {
              evidence: {
                kind: "local-file-fixture",
                rootAlias: "fixture-root",
                path: "inputs/ready.txt"
              }
            }
          }
        }
      }
    ]);
    expect(JSON.stringify(persisted)).not.toContain(fixtureRoot);
  });
});

const fileWorkflow: WorkflowDefinition = {
  schemaVersion: "flow.workflow.v1",
  id: "file-demo",
  trigger: {
    type: "manual"
  },
  steps: [
    {
      id: "read-fixture",
      action: {
        type: "local",
        name: "local_file_read"
      },
      retry: {
        maxAttempts: 2,
        backoff: {
          strategy: "none"
        }
      }
    }
  ]
};

const createClock = (timestamps: string[]): (() => string) => {
  let index = 0;

  return () => timestamps[Math.min(index++, timestamps.length - 1)];
};
