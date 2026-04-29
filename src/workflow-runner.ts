import { readFile } from "node:fs/promises";

import {
  appendWorkflowRunEvent,
  createWorkflowRun,
  readWorkflowRunState
} from "./workflow-run-state.js";
import { createLocalAuditEventWriter } from "./audit-event-writer.js";
import type { NeutralAuditEventWriter } from "./audit-event-writer.js";
import type {
  WorkflowRunIdempotencyMetadata,
  WorkflowRunState
} from "./workflow-run-state.js";
import {
  validateWorkflowDefinition,
  workflowDefinitionSchemaVersion
} from "./workflow-definition.js";
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

export type WorkflowStepHandler = (input: WorkflowStepHandlerInput) => Promise<void> | void;

export const runWorkflow = async (input: RunWorkflowInput): Promise<WorkflowRunState> => {
  const validation = validateWorkflowDefinition(input.definition);
  if (!validation.valid) {
    const details = validation.errors
      .map((error) => `${error.path}: ${error.message}`)
      .join("; ");
    throw new Error(`workflow definition is invalid: ${details}`);
  }

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

  const existingState = await readExistingRunState(input.statePath);
  if (existingState !== undefined) {
    assertExistingRunMatches(existingState, input.definition, runId, triggerIdempotencyKey);
    if (existingState.run.terminalState !== undefined) {
      return existingState;
    }
    throw new Error("workflow run state already exists but is not terminal; resume is out of scope");
  }

  const triggerReceivedAt = now();
  const createdAt = now();
  await createWorkflowRun(input.statePath, {
    runId,
    workflowId: input.definition.id,
    workflowVersion: workflowDefinitionSchemaVersion,
    trigger: {
      type: input.definition.trigger.type,
      receivedAt: triggerReceivedAt,
      context: triggerContext,
      idempotencyKey: triggerIdempotencyKey
    },
    createdAt
  });
  await auditWriter?.write({
    type: "workflow.started",
    occurredAt: createdAt
  });

  const orderedSteps = orderSteps(input.definition.steps);

  for (const step of orderedSteps) {
    const retryPolicy = step.retry ?? { maxAttempts: 1, backoff: { strategy: "none" as const } };

    for (let attempt = 1; attempt <= retryPolicy.maxAttempts; attempt += 1) {
      const startedAt = now();
      await appendWorkflowRunEvent(input.statePath, {
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
        await stepHandler({
          definition: input.definition,
          step,
          attempt,
          triggerContext,
          runState: await readWorkflowRunState(input.statePath)
        });

        const completedAt = now();
        await appendWorkflowRunEvent(input.statePath, {
          type: "step.attempt.completed",
          runId,
          stepId: step.id,
          attempt,
          occurredAt: completedAt
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
        const retryable = attempt < retryPolicy.maxAttempts;
        const failedAt = now();
        const nextAttemptAt = retryable
          ? calculateNextAttemptAt(failedAt, retryPolicy, attempt)
          : undefined;
        await appendWorkflowRunEvent(input.statePath, {
          type: "step.attempt.failed",
          runId,
          stepId: step.id,
          attempt,
          occurredAt: failedAt,
          retry: {
            retryable,
            ...(nextAttemptAt === undefined ? {} : { nextAttemptAt }),
            reason: errorReason(error)
          }
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
          outcome: { status: "failed", reason: errorReason(error) }
        });

        if (!retryable) {
          const completedAt = now();
          await appendWorkflowRunEvent(input.statePath, {
            type: "run.completed",
            runId,
            terminalState: "failed",
            occurredAt: completedAt
          });
          await auditWriter?.write({
            type: "workflow.failed",
            occurredAt: completedAt,
            outcome: { status: "failed", reason: errorReason(error) }
          });
          return readWorkflowRunState(input.statePath);
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
  await appendWorkflowRunEvent(input.statePath, {
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

  return readWorkflowRunState(input.statePath);
};

export const loadWorkflowDefinitionFile = async (
  definitionPath: string
): Promise<WorkflowDefinition> => {
  const parsed = JSON.parse(await readFile(definitionPath, "utf8")) as unknown;
  const validation = validateWorkflowDefinition(parsed);
  if (!validation.valid) {
    const details = validation.errors
      .map((error) => `${error.path}: ${error.message}`)
      .join("; ");
    throw new Error(`workflow definition is invalid: ${details}`);
  }

  return parsed as WorkflowDefinition;
};

const defaultWorkflowStepHandler: WorkflowStepHandler = ({ step }) => {
  if (step.action.name.trim() === "") {
    throw new Error("step action name must be configured");
  }
};

const readExistingRunState = async (statePath: string): Promise<WorkflowRunState | undefined> => {
  try {
    return await readWorkflowRunState(statePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return undefined;
    }

    throw error;
  }
};

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
      .replaceAll("{trigger.idempotencyKey}", resolveTriggerKey(triggerContext))
  };
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
    status: "succeeded" | "failed";
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
