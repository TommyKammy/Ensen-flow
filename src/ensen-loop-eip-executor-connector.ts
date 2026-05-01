import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize } from "node:path";

import {
  createExecutorConnectorCapabilities,
  createUnsupportedExecutorConnectorOperationResult,
  mapExecutorPolicyDecisionToFlowControlState
} from "./executor-connector.js";
import type {
  ConnectorErrorBody,
  ConnectorResult
} from "./connector.js";
import type {
  EipRunRequestActorRef,
  EipRunRequestMode,
  EipRunRequestPolicyContext,
  EipRunRequestSourceRef,
  EipRunRequestTarget,
  EipRunRequestWorkItem,
  ExecutorConnector,
  ExecutorConnectorCancelRequest,
  ExecutorConnectorCancelResult,
  ExecutorConnectorExecutionResult,
  ExecutorConnectorExecutionStatus,
  ExecutorConnectorFetchEvidenceRequest,
  ExecutorConnectorFetchEvidenceResult,
  ExecutorConnectorResultStatus,
  ExecutorConnectorStatusRequest,
  ExecutorConnectorStatusResult,
  ExecutorConnectorStatusSnapshot,
  ExecutorConnectorSubmitResult,
  ExecutorFlowControlState,
  ExecutorSubmitRequest
} from "./executor-connector.js";

export interface EipRunRequestV1 {
  schemaVersion: "eip.run-request.v1";
  id: string;
  correlationId: string;
  idempotencyKey: string;
  source: EipRunRequestSourceRef;
  requestedBy: EipRunRequestActorRef;
  workItem: EipRunRequestWorkItem;
  mode: EipRunRequestMode;
  createdAt: string;
  target?: EipRunRequestTarget;
  policyContext?: EipRunRequestPolicyContext;
  dataClassification?: string;
  extensions?: Record<string, unknown>;
}

export interface EnsenLoopEipExecutorTransport {
  submitRunRequest(
    request: EipRunRequestV1
  ):
    | Promise<{ requestId?: string; acceptedAt?: string; evidence?: Record<string, unknown> }>
    | { requestId?: string; acceptedAt?: string; evidence?: Record<string, unknown> };
  getRunStatusSnapshot(request: { requestId: string }): Promise<unknown> | unknown;
  getRunResult(request: { requestId: string }): Promise<unknown> | unknown;
  getEvidenceBundleRef(request: { requestId: string }): Promise<unknown> | unknown;
  cancelRunRequest?(
    request: ExecutorConnectorCancelRequest
  ):
    | Promise<{ requestId?: string; cancelled?: boolean; observedAt?: string }>
    | { requestId?: string; cancelled?: boolean; observedAt?: string };
}

export type EnsenLoopCliFailureClass = "protocol-gap" | "loop-gap" | "flow-gap";

export class EnsenLoopCliTransportError extends Error {
  readonly failureClass: EnsenLoopCliFailureClass;
  readonly operation: EnsenLoopCliOperation;
  readonly exitCode?: number;
  readonly stderr?: string;

  constructor(input: {
    message: string;
    failureClass: EnsenLoopCliFailureClass;
    operation: EnsenLoopCliOperation;
    exitCode?: number;
    stderr?: string;
  }) {
    super(input.message);
    this.name = "EnsenLoopCliTransportError";
    this.failureClass = input.failureClass;
    this.operation = input.operation;
    this.exitCode = input.exitCode;
    this.stderr = input.stderr;
  }
}

export type EnsenLoopCliOperation = "submit" | "status" | "result" | "evidence";

const cliTerminationGraceMs = 1000;

export interface CreateCliEnsenLoopEipExecutorTransportInput {
  command: string;
  args?: string[];
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  xGate3Smoke?: {
    workspaceRoot: string;
    stateRoot: string;
  };
}

export interface CreateEnsenLoopEipExecutorConnectorInput {
  connectorId?: string;
  transport: EnsenLoopEipExecutorTransport;
  now?: () => string;
}

export interface CreateFakeEnsenLoopEipExecutorTransportInput {
  acceptedAt?: string;
  observedAt?: string;
  completedAt?: string;
  verificationSummary?: string;
  statusSnapshots?: FakeEnsenLoopEipPayload[];
  result?: FakeEnsenLoopEipPayload;
  evidenceBundleRef?: FakeEnsenLoopEipPayload;
}

export interface FakeEnsenLoopEipExecutorTransport extends EnsenLoopEipExecutorTransport {
  readonly submittedRunRequests: EipRunRequestV1[];
}

export type FakeEnsenLoopEipPayload =
  | Record<string, unknown>
  | unknown[]
  | string
  | number
  | boolean
  | null
  | ((context: FakeEnsenLoopEipPayloadContext) => unknown);

export interface FakeEnsenLoopEipPayloadContext {
  requestId: string;
  request?: EipRunRequestV1;
}

interface FakeEnsenLoopEipRecord {
  request: EipRunRequestV1;
  statusIndex: number;
}

interface JsonCliInvocationResult {
  payload: unknown;
  exitCode: number | null;
  stderr: string;
}

export const createCliEnsenLoopEipExecutorTransport = (
  input: CreateCliEnsenLoopEipExecutorTransportInput
): EnsenLoopEipExecutorTransport => {
  const smokeAggregates = new Map<string, EnsenLoopSmokeAggregateV1>();

  return {
    async submitRunRequest(request: EipRunRequestV1) {
      const aggregate = await invokeEnsenLoopSmokeCli(input, request);
      smokeAggregates.set(request.id, aggregate);

      return {
        requestId: request.id,
        acceptedAt: aggregate.statusSnapshot.observedAt
      };
    },
    getRunStatusSnapshot(request: { requestId: string }) {
      return requireSmokeAggregate(smokeAggregates, request.requestId, "status").statusSnapshot;
    },
    getRunResult(request: { requestId: string }) {
      return enrichSmokeRunResult(
        requireSmokeAggregate(smokeAggregates, request.requestId, "result")
      );
    },
    getEvidenceBundleRef(request: { requestId: string }) {
      return requireSmokeAggregate(smokeAggregates, request.requestId, "evidence").evidenceBundleRef;
    }
  };
};

// Lower-level helper for CLIs that explicitly support Flow's per-operation stdin envelope.
// The real Ensen-loop X-Gate 2 smoke command is a one-shot aggregate stdout contract;
// use createCliEnsenLoopEipExecutorTransport for that boundary.
export const createPerOperationCliEnsenLoopEipExecutorTransport = (
  input: CreateCliEnsenLoopEipExecutorTransportInput
): EnsenLoopEipExecutorTransport => ({
  submitRunRequest(request: EipRunRequestV1) {
    return invokePerOperationEnsenLoopCli(input, {
      operation: "submit",
      request
    }) as Promise<{ requestId?: string; acceptedAt?: string; evidence?: Record<string, unknown> }>;
  },
  getRunStatusSnapshot(request: { requestId: string }) {
    return invokePerOperationEnsenLoopCli(input, {
      operation: "status",
      requestId: request.requestId
    });
  },
  getRunResult(request: { requestId: string }) {
    return invokePerOperationEnsenLoopCli(input, {
      operation: "result",
      requestId: request.requestId
    });
  },
  getEvidenceBundleRef(request: { requestId: string }) {
    return invokePerOperationEnsenLoopCli(input, {
      operation: "evidence",
      requestId: request.requestId
    });
  }
});

