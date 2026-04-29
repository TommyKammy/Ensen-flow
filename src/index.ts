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
