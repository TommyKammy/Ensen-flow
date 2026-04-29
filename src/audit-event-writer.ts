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

export const createLocalAuditEventWriter = (
  input: CreateLocalAuditEventWriterInput
): NeutralAuditEventWriter => {
  let sequence = 0;
  const actor = input.actor ?? { type: "system" as const, id: DEFAULT_RUNNER_CONTEXT };
  const source = input.source ?? { type: "runner" as const, id: DEFAULT_RUNNER_CONTEXT };

  return {
    async write(eventInput) {
      sequence += 1;
      const event: NeutralAuditEvent = {
        id: createAuditEventId(input.run.id, sequence),
        actor,
        source,
        workflow: input.workflow,
        run: input.run,
        ...eventInput
      };

      validateNeutralAuditEvent(event);
      await appendAuditEvent(input.auditPath, event);
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
  requireNonEmptyString(event.id, "audit event id");
  requireIsoTimestamp(event.occurredAt, "audit event occurredAt");
  requireNonEmptyString(event.actor.id, "audit event actor.id");
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
  if (Number.isNaN(Date.parse(value))) {
    throw new Error(`${label} must be an ISO timestamp string`);
  }
};