export const createEnsenLoopEipExecutorConnector = (
  input: CreateEnsenLoopEipExecutorConnectorInput
): ExecutorConnector => {
  const connectorId = input.connectorId ?? "ensen-loop-eip";
  const now = input.now ?? (() => new Date().toISOString());

  return {
    identity: {
      id: connectorId,
      displayName: "Ensen-loop EIP Executor Connector",
      version: "eip.run-request.v1"
    },
    capabilities: {
      ...createExecutorConnectorCapabilities(),
      cancel:
        input.transport.cancelRunRequest === undefined
          ? {
              supported: false,
              reason: "transport does not support cancellation"
            }
          : { supported: true }
    },
    async submit(request: ExecutorSubmitRequest): Promise<ExecutorConnectorSubmitResult> {
      const payload = createRunRequestPayload(request, now());
      const payloadValidation = validateRunRequest(payload);

      if (payloadValidation !== undefined) {
        return invalidRequest(
          connectorId,
          "submit",
          payloadValidation.message,
          payloadValidation.reason,
          "flow-gap"
        );
      }

      const submitted = await input.transport.submitRunRequest(payload);
      const requestId = submitted.requestId ?? payload.id;

      return {
        ok: true,
        connectorId,
        operation: "submit",
        value: {
          requestId,
          acceptedAt: submitted.acceptedAt,
          flowControl: mapExecutorPolicyDecisionToFlowControlState(
            request.policyDecision ?? { decision: "allow" }
          ),
          ...(submitted.evidence === undefined ? {} : { evidence: submitted.evidence })
        }
      };
    },
    async status(request: ExecutorConnectorStatusRequest): Promise<ExecutorConnectorStatusResult> {
      const snapshot = await input.transport.getRunStatusSnapshot(request);
      const statusVersion = requireSchemaVersion(
        snapshot,
        "eip.run-status.v1",
        "RunStatusSnapshot"
      );

      if (statusVersion !== undefined) {
        return invalidRequest(connectorId, "status", statusVersion.message, statusVersion.reason);
      }

      const statusValidation = validateRunStatusSnapshot(snapshot, request.requestId);

      if (statusValidation !== undefined) {
        return invalidRequest(
          connectorId,
          "status",
          statusValidation.message,
          statusValidation.reason
        );
      }

      const status = snapshot as EipRunStatusSnapshotV1;
      const mappedStatus = mapRunStatus(status.status);

      if (hasTerminalRunResult(status.status)) {
        const result = await input.transport.getRunResult(request);
        const resultVersion = requireSchemaVersion(result, "eip.run-result.v1", "RunResult");

        if (resultVersion !== undefined) {
          return invalidRequest(connectorId, "status", resultVersion.message, resultVersion.reason);
        }

        const resultValidation = validateRunResult(result, request.requestId);

        if (resultValidation !== undefined) {
          return invalidRequest(
            connectorId,
            "status",
            resultValidation.message,
            resultValidation.reason
          );
        }

        return {
          ok: true,
          connectorId,
          operation: "status",
          value: mapRunResultToStatusSnapshot(result as EipRunResultV1, status.observedAt)
        };
      }

      return {
        ok: true,
        connectorId,
        operation: "status",
        value: {
          requestId: status.requestId,
          status: mappedStatus,
          observedAt: status.observedAt,
          ...(status.message === undefined
            ? {}
            : { evidence: { message: status.message, progress: status.progress } }),
          ...(mappedStatus === "blocked" || mappedStatus === "needs-review"
            ? { flowControl: flowControlForStatus(mappedStatus, status.message) }
            : {}),
          ...(mappedStatus === "failed" || mappedStatus === "cancelled" || mappedStatus === "blocked"
            ? {
                result: {
                  status: resultStatusForExecutionStatus(mappedStatus),
                  ...(status.message === undefined ? {} : { summary: status.message })
                }
              }
            : {})
        }
      };
    },
    async cancel(request: ExecutorConnectorCancelRequest): Promise<ExecutorConnectorCancelResult> {
      if (input.transport.cancelRunRequest === undefined) {
        return createUnsupportedExecutorConnectorOperationResult({
          connectorId,
          operation: "cancel",
          reason: "transport does not support cancellation"
        });
      }

      const cancelled = await input.transport.cancelRunRequest(request);
      const cancelValidation = validateCancelReceipt(cancelled, request.requestId);

      if (cancelValidation !== undefined) {
        return invalidRequest(connectorId, "cancel", cancelValidation.message, cancelValidation.reason);
      }

      const cancelReceipt = cancelled as {
        requestId?: string;
        cancelled: boolean;
        observedAt?: string;
      };

      return {
        ok: true,
        connectorId,
        operation: "cancel",
        value: {
          requestId: cancelReceipt.requestId ?? request.requestId,
          cancelled: cancelReceipt.cancelled,
          observedAt: cancelReceipt.observedAt
        }
      };
    },
    async fetchEvidence(
      request: ExecutorConnectorFetchEvidenceRequest
    ): Promise<ExecutorConnectorFetchEvidenceResult> {
      const evidence = await input.transport.getEvidenceBundleRef(request);
      const evidenceVersion = requireSchemaVersion(
        evidence,
        "eip.evidence-bundle-ref.v1",
        "EvidenceBundleRef"
      );

      if (evidenceVersion !== undefined) {
        return invalidRequest(
          connectorId,
          "fetchEvidence",
          evidenceVersion.message,
          evidenceVersion.reason
        );
      }

      const evidenceValidation = validateEvidenceBundleRef(evidence);

      if (evidenceValidation !== undefined) {
        return invalidRequest(
          connectorId,
          "fetchEvidence",
          evidenceValidation.message,
          evidenceValidation.reason
        );
      }

      return {
        ok: true,
        connectorId,
        operation: "fetchEvidence",
        value: {
          requestId: request.requestId,
          evidence: evidence as Record<string, unknown>
        }
      };
    }
  };
};

