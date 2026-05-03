import { constants } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import {
  findUnsafeWorkflowArtifactValue,
  formatUnsafeWorkflowArtifactDiagnostic
} from "./workflow-artifact-hygiene.js";

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
  "retryable-failed",
  "approval-required",
  "blocked",
  "manual-repair-needed"
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
  "retry",
  "result",
  "recovery"
]);
const RUN_COMPLETED_ALLOWED_KEYS = new Set([
  "type",
  "runId",
  "terminalState",
  "occurredAt",
  "recovery"
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
const RECOVERY_DECISION_ALLOWED_KEYS = new Set([
  "state",
  "decision",
  "reason"
]);
const RECOVERY_STATES = new Set([
  "approval-required",
  "retryable",
  "blocked",
  "abandoned",
  "manual-repair-needed"
]);
const RECOVERY_DECISIONS = new Set([
  "await-human-approval",
  "retry-step",
  "block-run",
  "abandon-run",
  "manual-repair-needed"
]);
const statePathAppendLocks = new Map<string, Promise<void>>();

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

export type WorkflowRunRecoveryState =
  | "approval-required"
  | "retryable"
  | "blocked"
  | "abandoned"
  | "manual-repair-needed";

export type WorkflowRunRecoveryDecision =
  | "await-human-approval"
  | "retry-step"
  | "block-run"
  | "abandon-run"
  | "manual-repair-needed";

export interface WorkflowRunRecoveryDecisionMetadata {
  state: WorkflowRunRecoveryState;
  decision: WorkflowRunRecoveryDecision;
  reason: string;
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
  result?: WorkflowStepAttemptResultMetadata;
  recovery?: WorkflowRunRecoveryDecisionMetadata;
}

export interface WorkflowRunCompletedEvent {
  type: "run.completed";
  runId: string;
  terminalState: WorkflowRunTerminalState;
  occurredAt: string;
  recovery?: WorkflowRunRecoveryDecisionMetadata;
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
  result?: WorkflowStepAttemptResultMetadata;
  recovery?: WorkflowRunRecoveryDecisionMetadata;
  status:
    | "running"
    | "succeeded"
    | "failed"
    | "retryable-failed"
    | "approval-required"
    | "blocked"
    | "manual-repair-needed";
}

export interface WorkflowRunState {
  run: WorkflowRunRecord;
  events: WorkflowRunEvent[];
  stepAttempts: Record<string, WorkflowStepAttemptState[]>;
}

export type WorkflowStepAttemptResultMetadata = Record<string, unknown>;

export type WorkflowRunRecoveryClassification =
  | "recoverable"
  | "terminal"
  | "approval-required"
  | "blocked"
  | "corrupt"
  | "manual-repair-needed";

export type WorkflowRunRecoveryAction =
  | "resume-from-projected-state"
  | "do-not-replay"
  | "repair-jsonl-before-recovery"
  | "operator-review-required";

export interface WorkflowRunRecoveryReport {
  classification: WorkflowRunRecoveryClassification;
  action: WorkflowRunRecoveryAction;
  diagnostic: string;
  historyPreserved: true;
  run?: WorkflowRunRecoveryRunSummary;
  eventCount?: number;
  activeStepAttempts?: WorkflowRunRecoveryStepAttemptSummary[];
}

export interface WorkflowRunRecoveryRunSummary {
  runId: string;
  workflowId: string;
  workflowVersion: string;
  status: WorkflowRunStatus;
  terminalState?: WorkflowRunTerminalState;
  createdAt: string;
  updatedAt: string;
}

export interface WorkflowRunRecoveryStepAttemptSummary {
  stepId: string;
  attempt: number;
  status: WorkflowStepAttemptState["status"];
  startedAt?: string;
}

export interface StopWorkflowRunRecoveryInput {
  statePath: string;
  runId: string;
  stoppedAt: string;
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

  await withStatePathAppendLock(statePath, async () => {
    const currentState = await readWorkflowRunState(statePath).catch((error: unknown) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw missingWorkflowRunStateError();
      }

      throw error;
    });

    if (currentState.run.runId !== event.runId) {
      throw new Error("appendWorkflowRunEvent event.runId must match the existing workflow run");
    }

    if (currentState.run.terminalState !== undefined) {
      throw new Error("appendWorkflowRunEvent cannot append to a completed workflow run");
    }

    projectWorkflowRunEvents([...currentState.events, event]);

    let stateFile;
    try {
      stateFile = await open(statePath, constants.O_WRONLY | constants.O_APPEND);
    } catch (error) {
      if (isNodeError(error) && error.code === "ENOENT") {
        throw missingWorkflowRunStateError();
      }

      throw error;
    }

    try {
      await stateFile.writeFile(`${JSON.stringify(event)}\n`, "utf8");
    } finally {
      await stateFile.close();
    }
  });
};

