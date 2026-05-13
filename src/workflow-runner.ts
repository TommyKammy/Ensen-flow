import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import {
  appendWorkflowRunEvent,
  createWorkflowRun,
  readWorkflowRunState
} from "./workflow-run-state.js";
import { createLocalAuditEventWriter } from "./audit-event-writer.js";
import type { NeutralAuditEventWriter } from "./audit-event-writer.js";
import type {
  ExecutorConnectorStatusSnapshot,
  ExecutorConnectorExecutionStatus
} from "./executor-connector.js";
import type {
  AppendableWorkflowRunEvent,
  WorkflowRunIdempotencyMetadata,
  WorkflowRunRecoveryDecisionMetadata,
  WorkflowStepAttemptResultMetadata,
  WorkflowRunState,
  WorkflowStepAttemptState
} from "./workflow-run-state.js";
import {
  eipVersionBoundary,
  isSupportedEipProtocolVersion
} from "./eip-version.js";
import {
  validateWorkflowDefinition,
  workflowDefinitionSchemaVersion
} from "./workflow-definition.js";
import { assertCustomerWorkflowApprovalBoundary } from "./customer-workflow-approval-boundary.js";
import { assertCustomerWorkflowAllowlisted } from "./customer-workflow-allowlist.js";
import type {
  IdempotencyKeyDefinition,
  RetryPolicy,
  WorkflowDefinition,
  WorkflowStep
} from "./workflow-definition.js";

export interface RunWorkflowInput {
  definition: WorkflowDefinition;
  statePath: string;
  auditPath?: string;
  runId?: string;
  triggerContext?: Record<string, unknown>;
  existingRunStateGuard?: (existingState: WorkflowRunState) => void;
  existingRunStateArtifactHygiene?: "enforce" | "skip";
  now?: () => string;
  stepHandler?: WorkflowStepHandler;
}

export interface WorkflowStepHandlerInput {
  definition: WorkflowDefinition;
  step: WorkflowStep;
  attempt: number;
  triggerContext: Record<string, unknown>;
  runState: WorkflowRunState;
}

export type WorkflowStepHandlerResult =
  | void
  | ExecutorConnectorStatusSnapshot
  | {
      executor: ExecutorConnectorStatusSnapshot;
    };

export type WorkflowStepHandler = (
  input: WorkflowStepHandlerInput
) => Promise<WorkflowStepHandlerResult> | WorkflowStepHandlerResult;

interface NormalizedWorkflowStepHandlerResult extends WorkflowStepAttemptResultMetadata {
  executor: ExecutorConnectorStatusSnapshot;
}