const invokeEnsenLoopSmokeCli = async (
  input: CreateCliEnsenLoopEipExecutorTransportInput,
  request: EipRunRequestV1
): Promise<EnsenLoopSmokeAggregateV1> => {
  const tempRoot = await mkdtemp(join(tmpdir(), "ensen-flow-loop-smoke-"));
  const requestPath = join(tempRoot, "run-request.json");

  try {
    await writeFile(requestPath, `${JSON.stringify(request, null, 2)}\n`, "utf8");
    const cliResult = await invokeJsonCli({
      input: {
        ...input,
        args: createSmokeCliArgs(input, requestPath)
      },
      operation: "submit",
      allowNonZeroJsonStdout: true,
      returnResultMetadata: true
    }) as JsonCliInvocationResult;
    const aggregate = cliResult.payload;
    const invalidAggregateFailureClass =
      cliResult.exitCode === 0 ? "protocol-gap" : "loop-gap";
    const invalidAggregateEvidence = {
      ...(cliResult.exitCode === null || cliResult.exitCode === 0
        ? {}
        : { exitCode: cliResult.exitCode }),
      ...(cliResult.stderr.length === 0 ? {} : { stderr: cliResult.stderr })
    };
    if (!isRecord(aggregate)) {
      throw new EnsenLoopCliTransportError({
        message: "Ensen-loop smoke aggregate must be an object",
        failureClass: invalidAggregateFailureClass,
        operation: "submit",
        ...invalidAggregateEvidence
      });
    }

    const aggregateValidation = validateSmokeAggregate(aggregate, request.id);

    if (aggregateValidation !== undefined) {
      throw new EnsenLoopCliTransportError({
        message: aggregateValidation.message,
        failureClass: invalidAggregateFailureClass,
        operation: "submit",
        ...invalidAggregateEvidence
      });
    }

    return aggregate as unknown as EnsenLoopSmokeAggregateV1;
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
};

const createSmokeCliArgs = (
  input: CreateCliEnsenLoopEipExecutorTransportInput,
  requestPath: string
): string[] => {
  if (input.xGate3Smoke === undefined) {
    return [...(input.args ?? []), requestPath];
  }

  const { workspaceRoot, stateRoot } = input.xGate3Smoke;
  if (!isUsableLocalRoot(workspaceRoot) || !isUsableLocalRoot(stateRoot)) {
    throw new EnsenLoopCliTransportError({
      message:
        "Ensen-loop X-Gate 3 smoke roots must be non-empty absolute local path strings without traversal or credential-shaped values",
      failureClass: "flow-gap",
      operation: "submit"
    });
  }

  return [
    ...(input.args ?? []),
    "x-gate3-smoke",
    requestPath,
    "--workspace-root",
    workspaceRoot,
    "--state-root",
    stateRoot
  ];
};

const requireSmokeAggregate = (
  smokeAggregates: Map<string, EnsenLoopSmokeAggregateV1>,
  requestId: string,
  operation: EnsenLoopCliOperation
): EnsenLoopSmokeAggregateV1 => {
  const aggregate = smokeAggregates.get(requestId);

  if (aggregate === undefined) {
    throw new EnsenLoopCliTransportError({
      message: `Ensen-loop X-Gate 2 smoke aggregate is unavailable for request ${requestId}`,
      failureClass: "flow-gap",
      operation
    });
  }

  return aggregate;
};

const invokePerOperationEnsenLoopCli = async (
  input: CreateCliEnsenLoopEipExecutorTransportInput,
  envelope: {
    operation: EnsenLoopCliOperation;
    request?: EipRunRequestV1;
    requestId?: string;
  }
): Promise<unknown> => {
  return invokeJsonCli({
    input,
    operation: envelope.operation,
    stdin: `${JSON.stringify(envelope)}\n`
  });
};

const invokeJsonCli = async (run: {
  input: CreateCliEnsenLoopEipExecutorTransportInput;
  operation: EnsenLoopCliOperation;
  stdin?: string;
  allowNonZeroJsonStdout?: boolean;
  returnResultMetadata?: boolean;
}): Promise<unknown> => {
  const { input, operation } = run;
  const child = spawn(input.command, input.args ?? [], {
    cwd: input.cwd,
    env: input.env,
    stdio: ["pipe", "pipe", "pipe"],
    shell: false
  });
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let timeout: NodeJS.Timeout | undefined;
  let escalationTimeout: NodeJS.Timeout | undefined;

  type CompletionResult = {
    type: "completion";
    code: number | null;
    signal: NodeJS.Signals | null;
  };
  type TimeoutResult = { type: "timeout" };
  type CliResult = CompletionResult | TimeoutResult;

  const completion = new Promise<CliResult>(
    (resolve, reject) => {
      child.once("error", (error) => {
        reject(
          new EnsenLoopCliTransportError({
            message: `failed to start Ensen-loop CLI transport: ${error.message}`,
            failureClass: "flow-gap",
            operation
          })
        );
      });
      child.once("close", (code, signal) => {
        resolve({ type: "completion", code, signal });
      });
    }
  );

  child.stdout.on("data", (chunk: Buffer) => {
    stdoutChunks.push(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderrChunks.push(chunk);
  });

  const timeoutPromise =
    input.timeoutMs === undefined
      ? undefined
      : new Promise<CliResult>((resolve) => {
          timeout = setTimeout(() => {
            child.kill("SIGTERM");
            escalationTimeout = setTimeout(() => {
              if (child.exitCode === null && child.signalCode === null) {
                child.kill("SIGKILL");
              }
              resolve({ type: "timeout" });
            }, cliTerminationGraceMs);
          }, input.timeoutMs);
        });

  child.stdin.end(run.stdin ?? "");

  const result = await (timeoutPromise === undefined
    ? completion
    : Promise.race([completion, timeoutPromise])).finally(() => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
    if (escalationTimeout !== undefined) {
      clearTimeout(escalationTimeout);
    }
  });
  const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

  if (result.type === "timeout") {
    throw new EnsenLoopCliTransportError({
      message: `Ensen-loop CLI transport timed out during ${operation}`,
      failureClass: "loop-gap",
      operation,
      stderr
    });
  }

  const { code, signal } = result;

  const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();

  if (code !== 0 && run.allowNonZeroJsonStdout !== true) {
    throw new EnsenLoopCliTransportError({
      message: `Ensen-loop CLI transport failed during ${operation} with exit code ${code ?? signal ?? "unknown"}`,
      failureClass: "loop-gap",
      operation,
      ...(code === null ? {} : { exitCode: code }),
      ...(stderr.length === 0 ? {} : { stderr })
    });
  }

  if (stdout.length === 0) {
    throw new EnsenLoopCliTransportError({
      message:
        code === 0
          ? `Ensen-loop CLI transport returned empty stdout during ${operation}`
          : `Ensen-loop CLI transport failed during ${operation} with exit code ${code ?? signal ?? "unknown"} and empty stdout`,
      failureClass: code === 0 ? "protocol-gap" : "loop-gap",
      operation,
      ...(code === null || code === 0 ? {} : { exitCode: code }),
      ...(stderr.length === 0 ? {} : { stderr })
    });
  }

  try {
    const payload = JSON.parse(stdout) as unknown;
    if (run.returnResultMetadata === true) {
      return {
        payload,
        exitCode: code,
        stderr
      } satisfies JsonCliInvocationResult;
    }
    return payload;
  } catch (error) {
    throw new EnsenLoopCliTransportError({
      message:
        code === 0
          ? `Ensen-loop CLI transport returned non-JSON stdout during ${operation}`
          : `Ensen-loop CLI transport failed during ${operation} with exit code ${code ?? signal ?? "unknown"} and non-JSON stdout`,
      failureClass: code === 0 ? "protocol-gap" : "loop-gap",
      operation,
      ...(code === null || code === 0 ? {} : { exitCode: code }),
      ...(stderr.length === 0 ? {} : { stderr })
    });
  }
};

export const createFakeEnsenLoopEipExecutorTransport = (
  input: CreateFakeEnsenLoopEipExecutorTransportInput = {}
): FakeEnsenLoopEipExecutorTransport => {
  const submittedRunRequests: EipRunRequestV1[] = [];
  const records = new Map<string, FakeEnsenLoopEipRecord>();

  return {
    get submittedRunRequests() {
      return submittedRunRequests;
    },
    submitRunRequest(request: EipRunRequestV1) {
      submittedRunRequests.push(request);
      records.set(request.id, {
        request,
        statusIndex: 0
      });

      return {
        requestId: request.id,
        acceptedAt: input.acceptedAt ?? "2026-04-30T04:00:00.000Z",
        evidence: {
          kind: "fake-ensen-loop-eip-transport",
          requestId: request.id
        }
      };
    },
    getRunStatusSnapshot(request: { requestId: string }) {
      const record = records.get(request.requestId);
      const context = {
        requestId: request.requestId,
        ...(record === undefined ? {} : { request: record.request })
      };
      const scripted = nextFakeScriptedPayload(record, input.statusSnapshots);

      if (scripted !== undefined) {
        return resolveFakePayload(scripted, context);
      }

      return {
        schemaVersion: "eip.run-status.v1",
        id: `sts_${safeIdentifier(request.requestId)}`,
        requestId: request.requestId,
        correlationId: record?.request.correlationId ?? `corr_${safeIdentifier(request.requestId)}`,
        status: "completed",
        observedAt: input.observedAt ?? "2026-04-30T04:00:02.000Z",
        message: "Fake Ensen-loop EIP transport completed the run request."
      };
    },
    getRunResult(request: { requestId: string }) {
      const record = records.get(request.requestId);
      const context = {
        requestId: request.requestId,
        ...(record === undefined ? {} : { request: record.request })
      };

      if (input.result !== undefined) {
        return resolveFakePayload(input.result, context);
      }

      return {
        schemaVersion: "eip.run-result.v1",
        id: `run_${safeIdentifier(request.requestId)}`,
        requestId: request.requestId,
        correlationId: record?.request.correlationId ?? `corr_${safeIdentifier(request.requestId)}`,
        status: "succeeded",
        completedAt: input.completedAt ?? "2026-04-30T04:00:03.000Z",
        verification: {
          status: "passed",
          summary: input.verificationSummary ?? "Fake Ensen-loop EIP transport succeeded."
        },
        evidenceBundles: [
          {
            evidenceBundleId: `evb_${safeIdentifier(request.requestId)}`,
            digest:
              "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
          }
        ]
      };
    },
    getEvidenceBundleRef(request: { requestId: string }) {
      const record = records.get(request.requestId);
      const context = {
        requestId: request.requestId,
        ...(record === undefined ? {} : { request: record.request })
      };

      if (input.evidenceBundleRef !== undefined) {
        return resolveFakePayload(input.evidenceBundleRef, context);
      }

      return {
        schemaVersion: "eip.evidence-bundle-ref.v1",
        id: `evb_${safeIdentifier(request.requestId)}`,
        correlationId: record?.request.correlationId ?? `corr_${safeIdentifier(request.requestId)}`,
        type: "local_path",
        uri: `artifacts/evidence/${request.requestId}/bundle.json`,
        createdAt: input.completedAt ?? "2026-04-30T04:00:03.000Z",
        contentType: "application/json"
      };
    }
  };
};

interface EipRunStatusSnapshotV1 {
  schemaVersion: "eip.run-status.v1";
  id: string;
  requestId: string;
  correlationId: string;
  runId?: string;
  status:
    | "accepted"
    | "queued"
    | "running"
    | "cancelling"
    | "cancelled"
    | "completed"
    | "failed"
    | "blocked"
    | "unknown";
  observedAt: string;
  message?: string;
  progress?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

const nextFakeScriptedPayload = (
  record: FakeEnsenLoopEipRecord | undefined,
  script: FakeEnsenLoopEipPayload[] | undefined
): FakeEnsenLoopEipPayload | undefined => {
  if (script === undefined || script.length === 0) {
    return undefined;
  }

  const index = record?.statusIndex ?? 0;
  if (record !== undefined) {
    record.statusIndex += 1;
  }

  return script[Math.min(index, script.length - 1)];
};

const resolveFakePayload = (
  payload: FakeEnsenLoopEipPayload,
  context: FakeEnsenLoopEipPayloadContext
): unknown => {
  if (typeof payload === "function") {
    return payload(context);
  }

  return payload;
};

interface EipRunResultV1 {
  schemaVersion: "eip.run-result.v1";
  id: string;
  requestId: string;
  correlationId: string;
  status: "succeeded" | "failed" | "blocked" | "needs_review" | "cancelled";
  completedAt: string;
  verification?: {
    status?: string;
    summary?: string;
  };
  evidenceBundles?: unknown[];
  errors?: unknown[];
  warnings?: unknown[];
  metrics?: Record<string, unknown>;
  extensions?: Record<string, unknown>;
}

interface EnsenLoopXGate2SmokeAggregateV1 {
  schemaVersion: "ensen-loop.x-gate2-smoke.v1";
  boundary?: string;
  requestId?: string;
  correlationId?: string;
  mutatesRepository?: boolean;
  invokesProvider?: boolean;
  writesDurableEvidence?: boolean;
  statusSnapshot: EipRunStatusSnapshotV1;
  runResult: EipRunResultV1;
  evidenceBundleRef?: Record<string, unknown>;
}

interface EnsenLoopXGate3LocalLaneSmokeAggregateV1 {
  schemaVersion: "ensen-loop.x-gate3-local-lane-smoke.v1";
  boundary: "local-cli-bounded-fake-lane";
  requestId: string;
  correlationId: string;
  mutatesRepository: false;
  invokesProvider: false;
  startsAgentProviderSession: false;
  writesProductionEvidenceArchive: false;
  statusSnapshot: EipRunStatusSnapshotV1;
  runResult: EipRunResultV1;
  localArtifacts: Array<Record<string, unknown>>;
  evidenceBundleRef?: Record<string, unknown>;
}

type EnsenLoopSmokeAggregateV1 =
  | EnsenLoopXGate2SmokeAggregateV1
  | EnsenLoopXGate3LocalLaneSmokeAggregateV1;

const createRunRequestPayload = (
  request: ExecutorSubmitRequest,
  createdAt: string
): EipRunRequestV1 => {
  const suffix = safeIdentifier(`${request.run.id}-${request.step.id}-${request.step.attempt}`);
  const idempotencyKey =
    request.idempotencyKey ??
    `${request.workflow.id}:${request.run.id}:${request.step.id}:${request.step.attempt}`;

  return {
    schemaVersion: "eip.run-request.v1",
    id: `req_${suffix}`,
    correlationId: `corr_${suffix}`,
    idempotencyKey,
    source: request.source ?? {
      sourceId: `source_${safeIdentifier(request.workflow.id)}`,
      sourceType: "manual"
    },
    requestedBy: request.requestedBy ?? {
      actorId: "actor_ensen_flow",
      actorType: "system",
      displayName: "Ensen-flow"
    },
    workItem: request.workItem ?? {
      workItemId: `workitem_${suffix}`,
      externalId: request.step.id,
      title: request.step.id
    },
    mode: request.mode ?? "validate",
    createdAt,
    ...(request.target === undefined ? {} : { target: request.target }),
    ...(request.policyContext === undefined ? {} : { policyContext: request.policyContext }),
    ...(request.dataClassification === undefined
      ? {}
      : { dataClassification: request.dataClassification }),
    extensions: {
      "x-ensen-flow": {
        workflowId: request.workflow.id,
        workflowVersion: request.workflow.version,
        runId: request.run.id,
        stepId: request.step.id,
        attempt: request.step.attempt,
        ...(request.input === undefined ? {} : { input: request.input })
      }
    }
  };
};

const mapRunStatus = (status: EipRunStatusSnapshotV1["status"]): ExecutorConnectorExecutionStatus => {
  switch (status) {
    case "accepted":
    case "queued":
      return "accepted";
    case "running":
    case "cancelling":
      return "running";
    case "cancelled":
      return "cancelled";
    case "completed":
      return "succeeded";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
    case "unknown":
      return "needs-review";
  }
};

const hasTerminalRunResult = (status: EipRunStatusSnapshotV1["status"]): boolean =>
  status === "completed" ||
  status === "failed" ||
  status === "blocked" ||
  status === "cancelled";

const mapRunResultToStatusSnapshot = (
  result: EipRunResultV1,
  observedAt?: string
): ExecutorConnectorStatusSnapshot => {
  const resultStatus = mapRunResultStatus(result.status);
  const summary = result.verification?.summary;
  const localLaneEvidence = extractXGate3LocalLaneEvidence(result.extensions);
  const evidence = {
    ...(result.verification === undefined ? {} : { verification: result.verification }),
    ...(result.evidenceBundles === undefined ? {} : { evidenceBundles: result.evidenceBundles }),
    ...(result.errors === undefined ? {} : { errors: result.errors }),
    ...(result.warnings === undefined ? {} : { warnings: result.warnings }),
    ...(result.metrics === undefined ? {} : { metrics: result.metrics }),
    ...(localLaneEvidence === undefined ? {} : localLaneEvidence)
  };

  return {
    requestId: result.requestId,
    status: resultStatus,
    observedAt: result.completedAt ?? observedAt,
    ...(resultStatus === "blocked" || resultStatus === "needs-review"
      ? { flowControl: flowControlForStatus(resultStatus, summary) }
      : {}),
    result: {
      status: resultStatusForExecutionStatus(resultStatus),
      ...(summary === undefined ? {} : { summary }),
      ...(Object.keys(evidence).length === 0 ? {} : { evidence })
    } satisfies ExecutorConnectorExecutionResult
  };
};

const validateRunStatusSnapshot = (
  value: unknown,
  expectedRequestId: string
): { message: string; reason: string } | undefined => {
  if (!isRecord(value)) {
    return failClosedReason("EIP RunStatusSnapshot must be an object");
  }

  const unknownProperty = findUnknownProperty(value, [
    "schemaVersion",
    "id",
    "requestId",
    "correlationId",
    "runId",
    "status",
    "observedAt",
    "message",
    "progress",
    "extensions"
  ]);

  if (unknownProperty !== undefined) {
    return failClosedReason(`EIP RunStatusSnapshot has unsupported field ${unknownProperty}`);
  }

  if (!isPrefixedId(value.id, "sts")) {
    return failClosedReason("EIP RunStatusSnapshot id is malformed");
  }

  if (!isPrefixedId(value.requestId, "req") || value.requestId !== expectedRequestId) {
    return failClosedReason("EIP RunStatusSnapshot requestId does not match the submitted request");
  }

  if (!isCorrelationId(value.correlationId)) {
    return failClosedReason("EIP RunStatusSnapshot correlationId is malformed");
  }

  if (!isRunStatus(value.status)) {
    return failClosedReason("EIP RunStatusSnapshot status is unsupported or malformed");
  }

  if (!isIsoDateTimeUtc(value.observedAt)) {
    return failClosedReason("EIP RunStatusSnapshot observedAt is malformed");
  }

  if (value.message !== undefined && typeof value.message !== "string") {
    return failClosedReason("EIP RunStatusSnapshot message must be a string");
  }

  if (value.progress !== undefined && !isRecord(value.progress)) {
    return failClosedReason("EIP RunStatusSnapshot progress must be an object");
  }

  return undefined;
};

const enrichSmokeRunResult = (aggregate: EnsenLoopSmokeAggregateV1): EipRunResultV1 => {
  if (aggregate.schemaVersion !== "ensen-loop.x-gate3-local-lane-smoke.v1") {
    return aggregate.runResult;
  }

  return {
    ...aggregate.runResult,
    extensions: {
      ...(aggregate.runResult.extensions ?? {}),
      "x-ensen-flow-local-lane": {
        localArtifacts: aggregate.localArtifacts,
        localArtifactSemantics: "local-development-references-only",
        productionEvidence: false
      }
    }
  };
};

const extractXGate3LocalLaneEvidence = (
  extensions: Record<string, unknown> | undefined
): Record<string, unknown> | undefined => {
  const localLane = extensions?.["x-ensen-flow-local-lane"];
  if (!isRecord(localLane)) {
    return undefined;
  }

  return {
    localArtifacts: localLane.localArtifacts,
    localArtifactSemantics: localLane.localArtifactSemantics,
    productionEvidence: localLane.productionEvidence
  };
};

const validateSmokeAggregate = (
  value: Record<string, unknown>,
  expectedRequestId: string
): { message: string; reason: string } | undefined => {
  if (value.schemaVersion === "ensen-loop.x-gate2-smoke.v1") {
    return validateXGate2SmokeAggregate(value, expectedRequestId);
  }

  if (value.schemaVersion === "ensen-loop.x-gate3-local-lane-smoke.v1") {
    return validateXGate3LocalLaneSmokeAggregate(value, expectedRequestId);
  }

  const versionText =
    typeof value.schemaVersion === "string" ? value.schemaVersion : "missing";
  return failClosedReason(`unsupported EIP XGateSmokeAggregate schemaVersion ${versionText}`);
};

const validateXGate2SmokeAggregate = (
  value: Record<string, unknown>,
  expectedRequestId: string
): { message: string; reason: string } | undefined => {
  const unknownProperty = findUnknownProperty(value, [
    "schemaVersion",
    "boundary",
    "requestId",
    "correlationId",
    "mutatesRepository",
    "invokesProvider",
    "writesDurableEvidence",
    "statusSnapshot",
    "runResult",
    "evidenceBundleRef"
  ]);

  if (unknownProperty !== undefined) {
    return failClosedReason(`EIP XGate2SmokeAggregate has unsupported field ${unknownProperty}`);
  }

  if (!isRecord(value.statusSnapshot)) {
    return failClosedReason("EIP XGate2SmokeAggregate statusSnapshot must be an object");
  }

  if (!isRecord(value.runResult)) {
    return failClosedReason("EIP XGate2SmokeAggregate runResult must be an object");
  }

  if (value.evidenceBundleRef !== undefined && !isRecord(value.evidenceBundleRef)) {
    return failClosedReason("EIP XGate2SmokeAggregate evidenceBundleRef must be an object");
  }

  if (value.boundary !== undefined && value.boundary !== "local-cli-stdout") {
    return failClosedReason("EIP XGate2SmokeAggregate boundary is unsupported or malformed");
  }

  for (const field of ["mutatesRepository", "invokesProvider", "writesDurableEvidence"]) {
    if (value[field] !== undefined && typeof value[field] !== "boolean") {
      return failClosedReason(`EIP XGate2SmokeAggregate ${field} must be a boolean`);
    }
  }

  if (value.requestId !== undefined) {
    if (typeof value.requestId !== "string" || value.requestId !== expectedRequestId) {
      return failClosedReason(
        "EIP XGate2SmokeAggregate requestId does not match the submitted request"
      );
    }
  }

  const statusVersion = requireSchemaVersion(
    value.statusSnapshot,
    "eip.run-status.v1",
    "RunStatusSnapshot"
  );
  if (statusVersion !== undefined) {
    return statusVersion;
  }

  const statusValidation = validateRunStatusSnapshot(value.statusSnapshot, expectedRequestId);
  if (statusValidation !== undefined) {
    return statusValidation;
  }

  const resultVersion = requireSchemaVersion(value.runResult, "eip.run-result.v1", "RunResult");
  if (resultVersion !== undefined) {
    return resultVersion;
  }

  const resultValidation = validateRunResult(value.runResult, expectedRequestId);
  if (resultValidation !== undefined) {
    return resultValidation;
  }

  if (
    value.statusSnapshot.correlationId !== value.runResult.correlationId ||
    (value.correlationId !== undefined &&
      value.correlationId !== value.statusSnapshot.correlationId)
  ) {
    return failClosedReason(
      "EIP XGate2SmokeAggregate correlationId does not match nested payloads"
    );
  }

  if (value.evidenceBundleRef !== undefined) {
    const evidenceVersion = requireSchemaVersion(
      value.evidenceBundleRef,
      "eip.evidence-bundle-ref.v1",
      "EvidenceBundleRef"
    );
    if (evidenceVersion !== undefined) {
      return evidenceVersion;
    }

    const evidenceValidation = validateEvidenceBundleRef(value.evidenceBundleRef);
    if (evidenceValidation !== undefined) {
      return evidenceValidation;
    }
  }

  return undefined;
};

const validateXGate3LocalLaneSmokeAggregate = (
  value: Record<string, unknown>,
  expectedRequestId: string
): { message: string; reason: string } | undefined => {
  const shapeName = "EIP XGate3LocalLaneSmokeAggregate";
  const unknownProperty = findUnknownProperty(value, [
    "schemaVersion",
    "boundary",
    "requestId",
    "correlationId",
    "mutatesRepository",
    "invokesProvider",
    "startsAgentProviderSession",
    "writesProductionEvidenceArchive",
    "statusSnapshot",
    "runResult",
    "localArtifacts",
    "evidenceBundleRef"
  ]);

  if (unknownProperty !== undefined) {
    return failClosedReason(`${shapeName} has unsupported field ${unknownProperty}`);
  }

  if (value.boundary !== "local-cli-bounded-fake-lane") {
    return failClosedReason(`${shapeName} boundary is unsupported or malformed`);
  }

  for (const field of [
    "mutatesRepository",
    "invokesProvider",
    "startsAgentProviderSession",
    "writesProductionEvidenceArchive"
  ]) {
    if (value[field] !== false) {
      return failClosedReason(`${shapeName} ${field} must be false`);
    }
  }

  if (typeof value.requestId !== "string" || value.requestId !== expectedRequestId) {
    return failClosedReason(`${shapeName} requestId does not match the submitted request`);
  }

  if (!isRecord(value.statusSnapshot)) {
    return failClosedReason(`${shapeName} statusSnapshot must be an object`);
  }

  if (!isRecord(value.runResult)) {
    return failClosedReason(`${shapeName} runResult must be an object`);
  }

  const statusVersion = requireSchemaVersion(
    value.statusSnapshot,
    "eip.run-status.v1",
    "RunStatusSnapshot"
  );
  if (statusVersion !== undefined) {
    return statusVersion;
  }

  const statusValidation = validateRunStatusSnapshot(value.statusSnapshot, expectedRequestId);
  if (statusValidation !== undefined) {
    return statusValidation;
  }

  const resultVersion = requireSchemaVersion(value.runResult, "eip.run-result.v1", "RunResult");
  if (resultVersion !== undefined) {
    return resultVersion;
  }

  const resultValidation = validateRunResult(value.runResult, expectedRequestId);
  if (resultValidation !== undefined) {
    return resultValidation;
  }

  if (
    value.statusSnapshot.correlationId !== value.runResult.correlationId ||
    value.correlationId !== value.statusSnapshot.correlationId
  ) {
    return failClosedReason(`${shapeName} correlationId does not match nested payloads`);
  }

  if (!Array.isArray(value.localArtifacts) || value.localArtifacts.length === 0) {
    return failClosedReason(`${shapeName} localArtifacts must be a non-empty array`);
  }

  for (const [index, artifact] of value.localArtifacts.entries()) {
    const artifactValidation = validateXGate3LocalArtifact(
      artifact,
      `${shapeName} localArtifacts[${index}]`
    );
    if (artifactValidation !== undefined) {
      return artifactValidation;
    }
  }

  if (value.evidenceBundleRef !== undefined) {
    if (!isRecord(value.evidenceBundleRef)) {
      return failClosedReason(`${shapeName} evidenceBundleRef must be an object`);
    }

    const evidenceVersion = requireSchemaVersion(
      value.evidenceBundleRef,
      "eip.evidence-bundle-ref.v1",
      "EvidenceBundleRef"
    );
    if (evidenceVersion !== undefined) {
      return evidenceVersion;
    }

    const evidenceValidation = validateEvidenceBundleRef(value.evidenceBundleRef);
    if (evidenceValidation !== undefined) {
      return evidenceValidation;
    }
  }

  return undefined;
};

const validateXGate3LocalArtifact = (
  value: unknown,
  shapeName: string
): { message: string; reason: string } | undefined => {
  if (!isRecord(value)) {
    return failClosedReason(`${shapeName} must be an object`);
  }

  const unknownProperty = findUnknownProperty(value, [
    "kind",
    "path",
    "contentType",
    "description",
    "checksum"
  ]);

  if (unknownProperty !== undefined) {
    return failClosedReason(`${shapeName} has unsupported field ${unknownProperty}`);
  }

  if (
    typeof value.kind !== "string" ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value.kind)
  ) {
    return failClosedReason(`${shapeName}.kind is malformed`);
  }

  if (typeof value.path !== "string" || !isPortableLocalArtifactPath(value.path)) {
    return failClosedReason(`${shapeName}.path is malformed`);
  }

  for (const field of ["kind", "path", "contentType", "description"]) {
    const fieldValue = value[field];
    if (typeof fieldValue === "string" && containsCredentialShapedValue(fieldValue)) {
      return failClosedReason(`${shapeName}.${field} must not contain credential-shaped values`);
    }
  }

  if (
    value.contentType !== undefined &&
    (typeof value.contentType !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(?:; ?[A-Za-z0-9_.-]+=[A-Za-z0-9_.+-]+)*$/.test(
        value.contentType
      ))
  ) {
    return failClosedReason(`${shapeName}.contentType is malformed`);
  }

  if (value.description !== undefined && !isNonEmptyString(value.description, 240)) {
    return failClosedReason(`${shapeName}.description is malformed`);
  }

  if (value.checksum !== undefined) {
    if (!isRecord(value.checksum)) {
      return failClosedReason(`${shapeName}.checksum must be an object`);
    }

    const checksumUnknownProperty = findUnknownProperty(value.checksum, ["algorithm", "value"]);
    if (checksumUnknownProperty !== undefined) {
      return failClosedReason(
        `${shapeName}.checksum has unsupported field ${checksumUnknownProperty}`
      );
    }

    if (value.checksum.algorithm !== "sha256") {
      return failClosedReason(`${shapeName}.checksum algorithm is unsupported`);
    }

    if (
      typeof value.checksum.value !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.checksum.value) ||
      containsCredentialShapedValue(value.checksum.value)
    ) {
      return failClosedReason(`${shapeName}.checksum value is malformed`);
    }
  }

  return undefined;
};

