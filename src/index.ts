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
  validateWorkflowDefinition,
  workflowDefinitionSchemaVersion
} from "./workflow-definition.js";

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