export const runWorkflow = async (input: RunWorkflowInput): Promise<WorkflowRunState> => {
  assertSupportedWorkflowEipProtocolVersion(input.definition);

  const validation = validateWorkflowDefinition(input.definition);
  if (!validation.valid) {
    const details = validation.errors
      .map((error) => `${error.path}: ${error.message}`)
      .join("; ");
    throw new Error(`workflow definition is invalid: ${details}`);
  }

  const orderedSteps = orderSteps(input.definition.steps);
  const now = input.now ?? (() => new Date().toISOString());
  const triggerContext = input.triggerContext ?? {};
  const triggerIdempotencyKey = resolveIdempotencyKey(
    input.definition.trigger.idempotencyKey,
    input.definition,
    undefined,
    triggerContext
  );
  const runId =
    input.runId ??
    `${input.definition.id}-${triggerIdempotencyKey?.key ?? "local-run"}`;
  const stepHandler = input.stepHandler ?? defaultWorkflowStepHandler;
  const existingRunStateArtifactHygiene =
    input.existingRunStateArtifactHygiene ?? "enforce";
  const existingRunStateReadOptions = {
    artifactHygiene: existingRunStateArtifactHygiene
  };
  const readCurrentRunState = () =>
    readWorkflowRunState(input.statePath, existingRunStateReadOptions);
  const appendRunEvent = (event: AppendableWorkflowRunEvent) =>
    appendWorkflowRunEvent(input.statePath, event, existingRunStateReadOptions);
  const auditWriter =
    input.auditPath === undefined
      ? undefined
      : createLocalAuditEventWriter({
          auditPath: input.auditPath,
          workflow: {
            id: input.definition.id,
            version: workflowDefinitionSchemaVersion
          },
          run: { id: runId }
        });

  const existingState = await readExistingRunState(
    input.statePath,
    existingRunStateArtifactHygiene
  );
  if (existingState !== undefined) {
    assertExistingRunMatches(existingState, input.definition, runId, triggerIdempotencyKey);
    assertPersistedRunCustomerWorkflowAllowlisted(existingState, input.definition);
    assertRequestedCustomerWorkflowAllowlisted(input.definition, triggerContext);
    input.existingRunStateGuard?.(existingState);
    if (existingState.run.terminalState !== undefined) {
      return existingState;
    }
    assertExistingRunRecoverable(existingState, orderedSteps);
  } else {
    assertRequestedCustomerWorkflowAllowlisted(input.definition, triggerContext);
    const triggerReceivedAt = now();
    const createdAt = now();
    let createdNewRun = false;
    try {
      await createWorkflowRun(input.statePath, {
        runId,
        workflowId: input.definition.id,
        workflowVersion: workflowDefinitionSchemaVersion,
        trigger: {
          type: input.definition.trigger.type,
          receivedAt: triggerReceivedAt,
          context: triggerContext,
          ...(triggerIdempotencyKey === undefined ? {} : { idempotencyKey: triggerIdempotencyKey })
        },
        createdAt
      });
      createdNewRun = true;
    } catch (error) {
      if (!isNodeError(error) || error.code !== "EEXIST") {
        throw error;
      }

      const competingState = await readCompetingRunState(
        input.statePath,
        existingRunStateArtifactHygiene
      );
      assertExistingRunMatches(competingState, input.definition, runId, triggerIdempotencyKey);
      assertPersistedRunCustomerWorkflowAllowlisted(competingState, input.definition);
      assertRequestedCustomerWorkflowAllowlisted(input.definition, triggerContext);
      input.existingRunStateGuard?.(competingState);
      if (competingState.run.terminalState !== undefined) {
        return competingState;
      }
      assertExistingRunRecoverable(competingState, orderedSteps);
    }
    if (createdNewRun) {
      await auditWriter?.write({
        type: "workflow.started",
        occurredAt: createdAt
      });
    }
  }

  for (const step of orderedSteps) {
    const retryPolicy = step.retry ?? { maxAttempts: 1, backoff: { strategy: "none" as const } };
    const latestAttempt = latestStepAttempt((await readCurrentRunState()).stepAttempts[step.id]);
    if (latestAttempt?.status === "succeeded") {
      continue;
    }

    const firstAttempt =
      latestAttempt?.status === "retryable-failed" ? latestAttempt.attempt + 1 : 1;
    if (firstAttempt > retryPolicy.maxAttempts) {
      throw new Error(
        `existing workflow run state cannot resume ${step.id}; retry policy has no remaining attempts`
      );
    }

    for (let attempt = firstAttempt; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      const startedAt = now();
      await appendRunEvent({
        type: "step.attempt.started",
        runId,
        stepId: step.id,
        attempt,
        occurredAt: startedAt
      });
      await writeStepAuditEvent(auditWriter, {
        type: "step.started",
        occurredAt: startedAt,
        stepId: step.id,
        attempt
      });

      try {
        const currentRunState = await readCurrentRunState();
        const persistedTriggerContext = currentRunState.run.trigger.context ?? {};
        const stepResult = normalizeStepHandlerResult(
          await stepHandler({
            definition: input.definition,
            step,
            attempt,
            triggerContext: persistedTriggerContext,
            runState: currentRunState
          })
        );

        if (
          stepResult?.executor !== undefined &&
          stepResult.executor.status !== "succeeded"
        ) {
          throw new WorkflowStepOutcomeError(
            executorFailureReason(stepResult.executor),
            stepResult
          );
        }
        assertCustomerWorkflowApprovalBoundary({
          triggerContext: persistedTriggerContext,
          stepResult
        });

        const completedAt = now();
        await appendRunEvent({
          type: "step.attempt.completed",
          runId,
          stepId: step.id,
          attempt,
          occurredAt: completedAt,
          ...(stepResult === undefined ? {} : { result: stepResult })
        });
        await writeStepAuditEvent(auditWriter, {
          type: "step.completed",
          occurredAt: completedAt,
          stepId: step.id,
          attempt,
          outcome: { status: "succeeded" }
        });
        break;
      } catch (error) {
        const stepResult = errorStepResult(error);
        const recovery = recoveryDecisionFromStepResult(stepResult, error);
        const retryable = recovery === undefined && attempt < retryPolicy.maxAttempts;
        const failedAt = now();
        const nextAttemptAt = retryable
          ? calculateNextAttemptAt(failedAt, retryPolicy, attempt)
          : undefined;
        await appendRunEvent({
          type: "step.attempt.failed",
          runId,
          stepId: step.id,
          attempt,
          occurredAt: failedAt,
          retry: {
            retryable,
            ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
            reason: errorReason(error)
          },
          ...(stepResult === undefined ? {} : { result: stepResult }),
          ...(recovery === undefined ? {} : { recovery })
        });
        await writeStepAuditEvent(auditWriter, {
          type: "step.failed",
          occurredAt: failedAt,
          stepId: step.id,
          attempt,
          retry: {
            retryable,
            ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
            reason: errorReason(error)
          },
          outcome: {
            status: auditOutcomeStatusFromRecovery(recovery),
            reason: errorReason(error)
          }
        });

        if (
          recovery?.state === "approval-required" ||
          recovery?.state === "manual-repair-needed"
        ) {
          return readCurrentRunState();
        }

        if (!retryable) {
          const completedAt = now();
          await appendRunEvent({
            type: "run.completed",
            runId,
            terminalState: "failed",
            occurredAt: completedAt,
            ...(recovery === undefined ? {} : { recovery })
          });
          await auditWriter?.write({
            type: "workflow.failed",
            occurredAt: completedAt,
            outcome: {
              status: auditOutcomeStatusFromRecovery(recovery),
              reason: errorReason(error)
            }
          });
          return readCurrentRunState();
        }

        await writeStepAuditEvent(auditWriter, {
          type: "step.retry.scheduled",
          occurredAt: failedAt,
          stepId: step.id,
          attempt,
          retry: {
            retryable,
            ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
            reason: errorReason(error)
          }
        });
      }
    }
  }

  const completedAt = now();
  await appendRunEvent({
    type: "run.completed",
    runId,
    terminalState: "succeeded",
    occurredAt: completedAt
  });
  await auditWriter?.write({
    type: "workflow.completed",
    occurredAt: completedAt,
    outcome: { status: "succeeded" }
  });

  return readCurrentRunState();
};

