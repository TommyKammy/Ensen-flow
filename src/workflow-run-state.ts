import { constants } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const ISO_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;
const TERMINAL_STATES = new Set([
  "succeeded",
  "failed",
  "canceled",
  "retryable-failed"
]);
const STEP_ATTEMPT_TERMINAL_STATUSES = new Set([
  "succeeded",
  "failed",
  "retryable-failed"
]);
const EVENT_TYPES = new Set([
  "run.created",
  "step.attempt.started",
  "step.attempt.completed",
  "step.attempt.failed",
  "run.completed"
]);
const RUN_CREATED_ALLOWED_KEYS = new Set([
  "type",
  "runId",
  "workflowId",
  "workflowVersion",
  "trigger",
  "occurredAt"
]);
const STEP_ATTEMPT_ALLOWED_KEYS = new Set([
  "type",
  "runId",
  "stepId",
  "attempt",
  "occurredAt",
  "retry"
]);
const RUN_COMPLETED_ALLOWED_KEYS = new Set([
  "type",
  "runId",
  "terminalState",
  "occurredAt"
]);
const RETRY_METADATA_ALLOWED_KEYS = new Set([
  "retryable",
  "nextAttemptAt",
  "reason"
]);
const TRIGGER_ALLOWED_KEYS = new Set([
  "type",
  "receivedAt",
  "context",
  "idempotencyKey"
]);
const IDEMPOTENCY_METADATA_ALLOWED_KEYS = new Set([
  "source",
  "key"
]);

export type WorkflowRunTerminalState =
  | "succeeded"
  | "failed"
  | "canceled"
  | "retryable-failed";

export type WorkflowRunStatus = "created" | "running" | WorkflowRunTerminalState;

export interface WorkflowRunTriggerContext {
  type: string;
  receivedAt: string;
  context?: Record<string, unknown>;
  idempotencyKey?: WorkflowRunIdempotencyMetadata;
}

export interface WorkflowRunIdempotencyMetadata {
  source: "input" | "workflow" | "static";
  key: string;
}

export interface WorkflowRunRetryMetadata {
  retryable: boolean;
  nextAttemptAt?: string;
  reason?: string;
}

export interface CreateWorkflowRunInput {
  runId: string;
  workflowId: string;
  workflowVersion: string;
  trigger: WorkflowRunTriggerContext;
  createdAt: string;
}

export interface WorkflowRunCreatedEvent {
  type: "run.created";
  runId: string;
  workflowId: string;
  workflowVersion: string;
  trigger: WorkflowRunTriggerContext;
  occurredAt: string;
}

export interface WorkflowStepAttemptEvent {
  type: "step.attempt.started" | "step.attempt.completed" | "step.attempt.failed";
  runId: string;
  stepId: string;
  attempt: number;
  occurredAt: string;
  retry?: WorkflowRunRetryMetadata;
}

export interface WorkflowRunCompletedEvent {
  type: "run.completed";
  runId: string;
  terminalState: WorkflowRunTerminalState;
  occurredAt: string;
}

export type WorkflowRunEvent =
  | WorkflowRunCreatedEvent
  | WorkflowStepAttemptEvent
  | WorkflowRunCompletedEvent;

export type AppendableWorkflowRunEvent =
  | WorkflowStepAttemptEvent
  | WorkflowRunCompletedEvent;

export interface WorkflowRunRecord {
  runId: string;
  workflowId: string;
  workflowVersion: string;
  trigger: WorkflowRunTriggerContext;
  createdAt: string;
  updatedAt: string;
  status: WorkflowRunStatus;
  terminalState?: WorkflowRunTerminalState;
}

export interface WorkflowStepAttemptState {
  attempt: number;
  startedAt?: string;
  completedAt?: string;
  failedAt?: string;
  retry?: WorkflowRunRetryMetadata;
  status: "running" | "succeeded" | "failed" | "retryable-failed";
}

export interface WorkflowRunState {
  run: WorkflowRunRecord;
  events: WorkflowRunEvent[];
  stepAttempts: Record<string, WorkflowStepAttemptState[]>;
}

