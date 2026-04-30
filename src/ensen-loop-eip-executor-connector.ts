import {
  createExecutorConnectorCapabilities,
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

export interface CreateEnsenLoopEipExecutorConnectorInput {
  connectorId?: string;
  transport: EnsenLoopEipExecutorTransport;
  now?: () => string;
}

export const createEnsenLoopEipExecutorConnector = (
  input: CreateEnsenLoopEipExecutorConnectorInput
): ExecutorConnector => {
  const connectorId = input.connectorId ?? "ensen-loop-eip";
  const now = input.now ?? (() => new Date().toISOString());
  const submittedRequests = new Map<string, EipRunRequestV1>();

  return {
    identity: {
      id: connectorId,
      displayName: "Ensen-loop EIP Executor Connector",
      version: "eip.run-request.v1"
    },
    capabilities: createExecutorConnectorCapabilities(),
    async submit(request: ExecutorSubmitRequest): Promise<ExecutorConnectorSubmitResult> {
      const payload = createRunRequestPayload(request, now());
      const submitted = await input.transport.submitRunRequest(payload);
      const requestId = submitted.requestId ?? payload.id;
      submittedRequests.set(requestId, payload);

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
      if (!submittedRequests.has(request.requestId)) {
        return invalidRequest(connectorId, "status", "Ensen-loop EIP request is unknown");
      }

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

      if (status.status === "completed") {
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
      if (!submittedRequests.has(request.requestId)) {
        return invalidRequest(connectorId, "cancel", "Ensen-loop EIP request is unknown");
      }

      const cancelled = input.transport.cancelRunRequest === undefined
        ? { requestId: request.requestId, cancelled: true, observedAt: now() }
        : await input.transport.cancelRunRequest(request);

      return {
        ok: true,
        connectorId,
        operation: "cancel",
        value: {
          requestId: cancelled.requestId ?? request.requestId,
          cancelled: cancelled.cancelled ?? true,
          observedAt: cancelled.observedAt
        }
      };
    },
    async fetchEvidence(
      request: ExecutorConnectorFetchEvidenceRequest
    ): Promise<ExecutorConnectorFetchEvidenceResult> {
      if (!submittedRequests.has(request.requestId)) {
        return invalidRequest(connectorId, "fetchEvidence", "Ensen-loop EIP request is unknown");
      }

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

interface EipRunStatusSnapshotV1 {
  schemaVersion: "eip.run-status.v1";
  requestId: string;
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
  observedAt?: string;
  message?: string;
  progress?: Record<string, unknown>;
}

interface EipRunResultV1 {
  schemaVersion: "eip.run-result.v1";
  requestId: string;
  status: "succeeded" | "failed" | "blocked" | "needs_review" | "cancelled";
  completedAt?: string;
  verification?: {
    status?: string;
    summary?: string;
  };
  evidenceBundles?: unknown[];
  errors?: unknown[];
  warnings?: unknown[];
  metrics?: Record<string, unknown>;
}

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

const mapRunResultToStatusSnapshot = (
  result: EipRunResultV1,
  observedAt?: string
): ExecutorConnectorStatusSnapshot => {
  const resultStatus = mapRunResultStatus(result.status);
  const summary = result.verification?.summary;
  const evidence = {
    ...(result.evidenceBundles === undefined ? {} : { evidenceBundles: result.evidenceBundles }),
    ...(result.errors === undefined ? {} : { errors: result.errors }),
    ...(result.warnings === undefined ? {} : { warnings: result.warnings }),
    ...(result.metrics === undefined ? {} : { metrics: result.metrics })
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

  if (typeof value.requestId !== "string" || value.requestId !== expectedRequestId) {
    return failClosedReason("EIP RunStatusSnapshot requestId does not match the submitted request");
  }

  if (!isRunStatus(value.status)) {
    return failClosedReason("EIP RunStatusSnapshot status is unsupported or malformed");
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

  if (typeof value.requestId !== "string" || value.requestId !== expectedRequestId) {
    return failClosedReason("EIP RunResult requestId does not match the submitted request");
  }

  if (!isRunResultStatus(value.status)) {
    return failClosedReason("EIP RunResult status is unsupported or malformed");
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

const invalidRequest = <TValue>(
  connectorId: string,
  operation: "submit" | "status" | "cancel" | "fetchEvidence",
  message: string,
  reason?: string
): ConnectorResult<TValue> => ({
  ok: false,
  connectorId,
  operation,
  error: {
    code: "invalid-request",
    message,
    retryable: false,
    ...(reason === undefined ? {} : { reason })
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