class WorkflowStepOutcomeError extends Error {
  readonly result: WorkflowStepAttemptResultMetadata;

  constructor(message: string, result: WorkflowStepAttemptResultMetadata) {
    super(message);
    this.name = "WorkflowStepOutcomeError";
    this.result = result;
  }
}

const normalizeStepHandlerResult = (
  result: WorkflowStepHandlerResult
): NormalizedWorkflowStepHandlerResult | undefined => {
  if (result === undefined) {
    return undefined;
  }

  if (isExecutorStatusSnapshot(result)) {
    return { executor: result };
  }

  if (isRecord(result) && isExecutorStatusSnapshot(result.executor)) {
    return { executor: result.executor };
  }

  throw new Error("stepHandler must return an ExecutorConnectorStatusSnapshot or { executor }");
};

const errorStepResult = (error: unknown): WorkflowStepAttemptResultMetadata | undefined =>
  error instanceof WorkflowStepOutcomeError ? error.result : undefined;

const executorFailureReason = (executor: ExecutorConnectorStatusSnapshot): string => {
  const resultSummary = executor.result?.summary;
  if (resultSummary !== undefined && resultSummary.trim() !== "") {
    return resultSummary;
  }

  return `executor status ${executor.status} did not complete successfully`;
};

const recoveryDecisionFromStepResult = (
  stepResult: WorkflowStepAttemptResultMetadata | undefined,
  error: unknown
): WorkflowRunRecoveryDecisionMetadata | undefined => {
  if (!isRecord(stepResult) || !isExecutorStatusSnapshot(stepResult.executor)) {
    return undefined;
  }

  const reason = errorReason(error);
  if (stepResult.executor.status === "approval-required") {
    return {
      state: "approval-required",
      decision: "await-human-approval",
      reason
    };
  }

  if (stepResult.executor.status === "blocked") {
    return {
      state: "blocked",
      decision: "block-run",
      reason
    };
  }

  if (stepResult.executor.status === "needs-review") {
    return {
      state: "manual-repair-needed",
      decision: "manual-repair-needed",
      reason
    };
  }

  return undefined;
};