export const createWorkflowRun = async (
  statePath: string,
  input: CreateWorkflowRunInput
): Promise<void> => {
  const event: WorkflowRunCreatedEvent = {
    type: "run.created",
    runId: input.runId,
    workflowId: input.workflowId,
    workflowVersion: input.workflowVersion,
    trigger: input.trigger,
    occurredAt: input.createdAt
  };

  validateWorkflowRunEvent(event, 1);
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(event)}\n`, { encoding: "utf8", flag: "wx" });
};

export const appendWorkflowRunEvent = async (
  statePath: string,
  event: AppendableWorkflowRunEvent
): Promise<void> => {
  validateWorkflowRunEvent(event, 1);
  await mkdir(dirname(statePath), { recursive: true });

  const currentState = await readWorkflowRunState(statePath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(
        "appendWorkflowRunEvent requires an existing workflow run state file; call createWorkflowRun before appendWorkflowRunEvent so readWorkflowRunState can project a stream with run.created"
      );
    }

    throw error;
  });

  if (currentState.run.runId !== event.runId) {
    throw new Error("appendWorkflowRunEvent event.runId must match the existing workflow run");
  }

  if (currentState.run.terminalState !== undefined) {
    throw new Error("appendWorkflowRunEvent cannot append to a completed workflow run");
  }

  let stateFile;
  try {
    stateFile = await open(statePath, constants.O_WRONLY | constants.O_APPEND);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new Error(
        "appendWorkflowRunEvent requires an existing workflow run state file; call createWorkflowRun before appendWorkflowRunEvent so readWorkflowRunState can project a stream with run.created"
      );
    }

    throw error;
  }

  try {
    await stateFile.writeFile(`${JSON.stringify(event)}\n`, "utf8");
  } finally {
    await stateFile.close();
  }
};

export const readWorkflowRunState = async (
  statePath: string
): Promise<WorkflowRunState> => {
  const contents = await readFile(statePath, "utf8");
  const events = parseWorkflowRunEvents(contents);

  if (events.length === 0) {
    throw new Error("workflow run state must contain a run.created record");
  }

  const [createdEvent] = events;
  if (createdEvent.type !== "run.created") {
    throw new Error("workflow run state line 1: first record must be run.created");
  }

  const stepAttempts: Record<string, WorkflowStepAttemptState[]> = {};
  const run: WorkflowRunRecord = {
    runId: createdEvent.runId,
    workflowId: createdEvent.workflowId,
    workflowVersion: createdEvent.workflowVersion,
    trigger: createdEvent.trigger,
    createdAt: createdEvent.occurredAt,
    updatedAt: createdEvent.occurredAt,
    status: "created"
  };

  events.slice(1).forEach((event, index) => {
    const lineNumber = index + 2;
    if (run.terminalState !== undefined) {
      throw new Error(`workflow run state line ${lineNumber}: no records are allowed after run.completed`);
    }

    if (event.type === "run.created") {
      throw new Error(`workflow run state line ${lineNumber}: run.created must only appear once`);
    }

    if (event.runId !== run.runId) {
      throw new Error(`workflow run state line ${lineNumber}: runId must match run.created`);
    }

    run.updatedAt = event.occurredAt;

    if (event.type === "run.completed") {
      run.status = event.terminalState;
      run.terminalState = event.terminalState;
      return;
    }

    run.status = run.terminalState ?? "running";
    applyStepAttemptEvent(stepAttempts, event, lineNumber);
  });

  return {
    run,
    events,
    stepAttempts
  };
};

const parseWorkflowRunEvents = (contents: string): WorkflowRunEvent[] => {
  const lines = contents.split("\n");
  if (lines.at(-1) === "") {
    lines.pop();
  }

  return lines.map((line, index) => {
    const lineNumber = index + 1;
    if (line.trim() === "") {
      throw new Error(`workflow run state line ${lineNumber}: record must not be blank`);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid JSON";
      throw new Error(`workflow run state line ${lineNumber}: invalid JSON: ${message}`);
    }

    return validateWorkflowRunEvent(parsed, lineNumber);
  });
};

const applyStepAttemptEvent = (
  stepAttempts: Record<string, WorkflowStepAttemptState[]>,
  event: WorkflowStepAttemptEvent,
  lineNumber: number
): void => {
  const attempts = (stepAttempts[event.stepId] ??= []);
  let attempt = attempts.find((candidate) => candidate.attempt === event.attempt);

  if (event.type === "step.attempt.started") {
    if (attempt !== undefined) {
      throw stateError(
        lineNumber,
        `workflow step attempt ${event.stepId}#${event.attempt}: step.attempt.started cannot follow ${attempt.status}`
      );
    }

    const runningAttempt = attempts.find((candidate) => candidate.status === "running");
    if (runningAttempt !== undefined) {
      throw stateError(
        lineNumber,
        `workflow step attempt ${event.stepId}#${event.attempt}: step.attempt.started cannot follow running attempt ${event.stepId}#${runningAttempt.attempt}`
      );
    }

    const latestAttempt = attempts.at(-1);
    const expectedAttempt = latestAttempt === undefined ? 1 : latestAttempt.attempt + 1;
    if (event.attempt !== expectedAttempt) {
      throw stateError(
        lineNumber,
        `workflow step attempt ${event.stepId}#${event.attempt}: attempt numbers must increase by 1`
      );
    }

    attempts.push({
      attempt: event.attempt,
      startedAt: event.occurredAt,
      retry: event.retry,
      status: "running"
    });
    attempts.sort((left, right) => left.attempt - right.attempt);
    return;
  }

  if (attempt === undefined) {
    throw stateError(
      lineNumber,
      `workflow step attempt ${event.stepId}#${event.attempt}: ${event.type} requires step.attempt.started first`
    );
  }

  if (STEP_ATTEMPT_TERMINAL_STATUSES.has(attempt.status)) {
    throw stateError(
      lineNumber,
      `workflow step attempt ${event.stepId}#${event.attempt}: ${event.type} cannot follow ${attempt.status}`
    );
  }

  if (event.type === "step.attempt.completed") {
    attempt.completedAt = event.occurredAt;
    attempt.status = "succeeded";
    attempt.retry = event.retry;
  } else {
    attempt.failedAt = event.occurredAt;
    attempt.status = event.retry?.retryable === true ? "retryable-failed" : "failed";
    attempt.retry = event.retry;
  }
};