export const readWorkflowRunState = async (
  statePath: string
): Promise<WorkflowRunState> => {
  const contents = await readFile(statePath, "utf8");
  const events = parseWorkflowRunEvents(contents);

  return projectWorkflowRunEvents(events);
};

export const inspectWorkflowRunRecovery = async (
  statePath: string
): Promise<WorkflowRunRecoveryReport> => {
  let state: WorkflowRunState;
  try {
    state = await readWorkflowRunState(statePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {
        classification: "manual-repair-needed",
        action: "operator-review-required",
        diagnostic: "workflow run state file is missing; recovery requires existing JSONL state",
        historyPreserved: true
      };
    }

    return {
      classification: "corrupt",
      action: "repair-jsonl-before-recovery",
      diagnostic: sanitizeRecoveryDiagnostic(error),
      historyPreserved: true
    };
  }

  const run = summarizeRecoveryRun(state.run);
  if (state.run.terminalState === "failed" && hasLatestStepStatus(state.stepAttempts, "blocked")) {
    return {
      classification: "blocked",
      action: "operator-review-required",
      diagnostic:
        "workflow run has blocked step attempts; operator review is required before retry, re-run, abandon, or manual repair",
      historyPreserved: true,
      run,
      eventCount: state.events.length
    };
  }

  if (state.run.terminalState !== undefined) {
    return {
      classification: "terminal",
      action: "do-not-replay",
      diagnostic: `workflow run ${state.run.runId} is terminal (${state.run.terminalState}); recovery must not replay active work`,
      historyPreserved: true,
      run,
      eventCount: state.events.length
    };
  }

  const activeStepAttempts = summarizeActiveStepAttempts(state.stepAttempts);
  if (activeStepAttempts.length > 0) {
    return {
      classification: "manual-repair-needed",
      action: "operator-review-required",
      diagnostic:
        "workflow run has active step attempts; operator review is required before stop or retry because local state cannot prove external side effects",
      historyPreserved: true,
      run,
      eventCount: state.events.length,
      activeStepAttempts
    };
  }

  if (hasLatestStepStatus(state.stepAttempts, "approval-required")) {
    return {
      classification: "approval-required",
      action: "operator-review-required",
      diagnostic:
        "workflow run has approval-required step attempts; human approval is required before retry, re-run, abandon, or manual repair",
      historyPreserved: true,
      run,
      eventCount: state.events.length
    };
  }

  if (hasLatestStepStatus(state.stepAttempts, "blocked")) {
    return {
      classification: "blocked",
      action: "operator-review-required",
      diagnostic:
        "workflow run has blocked step attempts; operator review is required before retry, re-run, abandon, or manual repair",
      historyPreserved: true,
      run,
      eventCount: state.events.length
    };
  }

  if (hasFailedNonTerminalStepAttempt(state.stepAttempts)) {
    return {
      classification: "manual-repair-needed",
      action: "operator-review-required",
      diagnostic:
        "workflow run has failed non-terminal step attempts; operator review is required before recovery because the run should have recorded a terminal state",
      historyPreserved: true,
      run,
      eventCount: state.events.length
    };
  }

  return {
    classification: "recoverable",
    action: "resume-from-projected-state",
    diagnostic:
      "workflow run is non-terminal and has no active step attempt; recovery can continue from projected JSONL state",
    historyPreserved: true,
    run,
    eventCount: state.events.length
  };
};