const auditOutcomeStatusFromRecovery = (
  recovery: WorkflowRunRecoveryDecisionMetadata | undefined
): "failed" | "approval-required" | "blocked" | "manual-repair-needed" => {
  if (
    recovery?.state === "approval-required" ||
    recovery?.state === "blocked" ||
    recovery?.state === "manual-repair-needed"
  ) {
    return recovery.state;
  }

  return "failed";
};

const isExecutorStatusSnapshot = (
  value: unknown
): value is ExecutorConnectorStatusSnapshot => {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.requestId === "string" &&
    typeof value.status === "string" &&
    isExecutorTerminalOrProgressStatus(value.status)
  );
};

const isExecutorTerminalOrProgressStatus = (
  value: string
): value is ExecutorConnectorExecutionStatus =>
  value === "accepted" ||
  value === "running" ||
  value === "succeeded" ||
  value === "failed" ||
  value === "cancelled" ||
  value === "approval-required" ||
  value === "blocked" ||
  value === "needs-review";

export const loadWorkflowDefinitionFile = async (
  definitionPath: string
): Promise<WorkflowDefinition> => {
  const parsed = JSON.parse(await readFile(definitionPath, "utf8")) as unknown;
  assertSupportedWorkflowEipProtocolVersion(parsed);

  const validation = validateWorkflowDefinition(parsed);
  if (!validation.valid) {
    const details = validation.errors
      .map((error) => `${error.path}: ${error.message}`)
      .join("; ");
    throw new Error(`workflow definition is invalid: ${details}`);
  }

  return parsed as WorkflowDefinition;
};

const assertSupportedWorkflowEipProtocolVersion = (definition: unknown): void => {
  if (!isRecord(definition) || !("protocolVersion" in definition)) {
    return;
  }

  const protocolVersion = definition.protocolVersion;
  if (
    typeof protocolVersion !== "string" ||
    !isSupportedEipProtocolVersion(protocolVersion)
  ) {
    throw new Error(
      `unsupported EIP protocolVersion ${JSON.stringify(protocolVersion)}; ${eipVersionBoundary.unsupportedMajorVersionPolicy}`
    );
  }
};

const defaultWorkflowStepHandler: WorkflowStepHandler = ({ step }) => {
  if (step.action.name.trim() === "") {
    throw new Error("step action name must be configured");
  }
};

const readExistingRunState = async (
  statePath: string,
  artifactHygiene: "enforce" | "skip" = "enforce"
): Promise<WorkflowRunState | undefined> => {
  try {
    return await readWorkflowRunState(statePath, { artifactHygiene });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};

const readCompetingRunState = async (
  statePath: string,
  artifactHygiene: "enforce" | "skip" = "enforce"
): Promise<WorkflowRunState> => {
  const maxAttempts = 5;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await readWorkflowRunState(statePath, { artifactHygiene });
    } catch (error) {
      if (!isTransientRunCreationRead(error) || attempt === maxAttempts) {
        throw error;
      }
      await delay(5);
    }
  }

  return readWorkflowRunState(statePath, { artifactHygiene });
};

