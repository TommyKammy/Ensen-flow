import { createHash } from "node:crypto";

import {
  createFakeHttpNotificationTransport,
  createHttpNotificationConnector
} from "./http-notification-connector.js";
import { consumeWebhookInput } from "./webhook-intake.js";
import type {
  HttpNotificationTarget,
  HttpNotificationTransport
} from "./http-notification-connector.js";
import type { WebhookInput } from "./webhook-intake.js";
import type { WorkflowDefinition } from "./workflow-definition.js";
import type { WorkflowRunState } from "./workflow-run-state.js";

export const controlledPilotInputPackageSchemaVersion =
  "flow.controlled-pilot.input-package.v1";
export const selectedControlledPilotId = "webhook-review-notification";

export type ControlledPilotInputPackageMode = "dry-run";
export type ControlledPilotApprovalState = "approved" | "rejected";

export interface ControlledPilotApprovalCheckpoint {
  checkpointId: string;
  state: ControlledPilotApprovalState;
  decidedBy: string;
  decidedAt: string;
  reason: string;
  inputRef: string;
  inputFingerprint: string;
}

export interface ControlledPilotInputPackage {
  schemaVersion: typeof controlledPilotInputPackageSchemaVersion;
  pilotId: typeof selectedControlledPilotId;
  mode: ControlledPilotInputPackageMode;
  inputRef: string;
  webhook: WebhookInput;
  approval?: ControlledPilotApprovalCheckpoint;
  notification: HttpNotificationTarget;
}

export interface RunSelectedControlledPilotInput {
  inputPackage: ControlledPilotInputPackage;
  stateRoot: string;
  auditPath?: string;
  notificationTransport?: HttpNotificationTransport;
  now?: () => string;
}

export const selectedControlledPilotWorkflowDefinition = (): WorkflowDefinition => ({
  schemaVersion: "flow.workflow.v1",
  id: "controlled-pilot-webhook-review-notification",
  trigger: {
    type: "webhook",
    path: "/hooks/controlled-pilot",
    idempotencyKey: {
      source: "input",
      field: "requestId",
      required: true
    }
  },
  steps: [
    {
      id: "human-approval",
      action: {
        type: "approval",
        name: "human_approval_checkpoint"
      }
    },
    {
      id: "notify-operator",
      dependsOn: ["human-approval"],
      action: {
        type: "notification",
        name: "http_notification"
      },
      retry: {
        maxAttempts: 2,
        backoff: {
          strategy: "fixed",
          delayMs: 1000
        }
      }
    }
  ]
});

export const createControlledPilotInputFingerprint = (
  inputPackage: Pick<ControlledPilotInputPackage, "webhook">
): string => createWebhookInputFingerprint(inputPackage.webhook);

export const runSelectedControlledPilot = async (
  input: RunSelectedControlledPilotInput
): Promise<WorkflowRunState> => {
  const normalizedPackage = validateControlledPilotInputPackage(input.inputPackage);
  const inputFingerprint = createWebhookInputFingerprint(normalizedPackage.webhook);
  const approval = normalizeApprovalCheckpoint({
    approval: normalizedPackage.approval,
    inputRef: normalizedPackage.inputRef,
    inputFingerprint
  });
  const notificationTransport =
    input.notificationTransport ?? createFakeHttpNotificationTransport();
  const notificationConnector = createHttpNotificationConnector({
    transport: notificationTransport,
    now: input.now
  });

  return consumeWebhookInput({
    definition: selectedControlledPilotWorkflowDefinition(),
    stateRoot: input.stateRoot,
    auditPath: input.auditPath,
    input: normalizedPackage.webhook,
    now: input.now,
    stepHandler: async ({ step, runState, attempt }) => {
      if (step.id === "human-approval") {
        if (approval === undefined) {
          return {
            requestId: "approval-required",
            status: "approval-required",
            observedAt: input.now?.() ?? new Date().toISOString(),
            result: {
              status: "blocked",
              summary: "human approval checkpoint is required before notification",
              output: {
                approvalCheckpoint: createPendingApprovalCheckpoint({
                  inputRef: normalizedPackage.inputRef,
                  inputFingerprint
                })
              }
            }
          };
        }

        const approvalCheckpoint = createRecordedApprovalCheckpoint(approval);
        return {
          requestId: approval.checkpointId,
          status: approval.state === "approved" ? "succeeded" : "blocked",
          observedAt: approval.decidedAt,
          result: {
            status: approval.state === "approved" ? "succeeded" : "blocked",
            summary: approval.reason,
            output: {
              approvalCheckpoint
            }
          }
        };
      }

      if (step.id !== "notify-operator") {
        return undefined;
      }

      if (approval?.state !== "approved") {
        throw new Error("human approval checkpoint must be approved before notification");
      }

      const submitted = await notificationConnector.submit({
        workflowId: runState.run.workflowId,
        runId: runState.run.runId,
        stepId: step.id,
        idempotencyKey: `${runState.run.runId}:${step.id}`,
        attempt,
        notification: normalizedPackage.notification
      });

      if (!submitted.ok) {
        throw new Error(submitted.error.message);
      }

      return {
        executor: {
          requestId: submitted.value.requestId,
          status: "succeeded",
          observedAt: submitted.value.acceptedAt,
          result: {
            status: "succeeded",
            summary: submitted.value.notification.summary,
            evidence: submitted.value.evidence
          }
        }
      };
    }
  });
};