export const stopWorkflowRunRecovery = async (
  input: StopWorkflowRunRecoveryInput
): Promise<WorkflowRunRecoveryReport> => {
  const report = await inspectWorkflowRunRecovery(input.statePath);
  if (report.classification === "corrupt") {
    throw new Error(`cannot stop corrupt workflow run state: ${report.diagnostic}`);
  }

  if (report.run === undefined) {
    throw new Error(`cannot stop workflow run state: ${report.diagnostic}`);
  }

  if (report.run.runId !== input.runId) {
    throw new Error("cannot stop workflow run state: runId must match projected JSONL state");
  }

  if (report.classification === "terminal" || report.run.terminalState !== undefined) {
    return report;
  }

  await appendWorkflowRunEvent(input.statePath, {
    type: "run.completed",
    runId: input.runId,
    terminalState: "canceled",
    occurredAt: input.stoppedAt
  });

  return inspectWorkflowRunRecovery(input.statePath);
};

const projectWorkflowRunEvents = (events: WorkflowRunEvent[]): WorkflowRunState => {
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

    if (latestAttempt !== undefined && latestAttempt.status !== "retryable-failed") {
      throw stateError(
        lineNumber,
        `workflow step attempt ${event.stepId}#${event.attempt}: step.attempt.started cannot follow ${latestAttempt.status}`
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
    attempt.result = event.result;
    attempt.recovery = event.recovery;
  } else {
    attempt.failedAt = event.occurredAt;
    attempt.status = stepAttemptStatusFromFailedEvent(event);
    attempt.retry = event.retry;
    attempt.result = event.result;
    attempt.recovery = event.recovery;
  }
};

const stepAttemptStatusFromFailedEvent = (
  event: WorkflowStepAttemptEvent
): WorkflowStepAttemptState["status"] => {
  if (event.recovery?.state === "approval-required") {
    return "approval-required";
  }

  if (event.recovery?.state === "blocked") {
    return "blocked";
  }

  if (event.recovery?.state === "manual-repair-needed") {
    return "manual-repair-needed";
  }

  return event.retry?.retryable === true ? "retryable-failed" : "failed";
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

    if ("recovery" in value) {
      validateRecoveryDecisionMetadata(value.recovery, lineNumber);
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

  if ("result" in value) {
    if (eventType === "step.attempt.started") {
      throw stateError(lineNumber, "result is only allowed on terminal step attempt events");
    }
    validateResultMetadata(value.result, lineNumber);
  }

  if ("recovery" in value) {
    validateRecoveryDecisionMetadata(value.recovery, lineNumber);
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

  if ("context" in value) {
    validateJsonSerializableValue(value.context, lineNumber, "trigger.context");
    rejectUnsafeWorkflowArtifactValues(value.context, lineNumber, "trigger.context");
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
  rejectUnsafeWorkflowArtifactValues(value.key, lineNumber, "idempotencyKey.key");
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

  if ("reason" in value) {
    rejectUnsafeWorkflowArtifactValues(value.reason, lineNumber, "retry.reason");
  }
};

const validateRecoveryDecisionMetadata = (value: unknown, lineNumber: number): void => {
  if (!isRecord(value)) {
    throw stateError(lineNumber, "recovery must be an object");
  }

  rejectUnknownKeys(value, RECOVERY_DECISION_ALLOWED_KEYS, lineNumber);
  if (typeof value.state !== "string" || !RECOVERY_STATES.has(value.state)) {
    throw stateError(
      lineNumber,
      "recovery.state must be approval-required, retryable, blocked, abandoned, or manual-repair-needed"
    );
  }

  if (typeof value.decision !== "string" || !RECOVERY_DECISIONS.has(value.decision)) {
    throw stateError(
      lineNumber,
      "recovery.decision must be await-human-approval, retry-step, block-run, abandon-run, or manual-repair-needed"
    );
  }

  requireNonEmptyString(value, "reason", lineNumber);
  rejectUnsafeWorkflowArtifactValues(value.reason, lineNumber, "recovery.reason");
};

const validateResultMetadata = (value: unknown, lineNumber: number): void => {
  if (!isRecord(value)) {
    throw stateError(lineNumber, "result must be an object");
  }

  validateJsonSerializableValue(value, lineNumber, "result");
  rejectUnsafeWorkflowArtifactValues(value, lineNumber, "result");
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

const withStatePathAppendLock = async <T>(
  statePath: string,
  operation: () => Promise<T>
): Promise<T> => {
  const lockKey = resolve(statePath);
  const previousLock = statePathAppendLocks.get(lockKey) ?? Promise.resolve();
  let releaseLock: () => void = () => undefined;
  const currentLock = new Promise<void>((resolveLock) => {
    releaseLock = resolveLock;
  });
  const nextLock = previousLock.catch(() => undefined).then(() => currentLock);
  statePathAppendLocks.set(lockKey, nextLock);

  await previousLock.catch(() => undefined);

  try {
    return await operation();
  } finally {
    releaseLock();
    if (statePathAppendLocks.get(lockKey) === nextLock) {
      statePathAppendLocks.delete(lockKey);
    }
  }
};

const missingWorkflowRunStateError = (): Error =>
  new Error(
    "appendWorkflowRunEvent requires an existing workflow run state file; call createWorkflowRun before appendWorkflowRunEvent so readWorkflowRunState can project a stream with run.created"
  );

const summarizeRecoveryRun = (run: WorkflowRunRecord): WorkflowRunRecoveryRunSummary => ({
  runId: run.runId,
  workflowId: run.workflowId,
  workflowVersion: run.workflowVersion,
  status: run.status,
  terminalState: run.terminalState,
  createdAt: run.createdAt,
  updatedAt: run.updatedAt
});

const summarizeActiveStepAttempts = (
  stepAttempts: Record<string, WorkflowStepAttemptState[]>
): WorkflowRunRecoveryStepAttemptSummary[] =>
  Object.entries(stepAttempts).flatMap(([stepId, attempts]) =>
    attempts
      .filter((attempt) => attempt.status === "running")
      .map((attempt) => ({
        stepId,
        attempt: attempt.attempt,
        status: attempt.status,
        startedAt: attempt.startedAt
      }))
  );

const hasFailedNonTerminalStepAttempt = (
  stepAttempts: Record<string, WorkflowStepAttemptState[]>
): boolean =>
  Object.values(stepAttempts).some((attempts) =>
    ["failed", "manual-repair-needed"].includes(attempts.at(-1)?.status ?? "")
  );

const hasLatestStepStatus = (
  stepAttempts: Record<string, WorkflowStepAttemptState[]>,
  status: WorkflowStepAttemptState["status"]
): boolean => Object.values(stepAttempts).some((attempts) => attempts.at(-1)?.status === status);

const sanitizeRecoveryDiagnostic = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  const trimmed = message.trim();
  if (trimmed === "") {
    return "workflow run state could not be inspected";
  }

  return trimmed
    .replaceAll(/"[^"]*(?:\/Users\/|\/home\/|\\Users\\)[^"]*"/g, '"<path>"')
    .replaceAll(/(?:\/Users\/|\/home\/)[^\s)]+/g, "<path>")
    .replaceAll(/[A-Za-z]:\\Users\\[^\s)]+/g, "<path>");
};

const validateJsonSerializableValue = (
  value: unknown,
  lineNumber: number,
  path: string,
  seen: WeakSet<object> = new WeakSet()
): void => {
  if (value === null) {
    return;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return;
  }

  if (typeof value === "number") {
    if (Number.isFinite(value)) {
      return;
    }

    throw stateError(lineNumber, `${path} must contain only finite numbers`);
  }

  if (Array.isArray(value)) {
    validateJsonContainer(value, lineNumber, path, seen, () => {
      value.forEach((item, index) => {
        validateJsonSerializableValue(item, lineNumber, `${path}[${index}]`, seen);
      });
    });
    return;
  }

  if (isRecord(value) && isPlainJsonObject(value)) {
    validateJsonContainer(value, lineNumber, path, seen, () => {
      Object.entries(value).forEach(([key, item]) => {
        validateJsonSerializableValue(item, lineNumber, `${path}.${key}`, seen);
      });
    });
    return;
  }

  throw stateError(lineNumber, `${path} must contain only JSON-serializable values`);
};

const rejectUnsafeWorkflowArtifactValues = (
  value: unknown,
  lineNumber: number,
  path: string
): void => {
  const finding = findUnsafeWorkflowArtifactValue(value, path);
  if (finding !== undefined) {
    throw stateError(lineNumber, formatUnsafeWorkflowArtifactDiagnostic(finding));
  }
};

const validateJsonContainer = (
  value: object,
  lineNumber: number,
  path: string,
  seen: WeakSet<object>,
  validateChildren: () => void
): void => {
  if (seen.has(value)) {
    throw stateError(lineNumber, `${path} must not contain circular references`);
  }

  seen.add(value);
  try {
    validateChildren();
  } finally {
    seen.delete(value);
  }
};

const isPlainJsonObject = (value: Record<string, unknown>): boolean => {
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
};

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
