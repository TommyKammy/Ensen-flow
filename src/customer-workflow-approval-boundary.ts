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
  artifactIntent?: string;
  intent?: string;
  approvalState?: string;
  externalApplicationState?: string;
  humanApprovalRef?: string;
  decisionBoundary?: string;
  supersedesRef?: string;
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

export const assertCustomerWorkflowApprovalBoundary = (input: {
  triggerContext: Record<string, unknown>;
  stepResult: WorkflowStepAttemptResultMetadata | undefined;
}): void => {
  const customerWorkflow = parseCustomerWorkflowInput(input.triggerContext.customerWorkflow);
  if (customerWorkflow === undefined || input.stepResult === undefined) {
    return;
  }

  const executorResult = resolveExecutorResult(input.stepResult);
  if (executorResult === undefined) {
    return;
  }

  assertNoAutomaticQualityDecision(executorResult);
  assertNoLiveWriteBack(executorResult);

  for (const artifact of resolveCustomerWorkflowArtifacts(executorResult)) {
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
  const approvalState = parseApprovalState(input.artifact.approvalState);
  const externalApplicationState = input.artifact.externalApplicationState;

  if (externalApplicationState === "applied") {
    throw new Error(
      "customer workflow artifacts cannot claim live write-back or external application"
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

    if (approvalState === "approved") {
      throw new Error("read-only customer workflow mode cannot record approval as committed");
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

  if (approvalState !== undefined && !NON_COMMITTED_APPROVAL_STATES.has(approvalState)) {
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

const resolveExecutorResult = (
  stepResult: WorkflowStepAttemptResultMetadata
): Record<string, unknown> | undefined => {
  const executor = stepResult.executor;
  if (!isRecord(executor) || !isRecord(executor.result)) {
    return undefined;
  }

  return executor.result;
};

const resolveCustomerWorkflowArtifacts = (
  result: Record<string, unknown>
): CustomerWorkflowApprovalBoundaryArtifact[] => {
  const artifacts: CustomerWorkflowApprovalBoundaryArtifact[] = [];
  if (isRecord(result.customerWorkflowArtifact)) {
    artifacts.push(result.customerWorkflowArtifact);
  }

  if (Array.isArray(result.customerWorkflowArtifacts)) {
    artifacts.push(...result.customerWorkflowArtifacts.filter(isRecord));
  }

  return artifacts;
};

const parseApprovalState = (
  value: unknown
): CustomerWorkflowApprovalState | undefined => {
  if (typeof value !== "string") {
    return undefined;
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
