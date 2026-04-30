export interface BaselineInfo {
  packageName: "@tommykammy/ensen-flow";
  phase: "phase-1-baseline";
  runtimeFeaturesEnabled: false;
}

export const baselineInfo: BaselineInfo = {
  packageName: "@tommykammy/ensen-flow",
  phase: "phase-1-baseline",
  runtimeFeaturesEnabled: false
};

export {
  ConnectorOperationUnsupportedError,
  createImmediateOnlyConnectorCapabilities,
  createUnsupportedConnectorOperationResult
} from "./connector.js";

export {
  EnsenLoopCliTransportError,
  createCliEnsenLoopEipExecutorTransport,
  createEnsenLoopEipExecutorConnector,
  createFakeEnsenLoopEipExecutorTransport,
  createPerOperationCliEnsenLoopEipExecutorTransport
} from "./ensen-loop-eip-executor-connector.js";

export {
  createExecutorConnectorCapabilities,
  createUnsupportedExecutorConnectorOperationResult,
  mapExecutorPolicyDecisionToFlowControlState
} from "./executor-connector.js";

export {
  eipVersionBoundary,
  isSupportedEipProtocolVersion
} from "./eip-version.js";

export type {
  ConnectorCancelReceipt,
  ConnectorCancelRequest,
  ConnectorCancelResult,
  ConnectorCapabilities,
  ConnectorErrorBody,
  ConnectorErrorCode,
  ConnectorEvidenceBundle,
  ConnectorExecutionStatus,
  ConnectorFetchEvidenceRequest,
  ConnectorFetchEvidenceResult,
  ConnectorIdentity,
  ConnectorOperation,
  ConnectorOperationSupport,
  ConnectorResult,
  ConnectorStatusRequest,
  ConnectorStatusResult,
  ConnectorStatusSnapshot,
  ConnectorSubmitReceipt,
  ConnectorSubmitRequest,
  ConnectorSubmitResult,
  CreateImmediateOnlyConnectorCapabilitiesInput,
  UnsupportedConnectorOperationInput,
  WorkflowConnector
} from "./connector.js";

export type {
  CreateCliEnsenLoopEipExecutorTransportInput,
  CreateEnsenLoopEipExecutorConnectorInput,
  CreateFakeEnsenLoopEipExecutorTransportInput,
  EipRunRequestV1,
  EnsenLoopCliFailureClass,
  EnsenLoopCliOperation,
  EnsenLoopEipExecutorTransport,
  FakeEnsenLoopEipExecutorTransport,
  FakeEnsenLoopEipPayload,
  FakeEnsenLoopEipPayloadContext
} from "./ensen-loop-eip-executor-connector.js";

export type {
  ExecutorConnector,
  ExecutorConnectorCancelReceipt,
  ExecutorConnectorCancelRequest,
  ExecutorConnectorCancelResult,
  ExecutorConnectorEvidenceBundle,
  ExecutorConnectorExecutionResult,
  ExecutorConnectorExecutionStatus,
  ExecutorConnectorFetchEvidenceRequest,
  ExecutorConnectorFetchEvidenceResult,
  ExecutorConnectorResultStatus,
  ExecutorConnectorStatusRequest,
  ExecutorConnectorStatusResult,
  ExecutorConnectorStatusSnapshot,
  ExecutorConnectorSubmitReceipt,
  ExecutorConnectorSubmitResult,
  ExecutorFlowControlState,
  ExecutorFlowControlStateName,
  EipRunRequestActorRef,
  EipRunRequestMode,
  EipRunRequestPolicyContext,
  EipRunRequestSourceRef,
  EipRunRequestTarget,
  EipRunRequestWorkItem,
  ExecutorPolicyDecision,
  ExecutorPolicyDecisionPayload,
  ExecutorSubmitRequest
} from "./executor-connector.js";

export type { EipVersionBoundary } from "./eip-version.js";

export {
  appendWorkflowRunEvent,
  createWorkflowRun,
  readWorkflowRunState
} from "./workflow-run-state.js";

export { createLocalAuditEventWriter } from "./audit-event-writer.js";

export type {
  AppendableWorkflowRunEvent,
  CreateWorkflowRunInput,
  WorkflowRunCreatedEvent,
  WorkflowRunEvent,
  WorkflowRunIdempotencyMetadata,
  WorkflowRunRecord,
  WorkflowRunRetryMetadata,
  WorkflowRunState,
  WorkflowRunStatus,
  WorkflowRunTerminalState,
  WorkflowRunTriggerContext,
  WorkflowStepAttemptEvent,
  WorkflowStepAttemptState
} from "./workflow-run-state.js";

export {
  validateWorkflowDefinition,
  workflowDefinitionSchemaVersion
} from "./workflow-definition.js";

export {
  loadWorkflowDefinitionFile,
  runWorkflow
} from "./workflow-runner.js";

export type {
  IdempotencyKeyDefinition,
  RetryBackoffPolicy,
  RetryPolicy,
  WorkflowAction,
  WorkflowDefinition,
  WorkflowDefinitionValidationError,
  WorkflowDefinitionValidationResult,
  WorkflowSchemaVersion,
  WorkflowStep,
  WorkflowTrigger
} from "./workflow-definition.js";

export type {
  RunWorkflowInput,
  WorkflowStepHandler,
  WorkflowStepHandlerInput
} from "./workflow-runner.js";

export type {
  CreateLocalAuditEventWriterInput,
  CreateNeutralAuditEventInput,
  NeutralAuditActorContext,
  NeutralAuditEvent,
  NeutralAuditEventType,
  NeutralAuditEventWriter,
  NeutralAuditOutcomeContext,
  NeutralAuditRetryContext,
  NeutralAuditRunReference,
  NeutralAuditSourceContext,
  NeutralAuditStepReference,
  NeutralAuditWorkflowReference
} from "./audit-event-writer.js";
