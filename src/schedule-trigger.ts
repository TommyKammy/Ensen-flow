import { join } from "node:path";

import type { WorkflowRunState } from "./workflow-run-state.js";
import {
  isValidScheduleCronExpression,
  validateWorkflowDefinition
} from "./workflow-definition.js";
import type { WorkflowDefinition } from "./workflow-definition.js";
import { runWorkflow } from "./workflow-runner.js";
import type { WorkflowStepHandler } from "./workflow-runner.js";

export interface EvaluateScheduleTriggerInput {
  definition: WorkflowDefinition;
  stateRoot: string;
  auditPath?: string;
  scheduledFor: string;
  now?: () => string;
  stepHandler?: WorkflowStepHandler;
}

export interface ScheduleTriggerNotDueResult {
  status: "not-due";
  reason: "scheduledFor does not match trigger.cron";
}

export type ScheduleTriggerEvaluationResult =
  | WorkflowRunState
  | ScheduleTriggerNotDueResult;

export const evaluateScheduleTrigger = async (
  input: EvaluateScheduleTriggerInput
): Promise<ScheduleTriggerEvaluationResult> => {
  const validation = validateWorkflowDefinition(input.definition);
  if (!validation.valid) {
    const details = validation.errors
      .map((error) => `${error.path}: ${error.message}`)
      .join("; ");
    throw new Error(`workflow definition is invalid: ${details}`);
  }

  if (input.definition.trigger.type !== "schedule") {
    throw new Error("evaluateScheduleTrigger requires a schedule trigger workflow");
  }

  if (!isDueForSchedule(input.definition.trigger.cron, input.scheduledFor)) {
    return {
      status: "not-due",
      reason: "scheduledFor does not match trigger.cron"
    };
  }

  const runId = createScheduleRunId(input.definition.id, input.scheduledFor);
  return runWorkflow({
    definition: input.definition,
    statePath: join(input.stateRoot, `${runId}.jsonl`),
    auditPath: input.auditPath,
    runId,
    triggerContext: {
      schedule: {
        cron: input.definition.trigger.cron,
        scheduledFor: input.scheduledFor
      }
    },
    now: input.now,
    stepHandler: input.stepHandler
  });
};

export const isDueForSchedule = (cron: string, scheduledFor: string): boolean => {
  if (!isValidScheduleCronExpression(cron)) {
    return false;
  }

  const scheduledForDate = new Date(scheduledFor);
  if (!Number.isFinite(scheduledForDate.getTime())) {
    return false;
  }

  const fields = cron.trim().split(/\s+/);
  const dateFields = [
    scheduledForDate.getUTCMinutes(),
    scheduledForDate.getUTCHours(),
    scheduledForDate.getUTCDate(),
    scheduledForDate.getUTCMonth() + 1,
    scheduledForDate.getUTCDay()
  ];

  return fields.every((field, index) => field === "*" || Number(field) === dateFields[index]);
};

const createScheduleRunId = (workflowId: string, scheduledFor: string): string =>
  `${workflowId}-scheduled-${compactTimestamp(scheduledFor)}`;

const compactTimestamp = (value: string): string =>
  value.replaceAll("-", "").replaceAll(":", "").replace(".", "").replace("Z", "Z");
