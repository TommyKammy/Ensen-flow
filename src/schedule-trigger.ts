import { join } from "node:path";

import type { WorkflowRunState } from "./workflow-run-state.js";
import {
  isValidScheduleCronExpression,
  validateWorkflowDefinition
} from "./workflow-definition.js";
import type { WorkflowDefinition } from "./workflow-definition.js";
import { runWorkflow } from "./workflow-runner.js";
import type { WorkflowStepHandler } from "./workflow-runner.js";

const SCHEDULED_FOR_UTC_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/;

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
  const scheduledFor = normalizeScheduledForUtc(input.scheduledFor);

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

  if (!isDueForSchedule(input.definition.trigger.cron, scheduledFor)) {
    return {
      status: "not-due",
      reason: "scheduledFor does not match trigger.cron"
    };
  }

  const runId = createScheduleRunId(input.definition.id, scheduledFor);
  return runWorkflow({
    definition: input.definition,
    statePath: join(input.stateRoot, `${runId}.jsonl`),
    auditPath: input.auditPath,
    runId,
    triggerContext: {
      schedule: {
        cron: input.definition.trigger.cron,
        scheduledFor
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

  const scheduledForDate = parseScheduledForUtc(scheduledFor);
  if (scheduledForDate === undefined) {
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

const parseScheduledForUtc = (value: string): Date | undefined => {
  const match = SCHEDULED_FOR_UTC_PATTERN.exec(value);
  if (match === null) {
    return undefined;
  }

  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return undefined;
  }

  const canonicalInput = `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${
    match[7] ?? "000"
  }Z`;
  return parsed.toISOString() === canonicalInput ? parsed : undefined;
};

const normalizeScheduledForUtc = (value: string): string => {
  const parsed = parseScheduledForUtc(value);
  if (parsed === undefined) {
    throw new Error("scheduledFor must be an ISO-8601 UTC timestamp");
  }

  return parsed.toISOString();
};