const validateControlledPilotInputPackage = (
  value: ControlledPilotInputPackage
): ControlledPilotInputPackage => {
  if (!isRecord(value)) {
    throw new Error("controlled pilot input package must be an object");
  }

  rejectUnknownPackageKeys(value);
  if (value.schemaVersion !== controlledPilotInputPackageSchemaVersion) {
    throw new Error(
      `controlled pilot input package schemaVersion must be ${controlledPilotInputPackageSchemaVersion}`
    );
  }

  if (value.pilotId !== selectedControlledPilotId) {
    throw new Error(`controlled pilot input package pilotId must be ${selectedControlledPilotId}`);
  }

  if (value.mode !== "dry-run") {
    throw new Error("controlled pilot input package mode must be dry-run");
  }

  validatePortableFixtureRef(value.inputRef, "controlled pilot inputRef");
  if (!isRecord(value.webhook)) {
    throw new Error("controlled pilot input package webhook must be an object");
  }

  if (!isRecord(value.notification)) {
    throw new Error("controlled pilot input package notification must be an object");
  }

  return value;
};

const normalizeApprovalCheckpoint = (input: {
  approval: ControlledPilotApprovalCheckpoint | undefined;
  inputRef: string;
  inputFingerprint: string;
}): ControlledPilotApprovalCheckpoint | undefined => {
  if (input.approval === undefined) {
    return undefined;
  }

  const approval = input.approval;
  if (!isRecord(approval)) {
    throw new Error("controlled pilot approval checkpoint must be an object");
  }

  rejectUnknownApprovalKeys(approval);
  requireBoundedString(approval.checkpointId, "controlled pilot approval checkpointId");
  if (approval.state !== "approved" && approval.state !== "rejected") {
    throw new Error("controlled pilot approval state must be approved or rejected");
  }

  requireBoundedString(approval.decidedBy, "controlled pilot approval decidedBy");
  requireStrictUtcMillisTimestamp(approval.decidedAt, "controlled pilot approval decidedAt");
  requireBoundedString(approval.reason, "controlled pilot approval reason");
  validatePortableFixtureRef(approval.inputRef, "controlled pilot approval inputRef");
  requireBoundedString(
    approval.inputFingerprint,
    "controlled pilot approval inputFingerprint"
  );

  if (approval.inputRef !== input.inputRef) {
    throw new Error("controlled pilot approval inputRef must match the package inputRef");
  }

  if (approval.inputFingerprint !== input.inputFingerprint) {
    throw new Error("controlled pilot approval inputFingerprint must match the webhook input");
  }

  return approval;
};

const createPendingApprovalCheckpoint = (input: {
  inputRef: string;
  inputFingerprint: string;
}) => ({
  schemaVersion: "flow.approval-checkpoint.v1",
  checkpointId: "human-approval-required",
  state: "approval-required" as const,
  reason: "human approval checkpoint is required before notification",
  inputRef: input.inputRef,
  inputFingerprint: input.inputFingerprint
});

const createRecordedApprovalCheckpoint = (
  approval: ControlledPilotApprovalCheckpoint
) => ({
  schemaVersion: "flow.approval-checkpoint.v1",
  checkpointId: approval.checkpointId,
  state: approval.state,
  decidedBy: approval.decidedBy,
  decidedAt: approval.decidedAt,
  reason: approval.reason,
  inputRef: approval.inputRef,
  inputFingerprint: approval.inputFingerprint
});

const createWebhookInputFingerprint = (input: WebhookInput): string =>
  createHash("sha256")
    .update(stableStringify(input))
    .digest("hex");

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }

  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  return `{${entries
    .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableStringify(nestedValue)}`)
    .join(",")}}`;
};

const PACKAGE_ALLOWED_KEYS = new Set([
  "schemaVersion",
  "pilotId",
  "mode",
  "inputRef",
  "webhook",
  "approval",
  "notification"
]);
const APPROVAL_ALLOWED_KEYS = new Set([
  "checkpointId",
  "state",
  "decidedBy",
  "decidedAt",
  "reason",
  "inputRef",
  "inputFingerprint"
]);
const BOUNDED_STRING_MAX_LENGTH = 512;
const PORTABLE_FIXTURE_REF_PATTERN =
  /^fixtures\/controlled-pilot\/[a-z0-9][a-z0-9.-]*\.json$/;
const ISO_UTC_MILLIS_TIMESTAMP_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.\d{3}Z$/;

const rejectUnknownPackageKeys = (value: Record<string, unknown>): void => {
  for (const key of Object.keys(value)) {
    if (!PACKAGE_ALLOWED_KEYS.has(key)) {
      throw new Error(`${key} is outside the controlled pilot input package boundary`);
    }
  }
};

const rejectUnknownApprovalKeys = (value: Record<string, unknown>): void => {
  for (const key of Object.keys(value)) {
    if (!APPROVAL_ALLOWED_KEYS.has(key)) {
      throw new Error(`${key} is outside the controlled pilot approval checkpoint boundary`);
    }
  }
};

const validatePortableFixtureRef = (value: unknown, label: string): void => {
  const ref = requireBoundedString(value, label);
  if (!PORTABLE_FIXTURE_REF_PATTERN.test(ref)) {
    throw new Error(`${label} must be a repo-relative controlled pilot fixture reference`);
  }
};

const requireBoundedString = (value: unknown, label: string): string => {
  if (
    typeof value !== "string" ||
    value.trim() === "" ||
    value.length > BOUNDED_STRING_MAX_LENGTH
  ) {
    throw new Error(`${label} must be a bounded non-empty string`);
  }

  return value;
};

const requireStrictUtcMillisTimestamp = (value: unknown, label: string): void => {
  if (typeof value !== "string" || !isStrictUtcMillisTimestamp(value)) {
    throw new Error(`${label} must be an ISO-8601 UTC timestamp with milliseconds`);
  }
};

const isStrictUtcMillisTimestamp = (value: string): boolean => {
  const match = ISO_UTC_MILLIS_TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    return false;
  }

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString() === value;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
