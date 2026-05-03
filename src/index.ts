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
  explainControlledPilotBoundaryRejection
} from "./controlled-pilot-input-boundary.js";

export {
  createFakeHttpNotificationTransport,
  createHttpNotificationConnector
} from "./http-notification-connector.js";

export {
  createInMemoryLocalFileIdempotencyStore,
  createLocalFileConnector
} from "./file-connector.js";

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

export type {
  CreateFakeHttpNotificationTransportInput,
  CreateHttpNotificationConnectorInput,
  FakeHttpNotificationTransport,
  HttpNotificationCapabilities,
  HttpNotificationConnector,
  HttpNotificationMethod,
  HttpNotificationOutcome,
  HttpNotificationOutcomeStatus,
  HttpNotificationReceipt,
  HttpNotificationSubmitRequest,
  HttpNotificationSubmitResult,
  HttpNotificationTarget,
  HttpNotificationTransport,
  HttpNotificationTransportDelivery
} from "./http-notification-connector.js";

export type {
  CreateLocalFileConnectorInput,
  LocalFileAction,
  LocalFileAllowedRoot,
  LocalFileConnector,
  LocalFileIdempotencyRecord,
  LocalFileIdempotencyStore,
  LocalFileIdempotencyStoreResult,
  LocalFileReceipt,
  LocalFileRequest,
  LocalFileSubmitRequest,
  LocalFileSubmitResult
} from "./file-connector.js";

export type { EipVersionBoundary } from "./eip-version.js";

export {
  appendWorkflowRunEvent,
  createWorkflowRun,
  inspectWorkflowRunRecovery,
  readWorkflowRunState,
  stopWorkflowRunRecovery
} from "./workflow-run-state.js";

export { createLocalAuditEventWriter } from "./audit-event-writer.js";

export type {
  AppendableWorkflowRunEvent,
  CreateWorkflowRunInput,
  WorkflowRunCreatedEvent,
  WorkflowRunEvent,
  WorkflowRunIdempotencyMetadata,
  WorkflowRunRecoveryAction,
  WorkflowRunRecoveryClassification,
  WorkflowRunRecoveryReport,
  WorkflowRunRecoveryRunSummary,
  WorkflowRunRecoveryStepAttemptSummary,
  WorkflowRunRecord,
  WorkflowRunRetryMetadata,
  WorkflowRunState,
  WorkflowRunStatus,
  WorkflowRunTerminalState,
  WorkflowRunTriggerContext,
  StopWorkflowRunRecoveryInput,
  WorkflowStepAttemptEvent,
  WorkflowStepAttemptResultMetadata,
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

export {
  evaluateScheduleTrigger,
  isDueForSchedule
} from "./schedule-trigger.js";

export {
  WebhookIntakeRejectedError,
  consumeWebhookInput,
  webhookInputSchemaVersion
} from "./webhook-intake.js";

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
  ConsumeWebhookInputOptions,
  WebhookInput
} from "./webhook-intake.js";

export type {
  RunWorkflowInput,
  WorkflowStepHandler,
  WorkflowStepHandlerInput,
  WorkflowStepHandlerResult
} from "./workflow-runner.js";

export type {
  EvaluateScheduleTriggerInput,
  ScheduleTriggerEvaluationResult,
  ScheduleTriggerNotDueResult
} from "./schedule-trigger.js";

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

export type {
  ControlledPilotInputBoundary,
  ControlledPilotInputBoundaryMode,
  ControlledPilotOverride,
  DryRunFirstEvidence,
  DryRunFirstInputBoundaryMode
} from "./controlled-pilot-input-boundary.js";