const validateRunRequest = (value: unknown): { message: string; reason: string } | undefined => {
  if (!isRecord(value)) {
    return failClosedReason("EIP RunRequest must be an object");
  }

  const unknownProperty = findUnknownProperty(value, [
    "schemaVersion",
    "id",
    "correlationId",
    "idempotencyKey",
    "source",
    "requestedBy",
    "workItem",
    "mode",
    "createdAt",
    "target",
    "policyContext",
    "dataClassification",
    "extensions"
  ]);

  if (unknownProperty !== undefined) {
    return failClosedReason(`EIP RunRequest has unsupported field ${unknownProperty}`);
  }

  if (!isPrefixedId(value.id, "req")) {
    return failClosedReason("EIP RunRequest id is malformed");
  }

  if (!isCorrelationId(value.correlationId)) {
    return failClosedReason("EIP RunRequest correlationId is malformed");
  }

  if (
    typeof value.idempotencyKey !== "string" ||
    !/^[A-Za-z0-9][A-Za-z0-9._:-]{11,159}$/.test(value.idempotencyKey)
  ) {
    return failClosedReason("EIP RunRequest idempotencyKey is malformed");
  }

  const sourceValidation = validateSourceRef(value.source, "EIP RunRequest source");
  if (sourceValidation !== undefined) {
    return sourceValidation;
  }

  const actorValidation = validateActorRef(value.requestedBy, "EIP RunRequest requestedBy");
  if (actorValidation !== undefined) {
    return actorValidation;
  }

  const workItemValidation = validateRunRequestWorkItem(value.workItem);
  if (workItemValidation !== undefined) {
    return workItemValidation;
  }

  if (!isRunRequestMode(value.mode)) {
    return failClosedReason("EIP RunRequest mode is unsupported or malformed");
  }

  if (!isIsoDateTimeUtc(value.createdAt)) {
    return failClosedReason("EIP RunRequest createdAt is malformed");
  }

  if (value.target !== undefined) {
    const targetValidation = validateRunRequestTarget(value.target);
    if (targetValidation !== undefined) {
      return targetValidation;
    }
  }

  if (value.policyContext !== undefined) {
    const policyValidation = validatePolicyContext(value.policyContext);
    if (policyValidation !== undefined) {
      return policyValidation;
    }
  }

  if (value.dataClassification !== undefined && !isDataClassification(value.dataClassification)) {
    return failClosedReason("EIP RunRequest dataClassification is unsupported or malformed");
  }

  return validateExtensionMap(value.extensions, "EIP RunRequest extensions");
};