const isTransientRunCreationRead = (error: unknown): boolean =>
  error instanceof Error &&
  error.message === "workflow run state must contain a run.created record";

const assertExistingRunMatches = (
  existingState: WorkflowRunState,
  definition: WorkflowDefinition,
  runId: string,
  triggerIdempotencyKey: WorkflowRunIdempotencyMetadata | undefined
): void => {
  if (existingState.run.workflowId !== definition.id) {
    throw new Error("existing workflow run state has a different workflowId");
  }

  const existingKey = existingState.run.trigger.idempotencyKey;
  if (JSON.stringify(existingKey) !== JSON.stringify(triggerIdempotencyKey)) {
    throw new Error("existing workflow run state has a different idempotency key");
  }

  if (existingState.run.runId !== runId) {
    throw new Error("existing workflow run state has a different runId");
  }
};

const assertRequestedCustomerWorkflowAllowlisted = (
  definition: WorkflowDefinition,
  triggerContext: Record<string, unknown>
): void => {
  assertCustomerWorkflowAllowlisted({
    definition,
    triggerContext
  });
};

const assertPersistedRunCustomerWorkflowAllowlisted = (
  existingState: WorkflowRunState,
  definition: WorkflowDefinition
): void => {
  assertCustomerWorkflowAllowlisted({
    definition,
    triggerContext: existingState.run.trigger.context ?? {}
  });
};

const assertExistingRunRecoverable = (
  existingState: WorkflowRunState,
  orderedSteps: WorkflowStep[]
): void => {
  let sawIncompleteStep = false;

  for (const step of orderedSteps) {
    const latestAttempt = latestStepAttempt(existingState.stepAttempts[step.id]);
    if (latestAttempt?.status === "succeeded") {
      if (sawIncompleteStep) {
        throw new Error(
          `existing workflow run state references step ${step.id} after an incomplete earlier step; manual repair is required before recovery`
        );
      }
      continue;
    }

    if (latestAttempt !== undefined && sawIncompleteStep) {
      throw new Error(
        `existing workflow run state references step ${step.id} after an incomplete earlier step; manual repair is required before recovery`
      );
    }

    sawIncompleteStep = true;
  }

  for (const [stepId, attempts] of Object.entries(existingState.stepAttempts)) {
    if (!orderedSteps.some((step) => step.id === stepId)) {
      throw new Error(
        `existing workflow run state references unknown step ${stepId}; manual repair is required before recovery`
      );
    }

    const latestAttempt = latestStepAttempt(attempts);
    if (latestAttempt?.status === "running") {
      throw new Error(
        `existing workflow run state has active step attempt ${stepId}#${latestAttempt.attempt}; manual repair is required before recovery`
      );
    }

    if (latestAttempt?.status === "approval-required") {
      throw new Error(
        `existing workflow run state has approval-required step ${stepId}#${latestAttempt.attempt}; human approval is required before recovery`
      );
    }

    if (latestAttempt?.status === "blocked") {
      throw new Error(
        `existing workflow run state has blocked step ${stepId}#${latestAttempt.attempt}; operator review is required before recovery`
      );
    }

    if (latestAttempt?.status === "manual-repair-needed") {
      throw new Error(
        `existing workflow run state has manual-repair-needed step ${stepId}#${latestAttempt.attempt}; manual repair is required before recovery`
      );
    }

    if (latestAttempt?.status === "failed") {
      throw new Error(
        `existing workflow run state has failed non-terminal step ${stepId}#${latestAttempt.attempt}; manual repair is required before recovery`
      );
    }
  }
};

const latestStepAttempt = (
  attempts: WorkflowStepAttemptState[] | undefined
): WorkflowStepAttemptState | undefined => attempts?.at(-1);

