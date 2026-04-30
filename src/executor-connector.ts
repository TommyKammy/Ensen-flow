import {
  createUnsupportedConnectorOperationResult
} from "./connector.js";
import type {
  ConnectorCancelReceipt,
  ConnectorCancelRequest,
  ConnectorCancelResult,
  ConnectorCapabilities,
  ConnectorFetchEvidenceRequest,
  ConnectorIdentity,
  ConnectorOperation,
  ConnectorResult
} from "./connector.js";

export type ExecutorPolicyDecision = "allow" | "approval-required" | "blocked" | "needs-review";

export interface ExecutorPolicyDecisionPayload {
  decision: ExecutorPolicyDecision;
  reason?: string;
  decidedAt?: string;
  source?: {
    type: "policy" | "connector" | "operator";
    id: string;
  };
  evidence?: Record<string, unknown>;
}

export type ExecutorFlowControlStateName =
  | "ready"
  | "approval-required"
  | "blocked"
  | "needs-review";

export interface ExecutorFlowControlState {
  state: ExecutorFlowControlStateName;
  authority: "ensen-flow";
  reason?: string;
  policyDecision?: ExecutorPolicyDecisionPayload;
}

export interface ExecutorSubmitRequest {
  workflow: {
    id: string;
    version: string;
  };
  run: {
    id: string;
  };
  step: {
    id: string;
    attempt: number;
  };
  input?: Record<string, unknown>;
  idempotencyKey?: string;
  policyDecision?: ExecutorPolicyDecisionPayload;
}

export interface ExecutorConnectorSubmitReceipt {
  requestId: string;
  acceptedAt?: string;
  flowControl: ExecutorFlowControlState;
  evidence?: Record<string, unknown>;
}

export type ExecutorConnectorSubmitResult =
  ConnectorResult<ExecutorConnectorSubmitReceipt>;

export interface ExecutorConnectorStatusRequest {
  requestId: string;
}

export type ExecutorConnectorExecutionStatus =
  | "accepted"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "approval-required"
  | "blocked"
  | "needs-review";

export type ExecutorConnectorResultStatus =
  | "succeeded"
  | "failed"
  | "cancelled"
  | "blocked"
  | "approval-required"
  | "needs-review";

export interface ExecutorConnectorExecutionResult {
  status: ExecutorConnectorResultStatus;
  summary?: string;
  output?: Record<string, unknown>;
  evidence?: Record<string, unknown>;
}

export interface ExecutorConnectorStatusSnapshot {
  requestId: string;
  status: ExecutorConnectorExecutionStatus;
  observedAt?: string;
  flowControl?: ExecutorFlowControlState;
  result?: ExecutorConnectorExecutionResult;
  evidence?: Record<string, unknown>;
}

export type ExecutorConnectorStatusResult =
  ConnectorResult<ExecutorConnectorStatusSnapshot>;

export type ExecutorConnectorCancelRequest = ConnectorCancelRequest;
export type ExecutorConnectorCancelReceipt = ConnectorCancelReceipt;
export type ExecutorConnectorCancelResult = ConnectorCancelResult;

export type ExecutorConnectorFetchEvidenceRequest = ConnectorFetchEvidenceRequest;

export interface ExecutorConnectorEvidenceBundle {
  requestId: string;
  evidence: Record<string, unknown>;
}

export type ExecutorConnectorFetchEvidenceResult =
  ConnectorResult<ExecutorConnectorEvidenceBundle>;

export interface ExecutorConnector {
  identity: ConnectorIdentity;
  capabilities: ConnectorCapabilities;
  submit(
    request: ExecutorSubmitRequest
  ): Promise<ExecutorConnectorSubmitResult> | ExecutorConnectorSubmitResult;
  status(
    request: ExecutorConnectorStatusRequest
  ): Promise<ExecutorConnectorStatusResult> | ExecutorConnectorStatusResult;
  cancel(
    request: ExecutorConnectorCancelRequest
  ): Promise<ExecutorConnectorCancelResult> | ExecutorConnectorCancelResult;
  fetchEvidence(
    request: ExecutorConnectorFetchEvidenceRequest
  ):
    | Promise<ExecutorConnectorFetchEvidenceResult>
    | ExecutorConnectorFetchEvidenceResult;
}

export const createExecutorConnectorCapabilities = (): ConnectorCapabilities => ({
  submit: { supported: true },
  status: { supported: true },
  cancel: { supported: true },
  fetchEvidence: { supported: true }
});

export const mapExecutorPolicyDecisionToFlowControlState = (
  policyDecision: ExecutorPolicyDecisionPayload | undefined
): ExecutorFlowControlState => {
  if (policyDecision === undefined) {
    return {
      state: "blocked",
      authority: "ensen-flow",
      reason: "executor policy decision is missing"
    };
  }

  const state = policyDecision.decision === "allow" ? "ready" : policyDecision.decision;

  return {
    state,
    authority: "ensen-flow",
    ...(policyDecision.reason === undefined ? {} : { reason: policyDecision.reason }),
    policyDecision
  };
};

export const createUnsupportedExecutorConnectorOperationResult = (
  input: {
    connectorId: string;
    operation: ConnectorOperation;
    reason: string;
  }
): ConnectorResult<never> => createUnsupportedConnectorOperationResult(input);