const validateCancelReceipt = (
  value: unknown,
  expectedRequestId: string
): { message: string; reason: string } | undefined => {
  if (!isRecord(value)) {
    return failClosedReason("EIP cancel receipt must be an object");
  }

  if (value.requestId !== undefined) {
    if (typeof value.requestId !== "string") {
      return failClosedReason("EIP cancel receipt requestId must be a string");
    }

    if (value.requestId !== expectedRequestId) {
      return failClosedReason("EIP cancel receipt requestId does not match the submitted request");
    }
  }

  if (typeof value.cancelled !== "boolean") {
    return failClosedReason("EIP cancel receipt cancelled must be a boolean");
  }

  if (value.observedAt !== undefined && typeof value.observedAt !== "string") {
    return failClosedReason("EIP cancel receipt observedAt must be a string");
  }

  return undefined;
};

const validateRunResult = (
  value: unknown,
  expectedRequestId: string
): { message: string; reason: string } | undefined => {
  if (!isRecord(value)) {
    return failClosedReason("EIP RunResult must be an object");
  }

  const unknownProperty = findUnknownProperty(value, [
    "schemaVersion",
    "id",
    "requestId",
    "correlationId",
    "status",
    "completedAt",
    "changeRequests",
    "evidenceBundles",
    "verification",
    "errors",
    "warnings",
    "metrics",
    "extensions"
  ]);

  if (unknownProperty !== undefined) {
    return failClosedReason(`EIP RunResult has unsupported field ${unknownProperty}`);
  }

  if (typeof value.requestId !== "string" || value.requestId !== expectedRequestId) {
    return failClosedReason("EIP RunResult requestId does not match the submitted request");
  }

  if (!isPrefixedId(value.id, "run")) {
    return failClosedReason("EIP RunResult id is malformed");
  }

  if (!isCorrelationId(value.correlationId)) {
    return failClosedReason("EIP RunResult correlationId is malformed");
  }

  if (!isRunResultStatus(value.status)) {
    return failClosedReason("EIP RunResult status is unsupported or malformed");
  }

  if (!isIsoDateTimeUtc(value.completedAt)) {
    return failClosedReason("EIP RunResult completedAt is malformed");
  }

  if (value.verification !== undefined) {
    if (!isRecord(value.verification)) {
      return failClosedReason("EIP RunResult verification must be an object");
    }

    if (
      value.verification.status !== undefined &&
      typeof value.verification.status !== "string"
    ) {
      return failClosedReason("EIP RunResult verification.status must be a string");
    }

    if (
      value.verification.summary !== undefined &&
      typeof value.verification.summary !== "string"
    ) {
      return failClosedReason("EIP RunResult verification.summary must be a string");
    }
  }

  if (value.evidenceBundles !== undefined && !Array.isArray(value.evidenceBundles)) {
    return failClosedReason("EIP RunResult evidenceBundles must be an array");
  }

  if (value.errors !== undefined && !Array.isArray(value.errors)) {
    return failClosedReason("EIP RunResult errors must be an array");
  }

  if (value.warnings !== undefined && !Array.isArray(value.warnings)) {
    return failClosedReason("EIP RunResult warnings must be an array");
  }

  if (value.metrics !== undefined && !isRecord(value.metrics)) {
    return failClosedReason("EIP RunResult metrics must be an object");
  }

  return validateExtensionMap(value.extensions, "EIP RunResult extensions");
};

