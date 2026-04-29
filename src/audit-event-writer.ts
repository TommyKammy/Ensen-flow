import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

import type { WorkflowRunTerminalState } from "./workflow-run-state.js";

export type NeutralAuditEventType =
  | "workflow.started"
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "step.retry.scheduled"
  | "workflow.completed"
  | "workflow.failed";

export interface NeutralAuditActorContext {
  type: "system";
  id: string;
}

export interface NeutralAuditSourceContext {
  type: "runner";
  id: string;
}

export interface NeutralAuditWorkflowReference {
  id: string;
  version: string;
}

export interface NeutralAuditRunReference {
  id: string;
}

export interface NeutralAuditStepReference {
  id: string;
  attempt: number;
}

export interface NeutralAuditRetryContext {
  retryable: boolean;
  reason: string;
  nextAttemptAt?: string;
}

export interface NeutralAuditOutcomeContext {
  status: WorkflowRunTerminalState | "succeeded" | "failed";
  reason?: string;
}

export interface NeutralAuditEvent {
  id: string;
  type: NeutralAuditEventType;
  occurredAt: string;
  actor: NeutralAuditActorContext;
  source: NeutralAuditSourceContext;
  workflow: NeutralAuditWorkflowReference;
  run: NeutralAuditRunReference;
  step?: NeutralAuditStepReference;
  retry?: NeutralAuditRetryContext;
  outcome?: NeutralAuditOutcomeContext;
}

export interface NeutralAuditEventWriter {
  write(event: CreateNeutralAuditEventInput): Promise<void>;
}

export type CreateNeutralAuditEventInput = Omit<
  NeutralAuditEvent,
  "id" | "actor" | "source" | "workflow" | "run"
>;

export interface CreateLocalAuditEventWriterInput {
  auditPath: string;
  workflow: NeutralAuditWorkflowReference;
  run: NeutralAuditRunReference;
  actor?: NeutralAuditActorContext;
  source?: NeutralAuditSourceContext;
}

const DEFAULT_RUNNER_CONTEXT = "ensen-flow.local-runner";
const NEUTRAL_AUDIT_ACTOR_TYPE = "system";
const NEUTRAL_AUDIT_SOURCE_TYPE = "runner";
const NEUTRAL_AUDIT_EVENT_TYPES = new Set<string>([
  "workflow.started",
  "step.started",
  "step.completed",
  "step.failed",
  "step.retry.scheduled",
  "workflow.completed",
  "workflow.failed"
]);
const NEUTRAL_AUDIT_OUTCOME_STATUSES = new Set<string>([
  "succeeded",
  "failed",
  "canceled",
  "retryable-failed"
]);
const ISO_UTC_MILLIS_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/;

export const createLocalAuditEventWriter = (
  input: CreateLocalAuditEventWriterInput
): NeutralAuditEventWriter => {
  let sequence = 0;
  const auditPath = input.auditPath;
  const actor = Object.freeze(
    input.actor === undefined
      ? { type: "system" as const, id: DEFAULT_RUNNER_CONTEXT }
      : { ...input.actor }
  );
  const source = Object.freeze(
    input.source === undefined
      ? { type: "runner" as const, id: DEFAULT_RUNNER_CONTEXT }
      : { ...input.source }
  );
  const workflow = Object.freeze({ ...input.workflow });
  const run = Object.freeze({ ...input.run });

  return {
    async write(eventInput) {
      sequence += 1;
      const step =
        eventInput.step === undefined ? undefined : Object.freeze({ ...eventInput.step });
      const retry =
        eventInput.retry === undefined ? undefined : Object.freeze({ ...eventInput.retry });
      const outcome =
        eventInput.outcome === undefined ? undefined : Object.freeze({ ...eventInput.outcome });
      const event: NeutralAuditEvent = {
        id: createAuditEventId(run.id, sequence),
        type: eventInput.type,
        occurredAt: eventInput.occurredAt,
        actor,
        source,
        workflow,
        run,
        ...(step === undefined ? {} : { step }),
        ...(retry === undefined ? {} : { retry }),
        ...(outcome === undefined ? {} : { outcome })
      };

      validateNeutralAuditEvent(event);
      await appendAuditEvent(auditPath, event);
    }
  };
};

const createAuditEventId = (runId: string, sequence: number): string =>
  `audit.${runId}.${String(sequence).padStart(6, "0")}`;

const appendAuditEvent = async (auditPath: string, event: NeutralAuditEvent): Promise<void> => {
  await mkdir(dirname(auditPath), { recursive: true });
  const auditFile = await open(auditPath, "a");
  try {
    await auditFile.writeFile(`${JSON.stringify(event)}\n`, "utf8");
  } finally {
    await auditFile.close();
  }
};

const validateNeutralAuditEvent = (event: NeutralAuditEvent): void => {
  if (!NEUTRAL_AUDIT_EVENT_TYPES.has(event.type)) {
    throw new Error("audit event type is invalid");
  }

  requireNonEmptyString(event.id, "audit event id");
  requireIsoTimestamp(event.occurredAt, "audit event occurredAt");
  if (event.actor.type !== NEUTRAL_AUDIT_ACTOR_TYPE) {
    throw new Error("audit event actor.type must be system");
  }
  requireNonEmptyString(event.actor.id, "audit event actor.id");
  if (event.source.type !== NEUTRAL_AUDIT_SOURCE_TYPE) {
    throw new Error("audit event source.type must be runner");
  }
  requireNonEmptyString(event.source.id, "audit event source.id");
  requireNonEmptyString(event.workflow.id, "audit event workflow.id");
  requireNonEmptyString(event.workflow.version, "audit event workflow.version");
  requireNonEmptyString(event.run.id, "audit event run.id");

  if (event.step !== undefined) {
    requireNonEmptyString(event.step.id, "audit event step.id");
    if (!Number.isInteger(event.step.attempt) || event.step.attempt < 1) {
      throw new Error("audit event step.attempt must be a positive integer");
    }
  }

  if (event.retry !== undefined) {
    requireNonEmptyString(event.retry.reason, "audit event retry.reason");
    if (event.retry.nextAttemptAt !== undefined) {
      requireIsoTimestamp(event.retry.nextAttemptAt, "audit event retry.nextAttemptAt");
    }
  }

  if (event.outcome !== undefined && !NEUTRAL_AUDIT_OUTCOME_STATUSES.has(event.outcome.status)) {
    throw new Error(
      "audit event outcome.status must be succeeded, failed, canceled, or retryable-failed"
    );
  }

  if (event.outcome?.reason !== undefined) {
    requireNonEmptyString(event.outcome.reason, "audit event outcome.reason");
  }
};

const requireNonEmptyString = (value: string, label: string): void => {
  if (value.trim() === "") {
    throw new Error(`${label} must be a non-empty string`);
  }
};

const requireIsoTimestamp = (value: string, label: string): void => {
  if (!isStrictUtcMillisTimestamp(value)) {
    throw new Error(`${label} must be an ISO timestamp string`);
  }
};

const isStrictUtcMillisTimestamp = (value: string): boolean => {
  const match = ISO_UTC_MILLIS_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) {
    return false;
  }

  const isLeapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [
    31,
    isLeapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31
  ];

  return day >= 1 && day <= daysInMonth[month - 1];
};
