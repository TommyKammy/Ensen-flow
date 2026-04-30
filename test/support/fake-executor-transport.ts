import {
  createExecutorConnectorCapabilities,
  createUnsupportedExecutorConnectorOperationResult,
  mapExecutorPolicyDecisionToFlowControlState
} from "../../src/index.js";
import type {
  ConnectorCapabilities,
  ConnectorOperation,
  ConnectorOperationSupport,
  ExecutorConnector,
  ExecutorConnectorCancelRequest,
  ExecutorConnectorCancelResult,
  ExecutorConnectorExecutionResult,
  ExecutorConnectorExecutionStatus,
  ExecutorConnectorFetchEvidenceRequest,
  ExecutorConnectorFetchEvidenceResult,
  ExecutorConnectorStatusRequest,
  ExecutorConnectorStatusResult,
  ExecutorConnectorStatusSnapshot,
  ExecutorConnectorSubmitResult,
  ExecutorFlowControlState,
  ExecutorPolicyDecisionPayload,
  ExecutorSubmitRequest
} from "../../src/index.js";

// Phase 2 test boundary only: this fake transport exercises connector semantics
// without invoking Ensen-loop, Codex, GitHub, Docker, ERPNext, or any service.
export interface FakeExecutorTransportInput {
  connectorId?: string;
  capabilities?: Partial<Record<ConnectorOperation, ConnectorOperationSupport>>;
  statusScript?: FakeExecutorStatusScriptItem[];
  evidence?: Record<string, unknown>;
}

export interface FakeExecutorStatusScriptItem {
  status: ExecutorConnectorExecutionStatus;
  observedAt?: string;
  flowControl?: ExecutorFlowControlState;
  result?: ExecutorConnectorExecutionResult;
  evidence?: Record<string, unknown>;
}

interface FakeExecutorRecord {
  request: ExecutorSubmitRequest;
  requestId: string;
  cancelled: boolean;
  statusIndex: number;
}

export const createFakeExecutorTransport = (
  input: FakeExecutorTransportInput = {}
): ExecutorConnector => {
  const connectorId = input.connectorId ?? "fake-executor-transport";
  const capabilities = createFakeCapabilities(input.capabilities);
  const records = new Map<string, FakeExecutorRecord>();
  const statusScript = input.statusScript ?? [
    {
      status: "succeeded",
      observedAt: "2026-04-30T04:00:01.000Z",
      result: {
        status: "succeeded",
        summary: "fake executor completed bounded work"
      }
    }
  ];
  const evidence = input.evidence ?? {
    kind: "fake-executor-evidence",
    uri: "artifacts/fake-executor/evidence.json"
  };

  const unsupported = (
    operation: ConnectorOperation
  ):
    | ReturnType<typeof createUnsupportedExecutorConnectorOperationResult>
    | undefined => {
    const support = capabilities[operation];

    if (support.supported) {
      return undefined;
    }

    return createUnsupportedExecutorConnectorOperationResult({
      connectorId,
      operation,
      reason: support.reason
    });
  };

  return {
    identity: {
      id: connectorId,
      displayName: "Fake Executor Transport",
      version: "test-only"
    },
    capabilities,
    submit(request: ExecutorSubmitRequest): ExecutorConnectorSubmitResult {
      const blocked = unsupported("submit");

      if (blocked !== undefined) {
        return blocked;
      }

      const requestId = `fake-${request.run.id}-${request.step.id}-${request.step.attempt}`;
      records.set(requestId, {
        request,
        requestId,
        cancelled: false,
        statusIndex: 0
      });

      return {
        ok: true,
        connectorId,
        operation: "submit",
        value: {
          requestId,
          acceptedAt: "2026-04-30T04:00:00.000Z",
          flowControl: mapExecutorPolicyDecisionToFlowControlState(request.policyDecision)
        }
      };
    },
    status(request: ExecutorConnectorStatusRequest): ExecutorConnectorStatusResult {
      const blocked = unsupported("status");

      if (blocked !== undefined) {
        return blocked;
      }

      const record = records.get(request.requestId);

      if (record === undefined) {
        return invalidRequest(connectorId, "status", "fake executor request is unknown");
      }

      if (record.cancelled) {
        return {
          ok: true,
          connectorId,
          operation: "status",
          value: {
            requestId: request.requestId,
            status: "cancelled",
            observedAt: "2026-04-30T04:00:05.000Z",
            result: {
              status: "cancelled",
              summary: "fake executor request was cancelled"
            }
          }
        };
      }

      const scripted = statusScript[Math.min(record.statusIndex, statusScript.length - 1)];
      record.statusIndex += 1;

      return {
        ok: true,
        connectorId,
        operation: "status",
        value: {
          requestId: request.requestId,
          ...scripted
        } satisfies ExecutorConnectorStatusSnapshot
      };
    },
    cancel(request: ExecutorConnectorCancelRequest): ExecutorConnectorCancelResult {
      const blocked = unsupported("cancel");

      if (blocked !== undefined) {
        return blocked;
      }

      const record = records.get(request.requestId);

      if (record === undefined) {
        return invalidRequest(connectorId, "cancel", "fake executor request is unknown");
      }

      record.cancelled = true;

      return {
        ok: true,
        connectorId,
        operation: "cancel",
        value: {
          requestId: request.requestId,
          cancelled: true,
          observedAt: "2026-04-30T04:00:04.000Z"
        }
      };
    },
    fetchEvidence(
      request: ExecutorConnectorFetchEvidenceRequest
    ): ExecutorConnectorFetchEvidenceResult {
      const blocked = unsupported("fetchEvidence");

      if (blocked !== undefined) {
        return blocked;
      }

      if (!records.has(request.requestId)) {
        return invalidRequest(connectorId, "fetchEvidence", "fake executor request is unknown");
      }

      return {
        ok: true,
        connectorId,
        operation: "fetchEvidence",
        value: {
          requestId: request.requestId,
          evidence
        }
      };
    }
  };
};

export const fakeFlowControlForDecision = (
  decision: ExecutorPolicyDecisionPayload
): ExecutorFlowControlState => mapExecutorPolicyDecisionToFlowControlState(decision);

const createFakeCapabilities = (
  overrides: Partial<Record<ConnectorOperation, ConnectorOperationSupport>> | undefined
): ConnectorCapabilities => ({
  ...createExecutorConnectorCapabilities(),
  ...overrides
});

const invalidRequest = (
  connectorId: string,
  operation: ConnectorOperation,
  message: string
) => ({
  ok: false,
  connectorId,
  operation,
  error: {
    code: "invalid-request" as const,
    message,
    retryable: false
  }
});
