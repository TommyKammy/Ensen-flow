import type {
  CustomerWorkflowAllowlistMode,
  CustomerWorkflowInput
} from "./customer-workflow-allowlist.js";
import type { WorkflowStepAttemptResultMetadata } from "./workflow-run-state.js";

export type CustomerWorkflowApprovalState =
  | "approval-required"
  | "approved"
  | "rejected"
  | "revoked"
  | "superseded";

export interface CustomerWorkflowApprovalBoundaryArtifact {
  artifactIntent?: unknown;
  intent?: unknown;
  approvalState?: unknown;
  externalApplicationState?: unknown;
  humanApprovalRef?: unknown;
  decisionBoundary?: unknown;
  supersedesRef?: unknown;
}

const APPROVAL_STATES = new Set<CustomerWorkflowApprovalState>([
  "approval-required",
  "approved",
  "rejected",
  "revoked",
  "superseded"
]);

const NON_COMMITTED_APPROVAL_STATES = new Set<CustomerWorkflowApprovalState>([
  "approval-required",
  "rejected",
  "revoked",
  "superseded"
]);

const CUSTOMER_WORKFLOW_OUTPUT_BOUNDARY_KEYS = [
  "automaticQualityDecision",
  "customerWorkflowArtifact",
  "customerWorkflowArtifacts",
  "decisionType",
  "externalApplicationState",
  "finalQualityDecisionSource",
  "liveWriteBack",
  "qualityDecisionSource",
  "writeBack"
] as const;

export const assertCustomerWorkflowApprovalBoundary = (input: {
  triggerContext: Record<string, unknown>;
  stepResult: WorkflowStepAttemptResultMetadata | undefined;
}): void => {
  const customerWorkflow = parseCustomerWorkflowInput(input.triggerContext.customerWorkflow);
  if (customerWorkflow === undefined || input.stepResult === undefined) {
    return;
  }

  const executorOutput = resolveExecutorOutput(input.stepResult);
  if (executorOutput === undefined) {
    return;
  }

  assertNoAutomaticQualityDecision(executorOutput);
  assertNoLiveWriteBack(executorOutput);

  for (const artifact of resolveCustomerWorkflowArtifacts(executorOutput)) {
    assertArtifactBoundary({
      artifact,
      mode: customerWorkflow.mode
    });
  }
};

const assertArtifactBoundary = (input: {
  artifact: CustomerWorkflowApprovalBoundaryArtifact;
  mode: CustomerWorkflowAllowlistMode;
}): void => {
  const artifactIntent = input.artifact.artifactIntent ?? input.artifact.intent;
  const approvalState = parseApprovalState(input.artifact);
  const externalApplicationState = input.artifact.externalApplicationState;

  if (externalApplicationState !== "not-applied") {
    throw new Error(
      "customer workflow artifacts must remain not-applied in read-only or draft-only mode"
    );
  }

  if (input.mode === "read-only") {
    if (
      artifactIntent !== undefined &&
      artifactIntent !== "read-only" &&
      artifactIntent !== "observation"
    ) {
      throw new Error(
        "read-only customer workflow mode cannot create draft-only or committed artifacts"
      );
    }

    if (approvalState !== undefined) {
      throw new Error("read-only customer workflow mode cannot record approval lifecycle states");
    }
    return;
  }

  if (input.mode !== "draft-only") {
    return;
  }

  if (artifactIntent === "committed") {
    if (
      approvalState !== "approved" ||
      !hasNonEmptyString(input.artifact.humanApprovalRef) ||
      !hasNonEmptyString(input.artifact.decisionBoundary)
    ) {
      throw new Error(
        "draft-only customer workflow artifacts cannot be committed without explicit human approval"
      );
    }
    return;
  }

  if (artifactIntent !== undefined && artifactIntent !== "draft-only") {
    throw new Error(
      "draft-only customer workflow mode can only create draft-only artifacts before approval"
    );
  }

  if (approvalState === undefined) {
    throw new Error(
      "draft-only customer workflow artifacts require an explicit lifecycle approvalState before approval"
    );
  }

  if (!NON_COMMITTED_APPROVAL_STATES.has(approvalState)) {
    throw new Error(
      "draft-only customer workflow artifacts require an explicit human approval before approved state"
    );
  }
};