const validateEvidenceBundleRef = (
  value: unknown
): { message: string; reason: string } | undefined => {
  if (!isRecord(value)) {
    return failClosedReason("EIP EvidenceBundleRef must be an object");
  }

  const unknownProperty = findUnknownProperty(value, [
    "schemaVersion",
    "id",
    "correlationId",
    "type",
    "uri",
    "createdAt",
    "contentType",
    "checksum",
    "metadata"
  ]);

  if (unknownProperty !== undefined) {
    return failClosedReason(`EIP EvidenceBundleRef has unsupported field ${unknownProperty}`);
  }

  if (!isPrefixedId(value.id, "evb")) {
    return failClosedReason("EIP EvidenceBundleRef id is malformed");
  }

  if (!isCorrelationId(value.correlationId)) {
    return failClosedReason("EIP EvidenceBundleRef correlationId is malformed");
  }

  if (value.type !== "local_path" && value.type !== "file_uri") {
    return failClosedReason("EIP EvidenceBundleRef type is unsupported or malformed");
  }

  if (typeof value.uri !== "string" || value.uri.length === 0 || value.uri.length > 1000) {
    return failClosedReason("EIP EvidenceBundleRef uri is malformed");
  }

  if (value.type === "local_path" && !isLocalEvidencePath(value.uri)) {
    return failClosedReason("EIP EvidenceBundleRef local_path uri is malformed");
  }

  if (value.type === "file_uri" && !isFileEvidenceUri(value.uri)) {
    return failClosedReason("EIP EvidenceBundleRef file_uri uri is malformed");
  }

  if (!isIsoDateTimeUtc(value.createdAt)) {
    return failClosedReason("EIP EvidenceBundleRef createdAt is malformed");
  }

  if (
    value.contentType !== undefined &&
    (typeof value.contentType !== "string" ||
      !/^[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*\/[A-Za-z0-9][A-Za-z0-9!#$&^_.+-]*(?:; ?[A-Za-z0-9_.-]+=[A-Za-z0-9_.+-]+)*$/.test(
        value.contentType
      ))
  ) {
    return failClosedReason("EIP EvidenceBundleRef contentType is malformed");
  }

  if (value.checksum !== undefined) {
    if (!isRecord(value.checksum)) {
      return failClosedReason("EIP EvidenceBundleRef checksum must be an object");
    }

    const checksumUnknownProperty = findUnknownProperty(value.checksum, ["algorithm", "value"]);
    if (checksumUnknownProperty !== undefined) {
      return failClosedReason(
        `EIP EvidenceBundleRef checksum has unsupported field ${checksumUnknownProperty}`
      );
    }

    if (value.checksum.algorithm !== "sha256") {
      return failClosedReason("EIP EvidenceBundleRef checksum algorithm is unsupported");
    }

    if (
      typeof value.checksum.value !== "string" ||
      !/^[a-f0-9]{64}$/.test(value.checksum.value)
    ) {
      return failClosedReason("EIP EvidenceBundleRef checksum value is malformed");
    }
  }

  if (value.metadata !== undefined && !isRecord(value.metadata)) {
    return failClosedReason("EIP EvidenceBundleRef metadata must be an object");
  }

  return undefined;
};

const mapRunResultStatus = (status: EipRunResultV1["status"]): ExecutorConnectorExecutionStatus => {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "blocked":
      return "blocked";
    case "needs_review":
      return "needs-review";
    case "cancelled":
      return "cancelled";
  }
};