const orderSteps = (steps: WorkflowStep[]): WorkflowStep[] => {
  const remaining = new Map(steps.map((step) => [step.id, step]));
  const ordered: WorkflowStep[] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.values()].find((step) =>
      (step.dependsOn ?? []).every((dependency) =>
        ordered.some((orderedStep) => orderedStep.id === dependency)
      )
    );

    if (ready === undefined) {
      throw new Error("workflow definition dependencies cannot be ordered");
    }

    ordered.push(ready);
    remaining.delete(ready.id);
  }

  return ordered;
};

const resolveIdempotencyKey = (
  definition: IdempotencyKeyDefinition | undefined,
  workflow: WorkflowDefinition,
  step: WorkflowStep | undefined,
  triggerContext: Record<string, unknown>
): WorkflowRunIdempotencyMetadata | undefined => {
  if (definition === undefined) {
    return undefined;
  }

  if (definition.source === "static") {
    return { source: "static", key: definition.value };
  }

  if (definition.source === "input") {
    const value = triggerContext[definition.field];
    if (value === undefined || value === null || value === "") {
      if (definition.required !== false) {
        throw new Error(`required idempotency input ${definition.field} is missing`);
      }
      return undefined;
    }

    if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
      throw new Error(`idempotency input ${definition.field} must be a scalar value`);
    }

    return { source: "input", key: String(value) };
  }

  return {
    source: "workflow",
    key: definition.template
      .replaceAll("{workflow.id}", workflow.id)
      .replaceAll("{step.id}", step?.id ?? "")
      .replaceAll("{trigger.type}", workflow.trigger.type)
      .replaceAll("{trigger.scheduledFor}", resolveScheduledFor(triggerContext))
      .replaceAll("{trigger.idempotencyKey}", resolveTriggerKey(triggerContext))
  };
};

const resolveScheduledFor = (triggerContext: Record<string, unknown>): string => {
  const schedule = triggerContext.schedule;
  if (!isRecord(schedule)) {
    return "";
  }

  const scheduledFor = schedule.scheduledFor;
  return typeof scheduledFor === "string" || typeof scheduledFor === "number"
    ? String(scheduledFor)
    : "";
};

const resolveTriggerKey = (triggerContext: Record<string, unknown>): string => {
  const requestId = triggerContext.requestId;
  if (typeof requestId === "string" || typeof requestId === "number") {
    return String(requestId);
  }

  return "";
};

const calculateNextAttemptAt = (
  failedAt: string,
  retryPolicy: RetryPolicy,
  attempt: number
): string | undefined => {
  const failedAtTime = Date.parse(failedAt);
  if (!Number.isFinite(failedAtTime)) {
    return undefined;
  }

  const backoff = retryPolicy.backoff;
  if (backoff.strategy === "none") {
    return failedAt;
  }

  if (backoff.strategy === "fixed") {
    return new Date(failedAtTime + backoff.delayMs).toISOString();
  }

  const delay = Math.min(
    backoff.initialDelayMs * 2 ** Math.max(0, attempt - 1),
    backoff.maxDelayMs
  );
  return new Date(failedAtTime + delay).toISOString();
};

const errorReason = (error: unknown): string => {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }

  return "step handler failed";
};

interface StepAuditInput {
  type: "step.started" | "step.completed" | "step.failed" | "step.retry.scheduled";
  occurredAt: string;
  stepId: string;
  attempt: number;
  retry?: {
    retryable: boolean;
    reason: string;
    nextAttemptAt?: string;
  };
  outcome?: {
    status:
      | "succeeded"
      | "failed"
      | "approval-required"
      | "blocked"
      | "manual-repair-needed";
    reason?: string;
  };
}

const writeStepAuditEvent = async (
  auditWriter: NeutralAuditEventWriter | undefined,
  input: StepAuditInput
): Promise<void> => {
  await auditWriter?.write({
    type: input.type,
    occurredAt: input.occurredAt,
    step: {
      id: input.stepId,
      attempt: input.attempt
    },
    ...(input.retry === undefined ? {} : { retry: input.retry }),
    ...(input.outcome === undefined ? {} : { outcome: input.outcome })
  });
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