const assertNoAutomaticQualityDecision = (
  result: Record<string, unknown>
): void => {
  if (
    result.automaticQualityDecision === true ||
    result.decisionType === "automatic-quality-decision" ||
    result.qualityDecisionSource === "automatic" ||
    result.finalQualityDecisionSource === "automatic"
  ) {
    throw new Error("customer workflow output cannot infer automatic quality decisions");
  }
};

const assertNoLiveWriteBack = (result: Record<string, unknown>): void => {
  if (
    result.liveWriteBack === true ||
    result.writeBack === "live" ||
    result.externalApplicationState === "applied"
  ) {
    throw new Error(
      "customer workflow artifacts cannot claim live write-back or external application"
    );
  }
};

const resolveExecutorOutput = (
  stepResult: WorkflowStepAttemptResultMetadata
): Record<string, unknown> | undefined => {
  const executor = stepResult.executor;
  if (!isRecord(executor) || !isRecord(executor.result)) {
    return undefined;
  }

  assertNoBoundaryFieldsOutsideOutput(executor.result);

  if (executor.result.output === undefined) {
    return undefined;
  }

  if (!isRecord(executor.result.output)) {
    throw new Error("customer workflow executor result output must be an object");
  }

  return executor.result.output;
};

const resolveCustomerWorkflowArtifacts = (
  result: Record<string, unknown>
): CustomerWorkflowApprovalBoundaryArtifact[] => {
  const artifacts: CustomerWorkflowApprovalBoundaryArtifact[] = [];

  if (hasOwn(result, "customerWorkflowArtifact")) {
    if (!isRecord(result.customerWorkflowArtifact)) {
      throw new Error("customer workflow artifact must be an object");
    }
    artifacts.push(result.customerWorkflowArtifact);
  }

  if (hasOwn(result, "customerWorkflowArtifacts")) {
    if (!Array.isArray(result.customerWorkflowArtifacts)) {
      throw new Error("customer workflow artifacts must be an array of objects");
    }

    for (const artifact of result.customerWorkflowArtifacts) {
      if (!isRecord(artifact)) {
        throw new Error("customer workflow artifacts must be an array of objects");
      }
      artifacts.push(artifact);
    }
  }

  return artifacts;
};

const assertNoBoundaryFieldsOutsideOutput = (result: Record<string, unknown>): void => {
  for (const key of CUSTOMER_WORKFLOW_OUTPUT_BOUNDARY_KEYS) {
    if (hasOwn(result, key)) {
      throw new Error("customer workflow boundary fields must be provided in executor result output");
    }
  }
};

const parseApprovalState = (
  artifact: CustomerWorkflowApprovalBoundaryArtifact
): CustomerWorkflowApprovalState | undefined => {
  if (!hasOwn(artifact, "approvalState")) {
    return undefined;
  }

  const value = artifact.approvalState;
  if (typeof value !== "string") {
    throw new Error("customer workflow artifact approvalState must be a string");
  }

  if (!APPROVAL_STATES.has(value as CustomerWorkflowApprovalState)) {
    throw new Error("customer workflow artifact approvalState is not supported");
  }

  return value as CustomerWorkflowApprovalState;
};

const parseCustomerWorkflowInput = (
  value: unknown
): CustomerWorkflowInput | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }

  if (
    typeof value.ref !== "string" ||
    typeof value.mode !== "string" ||
    !isCustomerWorkflowMode(value.mode)
  ) {
    return undefined;
  }

  return value as unknown as CustomerWorkflowInput;
};

const isCustomerWorkflowMode = (
  value: string
): value is CustomerWorkflowAllowlistMode =>
  value === "fake" ||
  value === "read-only" ||
  value === "draft-only" ||
  value === "live-write-back";

const hasNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim() !== "";

const hasOwn = <T extends object, K extends PropertyKey>(
  value: T,
  key: K
): value is T & Record<K, unknown> => Object.hasOwn(value, key);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