const resultStatusForExecutionStatus = (
  status: ExecutorConnectorExecutionStatus
): ExecutorConnectorResultStatus => {
  switch (status) {
    case "approval-required":
      return "approval-required";
    case "blocked":
      return "blocked";
    case "needs-review":
      return "needs-review";
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "accepted":
    case "running":
    case "succeeded":
      return "succeeded";
  }
};

const flowControlForStatus = (
  status: "blocked" | "needs-review",
  reason: string | undefined
): ExecutorFlowControlState => ({
  state: status,
  authority: "ensen-flow",
  ...(reason === undefined ? {} : { reason })
});

const requireSchemaVersion = (
  value: unknown,
  expected: string,
  shapeName: string
): { message: string; reason: string } | undefined => {
  const schemaVersion = isRecord(value) ? value.schemaVersion : undefined;

  if (schemaVersion === expected) {
    return undefined;
  }

  const versionText = typeof schemaVersion === "string" ? schemaVersion : "missing";
  return {
    message: `unsupported EIP ${shapeName} schemaVersion ${versionText}`,
    reason: `unsupported EIP ${shapeName} schemaVersion ${versionText}`
  };
};

const failClosedReason = (reason: string): { message: string; reason: string } => ({
  message: reason,
  reason
});

const isRunStatus = (value: unknown): value is EipRunStatusSnapshotV1["status"] =>
  value === "accepted" ||
  value === "queued" ||
  value === "running" ||
  value === "cancelling" ||
  value === "cancelled" ||
  value === "completed" ||
  value === "failed" ||
  value === "blocked" ||
  value === "unknown";

const isRunResultStatus = (value: unknown): value is EipRunResultV1["status"] =>
  value === "succeeded" ||
  value === "failed" ||
  value === "blocked" ||
  value === "needs_review" ||
  value === "cancelled";

const isRunRequestMode = (value: unknown): value is EipRunRequestMode =>
  value === "plan" || value === "apply" || value === "validate";

const isDataClassification = (value: unknown): boolean =>
  value === "public" ||
  value === "internal" ||
  value === "confidential" ||
  value === "restricted";

const validateSourceRef = (
  value: unknown,
  shapeName: string
): { message: string; reason: string } | undefined => {
  if (!isRecord(value)) {
    return failClosedReason(`${shapeName} must be an object`);
  }

  const unknownProperty = findUnknownProperty(value, ["sourceId", "sourceType", "externalRef"]);
  if (unknownProperty !== undefined) {
    return failClosedReason(`${shapeName} has unsupported field ${unknownProperty}`);
  }

  if (!isPrefixedId(value.sourceId, "source")) {
    return failClosedReason(`${shapeName}.sourceId is malformed`);
  }

  if (
    typeof value.sourceType !== "string" ||
    !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value.sourceType)
  ) {
    return failClosedReason(`${shapeName}.sourceType is malformed`);
  }

  if (value.externalRef !== undefined && !isNonEmptyString(value.externalRef, 240)) {
    return failClosedReason(`${shapeName}.externalRef is malformed`);
  }

  return undefined;
};