const validateWorkflowRunEvent = (
  value: unknown,
  lineNumber: number
): WorkflowRunEvent => {
  if (!isRecord(value)) {
    throw stateError(lineNumber, "record must be an object");
  }

  const eventType = value.type;
  if (typeof eventType !== "string" || !EVENT_TYPES.has(eventType)) {
    throw stateError(
      lineNumber,
      "type must be run.created, step.attempt.started, step.attempt.completed, step.attempt.failed, or run.completed"
    );
  }

  if (eventType === "run.created") {
    rejectUnknownKeys(value, RUN_CREATED_ALLOWED_KEYS, lineNumber);
    requireNonEmptyString(value, "runId", lineNumber);
    requireNonEmptyString(value, "workflowId", lineNumber);
    requireNonEmptyString(value, "workflowVersion", lineNumber);
    requireTimestamp(value, "occurredAt", lineNumber);
    validateTrigger(value.trigger, lineNumber);
    return value as unknown as WorkflowRunCreatedEvent;
  }

  if (eventType === "run.completed") {
    rejectUnknownKeys(value, RUN_COMPLETED_ALLOWED_KEYS, lineNumber);
    requireNonEmptyString(value, "runId", lineNumber);
    requireTimestamp(value, "occurredAt", lineNumber);

    if (typeof value.terminalState !== "string" || !TERMINAL_STATES.has(value.terminalState)) {
      throw stateError(
        lineNumber,
        "terminalState must be succeeded, failed, canceled, or retryable-failed"
      );
    }

    return value as unknown as WorkflowRunCompletedEvent;
  }

  rejectUnknownKeys(value, STEP_ATTEMPT_ALLOWED_KEYS, lineNumber);
  requireNonEmptyString(value, "runId", lineNumber);
  requireNonEmptyString(value, "stepId", lineNumber);
  requirePositiveInteger(value, "attempt", lineNumber);
  requireTimestamp(value, "occurredAt", lineNumber);

  if ("retry" in value) {
    validateRetryMetadata(value.retry, lineNumber);
  }

  return value as unknown as WorkflowStepAttemptEvent;
};

