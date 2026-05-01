export type ConnectorOperation = "submit" | "status" | "cancel" | "fetchEvidence";

export interface ConnectorIdentity {
  id: string;
  displayName?: string;
  version?: string;
}

export type ConnectorOperationSupport =
  | {
      supported: true;
    }
  | {
      supported: false;
      reason: string;
    };

export interface ConnectorCapabilities {
  submit: ConnectorOperationSupport;
  status: ConnectorOperationSupport;
  cancel: ConnectorOperationSupport;
  fetchEvidence: ConnectorOperationSupport;
}

export type ConnectorErrorCode =
  | "unsupported-operation"
  | "invalid-request"
  | "execution-failed";

export interface ConnectorErrorBody {
  code: ConnectorErrorCode;
  message: string;
  retryable: boolean;
  reason?: string;
  failureClass?: "protocol-gap" | "loop-gap" | "flow-gap";
}

export type ConnectorResult<TValue = unknown> =
  | {
      ok: true;
      connectorId: string;
      operation: ConnectorOperation;
      value: TValue;
    }
  | {
      ok: false;
      connectorId: string;
      operation: ConnectorOperation;
      error: ConnectorErrorBody;
    };

export interface ConnectorSubmitRequest {
  workflowId: string;
  runId: string;
  stepId: string;
  idempotencyKey?: string;
  input?: Record<string, unknown>;
}

export interface ConnectorSubmitReceipt {
  requestId: string;
  acceptedAt?: string;
  evidence?: Record<string, unknown>;
}

export type ConnectorSubmitResult = ConnectorResult<ConnectorSubmitReceipt>;

export interface ConnectorStatusRequest {
  requestId: string;
}

export type ConnectorExecutionStatus =
  | "accepted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled";

export interface ConnectorStatusSnapshot {
  requestId: string;
  status: ConnectorExecutionStatus;
  observedAt?: string;
  evidence?: Record<string, unknown>;
}

export type ConnectorStatusResult = ConnectorResult<ConnectorStatusSnapshot>;

export interface ConnectorCancelRequest {
  requestId: string;
  reason?: string;
}

export interface ConnectorCancelReceipt {
  requestId: string;
  cancelled: boolean;
  observedAt?: string;
}

export type ConnectorCancelResult = ConnectorResult<ConnectorCancelReceipt>;

export interface ConnectorFetchEvidenceRequest {
  requestId: string;
}

export interface ConnectorEvidenceBundle {
  requestId: string;
  evidence: Record<string, unknown>;
}

export type ConnectorFetchEvidenceResult = ConnectorResult<ConnectorEvidenceBundle>;

export interface WorkflowConnector {
  identity: ConnectorIdentity;
  capabilities: ConnectorCapabilities;
  submit(request: ConnectorSubmitRequest): Promise<ConnectorSubmitResult> | ConnectorSubmitResult;
  status?(
    request: ConnectorStatusRequest
  ): Promise<ConnectorStatusResult> | ConnectorStatusResult;
  cancel?(
    request: ConnectorCancelRequest
  ): Promise<ConnectorCancelResult> | ConnectorCancelResult;
  fetchEvidence?(
    request: ConnectorFetchEvidenceRequest
  ): Promise<ConnectorFetchEvidenceResult> | ConnectorFetchEvidenceResult;
}

export interface CreateImmediateOnlyConnectorCapabilitiesInput {
  unsupportedReason: string;
}

export const createImmediateOnlyConnectorCapabilities = (
  input: CreateImmediateOnlyConnectorCapabilitiesInput
): ConnectorCapabilities => ({
  submit: { supported: true },
  status: { supported: false, reason: input.unsupportedReason },
  cancel: { supported: false, reason: input.unsupportedReason },
  fetchEvidence: { supported: false, reason: input.unsupportedReason }
});

export interface UnsupportedConnectorOperationInput {
  connectorId: string;
  operation: ConnectorOperation;
  reason: string;
}

export class ConnectorOperationUnsupportedError extends Error {
  readonly code = "unsupported-operation" as const;
  readonly connectorId: string;
  readonly operation: ConnectorOperation;
  readonly retryable = false;
  readonly reason: string;

  constructor(input: UnsupportedConnectorOperationInput) {
    super(formatUnsupportedOperationMessage(input));
    this.name = "ConnectorOperationUnsupportedError";
    this.connectorId = input.connectorId;
    this.operation = input.operation;
    this.reason = input.reason;
  }
}

export const createUnsupportedConnectorOperationResult = (
  input: UnsupportedConnectorOperationInput
): ConnectorResult<never> => ({
  ok: false,
  connectorId: input.connectorId,
  operation: input.operation,
  error: {
    code: "unsupported-operation",
    message: formatUnsupportedOperationMessage(input),
    retryable: false,
    reason: input.reason
  }
});

const formatUnsupportedOperationMessage = (
  input: UnsupportedConnectorOperationInput
): string => `connector ${input.connectorId} does not support ${input.operation}: ${input.reason}`;