const validateActorRef = (
  value: unknown,
  shapeName: string
): { message: string; reason: string } | undefined => {
  if (!isRecord(value)) {
    return failClosedReason(`${shapeName} must be an object`);
  }

  const unknownProperty = findUnknownProperty(value, ["actorId", "actorType", "displayName"]);
  if (unknownProperty !== undefined) {
    return failClosedReason(`${shapeName} has unsupported field ${unknownProperty}`);
  }

  if (!isPrefixedId(value.actorId, "actor")) {
    return failClosedReason(`${shapeName}.actorId is malformed`);
  }

  if (!isActorType(value.actorType)) {
    return failClosedReason(`${shapeName}.actorType is unsupported or malformed`);
  }

  if (value.displayName !== undefined && !isNonEmptyString(value.displayName, 160)) {
    return failClosedReason(`${shapeName}.displayName is malformed`);
  }

  return undefined;
};

const validateRunRequestWorkItem = (
  value: unknown
): { message: string; reason: string } | undefined => {
  if (!isRecord(value)) {
    return failClosedReason("EIP RunRequest workItem must be an object");
  }

  const unknownProperty = findUnknownProperty(value, [
    "workItemId",
    "externalId",
    "title",
    "url"
  ]);
  if (unknownProperty !== undefined) {
    return failClosedReason(`EIP RunRequest workItem has unsupported field ${unknownProperty}`);
  }

  if (!isPrefixedId(value.workItemId, "workitem")) {
    return failClosedReason("EIP RunRequest workItem.workItemId is malformed");
  }

  if (!isNonEmptyString(value.externalId, 240)) {
    return failClosedReason("EIP RunRequest workItem.externalId is malformed");
  }

  if (value.title !== undefined && !isNonEmptyString(value.title, 240)) {
    return failClosedReason("EIP RunRequest workItem.title is malformed");
  }

  if (
    value.url !== undefined &&
    (typeof value.url !== "string" || value.url.length > 400 || !/^https:\/\/[^\s]+$/.test(value.url))
  ) {
    return failClosedReason("EIP RunRequest workItem.url is malformed");
  }

  return undefined;
};

const validateRunRequestTarget = (
  value: unknown
): { message: string; reason: string } | undefined => {
  if (!isRecord(value)) {
    return failClosedReason("EIP RunRequest target must be an object");
  }

  const unknownProperty = findUnknownProperty(value, ["targetType", "targetId", "externalRef"]);
  if (unknownProperty !== undefined) {
    return failClosedReason(`EIP RunRequest target has unsupported field ${unknownProperty}`);
  }

  if (
    value.targetType !== "repository" &&
    value.targetType !== "workspace" &&
    value.targetType !== "environment" &&
    value.targetType !== "manual"
  ) {
    return failClosedReason("EIP RunRequest target.targetType is unsupported or malformed");
  }

  if (!isPrefixedId(value.targetId, value.targetType === "repository" ? "repo" : undefined)) {
    return failClosedReason("EIP RunRequest target.targetId is malformed");
  }

  if (value.externalRef !== undefined && !isNonEmptyString(value.externalRef, 240)) {
    return failClosedReason("EIP RunRequest target.externalRef is malformed");
  }

  return undefined;
};

const validatePolicyContext = (
  value: unknown
): { message: string; reason: string } | undefined => {
  if (!isRecord(value)) {
    return failClosedReason("EIP RunRequest policyContext must be an object");
  }

  const unknownProperty = findUnknownProperty(value, [
    "policySetId",
    "riskClasses",
    "requiresApproval"
  ]);
  if (unknownProperty !== undefined) {
    return failClosedReason(`EIP RunRequest policyContext has unsupported field ${unknownProperty}`);
  }

  if (value.policySetId !== undefined && !isPrefixedId(value.policySetId, "policy")) {
    return failClosedReason("EIP RunRequest policyContext.policySetId is malformed");
  }

  if (
    value.riskClasses !== undefined &&
    (!Array.isArray(value.riskClasses) ||
      value.riskClasses.some((item) => !isNonEmptyString(item, 80)))
  ) {
    return failClosedReason("EIP RunRequest policyContext.riskClasses is malformed");
  }

  if (value.requiresApproval !== undefined && typeof value.requiresApproval !== "boolean") {
    return failClosedReason("EIP RunRequest policyContext.requiresApproval must be a boolean");
  }

  return undefined;
};

const validateExtensionMap = (
  value: unknown,
  shapeName: string
): { message: string; reason: string } | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!isRecord(value)) {
    return failClosedReason(`${shapeName} must be an object`);
  }

  for (const key of Object.keys(value)) {
    if (!key.startsWith("x-")) {
      return failClosedReason(`${shapeName} key ${key} must use x- prefix`);
    }
  }

  return undefined;
};

const isActorType = (value: unknown): boolean =>
  value === "human" ||
  value === "workflow" ||
  value === "system" ||
  value === "api_client" ||
  value === "connector" ||
  value === "executor" ||
  value === "agent";

const invalidRequest = <TValue>(
  connectorId: string,
  operation: "submit" | "status" | "cancel" | "fetchEvidence",
  message: string,
  reason?: string,
  failureClass: EnsenLoopCliFailureClass = "protocol-gap"
): ConnectorResult<TValue> => ({
  ok: false,
  connectorId,
  operation,
  error: {
    code: "invalid-request",
    message,
    retryable: false,
    ...(reason === undefined ? {} : { reason }),
    failureClass
  } satisfies ConnectorErrorBody
});

const safeIdentifier = (value: string): string =>
  value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 120) || "local";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const findUnknownProperty = (
  value: Record<string, unknown>,
  allowedProperties: readonly string[]
): string | undefined => {
  const allowed = new Set(allowedProperties);
  return Object.keys(value).find((property) => !allowed.has(property));
};

const isPrefixedId = (value: unknown, expectedPrefix?: string): boolean => {
  if (typeof value !== "string") {
    return false;
  }

  const match = /^(actor|artifact|corr|cr|evb|evt|flowstep|policy|pr|repo|req|run|source|sts|workitem)_[A-Za-z0-9][A-Za-z0-9._~-]{5,127}$/.exec(
    value
  );

  return match !== null && (expectedPrefix === undefined || match[1] === expectedPrefix);
};

const isCorrelationId = (value: unknown): boolean =>
  typeof value === "string" && /^corr_[A-Za-z0-9][A-Za-z0-9._~-]{11,127}$/.test(value);

const isIsoDateTimeUtc = (value: unknown): boolean =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value);

const isNonEmptyString = (value: unknown, maxLength: number): boolean =>
  typeof value === "string" && value.length > 0 && value.length <= maxLength;

const isUsableLocalRoot = (value: unknown): boolean => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.includes("\0") ||
    containsCredentialShapedValue(value) ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value) ||
    value.includes("://") ||
    !isAbsolute(value)
  ) {
    return false;
  }

  const normalized = normalize(value);
  if (!isAbsolute(normalized) || normalized.includes("\0")) {
    return false;
  }

  const hasTraversalSegment = (candidate: string): boolean =>
    candidate.split(/[\\/]+/).includes("..");

  return !hasTraversalSegment(value) && !hasTraversalSegment(normalized);
};

const isLocalEvidencePath = (value: string): boolean =>
  /^(?![A-Za-z][A-Za-z0-9+.-]*:\/\/)(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._~@/-]+$/.test(
    value
  );

const isPortableLocalArtifactPath = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 1000 &&
  /^(?!~)(?![A-Za-z][A-Za-z0-9+.-]*:\/\/)(?!\/)(?![A-Za-z]:\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._~@/-]+$/.test(
    value
  );

const isFileEvidenceUri = (value: string): boolean =>
  /^file:\/\/\/(?!.*(?:^|\/)\.\.(?:\/|$))[^\s?#]+$/.test(value) &&
  !/^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^/?#\s]*[^/?#\s:@]+:[^/?#\s:@]+@/.test(value);

const containsCredentialShapedValue = (value: string): boolean =>
  /(?:^|\b)(?:password|passwd|token|secret|api[_-]?key|access[_-]?key|private[_-]?key)\s*[:=]/i.test(
    value
  ) ||
  /\b(?:ghp|github_pat|glpat|xox[abprs]|sk)[-_][A-Za-z0-9_-]{8,}\b/.test(value) ||
  /-----BEGIN [A-Z ]*(?:PRIVATE KEY|TOKEN|SECRET)[A-Z ]*-----/.test(value);