const validateTrigger = (value: unknown, lineNumber: number): void => {
  if (!isRecord(value)) {
    throw stateError(lineNumber, "trigger must be an object");
  }

  rejectUnknownKeys(value, TRIGGER_ALLOWED_KEYS, lineNumber);
  requireNonEmptyString(value, "type", lineNumber);
  requireTimestamp(value, "receivedAt", lineNumber);

  if ("context" in value && !isRecord(value.context)) {
    throw stateError(lineNumber, "trigger.context must be an object");
  }

  if ("idempotencyKey" in value) {
    validateIdempotencyMetadata(value.idempotencyKey, lineNumber);
  }
};

const validateIdempotencyMetadata = (value: unknown, lineNumber: number): void => {
  if (!isRecord(value)) {
    throw stateError(lineNumber, "trigger.idempotencyKey must be an object");
  }

  rejectUnknownKeys(value, IDEMPOTENCY_METADATA_ALLOWED_KEYS, lineNumber);
  if (
    value.source !== "input" &&
    value.source !== "workflow" &&
    value.source !== "static"
  ) {
    throw stateError(lineNumber, "idempotencyKey.source must be input, workflow, or static");
  }

  requireNonEmptyString(value, "key", lineNumber);
};

const validateRetryMetadata = (value: unknown, lineNumber: number): void => {
  if (!isRecord(value)) {
    throw stateError(lineNumber, "retry must be an object");
  }

  rejectUnknownKeys(value, RETRY_METADATA_ALLOWED_KEYS, lineNumber);

  if (typeof value.retryable !== "boolean") {
    throw stateError(lineNumber, "retry.retryable must be boolean");
  }

  if ("nextAttemptAt" in value) {
    requireTimestamp(value, "nextAttemptAt", lineNumber);
  }

  if ("reason" in value && (typeof value.reason !== "string" || value.reason.trim() === "")) {
    throw stateError(lineNumber, "retry.reason must be a non-empty string");
  }
};

const rejectUnknownKeys = (
  value: Record<string, unknown>,
  allowedKeys: Set<string>,
  lineNumber: number
): void => {
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw stateError(lineNumber, `${key} is outside the workflow run state schema boundary`);
    }
  }
};

const requireNonEmptyString = (
  value: Record<string, unknown>,
  key: string,
  lineNumber: number
): void => {
  if (typeof value[key] !== "string" || value[key].trim() === "") {
    throw stateError(lineNumber, `${key} must be a non-empty string`);
  }
};

const requireTimestamp = (
  value: Record<string, unknown>,
  key: string,
  lineNumber: number
): void => {
  if (typeof value[key] !== "string" || !isStrictIsoTimestamp(value[key])) {
    throw stateError(lineNumber, `${key} must be an ISO timestamp string`);
  }
};

const requirePositiveInteger = (
  value: Record<string, unknown>,
  key: string,
  lineNumber: number
): void => {
  if (typeof value[key] !== "number" || !Number.isInteger(value[key]) || value[key] < 1) {
    throw stateError(lineNumber, `${key} must be a positive integer`);
  }
};

const stateError = (lineNumber: number, message: string): Error =>
  new Error(`workflow run state line ${lineNumber}: ${message}`);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStrictIsoTimestamp = (value: string): boolean => {
  const match = ISO_TIMESTAMP_PATTERN.exec(value);
  if (match === null || Number.isNaN(Date.parse(value))) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (
    month < 1 ||
    month > 12 ||
    hour > 23 ||
    minute > 59 ||
    second > 59
  ) {
    return false;
  }

  return day >= 1 && day <= new Date(Date.UTC(year, month, 0)).getUTCDate();
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error;
